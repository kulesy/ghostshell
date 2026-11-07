import GhostShellKit
import Observation
import SwiftUI

/// A message the composer has handed to the server and the transcript does not hold yet. The thread draws it as a faded bubble.
struct SendingMessage: Identifiable, Equatable {
    let id = UUID()
    var text: String
    var imageCount = 0
    var fileCount = 0
}

/// What a feature that plugs into the chat can see of it. One per open chat. A slot in `ChatSlots` gets this and keeps its own state in `store`,
/// so it never needs an edit to the chat's own files.
@Observable @MainActor
final class ChatContext {
    let sessionID: String
    let client: GhostShellClient
    /// What the messages route says of the session: title, folder, branch, connectors.
    internal(set) var session: ChatSessionInfo
    /// The last status the stream or a send reported, including `pending` prompts. Nil until the first frame.
    internal(set) var status: ChatStatus?
    /// The server serves linked files for this chat. Until it says so, a path in a reply stays text.
    internal(set) var fileLinks = false
    /// The server has a terminal for this chat.
    internal(set) var terminalAvailable = false
    /// The inspector beside the thread, which draws `ChatSlots.filePanel`.
    var filePanelOpen = false
    /// The panel under the thread, which draws `ChatSlots.terminal`.
    var terminalOpen = false
    private(set) var sending: [SendingMessage] = []
    /// Counts up each time the thread should jump to its end, such as after a send.
    private(set) var scrollRequests = 0

    @ObservationIgnored private var listeners: [UUID: AsyncStream<SSEEvent>.Continuation] = [:]
    @ObservationIgnored private var stores: [ObjectIdentifier: AnyObject] = [:]
    @ObservationIgnored var refreshHandler: (@MainActor () -> Void)?

    init(sessionID: String, client: GhostShellClient, session: ChatSessionInfo? = nil) {
        self.sessionID = sessionID
        self.client = client
        self.session = session ?? ChatSessionInfo(id: sessionID)
    }

    /// Every event of the one stream this chat holds, raw, from now on. Opening a second stream would mark the session read, so a feature listens here.
    /// The stream ends when the chat leaves the screen. The current state is in `status`, because nothing is replayed.
    func events() -> AsyncStream<SSEEvent> {
        let (stream, continuation) = AsyncStream<SSEEvent>.makeStream(bufferingPolicy: .unbounded)
        let id = UUID()
        listeners[id] = continuation
        continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.listeners[id] = nil } }
        return stream
    }

    /// The state a feature keeps for this chat, made on first use. Keyed by its type, so each feature has its own and the chat's files never name it.
    func store<T: AnyObject>(_ type: T.Type = T.self, make: @MainActor () -> T) -> T {
        if let held = stores[ObjectIdentifier(type)] as? T { return held }
        let fresh = make()
        stores[ObjectIdentifier(type)] = fresh
        return fresh
    }

    /// For a status a call returned, such as a send, so the chat does not wait for the stream to say it.
    func apply(status fresh: ChatStatus) { status = fresh }

    @discardableResult
    func beginSending(_ message: SendingMessage) -> UUID {
        sending.append(message)
        scrollRequests += 1
        return message.id
    }

    func endSending(_ id: UUID) { sending.removeAll { $0.id == id } }

    func scrollToEnd() { scrollRequests += 1 }

    /// Asks the thread to read what is new now, without waiting for the stream to say the transcript grew.
    func refresh() { refreshHandler?() }

    // MARK: For the chat's own model

    func publish(_ event: SSEEvent) { listeners.values.forEach { $0.yield(event) } }

    func close() {
        listeners.values.forEach { $0.finish() }
        listeners = [:]
    }
}
