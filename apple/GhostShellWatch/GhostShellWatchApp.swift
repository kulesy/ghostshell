import GhostShellKit
import SwiftUI

@main
struct GhostShellWatchApp: App {
    @State private var model: WatchModel
    @State private var path: [WatchRow]

    init() {
        #if DEBUG
        _model = State(initialValue: DebugHooks.makeModel())
        _path = State(initialValue: DebugHooks.openedRow.map { [$0] } ?? [])
        #else
        _model = State(initialValue: WatchModel(relay: PhoneLink(), store: DefaultsWatchStore()))
        _path = State(initialValue: [])
        #endif
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $path) {
                WaitingListScreen()
                    .navigationDestination(for: WatchRow.self) { SessionScreen(row: $0) }
            }
            .environment(model)
        }
    }
}
