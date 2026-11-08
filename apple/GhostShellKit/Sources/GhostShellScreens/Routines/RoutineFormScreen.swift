import GhostShellKit
import SwiftUI

/// The routine form, for a new routine (`id` nil) or an edit. The body it sends comes from `RoutineDraft.request(against:)`, which sends only what
/// changed, so an edit never re-sends the schedule and re-arms the routine.
struct RoutineFormScreen: View {
    @Environment(AppModel.self) private var model
    let id: String?

    private enum Load { case loading, ready(RoutineBaseline?), missing, failed(String) }
    @State private var load = Load.loading
    @State private var draft: RoutineDraft?
    @State private var loaded = RoutinePrompt()

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView(id == nil ? "Loading" : "Loading the routine").frame(maxWidth: .infinity, maxHeight: .infinity)
            case .missing: unavailable("That routine is not here any more.")
            case .failed(let why): unavailable(why)
            case .ready(let baseline):
                if let draft { RoutineFields(draft: draft, baseline: baseline, id: id, loaded: loaded) }
            }
        }
        .navigationTitle(id == nil ? "New routine" : "Edit routine")
        .task(id: id) { await open() }
    }

    private func unavailable(_ text: String) -> some View {
        ContentUnavailableView {
            Label(text, systemImage: "calendar.badge.exclamationmark")
        } actions: {
            Button("Back to routines") { model.navigator.show { RoutinesScreen() } }
        }
    }

    private func open() async {
        let store = model.routines
        guard let id else {
            draft = RoutineDraft(home: NSHomeDirectory())
            load = .ready(nil)
            return
        }
        if store.routines == nil { await store.refresh() }
        guard let routine = store.routine(id) else {
            load = store.routines == nil ? .failed("Could not load routines: \(store.failure ?? "no answer")") : .missing
            return
        }
        do {
            guard let client = model.client else { return }
            let prompt = try await client.routinePrompt(id: id)
            draft = RoutineDraft(routine, prompt: prompt)
            loaded = prompt
            load = .ready(RoutineBaseline(routine, prompt: prompt))
        } catch {
            load = .failed(error.localizedDescription)
        }
    }
}

private enum Focus: Hashable { case title, heading, cron, jitterSeconds, cwd, model, effort, mode, account, file, prompt }

private struct RoutineFields: View {
    @Environment(AppModel.self) private var model
    @State var draft: RoutineDraft
    let baseline: RoutineBaseline?
    let id: String?
    let loaded: RoutinePrompt
    @State private var problems: [String: String] = [:]
    @State private var notice: String?
    @State private var saving = false
    @State private var deleting = false
    @State private var preview = Preview.idle
    @State private var folders: [String] = []
    @State private var accounts: [Account] = []
    @FocusState private var focus: Focus?

    private enum Preview: Equatable { case idle, fires([LocalTime]), never, problem(String) }
    private struct PreviewKey: Equatable { var cron: String; var jitter: String }

    private var store: RoutinesStore { model.routines }
    private var adding: Bool { id == nil }
    private var files: Bool { store.features.routineFiles }
    private var jitter: Int? { jitterOf(draft.jitterSeconds) }
    private var fileMode: Bool { files && draft.promptKind == .file }
    // The read error belongs to the prompt as loaded, so it goes once the person has changed what it describes.
    private var loadedUnchanged: Bool {
        guard files else { return true }
        guard let baseline else { return false }
        return fileMode ? baseline.kind == .file && draft.file == baseline.file : baseline.kind == .text && draft.prompt == baseline.prompt
    }
    private var offersAccount: Bool {
        store.features.accountPins && (!(baseline?.routine.account ?? "").isEmpty || accounts.count > 1)
    }

    init(draft: RoutineDraft, baseline: RoutineBaseline?, id: String?, loaded: RoutinePrompt) {
        _draft = State(initialValue: draft)
        (self.baseline, self.id, self.loaded) = (baseline, id, loaded)
    }

    var body: some View {
        Form {
            if let notice {
                Section { Label(notice, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }
            Section {
                FormField(label: "Title", message: problems["title"]) {
                    TextField("Title", text: $draft.title).labelsHidden().focused($focus, equals: .title)
                }
                if store.features.routineHeadings {
                    FormField(label: "Group", hint: "Routines with the same group show under one heading in Home. Leave it empty for none.", message: problems["heading"]) {
                        SuggestField(label: "Group", text: $draft.heading, options: headingNames(store.routines ?? []), focus: $focus, tag: .heading)
                    }
                }
            }
            Section("Schedule") {
                FormField(label: "Schedule", hint: "Five fields: minute, hour, day of the month, month and day of the week, in this Mac's time. For example 30 7 * * 1-5.",
                          message: problems["cron"] ?? previewProblem) {
                    VStack(alignment: .leading, spacing: 6) {
                        TextField("Schedule", text: $draft.cron, prompt: Text("30 7 * * 1-5")).labelsHidden().font(.body.monospaced())
                            .autocorrectionDisabled().focused($focus, equals: .cron)
                        previewView
                    }
                }
                FormField(label: "Jitter in seconds", hint: "Added to every fire time, so runs do not all start on the minute.",
                          message: problems["jitterSeconds"] ?? (jitter == nil ? jitterProblem : nil)) {
                    TextField("Jitter in seconds", text: $draft.jitterSeconds).labelsHidden().frame(maxWidth: 120).focused($focus, equals: .jitterSeconds)
                }
            }
            Section("Where it runs") {
                FormField(label: "Folder", hint: "The full path of the folder each run starts in.", message: problems["cwd"]) {
                    SuggestField(label: "Folder", text: $draft.cwd, options: folders, focus: $focus, tag: .cwd)
                }
                FormField(label: "Model", message: problems["model"]) {
                    ChoicePicker(label: "Model", value: $draft.model, choices: modelChoices(current: baseline?.routine.model)).focused($focus, equals: .model)
                }
                FormField(label: "Effort", message: problems["effort"]) {
                    ChoicePicker(label: "Effort", value: $draft.effort, choices: effortChoices(current: baseline?.routine.effort)).focused($focus, equals: .effort)
                }
                FormField(label: "Permission mode", hint: defaultFollowsNote, message: problems["mode"]) {
                    ChoicePicker(label: "Permission mode", value: $draft.mode, choices: modeChoices(current: baseline?.routine.mode)).focused($focus, equals: .mode)
                }
                if offersAccount {
                    FormField(label: "Account", hint: "\(accountPickNote) \(chromeNote(accounts))", message: problems["account"]) {
                        ChoicePicker(label: "Account", value: $draft.account, choices: accountChoices(accounts, current: baseline?.routine.account)).focused($focus, equals: .account)
                    }
                }
            }
            promptSection
            Section {
                Toggle("Run on its schedule", isOn: $draft.enabled)
                Text(adding ? "A new routine starts counting from the moment it is on." : "Off keeps the routine here without running it.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .disabled(saving)
        .toolbar {
            ToolbarItemGroup {
                if !adding { Button("Delete", role: .destructive) { deleting = true } }
                Button("Cancel", role: .cancel) { leave() }
                Button(saving ? "Saving" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .noteBar()
        .task(id: PreviewKey(cron: draft.cron, jitter: draft.jitterSeconds)) { await refreshPreview() }
        .task { await loadPickers() }
        .confirmationDialog("Delete “\(baseline?.routine.title ?? draft.title)”?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete routine", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}.keyboardShortcut(.defaultAction)
        } message: {
            Text(baseline.map { deleteDetail($0.routine) } ?? "")
        }
        .onChange(of: draft) { old, new in clearProblems(old, new) }
    }

    // MARK: Prompt

    @ViewBuilder private var promptSection: some View {
        let was = baseline?.kind
        Section("Prompt") {
            if files {
                Picker("Prompt", selection: $draft.promptKind) {
                    Text("GhostShell's own text").tag(PromptKind.text)
                    Text("A prompt file").tag(PromptKind.file)
                }
                .labelsHidden().radioGroup()
            }
            if fileMode {
                FormField(label: "Prompt file", message: problems["file"] ?? (loadedUnchanged ? loaded.error : nil)) {
                    TextField("Full path of the prompt file", text: $draft.file, prompt: Text("/Users/you/prompts/daily-scrum.md")).labelsHidden()
                        .focused($focus, equals: .file)
                }
            } else {
                promptEditor
            }
            Text(files ? promptHint(draft.promptKind, was: was) : adding ? "GhostShell keeps the prompt in its own folder." : promptSource(loaded))
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var promptEditor: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextEditor(text: $draft.prompt)
                .font(.body.monospaced())
                .frame(minHeight: 14 * 17)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(problems["prompt"] == nil ? Color.secondary.opacity(0.25) : .red))
                .focused($focus, equals: .prompt)
                .accessibilityLabel("Prompt")
            if let text = problems["prompt"] ?? (!fileMode && loadedUnchanged ? loaded.error : nil) {
                Label(text, systemImage: "exclamationmark.circle.fill").font(.caption).foregroundStyle(.red)
            }
        }
    }

    // MARK: Preview

    private var previewProblem: String? {
        guard case .problem(let text) = preview, !draft.cron.trimmingCharacters(in: .whitespaces).isEmpty, jitter != nil else { return nil }
        return text
    }

    @ViewBuilder private var previewView: some View {
        let cron = draft.cron.trimmingCharacters(in: .whitespaces)
        if !cron.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                if let words = scheduleWords(cron, jitterSeconds: jitter ?? 0) { Text(words).font(.callout) }
                switch preview {
                case .fires(let times):
                    Text("Next \(times.map { fireTime($0) }.joined(separator: ", "))").font(.callout).foregroundStyle(.secondary)
                case .never where jitter != nil:
                    Text("This schedule never fires.").font(.callout).foregroundStyle(.secondary)
                default: EmptyView()
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    // A change of text restarts this task, which drops the older call; the check after the await drops a late answer that was already on its way.
    private func refreshPreview() async {
        let cron = draft.cron.trimmingCharacters(in: .whitespaces)
        guard !cron.isEmpty, let jitter, let client = model.client else { preview = .idle; return }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        do {
            let answer = try await client.schedulePreview(cron: cron, jitterSeconds: jitter)
            guard !Task.isCancelled else { return }
            if let problem = answer.problem, !problem.isEmpty { preview = .problem(problem) } else { preview = answer.next.isEmpty ? .never : .fires(answer.next) }
        } catch {
            if !Task.isCancelled { preview = .problem(error.localizedDescription) }
        }
    }

    private func loadPickers() async {
        guard let client = model.client else { return }
        folders = (try? await client.folders()) ?? []
        if store.features.accountPins { accounts = (try? await client.accounts())?.accounts ?? [] }
    }

    // MARK: Save and delete

    // Editing a field clears its own message, as the page does.
    private func clearProblems(_ old: RoutineDraft, _ new: RoutineDraft) {
        guard !problems.isEmpty else { return }
        let changed: [(String, Bool)] = [("title", old.title != new.title), ("heading", old.heading != new.heading), ("cron", old.cron != new.cron),
            ("jitterSeconds", old.jitterSeconds != new.jitterSeconds), ("cwd", old.cwd != new.cwd), ("model", old.model != new.model),
            ("effort", old.effort != new.effort), ("mode", old.mode != new.mode), ("account", old.account != new.account),
            ("file", old.file != new.file || old.promptKind != new.promptKind), ("prompt", old.prompt != new.prompt || old.promptKind != new.promptKind)]
        for (key, did) in changed where did { problems[key] = nil }
    }

    private func refuse(_ refusal: ServerRefusal) {
        let fields = refusal.fields(in: ServerRefusal.routineFields)
        if fields.isEmpty { notice = refusal.message; return }
        notice = nil
        problems = Dictionary(uniqueKeysWithValues: fields.map { ($0.field, $0.sentence) })
        focus = Focus(rawFieldName: fields[0].field)
    }

    private func save() async {
        guard !saving, let client = model.client else { return }
        saving = true
        defer { saving = false }
        notice = nil
        problems = [:]
        do {
            let body = try draft.request(against: baseline)
            if baseline != nil, body.isEmpty { leave(); return }
            if let id { try await client.editRoutine(id: id, body) } else { try await client.addRoutine(body) }
            store.note = RoutineNote(text: "\(adding ? "Added" : "Saved") “\(draft.title.trimmingCharacters(in: .whitespaces))”.")
            await store.refresh()
            leave()
        } catch let refusal as ServerRefusal {
            refuse(refusal)
        } catch {
            notice = error.localizedDescription
        }
    }

    private func delete() async {
        guard let routine = baseline?.routine else { return }
        if await store.delete(routine) { leave() }
    }

    private func leave() { model.navigator.show { RoutinesScreen() } }
}

private extension Focus {
    init?(rawFieldName name: String) {
        switch name {
        case "title": self = .title
        case "heading": self = .heading
        case "cron": self = .cron
        case "jitterSeconds": self = .jitterSeconds
        case "cwd": self = .cwd
        case "model": self = .model
        case "effort": self = .effort
        case "mode": self = .mode
        case "account": self = .account
        case "file": self = .file
        case "prompt": self = .prompt
        default: return nil
        }
    }
}
