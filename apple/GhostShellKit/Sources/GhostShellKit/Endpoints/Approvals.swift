import Foundation

// NOTE: [8 Nov 2026] EK - The request mirrors the `approve` action in server.mjs and `answer()` in lib/runner.mjs. Change them together.

/// What the person decides. `always` is honoured by the server only when the pending item has `always: true`.
public enum ApprovalDecision: Sendable, Equatable {
    case allow, always, deny
    /// Answers to a question card, keyed by the question's text.
    case answer([String: String])
}

public enum ApprovalOutcome: Sendable, Equatable {
    /// The server took the decision.
    case resolved
    /// The request was no longer pending (410): someone answered it elsewhere, or the turn ended. It is not a failure.
    case answeredElsewhere
}

private struct DecisionBody: Encodable, Sendable {
    var requestId: String
    var decision: String
    var answers: [String: String]?
}

extension GhostShellClient {
    /// Answers one pending prompt. A 410 is `.answeredElsewhere`. A 409 (the chat is not running here) and every other failure throws.
    public func decide(sessionID: String, requestID: String, _ decision: ApprovalDecision) async throws -> ApprovalOutcome {
        guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
        let body: DecisionBody
        switch decision {
        case .allow: body = DecisionBody(requestId: requestID, decision: "allow")
        case .always: body = DecisionBody(requestId: requestID, decision: "always")
        case .deny: body = DecisionBody(requestId: requestID, decision: "deny")
        case .answer(let answers): body = DecisionBody(requestId: requestID, decision: "answer", answers: answers)
        }
        do {
            try await send("api/sessions/\(sessionID)/approve", json: body)
            return .resolved
        } catch GhostShellError.server(status: 410) {
            return .answeredElsewhere
        }
    }
}
