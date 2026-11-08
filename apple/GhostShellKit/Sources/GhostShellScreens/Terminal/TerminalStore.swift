#if os(macOS)
import Foundation
import GhostShellKit
import Observation

/// One chat's terminal, held in `ChatContext.store`. The reducer is `TerminalState` in the kit, so this only talks to the server and keeps the
/// panel's own settings.
///
/// A command runs only because a caller of `run` was told to: the owner's Return in the panel, his tap on a code block's Run, or Run again.
/// The events the server sends are applied and never start anything.
@Observable @MainActor
final class TerminalStore {
    private(set) var state = TerminalState()
    /// The panel's height, kept here so closing the panel and opening it again does not reset a drag.
    var height: CGFloat = 260

    @ObservationIgnored private weak var chat: ChatContext?
    @ObservationIgnored private let sessionID: String
    @ObservationIgnored private let client: GhostShellClient
    @ObservationIgnored private var started = false
    @ObservationIgnored private var stopped = false
    @ObservationIgnored private var sequence = 0
    @ObservationIgnored private(set) var hold = TerminalHold()
    @ObservationIgnored private var loaded = false
    @ObservationIgnored private var loading = false
    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    /// How long a snapshot that could not be read waits before it is read again.
    @ObservationIgnored var retryAfter = Duration.seconds(3)

    init(chat: ChatContext) {
        self.chat = chat
        sessionID = chat.sessionID
        client = chat.client
    }

    /// Listens to the chat's one stream and reads the snapshot. Safe to call again. A snapshot that the server could not give (unreachable or a 5xx)
    /// is read again after a few seconds until the store stops. A refusal is final, so only the next call reads again.
    ///
    /// The stream is opened first and its frames wait until the snapshot is in. A frame sent in the moment between the server taking the snapshot and
    /// this app reading it would otherwise be lost, and the ones the snapshot already holds are dropped by `applyHeld`.
    func start() {
        guard let chat, !stopped else { return }
        if !started {
            started = true
            let stream = chat.events()
            streamTask = Task { [weak self] in
                for await frame in stream {
                    guard let self else { return }
                    guard let event = TerminalEvent.decode(frame) else { continue }
                    if loaded { state.apply(event) } else { hold.add(event) }
                }
                self?.stop()
            }
        }
        guard !loaded, !loading else { return }
        loading = true
        loadTask = Task { [weak self] in await self?.load() }
    }

    /// Ends the stream and any read still waiting. The chat's stream ending (the chat left the screen) does this.
    func stop() {
        stopped = true
        streamTask?.cancel()
        loadTask?.cancel()
    }

    private func load() async {
        defer { loading = false }
        while !Task.isCancelled {
            do {
                let snapshot = try await client.terminalSnapshot(sessionID: sessionID)
                // Events were dropped while this was read, so it may lack some of them. Read again, holding from now.
                if hold.overflowed {
                    hold.reset()
                    try? await Task.sleep(for: retryAfter)
                    continue
                }
                state.apply(snapshot)
                state.error = ""
                state.applyHeld(hold.events)
                hold.reset()
                loaded = true
                return
            } catch {
                guard !Task.isCancelled else { return }
                state.error = TerminalFailure.words(error, step: .read)
                guard TerminalFailure.isTemporary(error) else {
                    hold.reset()
                    return
                }
                try? await Task.sleep(for: retryAfter)
            }
        }
    }

    // MARK: Commands

    /// Runs a command and returns the server's reason when it would not, or nil once the server has it.
    func run(_ command: String, source: TerminalSource) async -> String? {
        guard command.utf16.count <= TerminalRules.maxCommand else { return "That command is too long to run." }
        sequence += 1
        guard let key = state.begin(command: command, source: source, key: "local-\(sequence)", now: Date().timeIntervalSince1970 * 1000) else { return nil }
        do {
            state.settle(try await client.runCommand(sessionID: sessionID, command: command, source: source))
            return nil
        } catch {
            state.refused(key: key)
            return TerminalFailure.words(error, step: .run)
        }
    }

    func stop(_ id: String) async {
        do {
            state.settle(try await client.stopCommand(sessionID: sessionID, run: id))
        } catch {
            report(TerminalFailure.words(error, step: .stop))
        }
    }

    /// What is typed to a running command goes as written, and the panel draws it in the output because the command has no terminal to echo it.
    func input(_ id: String, text: String, eof: Bool = false) async {
        state.typed(to: id, text: text, eof: eof)
        do {
            try await client.sendInput(sessionID: sessionID, run: id, text: text, eof: eof)
        } catch {
            report(TerminalFailure.words(error, step: .input))
        }
    }

    func clear() async {
        do {
            let left = try await client.clearTerminal(sessionID: sessionID)
            state.cleared(cwd: left.cwd, runs: left.runs)
        } catch {
            report(TerminalFailure.words(error, step: .clear))
        }
    }

    // MARK: The line being typed

    func setInput(_ text: String, to: TerminalRules.InputPin? = nil) { state.setInput(text, to: to) }

    func report(_ words: String) { state.error = words }
}
#endif
