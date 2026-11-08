import GhostShellKit
import Observation
import SwiftUI

/// What the zoomable canvas tells the viewer's buttons, and what they ask of it.
@Observable @MainActor
final class ZoomController {
    private(set) var atFit = true
    /// False when the picture is already shown at its own size, so there is nothing to toggle to.
    private(set) var canToggle = false
    @ObservationIgnored var toggleHandler: (() -> Void)?

    func update(atFit: Bool, canToggle: Bool) {
        self.atFit = atFit
        self.canToggle = canToggle
    }

    func toggle() { toggleHandler?() }
}

/// Drawn over the whole chat while the store holds a viewer. The picture sits on a dark backdrop, and a click outside it, Esc or Close puts it away.
struct ImageViewerOverlay: View {
    let store: FilesStore

    var body: some View {
        ZStack {
            if let viewer = store.viewer {
                ViewerContent(store: store, viewer: viewer).transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: store.viewer != nil)
    }
}

private struct ViewerContent: View {
    let store: FilesStore
    let viewer: FilesStore.Viewer

    @State private var zoom = ZoomController()
    /// The decoded picture and the id it belongs to, so a step never shows the last picture under the new count.
    @State private var decoded: (id: String, image: PlatformImage)?
    @State private var failed = false

    var body: some View {
        let total = viewer.pictures.count
        ZStack {
            Color.black.opacity(0.94).ignoresSafeArea().onTapGesture { store.closeViewer() }
            if let loaded {
                ZoomCanvas(image: loaded, alt: viewer.current.alt, controller: zoom) { store.closeViewer() }
                    .id(viewer.current.id)
                    .accessibilityLabel(viewer.current.alt)
            } else if failed {
                Text("This image could not be loaded.").font(ChatStyle.body).foregroundStyle(.white.opacity(0.85))
            } else {
                ProgressView().controlSize(.large).environment(\.colorScheme, .dark)
            }
            chrome(total)
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .task(id: viewer.current.id) { await load() }
    }

    private var loaded: PlatformImage? { decoded?.id == viewer.current.id ? decoded?.image : nil }

    private func chrome(_ total: Int) -> some View {
        ZStack {
            VStack {
                HStack(spacing: 10) {
                    if total > 1 {
                        Text(verbatim: "\(viewer.index + 1) of \(total)")
                            .font(ChatStyle.small.monospacedDigit()).foregroundStyle(.white)
                            .padding(.horizontal, 10).frame(height: 30)
                            .background(Color.black.opacity(0.5), in: Capsule())
                    }
                    Spacer()
                    round(zoom.atFit ? "Actual size" : "Fit to window", zoom.atFit ? "arrow.up.left.and.arrow.down.right" : "arrow.down.right.and.arrow.up.left") {
                        zoom.toggle()
                    }
                    .disabled(!zoom.canToggle || loaded == nil)
                    round("Close", "xmark") { store.closeViewer() }.keyboardShortcut(.escape, modifiers: [])
                }
                Spacer()
            }
            if total > 1 {
                HStack {
                    round("Previous image", "chevron.left") { store.step(-1) }.disabled(viewer.index == 0)
                    Spacer()
                    round("Next image", "chevron.right") { store.step(1) }.disabled(viewer.index == total - 1)
                }
                // The arrow keys step only while the picture is fitted, because a zoomed picture uses them to scroll.
                keys.disabled(!zoom.atFit)
            }
        }
        .padding(14)
    }

    private var keys: some View {
        Group {
            Button("Previous image") { store.step(-1) }.keyboardShortcut(.leftArrow, modifiers: [])
            Button("Next image") { store.step(1) }.keyboardShortcut(.rightArrow, modifiers: [])
        }
        .frame(width: 0, height: 0).opacity(0).allowsHitTesting(false).accessibilityHidden(true)
    }

    private func round(_ name: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Color.black.opacity(0.5), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain).help(name).accessibilityLabel(name)
    }

    private func load() async {
        let picture = viewer.current
        failed = false
        if let hit = store.pictures.cached(picture.id) {
            decoded = (picture.id, hit)
        } else {
            let image = await store.pictures.image(picture)
            guard !Task.isCancelled else { return }
            if let image { decoded = (picture.id, image) } else { failed = true }
        }
        // The neighbours decode while this one is looked at, so stepping is quick.
        for neighbour in [viewer.index - 1, viewer.index + 1] where viewer.pictures.indices.contains(neighbour) {
            let next = viewer.pictures[neighbour]
            Task { _ = await store.pictures.image(next) }
        }
    }
}
