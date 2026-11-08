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
