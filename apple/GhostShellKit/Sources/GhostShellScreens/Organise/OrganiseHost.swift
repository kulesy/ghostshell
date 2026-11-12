import GhostShellKit
import SwiftUI

/// Gives the sidebar its organising state and shows what that state asks: a failure, a question, or a name to type.
struct OrganiseHost: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @State private var organise = OrganiseModel()

    func body(content: Content) -> some View {
        @Bindable var organise = organise
        content
            .environment(organise)
            .onAppear { organise.bind(model, state) }
            .task(id: model.visible) {
                while model.visible, !Task.isCancelled {
                    await organise.loadAccounts()
                    try? await Task.sleep(for: .seconds(10))
                }
            }
            .alert("That did not work", isPresented: Binding(get: { organise.problem != nil }, set: { if !$0 { organise.problem = nil } })) {
                Button("OK") {}
            } message: {
                Text(organise.problem ?? "")
            }
            .alert(organise.asking?.title ?? "", isPresented: Binding(get: { organise.asking != nil }, set: { if !$0 { organise.asking = nil } }), presenting: organise.asking) { ask in
                Button("Cancel", role: .cancel) { ask.cancel?() }
                Button(ask.action, role: .destructive) { ask.run() }
            } message: { ask in
                Text(ask.detail)
            }
            .sheet(item: Binding(get: { organise.naming.flatMap { $0.inline ? nil : $0 } }, set: { if $0 == nil { organise.naming = nil } })) { NameSheet(organise: organise, naming: $0) }
    }
}

/// One text field for a name, with Cancel and Save. Save is off while the name is empty or no different, as the page skips those.
private struct NameSheet: View {
    let organise: OrganiseModel
    let naming: OrganiseModel.Naming
    @State private var text: String
    @FocusState private var focused: Bool

    init(organise: OrganiseModel, naming: OrganiseModel.Naming) {
        self.organise = organise
        self.naming = naming
        _text = State(initialValue: naming.text)
    }

    private var canSave: Bool {
        let name = OrganiseRules.clean(text)
        return !name.isEmpty && name != OrganiseRules.clean(naming.was) && !organise.saving
    }

    var body: some View {
        #if os(iOS)
        // A phone gets a titled sheet with Cancel and Save in the bar, at a small detent so the chat stays in view behind it.
        NavigationStack {
            Form {
                Section {
                    field.frame(minHeight: 44).contentShape(Rectangle()).onTapGesture { focused = true }
                    if let problem = organise.namingProblem { Notice(text: problem) }
                }
            }
            .navigationTitle(naming.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // A framed label is the only way to make a bar's text button 44pt wide.
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { organise.cancelName() } label: { Text("Cancel").phoneIconTouch() } }
                ToolbarItem(placement: .confirmationAction) { Button { organise.submitName(text) } label: { Text("Save").fontWeight(.semibold).phoneIconTouch() }.disabled(!canSave) }
            }
        }
        .presentationDetents([.height(240), .medium])
        .onAppear { focused = true }
        #else
        VStack(alignment: .leading, spacing: 12) {
            Text(naming.title).font(.headline)
            field.textFieldStyle(.roundedBorder)
            if let problem = organise.namingProblem { Notice(text: problem) }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { organise.cancelName() }.keyboardShortcut(.cancelAction)
                Button("Save") { organise.submitName(text) }.keyboardShortcut(.defaultAction).disabled(!canSave)
            }
        }
        .padding(20)
        .frame(width: 340)
        .onAppear { focused = true }
        #endif
    }

    private var field: some View {
        TextField(naming.prompt, text: $text)
            .focused($focused)
            .onSubmit { if canSave { organise.submitName(text) } }
            .onChange(of: text) { _, new in if new.count > naming.limit { text = String(new.prefix(naming.limit)) } }
            .accessibilityLabel(naming.prompt)
    }
}
