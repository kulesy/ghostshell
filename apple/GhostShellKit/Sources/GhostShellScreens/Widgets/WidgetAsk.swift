import SwiftUI

/// What a widget asked for without a click of the owner's. The button does nothing for the first moments after the bar appears, so a tap meant for
/// something else cannot land on it.
struct WidgetAsk: View {
    let request: WidgetRequest
    let confirm: () -> Void
    let cancel: () -> Void

    private static let armDelay = Duration.milliseconds(600)
    @State private var armed = false
    @State private var wide = false
    @FocusState private var focused: Bool

    private var isLink: Bool { request.kind == .link }
    private var isLong: Bool { request.text.count > 240 || request.text.split(separator: "\n", omittingEmptySubsequences: false).count > 4 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(isLink ? "A widget wants to open a link" : "A widget wants to send this to Claude")
                .font(ChatStyle.caption).fontWeight(.semibold).textCase(.uppercase).tracking(0.6).foregroundStyle(ChatStyle.muted)
            if isLink {
                Text(verbatim: request.host).font(.system(size: 17, weight: .semibold)).textSelection(.enabled)
                Text(verbatim: request.text).font(ChatStyle.monoSmall).foregroundStyle(ChatStyle.muted).lineLimit(wide ? nil : 3).textSelection(.enabled)
            } else {
                Text(verbatim: request.text).font(.system(size: 15)).lineLimit(wide ? nil : 4).textSelection(.enabled)
            }
            if isLong {
                Button(wide ? "Show less" : "Show all") { wide.toggle() }
                    .buttonStyle(.borderless).font(ChatStyle.small).phoneTouch()
            }
            if !request.error.isEmpty {
                Text(request.error).font(ChatStyle.small).foregroundStyle(.red).accessibilityAddTraits(.isStaticText)
            }
            HStack(spacing: 10) {
                Button(isLink ? "Open link" : "Send") { if armed && !request.working { confirm() } }
                    .buttonStyle(.ghost(.primary, size: .compact))
                    .opacity(armed && !request.working ? 1 : 0.5)
                    .accessibilityLabel(isLink ? "Open link" : "Send")
                    .accessibilityHint(armed ? "" : "Not ready yet")
                Button("Cancel", action: cancel)
                    .buttonStyle(.ghost(.outline, size: .compact))
                    .accessibilityLabel("Cancel")
            }
        }
        // Escape cancels only with focus inside the bar, as on the page, which also focuses the bar when it opens. A window-wide cancel shortcut would also take Escape typed in the composer.
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onTapGesture { focused = true }
        .onAppear { focused = true }
        .onKeyPress(.escape) {
            cancel()
            return .handled
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatStyle.card, in: RoundedRectangle(cornerRadius: ChatStyle.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusCard).strokeBorder(ChatStyle.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Request from the widget")
        .task(id: request.error) {
            armed = false
            try? await Task.sleep(for: Self.armDelay)
            armed = true
        }
    }
}
