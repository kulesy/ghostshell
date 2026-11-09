import Foundation

/// The unsent text of each session, kept in one UserDefaults key as a dictionary of session id to text, so a relaunch finds it.
/// The new-session screen uses `DraftTexts.new`. An empty text removes its entry. See docs/adr/20261102-a-draft-for-each-session.md.
public struct DraftTexts {
    public static let new = "new"
    static let key = "composerDrafts"

    private let defaults: UserDefaults

    public init(_ defaults: UserDefaults) { self.defaults = defaults }

    public func text(for id: String) -> String { all[id] ?? "" }

    public func set(_ text: String, for id: String) {
        var held = all
        if text.isEmpty { guard held.removeValue(forKey: id) != nil else { return } } else { held[id] = text }
        defaults.set(held, forKey: Self.key)
    }

    public func clear() { defaults.removeObject(forKey: Self.key) }

    private var all: [String: String] { (defaults.dictionary(forKey: Self.key) as? [String: String]) ?? [:] }
}
