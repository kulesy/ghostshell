import Foundation

// NOTE: [9 Nov 2026] EK - The watch talks only to the iPhone app, over WatchConnectivity, because the watch has no Tailscale and its own networking is limited
// (TN3135). The iPhone makes each call with its own token, so the token never reaches the watch. Bump `version` when either side's types change shape.

/// The messages between the watch and the iPhone app. Each travels as JSON inside the WatchConnectivity dictionary, so both sides read the same types.
public enum WatchRelay {
    public static let version = 1
    /// The longest reply the iPhone will send for the watch, in characters.
    public static let maxReplyCharacters = 2000
    public static let maxRows = 20
    /// A question longer than this is answered on the iPhone or Mac, because the watch sends the question back whole to say which one it answers.
    public static let maxQuestionCharacters = 1500
    static let key = "gs"

    public static func pack(_ value: some Encodable) -> [String: Any]? {
        (try? JSONEncoder().encode(value)).map { [key: $0] }
    }

    public static func unpack<T: Decodable>(_ type: T.Type = T.self, from message: [String: Any]) -> T? {
        (message[key] as? Data).flatMap { try? JSONDecoder().decode(type, from: $0) }
    }
}

// MARK: Requests

public struct WatchRequest: Codable, Equatable, Sendable {
    public enum Action: Codable, Equatable, Sendable {
        case waiting
        case session(id: String)
        /// `replyID` names this reply, so the iPhone sends it once however many times the watch asks.
        case reply(id: String, text: String, replyID: String)
        /// An answer to a question card, sent with `decide` and never as a message. `question` is the card's question text, which keys the answer. `answerID` works as `replyID` does.
        case answer(id: String, requestID: String, question: String, text: String, answerID: String)
    }

    public var version: Int
    public var action: Action

    public init(_ action: Action, version: Int = WatchRelay.version) { (self.action, self.version) = (action, version) }
}

// MARK: Responses

/// Why an answer is not the one asked for, in words the watch can show.
public enum WatchProblem: Codable, Equatable, Sendable {
    /// Raised by the watch itself, when the iPhone does not answer.
    case phoneUnreachable
    case signedOut
    case serverUnreachable
    /// The server said no in its own words.
    case refused(String)
    case invalid
    /// The watch and the iPhone apps are different versions.
    case outOfDate

    public var words: String {
        switch self {
        case .phoneUnreachable: "Can't reach your iPhone"
        case .signedOut: "Sign in on your iPhone"
        case .serverUnreachable: "Your iPhone can't reach GhostShell"
        case .refused(let message): message
        case .invalid: "That request was not valid."
        case .outOfDate: "Update GhostShell on your iPhone and watch."
        }
    }

    /// True when sending the same thing again later could work, so the kept reply keeps its Send again button.
    public var canRetry: Bool {
        switch self {
        case .phoneUnreachable, .serverUnreachable, .refused: true
        case .signedOut, .invalid, .outOfDate: false
        }
    }
}

public enum WatchDot: String, Codable, Equatable, Sendable {
    case awaiting, ready

    public var words: String { self == .awaiting ? AlertKind.needsYou.text : AlertKind.finished.text }
}

/// One session in the list of those waiting on the owner.
public struct WatchRow: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var dot: WatchDot
    /// The folder the session works in.
    public var line: String

    public init(id: String, title: String, dot: WatchDot, line: String) { (self.id, self.title, self.dot, self.line) = (id, title, dot, line) }
}

/// A permission, question or plan the session waits on. A question with several parts becomes one prompt for each part.
public struct WatchPrompt: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Equatable, Sendable { case permission, question, plan }

    public var kind: Kind
    public var title: String
    public var text: String
    public var options: [String]
    /// The server's id for this card. Set on a question only.
    public var requestID: String
    /// True for a question with one single-choice part, which the watch answers itself. Other cards are answered on the iPhone or Mac.
    public var answerable: Bool

    public init(kind: Kind, title: String, text: String, options: [String] = [], requestID: String = "", answerable: Bool = false) {
        (self.kind, self.title, self.text, self.options, self.requestID, self.answerable) = (kind, title, text, options, requestID, answerable)
    }
}

public struct WatchSession: Codable, Equatable, Sendable {
    public enum State: String, Codable, Equatable, Sendable { case idle, working, waiting }

    public var id: String
    public var title: String
    /// Nil when the status frame did not arrive in time. The prompts are then empty and may be incomplete.
    public var state: State?
    public var prompts: [WatchPrompt]
    /// Claude's latest message, cut short.
    public var latest: String?

    public init(id: String, title: String, state: State?, prompts: [WatchPrompt] = [], latest: String? = nil) {
        (self.id, self.title, self.state, self.prompts, self.latest) = (id, title, state, prompts, latest)
    }
}

public struct WatchResponse: Codable, Equatable, Sendable {
    public enum Body: Codable, Equatable, Sendable {
        case waiting([WatchRow])
        case session(WatchSession)
        case sent
        /// The card was no longer pending (410), so the answer went nowhere.
        case answeredElsewhere
        case problem(WatchProblem)
    }

    public var version: Int
    public var body: Body

    public init(_ body: Body, version: Int = WatchRelay.version) { (self.body, self.version) = (body, version) }
}
