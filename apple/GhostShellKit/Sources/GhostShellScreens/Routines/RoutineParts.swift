import GhostShellKit
import SwiftUI

/// The line a write leaves behind, at the foot of a routine screen. It goes after a few seconds, and Open shows the session a start made.
struct NoteBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let note = model.routines.note {
            HStack(spacing: 10) {
                Image(systemName: note.isProblem ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(note.isProblem ? Color.orange : Color.green)
                Text(note.text).lineLimit(2)
                if let id = note.open {
                    Button("Open") { model.navigator.openSession(id) }
                }
                Button("Dismiss", systemImage: "xmark") { model.routines.note = nil }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
            }
            .font(.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(.separator))
            .padding(.bottom, 12)
            .transition(.opacity)
            .task(id: note.id) {
                try? await Task.sleep(for: .seconds(6))
                if !Task.isCancelled, model.routines.note?.id == note.id { model.routines.note = nil }
            }
            .accessibilityElement(children: .contain)
        }
    }
}

extension View {
    /// Puts the note bar over the foot of a screen.
    func noteBar() -> some View { overlay(alignment: .bottom) { NoteBar() } }
}

/// A form row: the label, the control, then the hint and the server's message for the field in red.
struct FormField<Control: View>: View {
    let label: String
    var hint: String?
    var message: String?
    @ViewBuilder var control: Control

    var body: some View {
        LabeledContent(label) {
            VStack(alignment: .leading, spacing: 4) {
                control
                if let hint { Text(hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                if let message {
                    Label(message, systemImage: "exclamationmark.circle.fill")
                        .font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// A text field with a menu of what the person has used before, such as a group heading or a folder.
struct SuggestField<Tag: Hashable>: View {
    let label: String
    @Binding var text: String
    let options: [String]
    var prompt: String?
    var focus: FocusState<Tag?>.Binding
    let tag: Tag

    var body: some View {
        HStack(spacing: 4) {
            TextField(label, text: $text, prompt: prompt.map { Text($0) }).labelsHidden().autocorrectionDisabled().focused(focus, equals: tag)
            if !options.isEmpty {
                Menu {
                    ForEach(options, id: \.self) { option in Button(option) { text = option } }
                } label: {
                    Image(systemName: "chevron.down.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Choose one you have used")
                .accessibilityLabel("\(label) choices")
            }
        }
    }
}

/// A select that starts with Default, and keeps a value the lists lack.
struct ChoicePicker: View {
    let label: String
    @Binding var value: String
    let choices: [Choice]

    var body: some View {
        Picker(label, selection: $value) {
            ForEach(choices) { Text($0.label).tag($0.value).disabled($0.disabled) }
        }
        .labelsHidden()
        .fixedSize()
    }
}

/// The page's note under the three selects.
let defaultFollowsNote = "Default follows Claude Desktop's settings for the folder."

extension View {
    /// A set of radio buttons side by side on the Mac, and the plain inline picker elsewhere.
    @ViewBuilder func radioGroup() -> some View {
        #if os(macOS)
        pickerStyle(.radioGroup).horizontalRadioGroupLayout()
        #else
        pickerStyle(.inline)
        #endif
    }
}
