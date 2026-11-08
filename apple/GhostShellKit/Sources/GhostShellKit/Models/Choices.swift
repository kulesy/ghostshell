import Foundation

/// One entry of a select in the routine and scheduled forms. An empty `value` is Default, which the server stores as null.
public struct Choice: Hashable, Sendable, Identifiable {
    public var value: String
    public var label: String
    public var disabled = false
    public var id: String { value }

    public init(_ value: String, _ label: String, disabled: Bool = false) { (self.value, self.label, self.disabled) = (value, label, disabled) }
}

// NOTE: [8 Nov 2026] EK - These lists copy public/ui/model-rules.js (MAIN, LONG, EFFORTS) and public/ui/composer.js (MODES). A new model or mode there
// needs the same line here. A value the lists lack is still kept by the choice functions, so an edit never drops it.
private let models = [Choice("claude-opus-5-5", "Opus 5.5"), Choice("claude-fable-5-1", "Fable 5.1"), Choice("claude-sonnet-5-5", "Sonnet 5.5"),
                      Choice("claude-haiku-5-5", "Haiku 5.5"), Choice("claude-opus-5-5[1m]", "Opus 5.5 (1M)")]
private let efforts = [Choice("low", "Low"), Choice("medium", "Medium"), Choice("high", "High"), Choice("xhigh", "Extra"), Choice("max", "Max")]
private let modes = [Choice("manual", "Manual"), Choice("acceptEdits", "Accept edits"), Choice("plan", "Plan"), Choice("auto", "Auto"),
                     Choice("bypassPermissions", "Bypass permissions")]

/// Default first, then the list. A current value the list lacks, such as a model Claude Desktop recorded, is kept as its own last option.
func choices(_ list: [Choice], current: String?, name: (String) -> String = { $0 }) -> [Choice] {
    let options = [Choice("", "Default")] + list
    guard let current, !current.isEmpty, !options.contains(where: { $0.value == current }) else { return options }
    return options + [Choice(current, name(current))]
}

public func modelChoices(current: String? = nil) -> [Choice] { choices(models, current: current, name: modelName) }
public func effortChoices(current: String? = nil) -> [Choice] { choices(efforts, current: current) }
public func modeChoices(current: String? = nil) -> [Choice] { choices(modes, current: current) }

/// A model the list lacks is named by what its id says, so `claude-opus-4-8` reads Opus 4.8.
public func modelName(_ id: String) -> String {
    if let known = models.first(where: { $0.value == id }) { return known.label }
    let long = id.range(of: #"\[1m\]$"#, options: [.regularExpression, .caseInsensitive]) != nil ? " (1M)" : ""
    func upper(_ word: Substring) -> String { word.prefix(1).uppercased() + word.dropFirst() }
    if let named = try? NSRegularExpression(pattern: #"(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?"#, options: .caseInsensitive),
       let m = named.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) {
        let part = { (i: Int) -> Substring? in Range(m.range(at: i), in: id).map { id[$0] } }
        return "\(upper(part(1)!)) \(part(2)!)\(part(3).map { ".\($0)" } ?? "")\(long)"
    }
    if let alias = try? NSRegularExpression(pattern: #"^(opus|sonnet|haiku|fable)(\[1m\])?$"#, options: .caseInsensitive),
       let m = alias.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)), let word = Range(m.range(at: 1), in: id) {
        return "\(upper(id[word]))\(long)"
    }
    return id
}

// MARK: Accounts and groups

public let accountPickNote = "Takes effect at the next start. A running turn keeps its account."
private let chromeLimit = "Chrome works only on the account its extension is signed into."

private func chromeOnName(_ accounts: [Account], _ account: Account) -> String {
    account.chromeOn.flatMap { id in accounts.first { $0.id == id }?.name } ?? ""
}

/// The line under the Account field: definite when the survey found Chrome on another account, else the static limit.
public func chromeNote(_ accounts: [Account]) -> String {
    accounts.map { chromeOnName(accounts, $0) }.first { !$0.isEmpty }.map { "Chrome is on \($0), so work on another account can't reach it." } ?? chromeLimit
}

/// The Account select: Active account (empty value) first, then each account. A signed out one cannot be picked unless it is the current value, and a
/// value no account holds is kept as Removed account.
public func accountChoices(_ accounts: [Account], current: String?) -> [Choice] {
    let label = { (a: Account) in a.signedOut ? "\(a.name) (signed out)" : !chromeOnName(accounts, a).isEmpty ? "\(a.name) (no Chrome)" : a.name }
    let list = accounts.map { Choice($0.id, label($0), disabled: $0.signedOut && $0.id != current) }
    let removed = current.flatMap { id in id.isEmpty || accounts.contains(where: { $0.id == id }) ? nil : Choice(id, "Removed account") }
    return [Choice("", "Active account")] + list + [removed].compactMap { $0 }
}

/// The scheduled form's Group select: No group first, then each group. A group the entry names that has gone is kept as its own option.
public func groupChoices(_ groups: [SessionGroup], current: String?) -> [Choice] {
    let options = [Choice("", "No group")] + groups.map { Choice($0.id, $0.name) }
    guard let current, !current.isEmpty, !options.contains(where: { $0.value == current }) else { return options }
    return options + [Choice(current, "A group that has been deleted")]
}
