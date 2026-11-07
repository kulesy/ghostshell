import GhostShellKit
import GhostShellScreens
import SwiftUI

@main
struct GhostShellApp: App {
    @State private var model: AppModel
    @State private var settings: NotificationSettings
    @State private var notifier: SessionNotifier

    init() {
        #if DEBUG
        let model = DebugHooks.makeModel()
        let settings = NotificationSettings(model: model, enabledByDefault: DebugHooks.notificationsOnByDefault)
        let poster = DebugHooks.alertPoster() ?? UserNotificationPoster()
        #else
        let model = AppModel(store: KeychainTokenStore())
        let settings = NotificationSettings(model: model)
        let poster = UserNotificationPoster()
        #endif
        let notifier = SessionNotifier(model: model, settings: settings, poster: poster)
        notifier.start()
        _model = State(initialValue: model)
        _settings = State(initialValue: settings)
        _notifier = State(initialValue: notifier)
    }

    var body: some Scene {
        Window("GhostShell", id: "main") {
            RootView(model: model)
                .environment(settings)
                .frame(minWidth: 640, minHeight: 420)
        }
        .defaultSize(width: 960, height: 640)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Session") { model.navigator.show { NewSessionScreen() } }
                    .keyboardShortcut("n")
                    .disabled(model.phase != .signedIn)
                Button("Sign Out") { Task { await model.signOut() } }
                    .disabled(model.phase != .signedIn)
            }
            CommandGroup(after: .sidebar) {
                Button("Accounts") { model.navigator.show { AccountsScreen() } }
                    .keyboardShortcut("a", modifiers: [.command, .shift])
                    .disabled(model.phase != .signedIn)
                Button("Passkeys") { model.navigator.show { PasskeysScreen() } }
                    .disabled(model.phase != .signedIn)
            }
        }
        Settings {
            NotificationSettingsView(settings: settings)
        }
    }
}
