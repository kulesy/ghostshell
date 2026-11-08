import XCTest
@testable import GhostShellKit

/// Talks to the scratch server that `apple/scripts/test.mjs` starts. Skipped without it. Every routine here is created switched off or on a yearly
/// schedule, and none is run, so nothing starts a chat.
final class RoutineIntegrationTests: XCTestCase {
    private let folder = "/private/tmp/claude-501/capcom-test-cwd/swift-routines"

    private func signedIn() async throws -> GhostShellClient {
        let env = ProcessInfo.processInfo.environment
        guard let text = env["GS_SCRATCH_ADDRESS"], let file = env["GS_SCRATCH_PASSWORD_FILE"] else { throw XCTSkip("No scratch server. Run apple/scripts/test.mjs.") }
        let address = try XCTUnwrap(ServerAddress(text))
        let password = try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let client = GhostShellClient(address: address, store: MemoryTokenStore())
        try await client.signIn(password: password)
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        return client
    }

    private func load(_ client: GhostShellClient, _ id: String) async throws -> RoutineSummary {
        let list = try await client.routines()
        return try XCTUnwrap(list.routines.first { $0.id == id })
    }

    func testARoutineIsAddedEditedPausedRefusedAndDeleted() async throws {
        let client = try await signedIn()
        var draft = RoutineDraft(home: folder)
        (draft.title, draft.cron, draft.jitterSeconds, draft.prompt, draft.enabled) = ("Swift kit check", "0 3 1 1 *", "737", "Say hi.", false)
        let added = try await client.addRoutine(draft.request())
        let id = added.id
        do {
            XCTAssertEqual([added.title, added.cron, added.cwd], ["Swift kit check", "0 3 1 1 *", folder])
            XCTAssertEqual(added.jitterSeconds, 737)
            XCTAssertFalse(added.enabled)

            let listed = try await client.routines()
            XCTAssertTrue(listed.routines.contains { $0.id == id })

            let prompt = try await client.routinePrompt(id: id)
            XCTAssertEqual(prompt.text, "Say hi.")
            XCTAssertEqual(prompt.kind, .text)

            // Resume first so the schedule is armed, then edit only the title: cron, jitter and armedAt must not move.
            let resumed = try await client.setRoutineEnabled(id: id, true)
            XCTAssertTrue(resumed.enabled)
            let before = try await load(client, id)
            var edited = RoutineDraft(before, prompt: prompt)
            edited.title = "Swift kit check 2"
            let request = edited.request(against: RoutineBaseline(before, prompt: prompt))
            XCTAssertEqual(request.title, .value("Swift kit check 2"))
            XCTAssertEqual(request.cron, .omitted)
            XCTAssertEqual(request.jitterSeconds, .omitted)
            _ = try await client.editRoutine(id: id, request)
            let after = try await load(client, id)
            XCTAssertEqual(after.title, "Swift kit check 2")
            XCTAssertEqual([after.cron, String(after.jitterSeconds)], [before.cron, String(before.jitterSeconds)])
            XCTAssertEqual(after.armedAt?.iso, before.armedAt?.iso)
            XCTAssertNotNil(after.armedAt)

            let nothing = try await client.editRoutine(id: id, RoutineRequest())
            XCTAssertNil(nothing)

            let paused = try await client.setRoutineEnabled(id: id, false)
            XCTAssertFalse(paused.enabled)

            var bad = RoutineDraft(after, prompt: prompt)
            bad.cwd = folder + "/does-not-exist"
            do {
                _ = try await client.editRoutine(id: id, bad.request(against: RoutineBaseline(after, prompt: prompt)))
                XCTFail("A folder that is not there should be refused.")
            } catch GhostShellError.refused(let status, let message, let problems) {
                XCTAssertEqual(status, 400)
                XCTAssertFalse(message.isEmpty)
                XCTAssertNotNil(problems["cwd"], "\(problems)")
            }
        } catch {
            try? await client.deleteRoutine(id: id)
            throw error
        }
        try await client.deleteRoutine(id: id)
        let left = try await client.routines()
        XCTAssertFalse(left.routines.contains { $0.id == id })
    }

    func testTheSchedulePreviewAndFormHelpersAnswer() async throws {
        let client = try await signedIn()
        let ok = try await client.schedulePreview(cron: "30 7 * * 1-5", jitterSeconds: 60)
        XCTAssertEqual(ok.next.count, 3)
        XCTAssertNil(ok.problem)
        let bad = try await client.schedulePreview(cron: "nonsense")
        XCTAssertTrue(bad.next.isEmpty)
        XCTAssertNotNil(bad.problem)
        let folders = try await client.folders()
        XCTAssertFalse(folders.isEmpty)
        _ = try await client.accounts()
        let features = try await client.serverFeatures()
        XCTAssertTrue(features.routineEdits)
        XCTAssertTrue(features.scheduled)
    }

    func testAScheduledSessionIsAddedEditedCancelledAndDeleted() async throws {
        let client = try await signedIn()
        var draft = ScheduledDraft(home: folder)
        (draft.title, draft.prompt) = ("Swift kit scheduled", "Say hi.")
        let added = try await client.addScheduled(draft.request())
        let id = added.id
        do {
            XCTAssertEqual(added.status, "pending")
            XCTAssertEqual(added.cwd, folder)
            XCTAssertEqual(added.at?.hour, 9)
            let listed = try await client.scheduledSessions()
            XCTAssertTrue(listed.scheduled.contains { $0.id == id })

            var edited = ScheduledDraft(added)
            edited.title = "Swift kit scheduled 2"
            let request = edited.request(against: added)
            XCTAssertNil(try json(request)["at"], "an unchanged time is not resent")
            let saved = try await client.editScheduled(id: id, request)
            XCTAssertEqual(saved?.title, "Swift kit scheduled 2")
            XCTAssertEqual(saved?.at?.date, added.at?.date)

            var past = edited
            past.at = Date().addingTimeInterval(-3600)
            do {
                _ = try await client.editScheduled(id: id, past.request(against: saved))
                XCTFail("A time in the past should be refused.")
            } catch GhostShellError.refused(let status, let message, let problems) {
                XCTAssertEqual(status, 400)
                XCTAssertNotNil(problems["at"], "\(problems)")
            }

            let cancelled = try await client.cancelScheduled(id: id)
            XCTAssertEqual(cancelled.status, "cancelled")
        } catch {
            try? await client.deleteScheduled(id: id)
            throw error
        }
        try await client.deleteScheduled(id: id)
        let left = try await client.scheduledSessions()
        XCTAssertFalse(left.scheduled.contains { $0.id == id })
    }
}
