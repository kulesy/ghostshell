import GhostShellKit

/// Text a person edited and did not save, kept for the next time the file opens. Memory only: it is gone when the app quits, and a file's text is never
/// written to disk by this app. Keyed by server, chat and path, so a draft cannot reach another chat's file.
@MainActor
enum FileDrafts {
    struct Draft: Equatable {
        var text: String
        /// The file's `version` when the text was read, so a draft of an older file starts in conflict.
        var base: String
    }

    private static var held: [String: Draft] = [:]
    private static var order: [String] = []
    // Each draft is at most 1 MB, since a bigger file is not editable.
    private static let limit = 40

    static func key(_ address: ServerAddress, sessionID: String, path: String) -> String { "\(address.key)\0\(sessionID)\0\(path)" }

    static func read(_ key: String) -> Draft? { held[key] }

    static func write(_ key: String, _ draft: Draft?) {
        order.removeAll { $0 == key }
        guard let draft else { held[key] = nil; return }
        held[key] = draft
        order.append(key)
        while order.count > limit { held[order.removeFirst()] = nil }
    }

    static func forgetAll() {
        held = [:]
        order = []
    }
}
