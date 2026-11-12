import GhostShellKit
import SwiftUI

/// Keeps a phone's stack and the navigator in step: showing something pushes the detail, and Back clears the navigator, so the same session can be opened again.
struct CompactColumnFollowsNavigator: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var column: NavigationSplitViewColumn

    func body(content: Content) -> some View {
        content
            .onChange(of: model.navigator.detail != nil) { _, shown in
                if shown { column = .detail }
            }
            .onChange(of: column) { _, now in
                if now == .sidebar, model.navigator.detail != nil { model.navigator.clear() }
            }
    }
}

#if os(iOS)
/// Opens the stream and the list again when the app returns from the background and when the network comes back or changes route.
struct ReconnectOnWake: ViewModifier {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var wasAway = false
    @State private var watcher: PathWatcher?

    func body(content: Content) -> some View {
        content
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { wasAway = true }
                if phase == .active, wasAway {
                    wasAway = false
                    Task { await model.reconnect() }
                }
            }
            .task {
                watcher = PathWatcher { [model] in Task { @MainActor in await model.reconnect() } }
            }
    }
}
#endif
