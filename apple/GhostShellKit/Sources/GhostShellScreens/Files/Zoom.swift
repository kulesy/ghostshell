import SwiftUI

// The scale shown is relative to a fitted picture: no smaller than fit, and no larger than 4 times fit or the picture's own size, whichever is more.
#if os(macOS)
import AppKit

struct ZoomCanvas: NSViewRepresentable {
    let image: NSImage
    let alt: String
    let controller: ZoomController
    let onBackdrop: () -> Void

    func makeNSView(context: Context) -> ZoomScrollView {
        let view = ZoomScrollView(image: image, alt: alt)
        view.onBackdrop = onBackdrop
        view.onChange = { [weak controller] atFit, canToggle in controller?.update(atFit: atFit, canToggle: canToggle) }
        controller.toggleHandler = { [weak view] in view?.toggle(at: nil) }
        return view
    }

    func updateNSView(_ view: ZoomScrollView, context: Context) { view.onBackdrop = onBackdrop }
}

/// A scroll view that pinches and smart-magnifies the way Preview does. It stays fitted to its size until the person zooms.
final class ZoomScrollView: NSScrollView {
    var onBackdrop: (() -> Void)?
    var onChange: ((Bool, Bool) -> Void)?
    private let imageSize: NSSize
    private let canvas: CanvasView
    private var fit: CGFloat = 1
    private var placed = false
    private var last: (atFit: Bool, canToggle: Bool)?

    init(image: NSImage, alt: String) {
        imageSize = NSSize(width: max(image.size.width, 1), height: max(image.size.height, 1))
        canvas = CanvasView(image: image, size: imageSize)
        super.init(frame: .zero)
        let clip = CenteringClipView()
        clip.drawsBackground = false
        contentView = clip
        documentView = canvas
        canvas.setAccessibilityLabel(alt)
        canvas.onDoubleClick = { [weak self] point in self?.toggle(at: point) }
        drawsBackground = false
        hasHorizontalScroller = false
        hasVerticalScroller = false
        allowsMagnification = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private var atFit: Bool { abs(magnification - fit) < 0.002 }
    private var canToggle: Bool { fit < 0.999 }

    override func layout() {
        super.layout()
        guard bounds.width > 1, bounds.height > 1 else { return }
        let wasFit = !placed || atFit
        fit = min(1, bounds.width / imageSize.width, bounds.height / imageSize.height)
        minMagnification = fit
        maxMagnification = max(4 * fit, 1)
        if wasFit, abs(magnification - fit) > 0.0001 { magnification = fit }
        placed = true
        report()
    }

    override func magnify(with event: NSEvent) {
        super.magnify(with: event)
        report()
    }

    override func smartMagnify(with event: NSEvent) { toggle(at: canvas.convert(event.locationInWindow, from: nil)) }

    /// A click on the dark area around the picture.
    override func mouseDown(with event: NSEvent) { onBackdrop?() }

    func toggle(at point: NSPoint?) {
        guard canToggle || !atFit else { return }
        setMagnification(atFit ? 1 : fit, centeredAt: point ?? NSPoint(x: documentVisibleRect.midX, y: documentVisibleRect.midY))
        report()
    }

    private func report() {
        let state = (atFit, canToggle)
        guard last?.atFit != state.0 || last?.canToggle != state.1 else { return }
        last = state
        Task { @MainActor [weak self] in self?.onChange?(state.0, state.1) }
    }
}

/// Keeps a picture smaller than the window in the middle of it.
private final class CenteringClipView: NSClipView {
    override func constrainBoundsRect(_ proposed: NSRect) -> NSRect {
        var rect = super.constrainBoundsRect(proposed)
        guard let document = documentView else { return rect }
        if rect.width > document.frame.width { rect.origin.x = (document.frame.width - rect.width) / 2 }
        if rect.height > document.frame.height { rect.origin.y = (document.frame.height - rect.height) / 2 }
        return rect
    }
}

private final class CanvasView: NSView {
    private let image: NSImage
    var onDoubleClick: ((NSPoint) -> Void)?

    init(image: NSImage, size: NSSize) {
        self.image = image
        super.init(frame: NSRect(origin: .zero, size: size))
        setAccessibilityRole(.image)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { onDoubleClick?(convert(event.locationInWindow, from: nil)) }
    }
}
#else
import UIKit

/// The same limits with SwiftUI gestures, for a phone or iPad where there is no scroll view to borrow.
struct ZoomCanvas: View {
    let image: UIImage
    let alt: String
    let controller: ZoomController
    let onBackdrop: () -> Void

    @State private var scale: CGFloat = 1
    @State private var pinchBase: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var dragBase: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            let fit = min(1, proxy.size.width / max(image.size.width, 1), proxy.size.height / max(image.size.height, 1))
            let actual = 1 / fit
            let limit = max(4, actual)
            Image(uiImage: image).resizable()
                .frame(width: image.size.width * fit, height: image.size.height * fit)
                .scaleEffect(scale).offset(offset)
                .frame(width: proxy.size.width, height: proxy.size.height)
                .contentShape(Rectangle())
                .gesture(MagnifyGesture()
                    .onChanged { scale = min(max(pinchBase * $0.magnification, 1), limit) }
                    .onEnded { _ in
                        pinchBase = scale
                        if scale <= 1.001 { offset = .zero; dragBase = .zero }
                    })
                .simultaneousGesture(DragGesture()
                    .onChanged { if scale > 1.001 { offset = CGSize(width: dragBase.width + $0.translation.width, height: dragBase.height + $0.translation.height) } }
                    .onEnded { _ in dragBase = offset })
                .onTapGesture(count: 2) { set(scale > 1.001 ? 1 : min(2.5, limit)) }
                .onAppear {
                    controller.update(atFit: true, canToggle: actual > 1.001)
                    controller.toggleHandler = { set(scale > 1.001 ? 1 : actual) }
                }
                .onChange(of: scale) { controller.update(atFit: scale <= 1.001, canToggle: actual > 1.001) }
                .accessibilityLabel(alt)
        }
    }

    private func set(_ value: CGFloat) {
        withAnimation(.easeOut(duration: 0.2)) {
            scale = value
            pinchBase = value
            if value <= 1.001 { offset = .zero; dragBase = .zero }
        }
    }
}
#endif
