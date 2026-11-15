import GhostShellKit
import GhostShellScreens
import SwiftUI

@main
struct GhostShelliPhoneApp: App {
    @State private var model: AppModel
    private let watchLink: WatchLink

    init() {
        #if DEBUG
        let model = DebugHooks.makeModel()
        #else
        let model = AppModel(store: KeychainTokenStore())
        #endif
        // A build made without Local.xcconfig has no domain and no entitlement, so it offers no passkey. The Debug stub may already have set one.
        if model.passkeySupport == nil, let domain = Bundle.main.object(forInfoDictionaryKey: "GSPasskeyDomain") as? String, !domain.isEmpty {
            model.passkeySupport = PasskeySupport(ceremony: SystemPasskeyCeremony(), domain: domain)
        }
        _model = State(initialValue: model)
        watchLink = WatchLink(model: model)
    }

    // NOTE: [8 Nov 2026] EK - No SessionNotifier and no NotificationSettings here. Alerts need push, which needs a paid team, so the phone has no bell.
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            RootView(model: model).preferredColorScheme(DebugHooks.colorScheme)
            #else
            RootView(model: model)
            #endif
        }
    }
}
