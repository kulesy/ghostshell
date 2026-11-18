import GhostShellKit
import SwiftUI

/// What the view picker lists: Home and the projects, then the slot's items. The header's projects button opens it.
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
    var color: Color { self == .waiting ? Color.ghost.warning : Color.ghost.successForeground }
}
