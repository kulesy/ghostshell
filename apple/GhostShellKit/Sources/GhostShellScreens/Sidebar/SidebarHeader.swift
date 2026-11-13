import GhostShellKit
import SwiftUI

/// Above the list: the view picker, and the server's warning when it has one.
struct SidebarHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        #if os(iOS)
        PhoneHeader()
        #else
        VStack(spacing: 0) {
            ViewMenu()
            if let problem = model.index?.problem {
                Label("\(problem).", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(.orange.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                    .padding(.horizontal, 10)
                    .padding(.bottom, 6)
            }
        }
        #endif
    }
}

/// Home and the projects. A project that has gone reads as Home. A view with a session that needs you or one that works shows a lamp, and a project shows its count.
private struct ViewMenu: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state

    var body: some View {
        let index = model.index ?? SessionIndex()
        let shown = SidebarOutline.view(state.project, in: index)
        let others = SidebarOutline.othersLamp(shown: shown, in: index)
        Menu {
            ViewMenuContent()
        } label: {
            Label(index.projects.first { $0.id == shown }?.name ?? "Home", systemImage: shown == nil ? "house" : "folder")
        }
        .menuStyle(.borderlessButton)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A menu label keeps one image and one text, so the lamp sits beside the menu's own chevron. 28pt is the width the borderless menu
        // keeps for that chevron.
        .overlay(alignment: .trailing) {
            if let others { Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(others.color).padding(.trailing, 28).allowsHitTesting(false) }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .accessibilityLabel(others.map { $0 == .waiting ? "View, another view needs you" : "View, another view is working" } ?? "View")
    }
}

/// What the view picker lists: Home and the projects, then the slot's items. The Mac's header menu and the phone's projects button both open it.
struct ViewMenuContent: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state

    var body: some View {
        let index = model.index ?? SessionIndex()
        let shown = SidebarOutline.view(state.project, in: index)
        Picker("View", selection: Binding(get: { shown }, set: { state.project = $0 })) {
            item("Home", nil, in: index).tag(String?.none)
            ForEach(index.projects) { item($0.name, $0.id, in: index).tag(String?.some($0.id)) }
        }
        .pickerStyle(.inline)
        Divider()
        ViewMenuSlot(project: shown)
    }

    // A menu item draws text and an image only, so the lamp is a coloured image and the count is in the text. Like the page's rail, every view shows its own lamp.
    @ViewBuilder private func item(_ name: String, _ id: String?, in index: SessionIndex) -> some View {
        let text = id.map { "\(name) (\(SidebarOutline.count(of: $0, in: index, idleRoutines: state.idleRoutines)))" } ?? name
        if let lamp = SidebarOutline.lamp(of: id, in: index) { Label { Text(text) } icon: { dot(lamp) } } else { Text(text) }
    }

    // A menu draws a symbol in one template colour, so the lamp is drawn once as a picture that keeps its own.
    @MainActor private func dot(_ lamp: ViewLamp) -> Image {
        let renderer = ImageRenderer(content: Circle().fill(lamp.color).frame(width: 8, height: 8))
        renderer.scale = 2
        guard let picture = renderer.cgImage else { return Image(systemName: "circle.fill") }
        return Image(decorative: picture, scale: 2).renderingMode(.original)
    }
}

extension ViewLamp {
    /// The page's colours: warning for waiting, success for working.
    var color: Color { self == .waiting ? .orange : .green }
}
