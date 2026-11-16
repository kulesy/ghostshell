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
        .modifier(ReconnectOnWake(model: model))
        #else
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didChangeOcclusionStateNotification)) { _ in
            model.setVisible(NSApp.occlusionState.contains(.visible))
        }
        #endif
    }

    // On a phone the split collapses to a stack. `preferredCompactColumn` is what the navigator drives, and it is ignored where both columns fit.
    @State private var compactColumn = NavigationSplitViewColumn.sidebar
    @State private var windowWidth: CGFloat = 960

    private var split: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            SidebarScreen()
                .safeAreaInset(edge: .top, spacing: 0) { BannerStack() }
                .navigationSplitViewColumnWidth(sidebarWidth)
        } detail: {
            if let detail = model.navigator.detail { detail } else { EmptyDetail() }
        }
        .toolbar {
            if let id = model.navigator.selectedSessionID { ToolbarItem { ContextMeter(sessionID: id) } }
        }
        .modifier(CompactColumnFollowsNavigator(column: $compactColumn))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { windowWidth = $0 }
    }

    /// The page's `--list-width`, 25.5rem, from 56rem up. Narrower, the page's drawer is 18rem, which the Mac keeps beside the detail pane.
    private var sidebarWidth: CGFloat {
        #if os(macOS)
        windowWidth < 840 ? 270 : 382
        #else
        260
        #endif
    }
}

/// The page's empty pane: the mark over a soft shadow, and a line with the shortcuts as key caps.
struct EmptyDetail: View {
    var body: some View {
        VStack(spacing: 0) {
            ShellMark().frame(width: 82, height: 82).foregroundStyle(Color.ghost.foreground)
            Ellipse().fill(RadialGradient(colors: [Color.ghost.foreground.opacity(0.15), .clear], center: .center, startRadius: 0, endRadius: 26))
                .frame(width: 52, height: 8).padding(.top, 6)
            ViewThatFits {
                HStack(spacing: 4) { words("Pick a session, press"); key("\u{2318}F"); words("to find one, or"); key("\u{2318}N"); words("to start a new one.") }
                VStack(spacing: 4) {
                    HStack(spacing: 4) { words("Pick a session, press"); key("\u{2318}F"); words("to find one,") }
                    HStack(spacing: 4) { words("or"); key("\u{2318}N"); words("to start a new one.") }
                }
            }
            .padding(.top, 24)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Pick a session, press Command F to find one, or Command N to start a new one.")
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ghost.background)
    }

    private func words(_ text: String) -> some View {
        Text(text).font(.geist(14, relativeTo: .body)).foregroundStyle(Color.ghost.mutedForeground).fixedSize()
    }

    /// The page's `kbd`: a muted chip, 20pt tall, in 12pt medium.
    private func key(_ text: String) -> some View {
        Text(text).font(.geist(12, weight: .medium, relativeTo: .caption)).foregroundStyle(Color.ghost.mutedForeground)
            .padding(.horizontal, 4).frame(minWidth: 20, minHeight: 20)
            .background(Color.ghost.muted, in: RoundedRectangle(cornerRadius: GhostRadius.sm))
    }
}
