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

/// Home and the projects. A project that has gone reads as Home.
private struct ViewMenu: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state

    var body: some View {
        let index = model.index ?? SessionIndex()
        let shown = SidebarOutline.view(state.project, in: index)
        Menu {
            Picker("View", selection: Binding(get: { shown }, set: { state.project = $0 })) {
                Text("Home").tag(String?.none)
                ForEach(index.projects) { Text($0.name).tag(String?.some($0.id)) }
            }
            .pickerStyle(.inline)
            Divider()
            ViewMenuSlot(project: shown)
        } label: {
            Label(index.projects.first { $0.id == shown }?.name ?? "Home", systemImage: shown == nil ? "house" : "folder")
        }
        .menuStyle(.borderlessButton)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .accessibilityLabel("View")
    }
}
