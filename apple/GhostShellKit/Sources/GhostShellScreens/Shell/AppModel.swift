import Foundation
import GhostShellKit
import Observation

/// What the whole window knows: where it points, whether it is signed in, and the live list. Screens read it from the environment.
@Observable @MainActor
public final class AppModel {
    public enum Phase: Equatable { case starting, signedOut, signedIn }

    public private(set) var phase = Phase.starting
    /// The whole index the feed last reported, for screens that need more than the rows.
    public private(set) var index: SessionIndex?
    public var rows: [SessionRow] { index?.rows ?? [] }
    public private(set) var connection = FeedConnection.connecting
    /// False until the first list arrives, which is when the sidebar shows its skeleton.
    public private(set) var hasLoaded = false
    public private(set) var address: ServerAddress?
    public let navigator = Navigator()

    /// The text in the sign-in address field, kept between launches. It is an address, not a secret.
    public var addressText: String

    private let store: TokenStore
    /// Where screens keep small settings, such as the sidebar's folds. The test run points it at a suite of its own.
    public let defaults: UserDefaults
    /// Screens call the server through this, so a new area needs no edit here.
    public private(set) var client: GhostShellClient?
    private var feed: SessionIndexFeed?
    private var tasks: [Task<Void, Never>] = []
    private var visible = true

    private static let addressKey = "serverAddress"

    public init(store: TokenStore, defaults: UserDefaults = .standard, address: String? = nil) {
        self.store = store
        self.defaults = defaults
        self.addressText = address ?? defaults.string(forKey: Self.addressKey) ?? ServerAddress.local.baseURL.absoluteString
    }

    /// Reads the saved token once. A token opens the window, otherwise sign-in. The Keychain read happens inside the client, off the main actor.
    public func start() async {
        guard phase == .starting else { return }
        guard let saved = ServerAddress(addressText) else { phase = .signedOut; return }
        let candidate = GhostShellClient(address: saved, store: store)
        if await candidate.restore() { enter(candidate) } else { phase = .signedOut }
    }

    /// Throws what the sign-in screen shows under its fields.
    public func signIn(address text: String, password: String) async throws {
        guard let typed = ServerAddress(text) else { throw GhostShellError.badAddress }
        let candidate = GhostShellClient(address: typed, store: store)
        try await candidate.signIn(password: password)
        addressText = text
        defaults.set(text, forKey: Self.addressKey)
        enter(candidate)
    }

    public func signOut() async {
        guard let old = client else { return }
        await old.signOut()
        if client === old { leave() }
    }

    /// The window calls this as it shows and hides, so a hidden app stops asking the server.
    public func setVisible(_ shown: Bool) {
        visible = shown
        guard let feed else { return }
        Task { if shown { await feed.resume() } else { await feed.pause() } }
    }

    private func enter(_ fresh: GhostShellClient) {
        stopWork()
        client = fresh
        address = fresh.address
        index = nil
        hasLoaded = false
        connection = .connecting
        let list = fresh.indexFeed()
        feed = list
        phase = .signedIn
        tasks = [
            Task { [weak self] in
                for await state in fresh.authChanges where state == .signedOut { self?.leave(); return }
            },
            Task { [weak self] in
                for await update in list.updates {
                    guard let self else { return }
                    switch update {
                    case .index(let latest): index = latest; hasLoaded = true
                    case .connection(let state): connection = state
                    }
                }
            },
        ]
        if visible { Task { await list.resume() } }
    }

    // Reached by sign-out and by any 401, which the client reports through authChanges.
    private func leave() {
        stopWork()
        client = nil
        address = nil
        index = nil
        hasLoaded = false
        navigator.clear()
        phase = .signedOut
    }

    private func stopWork() {
        tasks.forEach { $0.cancel() }
        tasks = []
        if let feed { Task { await feed.stop() } }
        feed = nil
    }
}
