import GhostShellKit
import Observation
import SwiftUI

/// What one card remembers: what the person typed or picked, whether a decision is in flight, and why the last one failed.
/// It is looked up by request id, so a card never inherits the state of a different prompt.
@Observable @MainActor
final class ApprovalCardState {
    var busy = false
    var error: String?
    var picks: [ApprovalPick] = []
    var inputOpen = false
}

/// The state of the prompts above one chat's composer. Held in `ChatContext.store`, so it lasts one visit.
@Observable @MainActor
final class ApprovalsModel {
    @ObservationIgnored private var states: [String: ApprovalCardState] = [:]

    func state(for requestID: String) -> ApprovalCardState {
        if let held = states[requestID] { return held }
        let fresh = ApprovalCardState()
        states[requestID] = fresh
        return fresh
    }

    /// Forgets the cards whose prompts are gone.
    func keep(_ requestIDs: Set<String>) {
        states = states.filter { requestIDs.contains($0.key) }
    }

    /// Sends one decision for the card of `requestID`. The card leaves `pending` once the server took it or says it was answered elsewhere (410).
    /// Any other failure frees the buttons and shows its reason on that card.
    func decide(_ decision: ApprovalDecision, requestID: String, in chat: ChatContext) {
        let state = state(for: requestID)
        guard !state.busy else { return }
        state.busy = true
        state.error = nil
        Task {
            do {
                _ = try await chat.client.decide(sessionID: chat.sessionID, requestID: requestID, decision)
                guard var fresh = chat.status else { return }
                fresh.pending.removeAll { $0.requestID == requestID }
                chat.apply(status: fresh)
            } catch {
                state.error = Approvals.message(for: error)
                state.busy = false
            }
        }
    }
}
