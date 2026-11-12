import GhostShellKit
import SwiftUI

/// The box under a card that sends a message to its session. Enter sends, Shift-Enter makes a new line and Esc closes it. On a phone Return makes a new line, Send sends and Cancel closes it. Its text is `GroupCards.boxes`,
/// so it survives the card moving to another part of the list.
struct GroupReplyBox: View {
    @Environment(GroupCards.self) private var cards
    let row: SessionRow
    let name: String
    @FocusState private var focused: Bool

    var body: some View {
        let box = cards.box(row.id)
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: Binding(get: { cards.box(row.id).text }, set: { cards.boxes[row.id, default: ReplyBoxState()].text = $0 }))
                .font(.callout)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .frame(minHeight: 44, maxHeight: 120)
                .padding(4)
                .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 6))
                .overlay(alignment: .topLeading) {
                    if box.text.isEmpty { Text("Message").font(.callout).foregroundStyle(.tertiary).padding(.horizontal, 9).padding(.vertical, 4).allowsHitTesting(false) }
                }
                .disabled(box.sending)
                .accessibilityLabel("Message to \(name)")
                .onKeyPress(.return, phases: .down) { press in
                    guard !press.modifiers.contains(.shift) else { return .ignored }
                    send()
                    return .handled
                }
                .onKeyPress(.escape) {
                    cards.flipBox(row.id)
                    return .handled
                }
            if row.state == .waiting {
                Text("It's waiting on a card in its chat, so this reaches it after you answer that.").font(.caption).foregroundStyle(.secondary)
            }
            if !box.problem.isEmpty {
                Text("Not sent: \(box.problem)").font(.caption).foregroundStyle(GroupTint.color(.error))
            }
            HStack(spacing: 8) {
                Button(box.sending ? "Sending" : "Send", action: send)
                    .phoneTouch(boxed: true).compactOnMac()
                    .disabled(box.sending || box.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                #if os(iOS)
                // A phone has no Esc, and Return adds a line, so Cancel is the way to close the box.
                Button("Cancel") { dismissKeyboard(); cards.flipBox(row.id) }.phoneTouch().disabled(box.sending)
                #endif
            }
            .id(Self.buttonsID(row.id))
        }
        .onAppear { if cards.focusing == row.id { focused = true } }
        .onChange(of: focused) { _, now in if now { cards.focusing = row.id } }
    }

    /// The id of the Send and Cancel row, which the panel scrolls above the keyboard.
    static func buttonsID(_ row: String) -> String { "reply-buttons-\(row)" }

    // On iOS 27 an editor that turns disabled while still focused is refocused on every frame, which hangs the app, so the keyboard goes first.
    private func send() { dismissKeyboard(); Task { await cards.send(row.id, name: name) } }
}
