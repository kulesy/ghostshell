import GhostShellKit
import SwiftUI

/// The scheduled session form, for a new one (`id` nil) or an edit of a pending one. An edit sends only what changed, and the time to the minute.
struct ScheduledFormScreen: View {
    @Environment(AppModel.self) private var model
    let id: String?

    private enum Load { case loading, ready(ScheduledSummary?), missing, failed(String), settled(String) }
    @State private var load = Load.loading

    var body: some View {
        Group {
            switch load {
            case .loading: ProgressView("Loading").frame(maxWidth: .infinity, maxHeight: .infinity)
            case .missing: unavailable("That scheduled session is not here any more.")
            case .failed(let why), .settled(let why): unavailable(why)
            case .ready(let was): ScheduledFields(was: was)
            }
        }
        .navigationTitle(id == nil ? "Schedule a session" : "Edit scheduled session")
        .task(id: id) { await open() }
    }

    private func unavailable(_ text: String) -> some View {
        ContentUnavailableView {
            Label(text, systemImage: "clock.badge.exclamationmark")
        } actions: {
            Button("Back to scheduled sessions") { model.navigator.show { ScheduledScreen() } }
        }
    }

    private func open() async {
        guard let id else { load = .ready(nil); return }
        let store = model.routines
        if store.scheduled == nil { await store.refresh() }
        guard let s = store.scheduled?.first(where: { $0.id == id }) else {
            load = store.scheduled == nil ? .failed("Could not load scheduled sessions: \(store.failure ?? "no answer")") : .missing
            return
        }
        load = s.isPending ? .ready(s) : .settled("\(s.title) is \(s.status), so it can no longer be changed.")
    }
}

private enum Focus: String, Hashable { case title, at, cwd, model, effort, mode, group, prompt }

private struct ScheduledFields: View {
    @Environment(AppModel.self) private var model
    let was: ScheduledSummary?
    @State private var draft: ScheduledDraft
    @State private var problems: [String: String] = [:]
    @State private var notice: String?
    @State private var saving = false
    @State private var deleting = false
    @State private var folders: [String] = []
    @FocusState private var focus: Focus?

    init(was: ScheduledSummary?) {
        self.was = was
        _draft = State(initialValue: was.map { ScheduledDraft($0) } ?? ScheduledDraft(home: NSHomeDirectory()))
    }

    private var store: RoutinesStore { model.routines }

    var body: some View {
        Form {
            if let notice {
                Section { Label(notice, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }
            Section {
                FormField(label: "Title", hint: "The session is called this.", message: problems["title"]) {
                    TextField("Title", text: $draft.title).labelsHidden().focused($focus, equals: .title)
                }
                FormField(label: "Date and time", hint: "In this Mac's time zone. If GhostShell is off then, it starts as soon as it is back, unless that is more than 12 hours late.",
                          message: problems["at"]) {
                    DatePicker("Date and time", selection: $draft.at, displayedComponents: [.date, .hourAndMinute]).labelsHidden().focused($focus, equals: .at)
                }
            }
            Section("Where it runs") {
                FormField(label: "Folder", hint: "The full path of the folder the session starts in.", message: problems["cwd"]) {
                    SuggestField(label: "Folder", text: $draft.cwd, options: folders, focus: $focus, tag: .cwd)
                }
                FormField(label: "Model", message: problems["model"]) {
                    ChoicePicker(label: "Model", value: $draft.model, choices: modelChoices(current: was?.model)).focused($focus, equals: .model)
                }
                FormField(label: "Effort", message: problems["effort"]) {
                    ChoicePicker(label: "Effort", value: $draft.effort, choices: effortChoices(current: was?.effort)).focused($focus, equals: .effort)
                }
                FormField(label: "Permission mode", hint: defaultFollowsNote, message: problems["mode"]) {
                    ChoicePicker(label: "Permission mode", value: $draft.mode, choices: modeChoices(current: was?.mode)).focused($focus, equals: .mode)
                }
                FormField(label: "Group", hint: "The session goes into this group when it starts. With none it starts on Home.", message: problems["group"]) {
                    ChoicePicker(label: "Group", value: $draft.group, choices: groupChoices(model.index?.groups ?? [], current: was?.group)).focused($focus, equals: .group)
                }
            }
            Section("Prompt") {
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
                    if let text = problems["prompt"] {
                        Label(text, systemImage: "exclamationmark.circle.fill").font(.caption).foregroundStyle(.red)
                    }
                }
                Text("GhostShell sends it as the session's first message, with a note that nobody is there to answer.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .disabled(saving)
        .toolbar {
            ToolbarItemGroup {
                if was != nil { Button("Delete", role: .destructive) { deleting = true } }
                Button("Cancel", role: .cancel) { leave() }
                Button(saving ? "Saving" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
        .noteBar()
        .task { folders = (try? await model.client?.folders()) ?? [] }
        .confirmationDialog("Delete “\(was?.title ?? draft.title)”?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete scheduled session", role: .destructive) { Task { if let was, await store.delete(was) { leave() } } }
            Button("Cancel", role: .cancel) {}.keyboardShortcut(.defaultAction)
        } message: {
            Text(was.map { deleteDetail($0) } ?? "")
        }
        .onChange(of: draft) { old, new in
            guard !problems.isEmpty else { return }
            let changed: [(String, Bool)] = [("title", old.title != new.title), ("at", old.at != new.at), ("cwd", old.cwd != new.cwd), ("model", old.model != new.model),
                ("effort", old.effort != new.effort), ("mode", old.mode != new.mode), ("group", old.group != new.group), ("prompt", old.prompt != new.prompt)]
            for (key, did) in changed where did { problems[key] = nil }
        }
    }

    private func save() async {
        guard !saving, let client = model.client else { return }
        saving = true
        defer { saving = false }
        notice = nil
        problems = [:]
        let body = draft.request(against: was)
        if was != nil, body.isEmpty { leave(); return }
        do {
            if let was { try await client.editScheduled(id: was.id, body) } else { try await client.addScheduled(body) }
            store.note = RoutineNote(text: "\(was == nil ? "Scheduled" : "Saved") “\(draft.title.trimmingCharacters(in: .whitespaces))”.")
            await store.refresh()
            leave()
        } catch let error as GhostShellError {
            let fields = error.fields(in: scheduledFields)
            if fields.isEmpty { notice = error.localizedDescription; return }
            problems = Dictionary(uniqueKeysWithValues: fields.map { ($0.field, $0.sentence) })
            focus = Focus(rawValue: fields[0].field)
        } catch {
            notice = error.localizedDescription
        }
    }

    private func leave() { model.navigator.show { ScheduledScreen() } }
}
