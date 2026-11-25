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
    #if DEBUG && os(macOS)
    /// The test run narrows the sidebar this way, because its screen is too small for a window wide enough to show the side terminal.
    @State private var debugSidebar: CGFloat?
    #endif

    private var split: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            SidebarScreen()
                #if os(macOS)
                .overlay { if model.navigator.overlay != nil { Color.black.opacity(model.navigator.overlayDim).ignoresSafeArea() } }
                .toolbar(removing: .sidebarToggle)
                #endif
                #if os(iOS)
                .safeAreaInset(edge: .top, spacing: 0) { BannerStack() }
                #endif
                // NOTE: [18 Nov 2026] EK - on macOS 27.0 a toolbar modifier after this one drops the width, and the column falls to about 145pt.
                .navigationSplitViewColumnWidth(sidebarWidth)
        } detail: {
            detailPane
                .environment(\.narrowWindow, windowWidth < 768)
        }
        #if os(macOS)
        .toolbar(removing: .sidebarToggle)
        #endif
        #if os(iOS)
        .toolbar {
            if let id = model.navigator.selectedSessionID { ToolbarItem { ContextMeter(sessionID: id) } }
        }
        #endif
        .modifier(CompactColumnFollowsNavigator(column: $compactColumn))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { windowWidth = $0 }
        #if DEBUG && os(macOS)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("GSDebugSidebar"))) { note in
            debugSidebar = (note.object as? String).flatMap(Double.init).map { CGFloat($0) }
        }
        #endif
    }

    @ViewBuilder private var detailPane: some View {
        let pane = Group { if let detail = model.navigator.detail { detail } else { EmptyDetail() } }
        #if os(macOS)
        // NOTE: [18 Nov 2026] EK - A chat pane asks for more than 640pt less the sidebar, and the split then runs wider than the window and off both its edges.
        NoMinimumWidth { pane }
            .overlay { if let layer = model.navigator.overlay { layer } }
        #else
        pane
        #endif
    }

    /// The page's `--list-width`, 25.5rem, from 56rem up. Narrower, the page's drawer is 18rem, which the Mac keeps beside the detail pane.
    private var sidebarWidth: CGFloat {
        #if os(macOS)
        #if DEBUG
        if let debugSidebar { return debugSidebar }
        #endif
        return windowWidth < 840 ? 270 : 382
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
            // The sentence breaks between clauses, so a narrow pane stacks whole clauses and no key cap is squeezed.
            ViewThatFits {
                HStack(spacing: 4) { find; start; home }
                VStack(spacing: 4) { find; HStack(spacing: 4) { start; home } }
                VStack(spacing: 4) { find; start; home }
            }
            .padding(.top, 24)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Pick a session, press Command F to find one, Command N to start a new one, or Shift Command N to start one in Home.")
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ghost.background)
    }

    private var find: some View { HStack(spacing: 4) { words("Pick a session, press"); key("\u{2318}F"); words("to find one,") } }
    private var start: some View { HStack(spacing: 4) { key("\u{2318}N"); words("to start a new one,") } }
    private var home: some View { HStack(spacing: 4) { words("or"); key("\u{21E7}\u{2318}N"); words("to start one in Home.") } }

    private func words(_ text: String) -> some View {
        Text(text).font(.geist(14, relativeTo: .body)).foregroundStyle(Color.ghost.mutedForeground).fixedSize()
    }

    /// The page's `kbd`: a muted chip, 20pt tall, in 12pt medium.
    private func key(_ text: String) -> some View {
        Text(text).font(.geist(12, weight: .medium, relativeTo: .caption)).foregroundStyle(Color.ghost.mutedForeground)
            .padding(.horizontal, 4).frame(minWidth: 20, minHeight: 20).fixedSize()
            .background(Color.ghost.muted, in: GhostShape(GhostRadius.sm))
    }
}

#if os(macOS)
/// Items without the toolbar's shared glass capsule, which shows as an empty pill while an item has nothing to draw.
struct BareToolbarItems<Content: ToolbarContent>: ToolbarContent {
    @ToolbarContentBuilder let content: Content

    var body: some ToolbarContent {
        if #available(macOS 26.0, *) { content.sharedBackgroundVisibility(.hidden) } else { content }
    }
}
#endif
