import Foundation

extension ChatStatus {
    /// Applies one event from the session's stream. Returns false, and changes nothing, for an event that says nothing about the status.
    @discardableResult
    public mutating func apply(_ event: ChatEvent) -> Bool {
        switch event {
        case .status(let fresh): self = fresh
        case .state(let state): self.state = state
        case .approval(let prompt): pending = pending.filter { $0.requestID != prompt.requestID } + [prompt]
        case .approvalResolved(let id): pending = pending.filter { $0.requestID != id }
        case .hold(let hold): holds = holds.filter { $0.id != hold.id } + [hold]
        case .holdEnded(let id): holds = holds.filter { $0.id != id }
        case .mode(let mode): self.mode = mode
        case .model(let model): (self.model, shownModel) = (model, model)
        case .effort(let effort): self.effort = effort
        case .fast(let fast): self.fast = fast
        case .exit: (running, state, pending, holds) = (false, .idle, [], [])
        case .delta, .think, .work, .outside, .subagents, .changed, .turnEnd, .error, .terminal, .other: return false
        }
        return true
    }
}
