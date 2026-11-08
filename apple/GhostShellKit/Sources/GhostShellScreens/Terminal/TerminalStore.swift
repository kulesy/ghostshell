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
    @ObservationIgnored private var sequence = 0
    @ObservationIgnored private var waiting: [TerminalEvent] = []
    @ObservationIgnored private var loaded = false
    @ObservationIgnored private var loading = false

    init(chat: ChatContext) {
        self.chat = chat
        sessionID = chat.sessionID
        client = chat.client
    }

    /// Listens to the chat's one stream and reads the snapshot. Safe to call again, and a snapshot that failed is read again by the next call or
    /// after a few seconds.
    ///
    /// The stream is opened first and its frames wait until the snapshot is in. A frame sent in the moment between the server taking the snapshot and
    /// this app reading it would otherwise be lost, and the ones the snapshot already holds are dropped by `applyHeld`.
    func start() {
        guard let chat else { return }
        if !started {
            started = true
            let stream = chat.events()
            Task { [weak self] in
                for await frame in stream {
                    guard let self, let event = TerminalEvent.decode(frame) else { continue }
                    if loaded { state.apply(event) } else { waiting.append(event) }
                }
            }
        }
        guard !loaded, !loading else { return }
        loading = true
        Task { [weak self] in
            guard let self else { return }
            do {
                state.apply(try await client.terminalSnapshot(sessionID: sessionID))
            } catch {
                state.error = TerminalFailure.words(error, step: .read)
                loading = false
                try? await Task.sleep(for: .seconds(3))
                start()
                return
            }
            loading = false
            state.error = ""
            state.applyHeld(waiting)
            waiting = []
            loaded = true
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
