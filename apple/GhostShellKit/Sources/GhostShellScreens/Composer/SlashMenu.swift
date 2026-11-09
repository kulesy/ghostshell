import GhostShellKit
import SwiftUI

/// The `/` list above the box. The arrows and Enter are the text box's, so a click is the only thing handled here.
struct SlashMenu: View {
    let model: ComposerModel

    static func height(for count: Int) -> CGFloat { min(CGFloat(count) * 30 + 8, 248) }

    var body: some View {
        let list = model.matches
        let at = model.highlighted
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.offset) { n, command in
                        Button { model.choose(command); model.requestFocus() } label: { SlashRow(command: command, selected: n == at) }
                            .buttonStyle(.plain)
                            .id(n)
                    }
                }
                .padding(4)
            }
            .onChange(of: at) { _, now in if now >= 0 { proxy.scrollTo(now) } }
        }
        .frame(height: Self.height(for: list.count))
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Commands")
    }
}

private struct SlashRow: View {
    let command: SlashCommand
    let selected: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "/\(command.name)").font(.system(size: 13, weight: .medium, design: .monospaced))
            if !command.hint.isEmpty { Text(verbatim: command.hint).font(ChatStyle.small).foregroundStyle(.tertiary).lineLimit(1) }
            Text(verbatim: command.description).font(ChatStyle.small).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .frame(height: 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .accessibilityLabel("/\(command.name) \(command.description)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
