import Foundation

/// Where the watch keeps small things between launches. `UserDefaults` is one, and the tests use a dictionary.
public protocol WatchStore: Sendable {
    func data(forKey key: String) -> Data?
    func save(_ data: Data?, forKey key: String)
}

/// A store on `UserDefaults`, which is safe to use from any thread.
public final class DefaultsWatchStore: WatchStore, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func data(forKey key: String) -> Data? { defaults.data(forKey: key) }
    public func save(_ data: Data?, forKey key: String) { defaults.set(data, forKey: key) }
}

/// A reply, or an answer to a question card, that the watch holds until the iPhone confirms the server took it.
public struct PendingReply: Codable, Equatable, Sendable, Identifiable {
    public var sessionID: String
    public var title: String
    public var text: String
    public var replyID: String
    public var at: Date
    /// Set on an answer: the card's id and its question text. A plain reply has neither.
    public var requestID: String?
    public var question: String?
    public var id: String { sessionID }
    public var isAnswer: Bool { requestID != nil }
}

/// One kept reply or answer for each session, saved before it is sent and removed only on the iPhone's word that it went. A relaunch, a dead link or a refusal keeps it.
public struct WatchOutbox: Sendable {
    /// Replies for more sessions than this push the oldest out.
    public static let limit = 20

    private let store: any WatchStore
    private let key = "watchOutbox"

    public init(store: any WatchStore) { self.store = store }

    /// Newest first.
    public var replies: [PendingReply] {
        (store.data(forKey: key).flatMap { try? JSONDecoder().decode([PendingReply].self, from: $0) } ?? []).sorted { $0.at > $1.at }
    }

    public func reply(for sessionID: String) -> PendingReply? { replies.first { $0.sessionID == sessionID } }

    /// Keeps `text` for the session. The same text again keeps its reply ID, so a resend of it is not a second message. Nil for text that is blank or too long.
    @discardableResult
    public func keep(_ text: String, for sessionID: String, title: String, now: Date = Date()) -> PendingReply? {
        keep(text, for: sessionID, title: title, card: nil, now: now)
    }

    /// Keeps an answer to the question `question` of card `requestID`. It follows the rules of `keep`, and the same text for the same card keeps its ID.
    @discardableResult
    public func keepAnswer(_ text: String, question: String, requestID: String, for sessionID: String, title: String, now: Date = Date()) -> PendingReply? {
        keep(text, for: sessionID, title: title, card: (requestID, question), now: now)
    }

    private func keep(_ text: String, for sessionID: String, title: String, card: (requestID: String, question: String)?, now: Date) -> PendingReply? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= WatchRelay.maxReplyCharacters else { return nil }
        var kept = PendingReply(sessionID: sessionID, title: title, text: clean, replyID: UUID().uuidString, at: now, requestID: card?.requestID, question: card?.question)
        if let earlier = reply(for: sessionID), earlier.text == clean, earlier.requestID == card?.requestID { kept = earlier }
        write(Array((replies.filter { $0.sessionID != sessionID } + [kept]).sorted { $0.at > $1.at }.prefix(Self.limit)))
        return kept
    }

    /// The iPhone said it went. A reply the person has since changed stays, because only the one that went is confirmed.
    public func confirm(_ sent: PendingReply) {
        write(replies.filter { !($0.sessionID == sent.sessionID && $0.replyID == sent.replyID) })
    }

    /// The person throws the reply away.
    public func discard(sessionID: String) { write(replies.filter { $0.sessionID != sessionID }) }

    private func write(_ list: [PendingReply]) {
        store.save(list.isEmpty ? nil : try? JSONEncoder().encode(list), forKey: key)
    }
}
