import SwiftUI

extension View {
    /// The page's ground and an inline title under the back link, for a screen that draws its own rows.
    func ghostScreen() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline).background(Color.ghost.background)
        #else
        background(Color.ghost.background)
        #endif
    }

    /// A plain list on the page's ground, so its rows read as flat rows split by 1px rules.
    func ghostList() -> some View {
        listStyle(.plain).scrollContentBackground(.hidden).ghostScreen()
    }

    /// One flat row of a `ghostList`: the page's 14pt above and below, 16pt at the sides, and the border colour for its rule.
    func ghostRow() -> some View {
        listRowInsets(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparatorTint(Color.ghost.border)
    }

    /// The page's muted 14pt secondary line.
    func ghostMuted(_ size: CGFloat = 14) -> some View {
        font(.geist(size)).foregroundStyle(Color.ghost.mutedForeground)
    }
}

/// The page's empty state: a title, a muted paragraph and an action, left aligned between two 1px rules.
struct FlatEmpty<Action: View>: View {
    let title: String
    let text: String
    @ViewBuilder var action: Action

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rule()
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.geist(16)).foregroundStyle(Color.ghost.foreground)
                Text(text).ghostMuted(16).fixedSize(horizontal: false, vertical: true)
                action
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 14)
            Rule()
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private let inputShape = RoundedRectangle(cornerRadius: GhostRadius.sm, style: .continuous)

#if os(iOS)
private let inputHeight: CGFloat = 44
#else
private let inputHeight: CGFloat = 36
#endif

extension View {
    /// The page's input box: card fill and a 1px border, which turns destructive when the field has a message.
    func ghostBox(invalid: Bool = false) -> some View {
        background(Color.ghost.card, in: inputShape)
            .overlay { inputShape.strokeBorder(invalid ? Color.ghost.destructive : Color.ghost.input, lineWidth: 1) }
    }

    /// A one-line input as the page draws it: 16pt text, 12pt at the sides, boxed. Geist Mono for a folder or a schedule.
    func ghostInput(mono: Bool = false, invalid: Bool = false) -> some View {
        font(mono ? .geistMono(16) : .geist(16))
            .foregroundStyle(Color.ghost.foreground)
            .textFieldStyle(.plain)
            .padding(.horizontal, 12)
            .frame(minHeight: inputHeight)
            .ghostBox(invalid: invalid)
    }
}

extension View {
    /// The page's prompt box, for a TextEditor: Geist 16pt, at least 256pt tall, boxed like an input.
    func ghostEditor(invalid: Bool = false) -> some View {
        font(.geist(16))
            .foregroundStyle(Color.ghost.foreground)
            .frame(minHeight: 256)
            .scrollContentBackground(.hidden)
            .padding(8)
            .ghostBox(invalid: invalid)
    }
}

/// A screen's one column of fields on the page ground, 20pt apart unless told otherwise, as the page lays a form out.
struct FlatForm<Content: View>: View {
    var spacing: CGFloat = 20
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: spacing) { content }
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
                .frame(maxWidth: 576, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .ghostScreen()
    }
}
