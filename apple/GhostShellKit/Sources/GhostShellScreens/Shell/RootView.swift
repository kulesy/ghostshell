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
                #if os(macOS)
                .toolbar(removing: .sidebarToggle)
                #endif
                #if os(iOS)
                .safeAreaInset(edge: .top, spacing: 0) { BannerStack() }
                #endif
                // NOTE: [18 Nov 2026] EK - on macOS 27.0 a toolbar modifier after this one drops the width, and the column falls to about 145pt.
                .navigationSplitViewColumnWidth(sidebarWidth)
        } detail: {
            detailPane
        }
        #if os(macOS)
        .toolbar(removing: .sidebarToggle)
        #endif
        .toolbar {
            if let id = model.navigator.selectedSessionID { ToolbarItem { ContextMeter(sessionID: id) } }
        }
        #if os(macOS)
        .overlay { if let layer = model.navigator.overlay { layer } }
        #endif
        .modifier(CompactColumnFollowsNavigator(column: $compactColumn))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { windowWidth = $0 }
    }

    @ViewBuilder private var detailPane: some View {
        let pane = Group { if let detail = model.navigator.detail { detail } else { EmptyDetail() } }
        #if os(macOS)
        // NOTE: [18 Nov 2026] EK - A chat pane asks for more than 640pt less the sidebar, and the split then runs wider than the window and off both its edges.
        NoMinimumWidth { pane }
        #else
        pane
        #endif
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

#if os(macOS)
/// Fills what it is offered and reports no minimum width, so a pane inside it can be squeezed without widening the split that holds it.
private struct NoMinimumWidth<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View { NoMinimumLayout { content } }
}

private struct NoMinimumLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ideal = subviews.first?.sizeThatFits(.unspecified) ?? .zero
        return CGSize(width: proposal.width ?? ideal.width, height: proposal.height ?? ideal.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
    }
}
#endif

/// The page's empty pane: the mark over a soft shadow, and a line with the shortcuts as key caps.
struct EmptyDetail: View {
    var body: some View {
        VStack(spacing: 0) {
            ShellMark().frame(width: 82, height: 82).foregroundStyle(Color.ghost.foreground)
            Ellipse().fill(RadialGradient(colors: [Color.ghost.foreground.opacity(0.15), .clear], center: .center, startRadius: 0, endRadius: 26))
                .frame(width: 52, height: 8).padding(.top, 6)
            ViewThatFits {
                HStack(spacing: 4) { words("Pick a session, press"); key("\u{2318}F"); words("to find one,"); key("\u{2318}N"); words("to start a new one, or"); key("\u{21E7}\u{2318}N"); words("to start one in Home.") }
                VStack(spacing: 4) {
                    HStack(spacing: 4) { words("Pick a session, press"); key("\u{2318}F"); words("to find one,") }
                    HStack(spacing: 4) { key("\u{2318}N"); words("to start a new one, or"); key("\u{21E7}\u{2318}N"); words("to start one in Home.") }
                }
            }
            .padding(.top, 24)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Pick a session, press Command F to find one, Command N to start a new one, or Shift Command N to start one in Home.")
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
            .background(Color.ghost.muted, in: GhostShape(GhostRadius.sm))
    }
}
