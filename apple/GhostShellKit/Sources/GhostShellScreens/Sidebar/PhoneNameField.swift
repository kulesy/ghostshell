#if os(iOS)
import GhostShellKit
import SwiftUI

/// The page's inline name form: the row becomes a field with its text selected. Return saves, and so does leaving the field with a changed name.
/// An unchanged or empty name cancels, which `OrganiseModel.submitName` decides.
struct PhoneNameField: View {
    @Environment(OrganiseModel.self) private var organise
    let naming: OrganiseModel.Naming
    var heading = false
    @State private var text: String
    @State private var selection: TextSelection?
    @FocusState private var focused: Bool
    @State private var hadFocus = false

    init(naming: OrganiseModel.Naming, heading: Bool = false) {
        self.naming = naming
        self.heading = heading
        _text = State(initialValue: naming.text)
    }

    /// Runs a turn after Return or the focus loss, so the row is not removed from the list while the keyboard is still resigning.
    private func commit() {
        Task { @MainActor in organise.submitName(text) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(naming.prompt, text: $text, selection: $selection)
                .focused($focused)
                .font(heading ? .geist(12, weight: .semibold, relativeTo: .caption) : .geist(14, relativeTo: .body))
                .foregroundStyle(Color.ghost.sidebarForeground)
                .submitLabel(.done)
                .onSubmit { commit() }
                .onChange(of: text) { _, new in if new.count > naming.limit { text = String(new.prefix(naming.limit)) } }
                .onChange(of: focused) { _, now in
                    if now { hadFocus = true } else if hadFocus { commit() }
                }
                .padding(.horizontal, 8)
                .frame(minHeight: 36)
                .background(Color.ghost.background, in: RoundedRectangle(cornerRadius: GhostRadius.md))
                .overlay(RoundedRectangle(cornerRadius: GhostRadius.md).strokeBorder(Color.ghost.ring, lineWidth: 1))
                .accessibilityLabel(naming.prompt)
            if let problem = organise.namingProblem {
                Text(problem).font(.geist(12, relativeTo: .caption)).foregroundStyle(Color.ghost.destructive)
            }
        }
        .padding(.vertical, 4)
        .padding(.trailing, 8)
        .frame(minHeight: 48)
        .onAppear {
            focused = true
        }
        .task {
            // The selection is ignored until the field has taken focus, so it is set a beat later.
            try? await Task.sleep(for: .milliseconds(200))
            selection = TextSelection(range: text.startIndex..<text.endIndex)
        }
    }
}
#endif
