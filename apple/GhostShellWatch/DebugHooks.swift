#if DEBUG
import Foundation
import GhostShellKit

/// Hooks for the scripted test run, compiled into Debug builds only. `apple/scripts/build.mjs` fails a Release build that holds one of these words.
/// Launch arguments: -GSDefaultsSuite, -GSWatchFixture (list, phone, server or signedout), -GSWatchOpen <session id>, -GSWatchOpenTitle, -GSWatchDraft <text>, -GSWatchSend 1.
enum DebugHooks {
    private static var args: UserDefaults { .standard }

    @MainActor static func makeModel() -> WatchModel {
        let defaults = args.string(forKey: "GSDefaultsSuite").flatMap { UserDefaults(suiteName: $0) } ?? .standard
        let relay: any Relay = args.string(forKey: "GSWatchFixture").map { FixtureRelay(mode: $0) } ?? PhoneLink()
        return WatchModel(relay: relay, store: DefaultsWatchStore(defaults))
    }

    static var openedRow: WatchRow? {
        args.string(forKey: "GSWatchOpen").map {
            WatchRow(id: $0, title: args.string(forKey: "GSWatchOpenTitle") ?? "Fix the flaky upload test", dot: .awaiting, line: "")
        }
    }

    /// The draft to type into the opened session, or nil. With -GSWatchSend the draft is sent as a person would with the keyboard, and nothing is typed.
    @MainActor static func draft(for row: WatchRow, model: WatchModel) async -> String? {
        guard row.id == args.string(forKey: "GSWatchOpen"), model.keptReply(for: row.id) == nil, !model.sent.contains(row.id), let text = args.string(forKey: "GSWatchDraft") else { return nil }
        guard args.bool(forKey: "GSWatchSend") else { return text }
        await model.reply(text, to: row.id, title: row.title)
        return nil
    }
}

/// Answers as the iPhone would, from fixed sessions. The `phone`, `server` and `signedout` modes fail every ask, to show each unreachable state.
struct FixtureRelay: Relay {
    let mode: String

    private let rows = [
        WatchRow(id: "s1", title: "Fix the flaky upload test", dot: .awaiting, line: "agent-chat"),
        WatchRow(id: "s2", title: "Clean up the build folder", dot: .awaiting, line: "tinacms"),
        WatchRow(id: "s3", title: "Draft the sprint review email", dot: .ready, line: "sprint-review"),
        WatchRow(id: "s4", title: "Bump the examples to React 19", dot: .ready, line: "tinacms"),
    ]

    private let sessions: [String: WatchSession] = [
        "s1": WatchSession(id: "s1", title: "Fix the flaky upload test", state: .waiting,
                           prompts: [WatchPrompt(kind: .question, title: "Storage", text: "Which database should the upload queue use?", options: ["SQLite", "Postgres"])],
                           latest: "The test fails because it starts the upload before the server has finished its setup. I can wait for the **ready** event instead."),
        "s2": WatchSession(id: "s2", title: "Clean up the build folder", state: .waiting,
                           prompts: [WatchPrompt(kind: .permission, title: "Bash wants to run a command", text: "rm -rf apple/build")]),
        "s3": WatchSession(id: "s3", title: "Draft the sprint review email", state: .idle,
                           latest: "The draft is in your Drafts folder. It covers the four finished PBIs and the two that carried over. Do you want a shorter version for the team chat?"),
    ]

    func ask(_ request: WatchRequest) async -> WatchResponse {
        switch mode {
        case "phone": return WatchResponse(.problem(.phoneUnreachable))
        case "server": return WatchResponse(.problem(.serverUnreachable))
        case "signedout": return WatchResponse(.problem(.signedOut))
        default: break
        }
        switch request.action {
        case .waiting: return WatchResponse(.waiting(rows))
        case .session(let id): return WatchResponse(.session(sessions[id] ?? WatchSession(id: id, title: "Session", state: .idle)))
        case .reply: return WatchResponse(.sent)
        }
    }
}
#endif
