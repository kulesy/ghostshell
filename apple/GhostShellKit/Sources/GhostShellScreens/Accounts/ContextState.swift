import Foundation
import GhostShellKit
import Observation

/// One chat's context figure and plan rows. It reads with a POST, never the chat's events stream, which would mark the chat read.
@Observable @MainActor
final class ContextState {
    private(set) var figure: ContextFigure?
    private(set) var plan: PlanReply?
    /// The total a full count failed at, so a failing count is not asked for again until the total moves.
    private(set) var failedAt: Int?
    private var lastCall = Date.distantPast
    private var asked = 0
    private var drawn = 0

    static let spacing: TimeInterval = 5

    /// Reads the figure, at most once every five seconds unless `throttled` is off. A caller that is cancelled while it waits is replaced by the newer one, which is the trailing call.
    /// A cancelled ask records nothing. A full count that was overtaken by a newer reply is asked once more, as the page does.
    func refresh(_ client: GhostShellClient, sessionID: String, detail: ContextDetail, throttled: Bool = true) async {
        let wait = Self.spacing - Date().timeIntervalSince(lastCall)
        if throttled, wait > 0, !(await pause(wait)) { return }
        lastCall = Date()
        var retry = detail == .full
        while true {
            asked += 1
            let ticket = asked
            let reply: ContextFigure
            do { reply = try await client.context(sessionID: sessionID, detail: detail) } catch is CancellationError { return } catch {
                if detail == .full { failedAt = figure?.total }
                return
            }
            if ticket > drawn {
                drawn = ticket
                figure = mergeContext(held: figure, reply: reply, detail: detail)
                if detail == .full { failedAt = reply.categories == nil ? reply.total : nil }
                return
            }
            if !retry { return }
            retry = false
        }
    }

    func loadPlan(_ client: GhostShellClient, sessionID: String) async {
        plan = try? await client.plan(sessionID: sessionID)
    }

    /// A popover opened again asks for the parts afresh, so a failure from before is forgotten.
    func close() { plan = nil; failedAt = nil }
}
