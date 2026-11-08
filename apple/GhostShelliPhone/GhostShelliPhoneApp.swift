import GhostShellKit
import GhostShellScreens
import SwiftUI

@main
struct GhostShelliPhoneApp: App {
    @State private var model: AppModel

    init() {
        #if DEBUG
        _model = State(initialValue: DebugHooks.makeModel())
        #else
        _model = State(initialValue: AppModel(store: KeychainTokenStore()))
        #endif
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
