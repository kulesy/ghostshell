import Foundation
import GhostShellKit
import Observation

/// What the organising menus, drops and name sheets share: the question or error on screen, and every action that edits the layout.
/// Each action sends the page's request, then reads the index again at once so the sidebar does not wait for the next poll.
@Observable @MainActor
final class OrganiseModel {
    /// A confirmation, such as deleting a group. `run` does the work once the person agrees.
    struct Question: Identifiable {
        let id = UUID()
        var title: String
        var detail: String
        var action: String
        var run: @MainActor () -> Void
    }

    /// A name to type, for a new or renamed session, group or project. `run` returns the server's words when it refuses.
    struct Naming: Identifiable {
        let id = UUID()
        var title: String
        var prompt: String
        var text: String
        var was: String
        var limit: Int
        var run: @MainActor (String) async -> String?
    }

    var problem: String?
    var asking: Question?
    var naming: Naming?
    var namingProblem: String?
    private(set) var saving = false
    /// The accounts the Account menu lists, read with the same call as the Accounts screen. Nil until the first read, or when it failed.
    private(set) var accounts: [Account]?

    private weak var app: AppModel?
    private weak var state: SidebarState?

    func bind(_ app: AppModel, _ state: SidebarState) { (self.app, self.state) = (app, state) }

    var index: SessionIndex { app?.index ?? SessionIndex() }
    var features: SessionFeatures { index.features ?? SessionFeatures() }
    var view: String? { SidebarOutline.view(state?.project, in: index) }

    func loadAccounts() async {
        guard features.accountPins, let client = app?.client else { return }
        accounts = try? await client.accounts().accounts
    }

    // MARK: Sending

    /// Runs `work`, reads the index again, and returns the server's words when it failed.
    @discardableResult
    private func attempt(_ work: (GhostShellClient) async throws -> Void) async -> String? {
        guard let client = app?.client else { return GhostShellError.signedOut.localizedDescription }
        var failure: String?
        do { try await work(client) } catch { failure = error.localizedDescription }
        await app?.refreshIndex()
        return failure
    }

    private func run(_ work: @escaping @MainActor (GhostShellClient) async throws -> Void) {
        Task { if let failure = await attempt(work) { problem = failure } }
    }

    private func ask(_ title: String, _ detail: String, action: String, run: @escaping @MainActor () -> Void) {
        asking = Question(title: title.isEmpty ? "Untitled" : title, detail: detail, action: action, run: run)
    }

    // MARK: Names

    func submitName(_ text: String) {
        guard let current = naming, !saving else { return }
        let name = OrganiseRules.clean(text)
        if name.isEmpty || name == OrganiseRules.clean(current.was) { naming = nil; return }
        saving = true
        namingProblem = nil
        Task {
            let failure = await current.run(text)
            saving = false
            if let failure { namingProblem = failure } else { naming = nil }
        }
    }

    func cancelName() { naming = nil; namingProblem = nil }

    private func askName(_ title: String, prompt: String, text: String = "", limit: Int, run: @escaping @MainActor (String) async -> String?) {
        namingProblem = nil
        naming = Naming(title: title, prompt: prompt, text: text, was: text, limit: limit, run: run)
    }

    // MARK: One session

    func rename(_ row: SessionRow) {
        askName("Rename session", prompt: "Title", text: row.title, limit: OrganiseRules.titleMax) { [self] text in
            await attempt { try await $0.renameSession(row.id, title: OrganiseRules.clean(text)) }
        }
    }

    func pin(_ row: SessionRow) { endSelection(unless: row.id); run { try await $0.pinSession(row.id) } }

    /// Moves a session into a section: Pinned, a group, or a loose list. A drop that leaves it where it is sends nothing.
    func place(_ row: SessionRow, section: String) {
        endSelection(unless: row.id)
        if OrganiseRules.staysPut(index, row, section: section) { return }
        if section == "pinned" { return run { try await $0.pinSession(row.id) } }
        let group = index.groups.contains { $0.id == section } ? section : nil
        run { try await $0.moveSession(row.id, group: group) }
    }

    func nest(_ row: SessionRow, under parent: String?) {
        endSelection(unless: row.id)
        guard let parent else { return run { try await $0.nestSession(row.id, parent: nil) } }
        guard let root = OrganiseRules.root(index, parent) else { return }
        if OrganiseRules.nestsNothing(index, row, under: parent) { return }
        state?.setUnfolded(root.id, true)
        run { try await $0.nestSession(row.id, parent: root.id) }
    }

    /// Pins a session to an account, or with nil clears the pin. The server refuses an account that is signed out.
    func pinAccount(_ row: SessionRow, to account: String?) { endSelection(unless: row.id); run { try await $0.pinAccount(id: row.id, account: account) } }

    func stop(_ row: SessionRow) { endSelection(unless: row.id); run { try await $0.stopSession(row.id) } }

    /// A session with a chat running in it or below it is asked about first, since archiving stops them.
    func archive(_ row: SessionRow) {
        endSelection(unless: row.id)
        let subs = OrganiseRules.subsRunning(OrganiseRules.every(index), row.id)
        if subs > 0 { confirmStop(row, subs: subs) } else { archiveOne(row, stop: OrganiseRules.isRunning(row)) }
    }

    private func confirmStop(_ row: SessionRow, subs: Int) {
        let itself = OrganiseRules.isRunning(row)
        ask(row.title, OrganiseRules.stopQuestion(subs: subs, itself: itself), action: "Stop and archive") { [self] in archiveOne(row, stop: true) }
    }

    /// Without `stop` the server refuses with a 409 when a chat is running, which turns into the question.
    private func archiveOne(_ row: SessionRow, stop: Bool) {
        Task {
            guard let client = app?.client else { return }
            do {
                try await client.archiveSession(row.id, stop: stop)
            } catch GhostShellError.refused(let status, _) where status == 409 && !stop {
                confirmStop(row, subs: OrganiseRules.subsRunning(OrganiseRules.every(index), row.id))
            } catch {
                problem = error.localizedDescription
            }
            await app?.refreshIndex()
        }
    }

    // MARK: Several sessions

    /// The chosen rows in the order the sidebar draws them, for a write that sends them together.
    func ordered(_ chosen: Set<String>) -> [String] {
        var drawn: [String] = []
        for section in SidebarOutline.sections(index, view: state?.project) {
            if section.kind == .routines {
                drawn += section.buckets.flatMap(\.routines).flatMap { [$0.latest] + $0.earlier }.map(\.id)
            } else {
                drawn += section.rows.flatMap { [$0] + $0.children }.map(\.id)
            }
        }
        let rest = OrganiseRules.every(index).map(\.id).filter { chosen.contains($0) && !drawn.contains($0) }
        return (drawn + rest).filter(chosen.contains)
    }

    /// The whole selection when `row` is one of several chosen rows, in drawn order. Nil when the row stands alone.
    func selection(with row: SessionRow) -> [String]? {
        guard let chosen = state?.selection, chosen.count > 1, chosen.contains(row.id) else { return nil }
        return ordered(chosen)
    }

    /// A menu or drop on a row outside the selection ends it, as in Finder.
    private func endSelection(unless id: String) {
        if let state, state.selection.count > 1, !state.selection.contains(id) { state.selection = [] }
    }

    func clearSelection() { state?.selection = [] }

    func moveMany(_ ids: [String], section: String) {
        let to = OrganiseRules.target(index, section: section)
        if OrganiseRules.changesNothing(index, ids, to) { return }
        run { try await $0.placeSessions(ids, to: to) }
    }

    func nestMany(_ ids: [String], under parent: String?) {
        guard let parent else { return run { try await $0.placeSessions(ids, to: .parent(nil)) } }
        guard let root = OrganiseRules.root(index, parent) else { problem = "Not nested: that session is no longer in the list."; return }
        if let refusal = OrganiseRules.refuseNest(index, ids, under: parent) { problem = refusal; return }
        if OrganiseRules.changesNothing(index, ids, .parent(root.id)) { return }
        state?.setUnfolded(root.id, true)
        run { try await $0.placeSessions(ids, to: .parent(root.id)) }
    }

    /// Archives the topmost chosen sessions, which take the ones below them along. Several with a chat running are asked about once.
    func archiveMany(_ ids: [String]) {
        let rows = OrganiseRules.topmost(index, ids)
        clearSelection()
        if rows.count < 2 {
            if let row = rows.first { archive(row) }
            return
        }
        let all = OrganiseRules.every(index)
        let running = rows.filter(OrganiseRules.isRunning).count
        let below = rows.reduce(0) { $0 + OrganiseRules.subsRunning(all, $1.id) }
        if running == 0 && below == 0 { return archiveBatch(rows, stop: false, tally: Tally(total: rows.count)) }
        ask(OrganiseRules.sessions(rows.count), OrganiseRules.batchStopDetail(running: running, subs: below), action: "Stop and archive") { [self] in
            archiveBatch(rows, stop: true, tally: Tally(total: rows.count))
        }
    }

    private struct Tally {
        var total: Int
        var done = 0, stopped = 0, subs = 0
        var refused: [String] = []
    }

    /// Archives one session at a time, as the page does. A chat found running when none were meant to be stopped is asked about once more.
    private func archiveBatch(_ rows: [SessionRow], stop: Bool, tally: Tally) {
        Task {
            guard let client = app?.client else { return }
            var tally = tally
            var busy: [SessionRow] = []
            for row in rows {
                do {
                    let reply = try await client.archiveSession(row.id, stop: stop)
                    tally.done += 1
                    tally.stopped += reply.stoppedCount
                    tally.subs += reply.subs
                } catch GhostShellError.refused(let status, _) where status == 409 && !stop {
                    busy.append(row)
                } catch {
                    tally.refused.append(error.localizedDescription)
                }
            }
            let all = OrganiseRules.every(index)
            await app?.refreshIndex()
            let settled = tally.total - busy.count
            if tally.done < settled {
                problem = OrganiseRules.archiveNote(archived: tally.done, total: settled, stopped: tally.stopped, subs: tally.subs, reason: tally.refused.first ?? "")
            }
            guard !busy.isEmpty else { return }
            let itself = busy.filter(OrganiseRules.isRunning).count
            let below = busy.reduce(0) { $0 + OrganiseRules.subsRunning(all, $1.id) }
            let carried = tally
            ask(OrganiseRules.sessions(busy.count), OrganiseRules.batchStopDetail(running: itself, subs: below), action: "Stop and archive") { [self] in
                archiveBatch(busy, stop: true, tally: carried)
            }
        }
    }

    // MARK: Groups

    func newGroup() {
        let project = view
        let name = project.flatMap { id in index.projects.first { $0.id == id }?.name }
        askName(name.map { "New group in \($0)" } ?? "New group", prompt: "Name", limit: OrganiseRules.nameMax) { [self] text in
            await attempt { _ = try await $0.addGroup(name: text, project: project) }
        }
    }

    func rename(_ group: SessionGroup) {
        askName("Rename group", prompt: "Name", text: group.name, limit: OrganiseRules.nameMax) { [self] text in
            await attempt { try await $0.renameGroup(group.id, name: text) }
        }
    }

    func move(_ group: SessionGroup, toProject project: String?) { run { try await $0.moveGroup(group.id, project: project) } }

    func order(_ group: SessionGroup, _ side: OrderSide, beside: String) { run { try await $0.orderGroup(group.id, side, beside: beside) } }

    func delete(_ group: SessionGroup) {
        ask(group.name, OrganiseRules.deleteDetail(group), action: "Delete group") { [self] in
            Task {
                let failure = await attempt { _ = try await $0.removeGroup(group.id) }
                if let failure { return problem = failure }
                if let chat = group.session?.id, app?.navigator.selectedSessionID == chat { app?.navigator.clear() }
            }
        }
    }

    // MARK: Projects

    func newProject() {
        askName("New project", prompt: "Name", limit: OrganiseRules.nameMax) { [self] text in
            var made: MadeFolder?
            let failure = await attempt { made = try await $0.addProject(name: text) }
            if failure == nil, let made { state?.project = made.id }
            return failure
        }
    }

    func rename(_ project: SessionProject) {
        askName("Rename project", prompt: "Name", text: project.name, limit: OrganiseRules.nameMax) { [self] text in
            await attempt { try await $0.renameProject(project.id, name: text) }
        }
    }

    func delete(_ project: SessionProject) {
        ask(project.name, OrganiseRules.deleteDetail(project, in: index), action: "Delete project") { [self] in
            run { try await $0.removeProject(project.id) }
        }
    }
}
