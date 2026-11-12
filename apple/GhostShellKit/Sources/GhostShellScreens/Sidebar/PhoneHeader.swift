#if os(iOS)
import GhostShellKit
import SwiftUI

/// Above the phone's list, as the page draws it: the top bar, the search field when it is open, and the server's warning when it has one.
struct PhoneHeader: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @State private var searching = false
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var state = state
        VStack(spacing: 0) {
            PhoneTopBar(searching: $searching)
            if searching {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.ghost.sidebarMuted).accessibilityHidden(true)
                    TextField("Search", text: $state.query)
                        .font(.geist(14, relativeTo: .body))
                        .focused($focused)
                        .submitLabel(.search)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        state.query = ""
                        searching = false
                    } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.ghost.sidebarMuted).phoneIconTouch()
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Close search")
                }
                .padding(.leading, 10)
                .frame(minHeight: 44)
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
struct PhoneTopBar: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise: OrganiseModel?
    @Binding var searching: Bool

    var body: some View {
        let index = model.index ?? SessionIndex()
        let others = SidebarOutline.othersLamp(shown: SidebarOutline.view(state.project, in: index), in: index)
        HStack(spacing: 0) {
            Menu {
                ViewMenuContent()
            } label: {
                Image(systemName: "sidebar.left").font(.system(size: 17)).foregroundStyle(Color.ghost.sidebarForeground).phoneIconTouch()
                    .overlay(alignment: .topTrailing) {
                        if let others { Circle().fill(others.color).frame(width: 8, height: 8).padding(9) }
                    }
            }
            .menuStyle(.borderlessButton)
            .accessibilityLabel("Projects")
            HStack(spacing: 8) {
                ShellMark().frame(width: 24, height: 24).foregroundStyle(Color.ghost.sidebarForeground)
                // The page's .brand h1: 32pt tall, two lines of regular caps on an 18.4pt pitch.
                VStack(alignment: .leading, spacing: 0) {
                    Text("GHOST").frame(height: 18.4)
                    Text("SHELL").frame(height: 18.4)
                }
                .font(.geist(19, weight: .regular, relativeTo: .title3)).tracking(1.2)
                .foregroundStyle(Color.ghost.sidebarForeground)
                .dynamicTypeSize(.large)
                .frame(height: 32, alignment: .top)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("GhostShell")
            Spacer(minLength: 0)
            Menu {
                Button("New session", systemImage: "square.and.pencil") { model.navigator.show { NewSessionScreen() } }
                Button("New group", systemImage: "folder.badge.plus") { organise?.newGroup() }
            } label: {
                Image(systemName: "plus").font(.system(size: 17)).foregroundStyle(Color.ghost.sidebarForeground).phoneIconTouch()
            }
            .menuStyle(.borderlessButton)
            .accessibilityLabel("New")
            Button { searching.toggle() } label: {
                Image(systemName: "magnifyingglass").font(.system(size: 17)).foregroundStyle(Color.ghost.sidebarForeground).phoneIconTouch()
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Search")
        }
        .padding(.horizontal, 4)
    }
}
#endif
