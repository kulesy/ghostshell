import Foundation
import GhostShellKit
import WatchConnectivity

/// How the watch asks a question. The phone answers in the app and a Debug fixture answers in tests.
protocol Relay: Sendable {
    func ask(_ request: WatchRequest) async -> WatchResponse
}

/// The only road off the watch: a message to the iPhone app. The watch holds no token, no address and no GhostShellClient.
final class PhoneLink: NSObject, Relay, WCSessionDelegate, @unchecked Sendable {
    override init() {
        super.init()
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func ask(_ request: WatchRequest) async -> WatchResponse {
        let session = WCSession.default
        // The session takes a moment to activate after launch. Asking before then would read as an unreachable phone.
        for _ in 0..<30 where session.activationState != .activated { try? await Task.sleep(for: .milliseconds(100)) }
        guard session.activationState == .activated, session.isReachable, let message = WatchRelay.pack(request) else {
            return WatchResponse(.problem(.phoneUnreachable))
        }
        return await withCheckedContinuation { continuation in
            let once = Once(continuation)
            session.sendMessage(message) { reply in
                once.finish(WatchRelay.unpack(WatchResponse.self, from: reply) ?? WatchResponse(.problem(.outOfDate)))
            } errorHandler: { _ in
                once.finish(WatchResponse(.problem(.phoneUnreachable)))
            }
            // The reply handlers can go uncalled, so the ask times out itself.
            // A reply that lands later is harmless: the kept reply goes again with the same replyID, which the phone answers once.
            Task {
                try? await Task.sleep(for: Self.timeout)
                once.finish(WatchResponse(.problem(.phoneUnreachable)))
            }
        }
    }

    /// The phone waits up to 6 seconds for a status frame and then the server, so this leaves room for a slow network.
    private static let timeout = Duration.seconds(20)

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
}

/// Resumes the ask once, from whichever of the reply, the error or the timeout comes first.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<WatchResponse, Never>?

    init(_ continuation: CheckedContinuation<WatchResponse, Never>) { self.continuation = continuation }

    func finish(_ response: WatchResponse) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(returning: response)
    }
}
