import GhostShellKit
import SwiftUI

/// A widget in the thread: Claude's HTML or SVG in its own web view, and the bar that asks the owner when the widget wants something they did not click.
struct WidgetView: View {
    let tool: ToolCall
    let chat: ChatContext
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let store = chat.store(WidgetStore.self) { WidgetStore(client: chat.client) }
        let mode: WidgetMode = scheme == .dark ? .dark : .light
        let widget = store.controller(for: tool, chat: chat, mode: mode)
        WidgetBody(widget: widget, mode: mode)
            .id(ObjectIdentifier(widget))
    }
}

private struct WidgetBody: View {
    let widget: WidgetController
    let mode: WidgetMode

    /// The frame's height until the widget has measured itself, as the page's 12rem.
    private static let placeholderHeight: CGFloat = 192
    private static let radius: CGFloat = 14

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if widget.closed {
                Text("This widget tried to open another page, so GhostShell closed it.")
                    .font(ChatStyle.body).foregroundStyle(.secondary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.background, in: RoundedRectangle(cornerRadius: Self.radius))
                    .overlay(RoundedRectangle(cornerRadius: Self.radius).strokeBorder(.quaternary))
            } else {
                frame
                if let request = widget.request {
                    WidgetAsk(request: request, confirm: widget.confirm, cancel: widget.cancel)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeOut(duration: 0.18), value: widget.request)
        // `initial` applies the current mode to a widget kept across a rebuilt row, such as one the lazy stack dropped during an appearance change.
        .onChange(of: mode, initial: true) { _, next in widget.setMode(next) }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var frame: some View {
        let web = WidgetWebHost(view: widget.webView)
            .accessibilityLabel(widget.title)
        if widget.card {
            // The picture is drawn on a card, with the border outside the content as on the page.
            web
                .padding(1)
                .frame(maxWidth: .infinity)
                .modifier(PendingRatio(ratio: pendingRatio))
                .frame(height: heightWithBorder)
                .background(Self.cardColor(mode), in: RoundedRectangle(cornerRadius: Self.radius))
                .clipShape(RoundedRectangle(cornerRadius: Self.radius))
                .overlay(RoundedRectangle(cornerRadius: Self.radius).strokeBorder(.quaternary))
        } else {
            web.frame(maxWidth: .infinity).frame(height: height)
        }
    }

    private var height: CGFloat { CGFloat(widget.height ?? Int(Self.placeholderHeight)) }
    private var heightWithBorder: CGFloat? { widget.height.map { CGFloat($0) + 2 } ?? placeholderBox }

    // Until the frame has measured itself, an SVG card holds the place its picture will take.
    private var placeholderBox: CGFloat? { widget.ratio == nil ? Self.placeholderHeight : nil }
    private var pendingRatio: CGFloat? { widget.height == nil ? widget.ratio.map { CGFloat($0.width / $0.height) } : nil }

    private static func cardColor(_ mode: WidgetMode) -> Color {
        // The two greys public/app.css calls --widget-card, so the card and the picture in it match.
        mode == .dark ? Color(white: 0.09) : Color(white: 0.993)
    }
}

/// Holds an SVG card to its viewBox shape until the widget measures itself. NOTE: [8 Nov 2026] EK - `.aspectRatio(nil, ...)` is not a no-op: it takes the
/// web view's own ideal size, a small square, so the modifier must be left off once the height is known.
private struct PendingRatio: ViewModifier {
    let ratio: CGFloat?

    func body(content: Content) -> some View {
        if let ratio { content.aspectRatio(ratio, contentMode: .fit) } else { content }
    }
}
