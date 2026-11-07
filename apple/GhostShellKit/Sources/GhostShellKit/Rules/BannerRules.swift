import Foundation

// Ported from public/ui/banner-rules.js and the banner half of account-rules.js. Change them together.

public enum BannerKind: String, Sendable { case login, out, auto, chrome, update }

public struct BannerAction: Hashable, Sendable {
    public var label: String
    public var busy = false
    public var blocked = false
}

/// One banner as it is drawn: every word, and which buttons it has.
public struct BannerCard: Hashable, Sendable, Identifiable {
    public var kind: BannerKind
    public var warning = false
    public var title: String
    public var text: String
    public var steps: [String] = []
    public var caution = ""
    public var changes: [UpdateChange] = []
    public var more = 0
    public var action: BannerAction?
    public var force: String?
    public var dismiss: String?
    public var progress = ""
    public var problem = ""
    public var id: BannerKind { kind }
}

public let bannerListed = 5
/// A sign-in that ends within five days is offered a new one.
public let signInSoon: TimeInterval = 5 * 86_400

/// The sign-in banner, or nil when there is none to show. Its one button is busy while the CLI waits on the Mac.
public func loginCard(_ login: LoginNotice?, now: Date = Date(), calendar: Calendar = .current) -> BannerCard? {
    guard let login, login.visible else { return nil }
    let waiting = login.stage == .waiting
    let account = login.account
    var card = BannerCard(
        kind: .login, title: "", text: "",
        action: BannerAction(label: waiting ? "Waiting for the Mac" : "Sign in on the Mac", busy: waiting),
        progress: waiting ? "Approve the sign-in page in the browser on the Mac." : "",
        problem: login.stage == .failed ? login.problem : "")
    if login.signedOut {
        card.warning = true
        card.title = account.map { "\($0) is signed out" } ?? "Claude is signed out"
        card.text = account.map { "Chats and routines on \($0) fail until you sign in again." } ?? "Every chat and routine fails until you sign in again."
        return card
    }
    guard let ends = login.endsAt else { return nil }
    let days = daysLeft(ends, now: now, calendar: calendar)
    let when = days <= 0 ? "today" : days == 1 ? "tomorrow" : "in \(days) days"
    card.title = "\(account.map { "\($0)'s" } ?? "Claude's") sign-in ends \(when)"
    card.text = "It ends on \(endWords(ends, calendar: calendar)). Chats and routines stop until you sign in again. Signing in now starts a fresh four weeks."
    return card
}

public func updateCard(_ update: UpdateNotice?) -> BannerCard? {
    guard let update, update.show else { return nil }
    let pulled = update.kind == .pulled
    let stage = update.stage
    let shown = Array(update.changes.prefix(bannerListed))
    let idleLabel = pulled ? "Restart" : update.restart ? "Update and restart" : "Update"
    let progress: String = switch stage {
    case .updating: "Updating."
    case .restarting: update.busy > 0 ? "Restarting once \(plural(update.busy, "running chat", "running chats")) \(update.busy == 1 ? "finishes" : "finish")." : "Restarting now."
    default: update.blocked
    }
    return BannerCard(
        kind: .update,
        title: pulled ? "Pulled, waiting for a restart" : "\(plural(update.count, "merged change", "merged changes")) \(update.count == 1 ? "is" : "are") waiting",
        text: pulled || update.restart ? "\(pulled ? "Restarting" : "Updating restarts") GhostShell once no chat is running." : "These change only the page, so updating needs no restart.",
        changes: shown,
        more: max(0, update.count - shown.count),
        action: BannerAction(label: stage == .updating ? "Updating" : stage == .restarting ? "Restarting" : idleLabel, busy: stage != .idle, blocked: stage == .idle && !update.blocked.isEmpty),
        force: update.force ? "Force restart" : nil,
        progress: progress,
        problem: update.problem)
}

/// What the Force restart question says: what the restart will cut, and the two things a plain update would have waited for.
public func forceQuestion(_ update: UpdateNotice) -> String {
    let cut = update.busy > 0 ? "\(plural(update.busy, "running chat", "running chats")) will be cut." : "No chat is running, so none will be cut."
    let pull = update.kind == .update ? " The \(plural(update.count, "merged change", "merged changes")) will be pulled first." : ""
    let quiet = update.blocked.isEmpty ? "" : " This goes ahead inside the quiet window, which holds restarts until 09:45 on weekdays."
    return cut + pull + quiet
}

/// The active account when it is out of usage and has another to go to.
public func outCard(_ accounts: AccountsNotice?) -> BannerCard? {
    guard let out = accounts?.out, let to = out.to else { return nil }
    return BannerCard(kind: .out, warning: true, title: "\(out.name) is out of usage", text: out.text, action: BannerAction(label: "Switch to \(to.name)"))
}

public func autoCard(_ accounts: AccountsNotice?) -> BannerCard? {
    guard let auto = accounts?.auto, let from = auto.from, let to = auto.to else { return nil }
    return BannerCard(kind: .auto, title: "Switched to \(to.name)", text: "\(from.name) ran out of usage, so new messages now go to \(to.name).", dismiss: "Dismiss")
}

/// Chrome's Claude extension is not on the account just switched to. Nil while the check runs or when there is nothing to say.
public func chromeCard(_ chrome: ChromeCheck?) -> BannerCard? {
    guard let chrome, let state = chrome.state, let to = chrome.to else { return nil }
    let elsewhere = state == .elsewhere
    let who = chrome.email.isEmpty ? "the \(to.name) account" : chrome.email
    return BannerCard(
        kind: .chrome, warning: elsewhere,
        title: elsewhere ? "Chrome is still on \(chrome.on?.name ?? "another account")" : "Check Chrome is on \(to.name)",
        text: elsewhere
            ? "Chats on \(to.name) can't use Chrome until the Claude extension is on \(to.name) too."
            : "Chrome may be closed, or on another account. Chats on \(to.name) reach Chrome only when the Claude extension is on \(to.name) too.",
        steps: elsewhere
            ? ["Press Log out in the settings.", "Log in with \(who), picking it on the sign-in page."]
            : ["Open the settings. If Chrome was only closed, this banner clears.", "If it stays, press Log out, then log in with \(who)."],
        caution: "Logging out deletes the extension's saved shortcuts and scheduled tasks.",
        action: BannerAction(label: "Open in Chrome on the Mac"),
        dismiss: "Dismiss",
        progress: chrome.opened ? "Opened on the Mac. This clears once Chrome is on \(to.name)." : "")
}

/// Every banner that has something to say, in the order the sidebar stacks them.
public func bannerCards(_ banners: Banners, now: Date = Date(), calendar: Calendar = .current) -> [BannerCard] {
    [loginCard(banners.login, now: now, calendar: calendar), outCard(banners.accounts), autoCard(banners.accounts), chromeCard(banners.chrome), updateCard(banners.update)].compactMap { $0 }
}

public let bannerFastPoll: TimeInterval = 2
public let bannerSlowPoll: TimeInterval = 15

/// Faster while a sign-in waits on the Mac, a restart is under way or the Chrome check runs, so the banner clears or appears soon.
public func bannerPollInterval(_ banners: Banners?) -> TimeInterval {
    let quick = banners?.login?.stage == .waiting || banners?.update?.stage == .updating || banners?.update?.stage == .restarting || banners?.chrome?.checking == true
    return quick ? bannerFastPoll : bannerSlowPoll
}

/// The server is down for a moment while it restarts, so a failed read keeps the banner and says only that it is restarting.
public func keptWhileRestarting(_ banners: Banners) -> Banners {
    guard banners.update?.stage == .restarting else { return banners }
    var kept = banners
    kept.update?.busy = 0
    kept.update?.force = false
    return kept
}
