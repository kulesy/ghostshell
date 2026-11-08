import GhostShellKit
import GhostShellScreens
import WatchConnectivity

/// Answers the watch app. The watch never sees the token: each request is run here with the app's own client, and only the answer goes back.
final class WatchLink: NSObject, WCSessionDelegate, Sendable {
    private struct Reply: @unchecked Sendable { let send: ([String: Any]) -> Void }

    private let model: AppModel
    private let handler = WatchRelayHandler(ledger: DefaultsWatchStore())

    // NOTE: [9 Nov 2026] EK - Start this in the App's init, not in a scene. A message from the watch can launch the app in the background, and no scene exists then.
    @MainActor init(model: AppModel) {
        self.model = model
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        let reply = Reply(send: replyHandler)
        guard let request = WatchRelay.unpack(WatchRequest.self, from: message) else {
            reply.send(WatchRelay.pack(WatchResponse(.problem(.invalid))) ?? [:])
            return
        }
        Task {
            // A launch from the watch has not read the Keychain yet. `start` does nothing the second time.
            await model.start()
            let answer = await handler.handle(request, client: await model.client)
            reply.send(WatchRelay.pack(answer) ?? [:])
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}
