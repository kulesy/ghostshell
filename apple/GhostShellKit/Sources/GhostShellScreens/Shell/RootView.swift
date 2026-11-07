import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The whole window: sign-in until there is a token, then the sidebar beside the detail pane.
public struct RootView: View {
    @Bindable private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    public init(model: AppModel) { self.model = model }

    public var body: some View {
        Group {
            switch model.phase {
            case .starting: Color.clear
            case .signedOut: SignInScreen()
            case .signedIn: split
            }
        }
        .environment(model)
        .task { await model.start() }
        #if os(iOS)
        .onChange(of: scenePhase) { _, phase in model.setVisible(phase == .active) }
        #else
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didChangeOcclusionStateNotification)) { _ in
            model.setVisible(NSApp.occlusionState.contains(.visible))
        }
        #endif
    }

    private var split: some View {
        NavigationSplitView {
            SidebarScreen()
                .safeAreaInset(edge: .top, spacing: 0) { BannerStack() }
                .navigationSplitViewColumnWidth(min: 200, ideal: 260, max: 400)
        } detail: {
            if let detail = model.navigator.detail { detail } else { EmptyDetail() }
        }
        .toolbar {
            // NOTE: [8 Nov 2026] EK - The chat PBI may move the context meter into the chat screen's own toolbar.
            if let id = model.navigator.selectedSessionID { ToolbarItem { ContextMeter(sessionID: id) } }
        }
    }
}

struct EmptyDetail: View {
    var body: some View {
        VStack(spacing: 14) {
            ShellMark().frame(width: 48, height: 48).opacity(0.85)
            Text("Pick a session").font(.title3).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
