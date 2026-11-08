import Foundation
import GhostShellKit
import Observation

/// A short line the routine screens show after a write, such as Saved or Started, in the page's words. `open` is the session a Run now started.
struct RoutineNote: Equatable, Identifiable {
    let id = UUID()
    var text: String
    var isProblem = false
    var open: String?
}

/// The routines and scheduled sessions, kept fresh while the window is visible. Screens read it from `AppModel.routines` and call `refresh()` after a write.
@Observable @MainActor
public final class RoutinesStore {
    public private(set) var routines: [RoutineSummary]?
    public private(set) var scheduled: [ScheduledSummary]?
    public private(set) var features = ServerFeatures()
    /// False until the features call has answered. Every refresh tries it again, and the routine form does not save before it is true.
    public private(set) var featuresLoaded = false
    /// The server's own line when routines.json or scheduled.json cannot be read.
    public private(set) var problem: String?
    public private(set) var scheduledProblem: String?
    /// Why the first load failed. A later failed poll keeps the list it has.
    public private(set) var failure: String?
    var note: RoutineNote?

    private var client: GhostShellClient?
    private var polling: Task<Void, Never>?
    private static let interval = Duration.seconds(5)

    public init() {}

    func start(_ client: GhostShellClient, polling visible: Bool) {
        stop()
        self.client = client
        if visible { poll() }
    }

    func stop() {
        polling?.cancel()
        polling = nil
        client = nil
        routines = nil
        scheduled = nil
        features = ServerFeatures()
        featuresLoaded = false
        problem = nil
        scheduledProblem = nil
        failure = nil
        note = nil
    }

    func setVisible(_ shown: Bool) {
        guard client != nil else { return }
        if shown { if polling == nil { poll() } } else { polling?.cancel(); polling = nil }
    }

    private func poll() {
        polling = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: Self.interval)
            }
        }
    }

    /// Loads both lists again. Screens call it after each write, so the result shows at once.
    public func refresh() async {
        guard let client else { return }
        if !featuresLoaded, let loaded = try? await client.serverFeatures(), self.client === client {
            features = loaded
            featuresLoaded = true
        }
        do {
            let list = try await client.routines()
            guard self.client === client else { return }
            routines = list.routines
            problem = list.problem
            failure = nil
        } catch {
            guard self.client === client else { return }
            if routines == nil { failure = error.localizedDescription }
        }
        guard features.scheduled else { return }
        if let list = try? await client.scheduledSessions(), self.client === client {
            scheduled = list.scheduled
            scheduledProblem = list.problem
        }
    }

    func routine(_ id: String) -> RoutineSummary? { routines?.first { $0.id == id } }

    // MARK: Writes. Each says what happened in `note`, then loads the lists again.

    func run(_ r: RoutineSummary) async {
        await attempt { client in
            let started = try await client.runRoutine(id: r.id)
            return RoutineNote(text: "Started “\(r.title)”.", open: started.sessionId)
        }
    }

    func setEnabled(_ r: RoutineSummary, _ on: Bool) async {
        await attempt { client in
            try await client.setRoutineEnabled(id: r.id, on)
            return RoutineNote(text: "\(on ? "Resumed" : "Paused") “\(r.title)”.")
        }
    }

    @discardableResult
    func delete(_ r: RoutineSummary) async -> Bool {
        await attempt { client in
            try await client.deleteRoutine(id: r.id)
            return RoutineNote(text: "Deleted “\(r.title)”.")
        }
    }

    func startNow(_ s: ScheduledSummary) async {
        await attempt { client in
            let started = try await client.startScheduled(id: s.id)
            return RoutineNote(text: "Started “\(s.title)”.", open: started.sessionId)
        }
    }

    func cancel(_ s: ScheduledSummary) async {
        await attempt { client in
            try await client.cancelScheduled(id: s.id)
            return RoutineNote(text: "Cancelled “\(s.title)”.")
        }
    }

    @discardableResult
    func delete(_ s: ScheduledSummary) async -> Bool {
        await attempt { client in
            try await client.deleteScheduled(id: s.id)
            return RoutineNote(text: "Deleted “\(s.title)”.")
        }
    }

    /// Runs one write. A refusal reads as a problem note in the server's own words. Returns whether the server took it.
    @discardableResult
    private func attempt(_ write: (GhostShellClient) async throws -> RoutineNote) async -> Bool {
        guard let client else { return false }
        var done = true
        do { note = try await write(client) } catch {
            note = RoutineNote(text: error.localizedDescription, isProblem: true)
            done = false
        }
        await refresh()
        return done
    }
}
