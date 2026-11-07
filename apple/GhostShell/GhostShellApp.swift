import GhostShellKit
import GhostShellScreens
import SwiftUI

@main
struct GhostShellApp: App {
    @State private var model: AppModel

    init() {
        #if DEBUG
        _model = State(initialValue: DebugHooks.makeModel())
        #else
        _model = State(initialValue: AppModel(store: KeychainTokenStore()))
        #endif
    }

    var body: some Scene {
        Window("GhostShell", id: "main") {
            RootView(model: model)
                .frame(minWidth: 640, minHeight: 420)
        }
        .defaultSize(width: 960, height: 640)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Sign Out") { Task { await model.signOut() } }
                    .disabled(model.phase != .signedIn)
            }
        }
    }
}
