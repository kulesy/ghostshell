import Foundation

// NOTE: [8 Nov 2026] EK - These types mirror `accountsNow`, `bannersNow`, `contextFor` and the passkey handlers in server.mjs, which a comment there names in turn.
// Decoding is lenient, so a field the server renames is dropped with no error and reads as empty.

public enum SignInStage: Hashable, Sendable, ServerWord {
    case idle, waiting, done, failed
    case other(String)
    public init(word: String) {
        self = switch word { case "idle": .idle; case "waiting": .waiting; case "done": .done; case "failed": .failed; default: .other(word) }
    }
}

public enum PlanSeverity: Hashable, Sendable, ServerWord {
    case normal, warning, critical
    case other(String)
    public init(word: String) {
        self = switch word { case "normal": .normal; case "warning": .warning; case "critical": .critical; default: .other(word) }
    }
}

public enum ChromeState: Hashable, Sendable, ServerWord {
    case elsewhere, unknown
    case other(String)
    public init(word: String) {
        self = switch word { case "elsewhere": .elsewhere; case "unknown": .unknown; default: .other(word) }
    }
}

public enum UpdateKind: Hashable, Sendable, ServerWord {
    case update, pulled
    case other(String)
    public init(word: String) {
        self = switch word { case "update": .update; case "pulled": .pulled; default: .other(word) }
    }
}

public enum UpdateStage: Hashable, Sendable, ServerWord {
    case idle, updating, restarting
    case other(String)
    public init(word: String) {
        self = switch word { case "idle": .idle; case "updating": .updating; case "restarting": .restarting; default: .other(word) }
    }
}

public enum ContextSource: Hashable, Sendable, ServerWord {
    case process, transcript, none
    case other(String)
    public init(word: String) {
        self = switch word { case "process": .process; case "transcript": .transcript; case "none": .none; default: .other(word) }
    }
}

/// An account named by id, as the banners and the notices name one.
public struct AccountRef: Hashable, Sendable, Decodable {
    public var id: String
    public var name: String
    private enum Key: String, CodingKey { case id, name }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name) ?? ""
    }
    public init(id: String, name: String) { (self.id, self.name) = (id, name) }
}

public struct PlanLimit: Hashable, Sendable, Decodable {
    public var kind: String
    public var group: String
    public var percent: Int
    public var resetsAt: Date?
    public var scope: String?
    public var severity: PlanSeverity

    private enum Key: String, CodingKey { case kind, group, percent, resetsAt, scope, severity }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        kind = try c.decode(String.self, forKey: .kind)
        group = c.value(.group) ?? ""
        percent = c.count(.percent) ?? 0
        resetsAt = c.iso(.resetsAt)
        scope = c.value(.scope)
        severity = c.value(.severity) ?? .normal
    }
    public init(kind: String, group: String = "", percent: Int, resetsAt: Date? = nil, scope: String? = nil, severity: PlanSeverity = .normal) {
        (self.kind, self.group, self.percent, self.resetsAt, self.scope, self.severity) = (kind, group, percent, resetsAt, scope, severity)
    }
}

public struct AccountPlan: Hashable, Sendable, Decodable {
    public var limits: [PlanLimit]
    public var at: Date?
    private enum Key: String, CodingKey { case limits, at }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        limits = c.list(.limits)
        at = c.millis(.at)
    }
    public init(limits: [PlanLimit], at: Date?) { (self.limits, self.at) = (limits, at) }
}

public struct OutOfUsage: Hashable, Sendable, Decodable {
    public var text: String
    public var at: Date?
    private enum Key: String, CodingKey { case text, at }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        text = c.value(.text) ?? ""
        at = c.millis(.at)
    }
}

public struct Pins: Hashable, Sendable, Decodable {
    public var sessions = 0, groups = 0, projects = 0, routines = 0
    private enum Key: String, CodingKey { case sessions, groups, projects, routines }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        (sessions, groups, projects, routines) = (c.count(.sessions) ?? 0, c.count(.groups) ?? 0, c.count(.projects) ?? 0, c.count(.routines) ?? 0)
    }
    public init(sessions: Int = 0, groups: Int = 0, projects: Int = 0, routines: Int = 0) {
        (self.sessions, self.groups, self.projects, self.routines) = (sessions, groups, projects, routines)
    }
}

public struct RunningChat: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var title: String
    public var state: ChatState
    private enum Key: String, CodingKey { case id, title, state }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.value(.title) ?? ""
        state = c.value(.state) ?? .other("")
    }
    public init(id: String, title: String, state: ChatState) { (self.id, self.title, self.state) = (id, title, state) }
}

public struct Account: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var name: String
    public var stage: SignInStage
    public var signedOut: Bool
    public var endsAt: Date?
    public var problem: String
    public var email: String?
    public var planType: String?
    public var sameAs: String?
    public var out: OutOfUsage?
    public var plan: AccountPlan?
    public var chromeOn: String?
    public var active: Bool
    public var pinned: Pins
    public var chats: [RunningChat]

    private enum Key: String, CodingKey { case id, name, stage, signedOut, endsAt, problem, email, planType, sameAs, out, plan, chromeOn, active, pinned, chats }
    /// Only the id is required.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name) ?? ""
        stage = c.value(.stage) ?? .idle
        signedOut = c.value(.signedOut) ?? false
        endsAt = c.millis(.endsAt)
        problem = c.value(.problem) ?? ""
        email = c.value(.email)
        planType = c.value(.planType)
        sameAs = c.value(.sameAs)
        out = c.value(.out)
        plan = c.value(.plan)
        chromeOn = c.value(.chromeOn)
        active = c.value(.active) ?? false
        pinned = c.value(.pinned) ?? Pins()
        chats = c.list(.chats)
    }
}

/// The account an automatic switch left, the one it went to, and when.
public struct AutoSwitched: Hashable, Sendable, Decodable {
    public var at: Date?
    public var from: AccountRef?
    public var to: AccountRef?
    private enum Key: String, CodingKey { case at, from, to }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        at = c.millis(.at)
        from = c.value(.from)
        to = c.value(.to)
    }
}

/// `{ checking: true }` while the check runs, else the account Chrome should be on and the one it is on.
public struct ChromeCheck: Hashable, Sendable, Decodable {
    public var checking: Bool
    public var state: ChromeState?
    public var to: AccountRef?
    public var on: AccountRef?
    public var email: String
    public var opened: Bool
    private enum Key: String, CodingKey { case checking, state, to, on, email, opened }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        checking = c.value(.checking) ?? false
        state = c.value(.state)
        to = c.value(.to)
        on = c.value(.on)
        email = c.value(.email) ?? ""
        opened = c.value(.opened) ?? false
    }
}

/// The reply of `api/accounts` and of every account route that changes something.
public struct AccountList: Hashable, Sendable, Decodable {
    public var accounts: [Account]
    public var autoSwitch: Bool
    public var auto: AutoSwitched?
    public var chrome: ChromeCheck?
    public var waiting: Bool
    private enum Key: String, CodingKey { case accounts, autoSwitch, auto, chrome, waiting }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        accounts = c.list(.accounts)
        autoSwitch = c.value(.autoSwitch) ?? false
        auto = c.value(.auto)
        chrome = c.value(.chrome)
        waiting = c.value(.waiting) ?? false
    }
}

// MARK: Banners

public struct LoginNotice: Hashable, Sendable, Decodable {
    public var signedOut: Bool
    public var endsAt: Date?
    public var stage: SignInStage
    public var problem: String
    public var visible: Bool
    /// Both are set only when the server lists more than one account.
    public var account: String?
    public var accountId: String?
    private enum Key: String, CodingKey { case signedOut, endsAt, stage, problem, visible, account, accountId }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        signedOut = c.value(.signedOut) ?? false
        endsAt = c.millis(.endsAt)
        stage = c.value(.stage) ?? .idle
        problem = c.value(.problem) ?? ""
        visible = c.value(.visible) ?? false
        account = c.value(.account)
        accountId = c.value(.accountId)
    }
    public init(signedOut: Bool = false, endsAt: Date? = nil, stage: SignInStage = .idle, problem: String = "", visible: Bool = true, account: String? = nil, accountId: String? = nil) {
        (self.signedOut, self.endsAt, self.stage, self.problem, self.visible, self.account, self.accountId) = (signedOut, endsAt, stage, problem, visible, account, accountId)
    }
}

public struct UpdateChange: Hashable, Sendable, Decodable {
    public var title: String
    public var url: URL?
    private enum Key: String, CodingKey { case title, url }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        title = c.value(.title) ?? ""
        // Only an https link is offered, because the owner opens it.
        url = (c.value(.url) as String?).flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
    }
    public init(title: String, url: URL? = nil) { (self.title, self.url) = (title, url) }
}

public struct UpdateNotice: Hashable, Sendable, Decodable {
    public var show: Bool
    public var kind: UpdateKind?
    public var stage: UpdateStage
    public var count: Int
    public var changes: [UpdateChange]
    public var restart: Bool
    public var blocked: String
    public var busy: Int
    public var problem: String
    public var force: Bool
    private enum Key: String, CodingKey { case show, kind, stage, count, changes, restart, blocked, busy, problem, force }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        show = c.value(.show) ?? false
        kind = c.value(.kind)
        stage = c.value(.stage) ?? .idle
        count = c.count(.count) ?? 0
        changes = c.list(.changes)
        restart = c.value(.restart) ?? false
        blocked = c.value(.blocked) ?? ""
        busy = c.count(.busy) ?? 0
        problem = c.value(.problem) ?? ""
        force = c.value(.force) ?? false
    }
    public init(show: Bool = true, kind: UpdateKind? = .update, stage: UpdateStage = .idle, count: Int = 0, changes: [UpdateChange] = [], restart: Bool = false,
                blocked: String = "", busy: Int = 0, problem: String = "", force: Bool = false) {
        (self.show, self.kind, self.stage, self.count, self.changes) = (show, kind, stage, count, changes)
        (self.restart, self.blocked, self.busy, self.problem, self.force) = (restart, blocked, busy, problem, force)
    }
}

/// The active account when it is out of usage and another can take over.
public struct OutNotice: Hashable, Sendable, Decodable {
    public var text: String
    public var at: Date?
    public var name: String
    public var to: AccountRef?
    private enum Key: String, CodingKey { case text, at, name, to }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        text = c.value(.text) ?? ""
        at = c.millis(.at)
        name = c.value(.name) ?? ""
        to = c.value(.to)
    }
}

public struct AccountsNotice: Hashable, Sendable, Decodable {
    public var out: OutNotice?
    public var auto: AutoSwitched?
    private enum Key: String, CodingKey { case out, auto }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        out = c.value(.out)
        auto = c.value(.auto)
    }
}

/// The reply of `api/banners` and of the three banner routes.
public struct Banners: Hashable, Sendable, Decodable {
    public var login: LoginNotice?
    public var update: UpdateNotice?
    public var accounts: AccountsNotice?
    public var chrome: ChromeCheck?
    private enum Key: String, CodingKey { case login, update, accounts, chrome }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        login = c.value(.login)
        update = c.value(.update)
        accounts = c.value(.accounts)
        chrome = c.value(.chrome)
    }
    public init(login: LoginNotice? = nil, update: UpdateNotice? = nil, accounts: AccountsNotice? = nil, chrome: ChromeCheck? = nil) {
        (self.login, self.update, self.accounts, self.chrome) = (login, update, accounts, chrome)
    }
}

// MARK: Context and plan

public struct ContextPart: Hashable, Sendable, Decodable {
    public var id: String
    public var name: String
    public var tokens: Int
    private enum Key: String, CodingKey { case id, name, tokens }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        name = try c.decode(String.self, forKey: .name)
        id = c.value(.id) ?? name
        tokens = c.count(.tokens) ?? 0
    }
    public init(id: String, name: String, tokens: Int) { (self.id, self.name, self.tokens) = (id, name, tokens) }
}

/// What fills a chat's context window. `window` is nil where the server has not learned the model's, and `autoCompactAt` is nil with auto-compact off.
public struct ContextFigure: Hashable, Sendable, Decodable {
    public var source: ContextSource
    public var compacted: Bool
    public var total: Int?
    public var window: Int?
    public var autoCompactAt: Int?
    public var model: String?
    public var categories: [ContextPart]?
    public var buffer: ContextPart?
    public var free: ContextPart?

    private enum Key: String, CodingKey { case source, compacted, total, window, autoCompactAt, model, categories, buffer, free }
    /// Only the source is required, because a reply without one is not a figure at all.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        source = try c.decode(ContextSource.self, forKey: .source)
        compacted = c.value(.compacted) ?? false
        total = c.count(.total)
        window = c.count(.window)
        autoCompactAt = c.count(.autoCompactAt)
        model = c.value(.model)
        categories = (c.value(.categories) as [Lossy<ContextPart>]?)?.compactMap(\.value)
        buffer = c.value(.buffer)
        free = c.value(.free)
    }
    public init(source: ContextSource, total: Int? = nil, window: Int? = nil, autoCompactAt: Int? = nil, model: String? = nil, compacted: Bool = false,
                categories: [ContextPart]? = nil, buffer: ContextPart? = nil, free: ContextPart? = nil) {
        (self.source, self.total, self.window, self.autoCompactAt, self.model, self.compacted) = (source, total, window, autoCompactAt, model, compacted)
        (self.categories, self.buffer, self.free) = (categories, buffer, free)
    }
}

public enum ContextDetail: String, Sendable, Encodable { case summary, full }

/// `limits` is nil when no running chat of the account answered, and `account` is set only when the server lists more than one.
public struct PlanReply: Hashable, Sendable, Decodable {
    public var limits: [PlanLimit]?
    public var account: String?
    private enum Key: String, CodingKey { case limits, account }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        limits = (c.value(.limits) as [Lossy<PlanLimit>]?)?.compactMap(\.value)
        account = c.value(.account)
    }
    public init(limits: [PlanLimit]?, account: String? = nil) { (self.limits, self.account) = (limits, account) }
}

// MARK: Passkeys

public struct Passkey: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var device: String
    public var rpId: String
    public var created: Date?
    public var used: Date?
    private enum Key: String, CodingKey { case id, device, rpId, created, used }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        device = c.value(.device) ?? ""
        rpId = c.value(.rpId) ?? ""
        created = c.iso(.created)
        used = c.iso(.used)
    }
    public init(id: String, device: String = "", rpId: String = "", created: Date? = nil, used: Date? = nil) {
        (self.id, self.device, self.rpId, self.created, self.used) = (id, device, rpId, created, used)
    }
}

/// `available` says whether the origin asked about is one the server lets make passkeys. The remove route answers with the list alone.
public struct PasskeyList: Hashable, Sendable, Decodable {
    public var available: Bool
    public var passkeys: [Passkey]
    private enum Key: String, CodingKey { case available, passkeys }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        available = c.value(.available) ?? false
        passkeys = c.list(.passkeys)
    }
}

// MARK: Calls

private struct Empty: Encodable, Sendable {}
private struct NameBody: Encodable, Sendable { var name: String }
private struct OnBody: Encodable, Sendable { var on: Bool }
private struct SignInBody: Encodable, Sendable { var account: String? }
private struct UseBody: Encodable, Sendable { var `continue`: String? }
private struct DetailBody: Encodable, Sendable { var detail: ContextDetail }
private struct IDBody: Encodable, Sendable { var id: String }

// Accounts, banners, the context meter and passkeys. The owner routes here are strict about Origin, which the client always sends.
// NOTE: [8 Nov 2026] EK - Never call update, forceRestart, signIn, bannerSignIn, use, addAccount, setAutoSwitch or chromeOpen from a test against a real server.
// Update and forceRestart run `npm run restart`, which cuts the owner's running chats, and a sign-in opens a browser on the Mac.
extension GhostShellClient {
    public func accounts() async throws -> AccountList { try await get("api/accounts") }
    public func addAccount(name: String) async throws -> AccountList { try await post("api/accounts", json: NameBody(name: name)) }
    public func signIn(account: String) async throws -> AccountList { try await post("api/accounts/\(try pathID(account))/sign-in", json: Empty()) }
    public func rename(account: String, name: String) async throws -> AccountList { try await post("api/accounts/\(try pathID(account))/rename", json: NameBody(name: name)) }
    /// Switches the active account. `continue` is a session to send "Continue." to afterwards.
    public func use(account: String, continue session: String? = nil) async throws -> AccountList {
        try await post("api/accounts/\(try pathID(account))/use", json: UseBody(continue: try session.map(pathID)))
    }
    public func setAutoSwitch(_ on: Bool) async throws -> AccountList { try await post("api/accounts/auto", json: OnBody(on: on)) }
    public func seenAutoSwitch() async throws -> AccountList { try await post("api/accounts/seen", json: Empty()) }
    /// Asks the running chats of every account for their plan usage. It can take several seconds.
    public func refreshPlans() async throws -> AccountList { try await post("api/accounts/plan", json: Empty()) }
    public func chromeOpen() async throws -> AccountList { try await post("api/accounts/chrome-open", json: Empty()) }
    public func chromeSeen() async throws -> AccountList { try await post("api/accounts/chrome-seen", json: Empty()) }

    public func banners() async throws -> Banners { try await get("api/banners") }
    /// `account` nil is the active account.
    public func bannerSignIn(account: String?) async throws -> Banners {
        try await post("api/banners/sign-in", json: SignInBody(account: try account.map(pathID)))
    }
    public func update() async throws -> Banners { try await post("api/banners/update", json: Empty()) }
    public func forceRestart() async throws -> Banners { try await post("api/banners/force-restart", json: Empty()) }

    /// Reads the figure with a POST, not the session's events stream, which would mark the session read.
    public func context(sessionID: String, detail: ContextDetail = .summary) async throws -> ContextFigure {
        try await post("api/sessions/\(try pathID(sessionID))/context", json: DetailBody(detail: detail))
    }
    public func plan(sessionID: String) async throws -> PlanReply { try await post("api/sessions/\(try pathID(sessionID))/plan", json: Empty()) }

    /// `origin` is the address the person reached the server at, and decides `available`.
    public func passkeys(origin: String) async throws -> PasskeyList { try await get("api/passkeys", query: [URLQueryItem(name: "origin", value: origin)]) }
    public func removePasskey(id: String) async throws -> [Passkey] {
        let reply: PasskeyList = try await post("api/passkeys/remove", json: IDBody(id: id))
        return reply.passkeys
    }
}
