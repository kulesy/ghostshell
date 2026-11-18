import GhostShellKit
import SwiftUI

/// Above the list, as the page draws it: the top bar, the search field when it is open, and the server's warning when it has one.
struct SidebarHeader: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @State private var searching = false
    @FocusState private var focused: Bool
    private let metrics = SidebarMetrics.current

    private func close() {
        searching = false
        state.query = ""
    }

    var body: some View {
        @Bindable var state = state
        VStack(spacing: 0) {
            SidebarTopBar(searching: $searching)
            if searching {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.ghost.sidebarMuted).accessibilityHidden(true)
                    TextField("Search", text: $state.query)
                        .textFieldStyle(.plain)
                        .font(.geist(metrics.rowFont, relativeTo: .body))
                        .focused($focused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                        .onEscape { close() }
                    Button(action: close) {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.ghost.sidebarMuted).sidebarIconTouch()
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Close search")
                }
                .padding(.leading, 10)
                .frame(minHeight: metrics.target)
                .background(Color.ghost.background, in: RoundedRectangle(cornerRadius: GhostRadius.md))
                .overlay(RoundedRectangle(cornerRadius: GhostRadius.md).strokeBorder(Color.ghost.input, lineWidth: 1))
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
                .onAppear { focused = true }
            }
            if let problem = model.index?.problem {
                Label("\(problem).", systemImage: "exclamationmark.triangle.fill")
                    .font(.geist(12, relativeTo: .footnote))
                    .foregroundStyle(Color.ghost.warningForeground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color.ghost.warningMuted, in: RoundedRectangle(cornerRadius: GhostRadius.base))
                    .padding(.horizontal, 8)
                    .padding(.bottom, 6)
            }
        }
        .background(Color.ghost.sidebar)
    }
}

/// The page's top bar: the projects button, the wordmark, then New and search.
struct SidebarTopBar: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise: OrganiseModel?
    @Binding var searching: Bool
    private let k = SidebarMetrics.current.rem / 16

    var body: some View {
        let index = model.index ?? SessionIndex()
        let others = SidebarOutline.othersLamp(shown: SidebarOutline.view(state.project, in: index), in: index)
        HStack(spacing: 0) {
            Menu {
                ViewMenuContent()
            } label: {
                Image(systemName: "sidebar.left").font(.system(size: 17)).foregroundStyle(Color.ghost.sidebarForeground).sidebarIconTouch()
                    .overlay(alignment: .topTrailing) {
                        if let others { Circle().fill(others.color).frame(width: 8, height: 8).padding(9) }
                    }
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .accessibilityLabel("Projects")
            .accessibilityValue(others.map { $0 == .waiting ? "Another view needs you" : "Another view is working" } ?? "")
            HStack(spacing: 8) {
                ShellMark().frame(width: 24 * k, height: 24 * k).foregroundStyle(Color.ghost.sidebarForeground)
                // The page's .brand h1: 32pt tall, two lines of regular caps on an 18.4pt pitch.
                VStack(alignment: .leading, spacing: 0) {
                    Text("GHOST").frame(height: 18.4 * k)
                    Text("SHELL").frame(height: 18.4 * k)
                }
                .font(.geist(19 * k, weight: .regular, relativeTo: .title3)).tracking(1.2 * k)
                .foregroundStyle(Color.ghost.sidebarForeground)
                .dynamicTypeSize(.large)
                .frame(height: 32 * k, alignment: .top)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("GhostShell")
            Spacer(minLength: 0)
            Menu {
                Button("New session", systemImage: "square.and.pencil") { model.navigator.show { NewSessionScreen(group: model.newSessionGroup()) } }
                Button("New group", systemImage: "folder.badge.plus") { organise?.newGroup() }
            } label: {
                Image(systemName: "plus").font(.system(size: 17)).foregroundStyle(Color.ghost.sidebarForeground).sidebarIconTouch()
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .accessibilityLabel("New")
            Button { if searching { state.query = "" }; searching.toggle() } label: {
                Image(systemName: "magnifyingglass").font(.system(size: 17)).foregroundStyle(Color.ghost.sidebarForeground).sidebarIconTouch()
            }
            .buttonStyle(.borderless)
            .keyboardShortcut("f", modifiers: .command)
            .accessibilityLabel("Search")
        }
        .padding(.horizontal, 4)
        .padding(.vertical, SidebarMetrics.current.touch ? 0 : 8)
    }
}
