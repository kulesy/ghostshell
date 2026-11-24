import Foundation

// Ported from public/ui/account-rules.js and accounts.js. Change them together.

public func signInLine(_ a: Account, calendar: Calendar = .current) -> String {
    if a.signedOut { return "Signed out" }
    return a.endsAt.map { "Signed in until \(endWords($0, calendar: calendar))" } ?? "Signed in"
}

/// A signed out account, or one whose sign-in ends within five days, gets a Sign in button.
public func needsSignIn(_ a: Account, now: Date = Date()) -> Bool {
    a.signedOut || (a.endsAt.map { $0.timeIntervalSince(now) <= signInSoon } ?? false)
}

public func planAsOf(_ at: Date) -> String { at.formatted(date: .omitted, time: .shortened) }

public func sameAccountWords(_ a: Account, in list: AccountList) -> String {
    guard let other = list.accounts.first(where: { $0.id == a.sameAs }) else { return "" }
    return "This is the same Claude account as \(other.name). The browser approved the sign-in page with the account it already had. Sign in again and approve it with a different account."
}

public func waitingWords(_ a: Account) -> String { "Approve the sign-in page in the browser on the Mac, with the Claude account you want for \(a.name)." }

public func outWords(_ out: OutOfUsage) -> String { "Out of usage: \(out.text)" }

public func chatStateWords(_ state: ChatState) -> String {
    switch state {
    case .idle: "Idle"
    case .working: "Working"
    case .waiting: "Waiting for approval"
    case .other(let word): word
    }
}

/// What an account has pinned to it, such as "Pinned: 2 sessions, 1 group", or an empty string when nothing is.
public func pinnedWords(_ pinned: Pins) -> String {
    let counts = [(pinned.sessions, "session", "sessions"), (pinned.groups, "group", "groups"), (pinned.projects, "project", "projects"), (pinned.routines, "routine", "routines")]
    let parts = counts.filter { $0.0 > 0 }.map { plural($0.0, $0.1, $0.2) }
    return parts.isEmpty ? "" : "Pinned: \(parts.joined(separator: ", "))"
}

/// The line under "Pinned: ..." when the work pinned to this account cannot reach Chrome, or an empty string.
public func pinnedChromeWords(_ a: Account, in accounts: [Account]) -> String {
    guard let on = a.chromeOn, let name = accounts.first(where: { $0.id == on })?.name, !pinnedWords(a.pinned).isEmpty else { return "" }
    return "Chrome is on \(name), so these can't reach it."
}

public let switchLeavesPins = "A switch leaves pinned work on its account."

public func accountsLead(_ list: AccountList) -> String {
    let base = "Chats and routines run on the active account. Switching takes one click and no sign-in, and a chat carries on where it was."
    return list.accounts.count > 1 && list.accounts.contains(where: { !pinnedWords($0.pinned).isEmpty }) ? "\(base) \(switchLeavesPins)" : base
}

/// A name as the server keeps it: runs of whitespace become one space and the ends are trimmed.
public func cleanName(_ text: String) -> String { text.split(whereSeparator: \.isWhitespace).joined(separator: " ") }

public let renameLimit = 40
public let addNameLimit = 80

// MARK: Chip account line

// Ported from chipAccount, chipAccountItems, placeWords and pinsKey in public/ui/account-rules.js. Change them together.

/// The owner's own pick on a card: follow the pins, or one account. No pick at all is a nil `ChipPick?`.
public enum ChipPick: Hashable, Sendable {
    case follow
    case account(String)
}

public struct ChipAccountLine: Hashable, Sendable {
    public enum State: String, Sendable { case ok, signedOut, removed }
    /// Whose word the account is: the owner's pick, the chip's own account, or the pins.
    public enum By: String, Sendable { case pick, chip, pins }
    public var state: State
    public var by: By
    /// The account asked for, nil for the pins.
    public var want: String?
    /// The account the session would start on, nil when none is listed.
    public var id: String?
    public var name: String
    public var line: String
    /// Said when the chip's account does not follow the pin of its place, else empty.
    public var replaces: String
    public var post: ChipAccountPost
    /// Whether Start may be pressed.
    public var ok: Bool { state == .ok }
}

private func placeWords(_ card: ChipAccountCard) -> String {
    let name = card.fromName.flatMap { $0.isEmpty ? nil : $0 }
    if card.from == "session" { return "the session \(name.map { "\u{201C}\($0)\u{201D}" } ?? "it opens under")" }
    return "the \(card.from)\(name.map { " \($0)" } ?? "")"
}

private let gone = "an account that is no longer listed"

/// The account line on a chip card, or nil when the card shows none: one account listed, a server that sends no words for the card, or a chip that is not open.
/// The pick wins, then the chip's account, then the pins. `post` is what Start sends and `ok` says Start may be pressed.
public func chipAccount(card: ChipAccountCard?, accounts: [Account]?, named: String? = nil, pick: ChipPick? = nil) -> ChipAccountLine? {
    guard let card, let accounts, accounts.count >= 2 else { return nil }
    let want: String? = switch pick {
    case .follow?: nil
    case .account(let id)?: id.isEmpty ? nil : id
    case nil: named.flatMap { $0.isEmpty ? nil : $0 }
    }
    let by: ChipAccountLine.By = want == nil ? .pins : (pick != nil ? .pick : .chip)
    let spent = want.flatMap { card.choices[$0] } ?? (want == nil ? ChipAccountCard.Choice(account: card.account, spill: card.spill) : nil)
    let id = want != nil ? (spent?.account ?? want) : card.account
    let spillName = spent?.spill.flatMap { $0.isEmpty ? nil : $0 }.map { OrganiseRules.accountName(accounts, $0).isEmpty ? gone : OrganiseRules.accountName(accounts, $0) } ?? ""
    let account = accounts.first { $0.id == id }
    let how = switch by {
    case .pick: "picked here"
    case .chip: "chosen by this chip"
    case .pins: card.from == "active" ? "the active account" : "pinned to \(placeWords(card))"
    }
    let pinned = card.from != "active" ? (card.spill ?? card.account) : nil
    var replaces = ""
    if let want, let pinned, pinned != want {
        let pinName = OrganiseRules.accountName(accounts, pinned)
        let over = card.overflow.map { ", or its overflow to \(OrganiseRules.accountName(accounts, $0).isEmpty ? gone : OrganiseRules.accountName(accounts, $0))" } ?? ""
        replaces = "It does not follow the pin to \(pinName.isEmpty ? gone : pinName) on \(placeWords(card))\(over). It has no overflow account."
    }
    let post = ChipAccountPost(account: want, confirmAccount: id ?? "")
    guard let account else {
        let words = want != nil ? "The account this chip names is no longer listed. Pick another." : (card.blocked.flatMap { $0.isEmpty ? nil : $0 } ?? "The pin it opens under is to an account that is no longer listed. Pick another.")
        return ChipAccountLine(state: .removed, by: by, want: want, id: id, name: "", line: words, replaces: replaces, post: post)
    }
    if account.signedOut {
        return ChipAccountLine(state: .signedOut, by: by, want: want, id: id, name: account.name, line: "\(account.name), \(how), is signed out. Sign it in, or pick another account.", replaces: replaces, post: post)
    }
    let line = spillName.isEmpty ? "Starts on \(account.name), \(how)." : "Starts on \(account.name). \(spillName), \(how), is out of usage, so it starts on \(account.name) until \(spillName) resets."
    return ChipAccountLine(state: .ok, by: by, want: want, id: id, name: account.name, line: line, replaces: replaces, post: post)
}

/// One line of a chip card's Change account menu. `pick` is what choosing it does: nil follows the pins. A checked or disabled line picks nothing.
public struct ChipAccountItem: Hashable, Sendable, Identifiable {
    public var id: String
    public var label: String
    public var value: String?
    public var checked: Bool
    public var disabled: Bool
    public var pick: ChipPick?
    public var picks: Bool { !checked && !disabled }
}

/// The menu of a chip card's Account control: follow the pins first, then each account with the current choice checked. A signed out account cannot be picked
/// unless it is the current choice, and a choice no account holds shows as Removed account.
public func chipAccountItems(accounts: [Account], card: ChipAccountCard, line: ChipAccountLine) -> [ChipAccountItem] {
    let follows = OrganiseRules.accountName(accounts, card.account)
    var items = [ChipAccountItem(id: "account:", label: "Follow the pins", value: follows.isEmpty ? nil : follows, checked: line.want == nil, disabled: false, pick: .follow)]
    for a in accounts {
        let value = a.signedOut ? "Signed out" : (OrganiseRules.chromeOnName(accounts, a).isEmpty ? nil : "No Chrome")
        items.append(ChipAccountItem(id: "account:\(a.id)", label: a.name, value: value, checked: a.id == line.want, disabled: a.signedOut && a.id != line.want, pick: .account(a.id)))
    }
    if let want = line.want, OrganiseRules.accountName(accounts, want).isEmpty {
        items.append(ChipAccountItem(id: "account:\(want)", label: "Removed account", value: nil, checked: true, disabled: true, pick: nil))
    }
    return items
}

/// Every pin the list shows, as one string that changes when a pin does, so a chip card drawn from the pins is asked for again.
public func pinsKey(_ index: SessionIndex?) -> String {
    guard let index else { return "" }
    let groups = index.groups.map { "\($0.id)|\($0.account ?? "")|\($0.overflow ?? "")" }
    let projects = index.projects.map { "\($0.id)|\($0.account ?? "")|\($0.overflow ?? "")" }
    let rows = OrganiseRules.every(index).filter { $0.accountPin != nil }.map { "\($0.id)|\($0.accountPin ?? "")|\($0.accountOverflow ?? "")" }
    return [groups, projects, rows].map { $0.joined(separator: ",") }.joined(separator: ";")
}
