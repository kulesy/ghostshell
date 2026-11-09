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
                    Button("Open") { model.navigator.openSession(id) }.phoneTouch()
                }
                Button("Dismiss", systemImage: "xmark") { model.routines.note = nil }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .phoneIconTouch()
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

/// A form row: the label above the control, then the hint and the server's message for the field in red, all down one leading edge like the web page's Field.
struct FormField<Control: View>: View {
    let label: String
    var hint: String?
    var message: String?
    @ViewBuilder var control: Control

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.weight(.medium))
            control.multilineTextAlignment(.leading)
            if let hint { Text(hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            if let message {
                Label(message, systemImage: "exclamationmark.circle.fill")
                    .font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            TextField(label, text: $text, prompt: prompt.map { Text($0) }).labelsHidden().autocorrectionDisabled().phoneField(focus, tag)
            if !options.isEmpty {
                Menu {
                    ForEach(options, id: \.self) { option in Button(option) { text = option } }
                } label: {
                    Image(systemName: "chevron.down.circle").phoneIconTouch()
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
        #if os(iOS)
        // A menu whose label is a full-width 44pt row, because a Picker's own menu button is only as tall as its text.
        Menu {
            Picker(label, selection: $value) {
                ForEach(choices) { Text($0.label).tag($0.value).disabled($0.disabled) }
            }
        } label: {
            HStack(spacing: 8) {
                Text(choices.first { $0.value == value }?.label ?? value)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
        #else
        Picker(label, selection: $value) {
            ForEach(choices) { Text($0.label).tag($0.value).disabled($0.disabled) }
        }
        .labelsHidden()
        .fixedSize()
        #endif
    }
}

/// The page's note under the three selects.
let defaultFollowsNote = "Default follows Claude Desktop's settings for the folder."

/// Cancel and Save for a form. The Mac keeps all three in the toolbar; a phone keeps Delete out of the nav bar, where it sits beside Save, in a section
/// at the foot of the form (`PhoneDeleteSection`).
struct FormToolbar: ToolbarContent {
    var canDelete: Bool
    var saving: Bool
    var canSave = true
    let delete: () -> Void
    let cancel: () -> Void
    let save: () -> Void

    var body: some ToolbarContent {
        #if os(iOS)
        ToolbarItemGroup(placement: .topBarTrailing) {
            // The bar sizes a bare text button to its words; a framed label is the only way to make it 44pt wide.
            Button(role: .cancel, action: cancel) { Text("Cancel").phoneIconTouch() }
            Button(action: save) { Text(saving ? "Saving" : "Save").fontWeight(.semibold).phoneIconTouch() }.disabled(!canSave)
        }
        #else
        ToolbarItemGroup {
            if canDelete { Button("Delete", role: .destructive, action: delete) }
            Button("Cancel", role: .cancel, action: cancel)
            Button(saving ? "Saving" : "Save", action: save).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!canSave)
        }
        #endif
    }
}

/// The phone's Delete, at the foot of an edit form. It is nothing on the Mac, whose toolbar has the button.
struct PhoneDeleteSection: View {
    var show: Bool
    let delete: () -> Void

    var body: some View {
        #if os(iOS)
        if show {
            Section { Button("Delete", role: .destructive, action: delete).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading) }
        }
        #endif
    }
}

extension View {
    /// A control in a phone form is 44pt tall like the ones around it. The Mac is left as it was.
    func phoneField() -> some View {
        #if os(iOS)
        frame(minHeight: 44).contentShape(Rectangle())
        #else
        self
        #endif
    }

    /// A text field that takes focus from anywhere in its 44pt row, because the frame alone leaves the 11pt above and below dead.
    func phoneField<Tag: Hashable>(_ focus: FocusState<Tag?>.Binding, _ tag: Tag) -> some View {
        #if os(iOS)
        focused(focus, equals: tag).frame(minHeight: 44).contentShape(Rectangle()).onTapGesture { focus.wrappedValue = tag }
        #else
        focused(focus, equals: tag)
        #endif
    }
}

/// The folder a new routine or scheduled session starts in. The Mac's home is the server's own, but a phone's is the app's sandbox, so it starts empty and
/// takes the server's home from `api/folders`.
var startFolder: String {
    #if os(iOS)
    ""
    #else
    NSHomeDirectory()
    #endif
}

/// "in the GhostShell server's time zone (GMT+10)", with the zone once the server has sent a time.
func serverZoneWords(_ zone: TimeZone?) -> String {
    "in the GhostShell server's time zone" + (zone?.abbreviation().map { " (\($0))" } ?? "")
}

extension View {
    /// A set of radio buttons side by side on the Mac, and a segmented control on a phone, where two short options fit on one line.
    @ViewBuilder func radioGroup() -> some View {
        #if os(macOS)
        pickerStyle(.radioGroup).horizontalRadioGroupLayout()
        #else
        pickerStyle(.segmented)
        #endif
    }
}
