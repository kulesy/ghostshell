import GhostShellKit
import SwiftUI

/// Above the list: the view picker, and the server's warning when it has one.
struct SidebarHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
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
    }
}

/// Home and the projects. A project that has gone reads as Home. A view with a session that needs you shows a lamp, and a project shows its count.
private struct ViewMenu: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state

    var body: some View {
        let index = model.index ?? SessionIndex()
        let shown = SidebarOutline.view(state.project, in: index)
        let otherNeedsYou = SidebarOutline.othersWaiting(shown: shown, in: index)
        Menu {
            Picker("View", selection: Binding(get: { shown }, set: { state.project = $0 })) {
                item("Home", nil, shown: shown, in: index).tag(String?.none)
                ForEach(index.projects) { item($0.name, $0.id, shown: shown, in: index).tag(String?.some($0.id)) }
            }
            .pickerStyle(.inline)
            Divider()
            ViewMenuSlot(project: shown)
        } label: {
            Label(index.projects.first { $0.id == shown }?.name ?? "Home", systemImage: shown == nil ? "house" : "folder")
        }
        .menuStyle(.borderlessButton)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A menu label keeps one image and one text, so the lamp sits beside the menu's own chevron.
        .overlay(alignment: .trailing) {
            if otherNeedsYou { Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(.orange).padding(.trailing, 28).allowsHitTesting(false) }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .accessibilityLabel(otherNeedsYou ? "View, another view needs you" : "View")
    }

    // A menu item draws text and an image only, so the lamp is an image and the count is in the text.
    @ViewBuilder private func item(_ name: String, _ id: String?, shown: String?, in index: SessionIndex) -> some View {
        let text = id.map { "\(name) (\(SidebarOutline.count(of: $0, in: index)))" } ?? name
        if id != shown, SidebarOutline.lamp(of: id, in: index) == .waiting { Label(text, systemImage: "circle.fill") } else { Text(text) }
    }
}
