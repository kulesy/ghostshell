import GhostShellKit
import SwiftUI

public struct AccountsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var state = AccountsState()
    @State private var name = ""

    public init() {}

    public var body: some View {
        Form {
            if let card = chromeCard(state.list?.chrome) {
                Section {
                    BannerCardView(card: card, problem: state.refused["chrome"] ?? "", busy: state.pending.contains("chrome"),
                                   onAction: { act("chrome") { try await $0.chromeOpen() } },
                                   onDismiss: { act("chrome") { try await $0.chromeSeen() } })
                }
            }
            Section {
                Text(state.list.map(accountsLead) ?? "Chats and routines run on the active account.").font(.callout).foregroundStyle(.secondary)
            }
            if let list = state.list {
                ForEach(list.accounts) { account in
                    Section { AccountRow(account: account, list: list, state: state) }
                }
                addForm(list)
                Section {
                    Toggle("Switch accounts by itself", isOn: Binding(get: { list.autoSwitch }, set: { on in act("auto") { try await $0.setAutoSwitch(on) } }))
                        .disabled(state.pending.contains("auto"))
                    Text("When the active account runs out of usage, new messages go to another signed-in account. A chat that is mid-turn finishes where it is.")
                        .font(.caption).foregroundStyle(.secondary)
                    if let words = state.refused["auto"] { Notice(text: words) }
                }
            } else if state.problem.isEmpty {
                Section { Text("Loading accounts").foregroundStyle(.secondary) }
            }
            if !state.problem.isEmpty { Section { Notice(text: state.problem) } }
        }
        .formStyle(.grouped)
        .navigationTitle("Accounts")
        .onAppear { AccountsPresence.shared.open = true }
        .onDisappear { AccountsPresence.shared.open = false }
        .task(id: model.visible) {
            guard model.visible, let client = model.client else { return }
            repeat { await state.load(client) } while await pause(state.polling)
        }
        .task(id: model.visible) {
            guard model.visible, let client = model.client else { return }
            repeat { await state.refreshPlans(client) } while await pause(60)
        }
    }

    private func act(_ key: String, _ call: @escaping @Sendable (GhostShellClient) async throws -> AccountList) {
        guard let client = model.client else { return }
        Task { await state.act(key, client, call) }
    }

    private func addForm(_ list: AccountList) -> some View {
        let clean = cleanName(name)
        return Section("Add an account") {
            HStack {
                TextField("Name", text: $name, prompt: Text("Name, such as Work"))
                    .onChange(of: name) { _, text in if text.count > addNameLimit { name = String(text.prefix(addNameLimit)) } }
                    .onSubmit { add(clean, list) }
                Button("Add and sign in") { add(clean, list) }
                    .disabled(clean.isEmpty || list.waiting || state.pending.contains("add"))
            }
            Text("Signing in opens a page in the browser on the Mac. Approve it with the Claude account you want to add.").font(.caption).foregroundStyle(.secondary)
            if let words = state.refused["add"] { Notice(text: words) }
        }
    }

    private func add(_ clean: String, _ list: AccountList) {
        guard !clean.isEmpty, !list.waiting, let client = model.client else { return }
        Task { if await state.act("add", client, { try await $0.addAccount(name: clean) }) { name = "" } }
    }
}

struct AccountRow: View {
    @Environment(AppModel.self) private var model
    let account: Account
    let list: AccountList
    let state: AccountsState
    @State private var renaming = false
    @State private var draft = ""

    var body: some View {
        let waiting = account.stage == .waiting
        let pins = pinnedWords(account.pinned)
        let noChrome = pinnedChromeWords(account, in: list.accounts)
        let same = account.sameAs == nil ? "" : sameAccountWords(account, in: list)
        let plan = planRows(account.plan?.limits)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    if renaming { renameForm } else { title }
                    let meta = [account.email, account.planType].compactMap { $0 }.filter { !$0.isEmpty }
                    if !meta.isEmpty { Text(meta.joined(separator: " · ")).font(.callout).foregroundStyle(.secondary) }
                    Text(signInLine(account)).font(.callout).foregroundStyle(.secondary)
                    if !pins.isEmpty { Text(pins).font(.callout).foregroundStyle(.secondary) }
                    if !noChrome.isEmpty { Text(noChrome).font(.callout).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 8)
                actions(waiting: waiting)
            }
            if let out = account.out { Notice(text: outWords(out)) }
            if !same.isEmpty { Notice(text: same) }
            if waiting { Text(waitingWords(account)).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            if let words = state.refused[account.id] ?? (account.stage == .failed && !account.problem.isEmpty ? account.problem : nil) { Notice(text: words) }
            if !plan.isEmpty, let at = account.plan?.at {
                PlanBars(rows: plan)
                Text("As of \(planAsOf(at))").font(.caption).foregroundStyle(.secondary)
            }
            if !account.chats.isEmpty { chats }
        }
        .padding(.vertical, 2)
    }

    private var title: some View {
        HStack(spacing: 6) {
            Text(account.name).font(.headline)
            if account.active {
                Text("Active").font(.caption.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 1)
                    .background(.quaternary, in: Capsule())
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var renameForm: some View {
        HStack {
            TextField("Rename \(account.name)", text: $draft)
                .labelsHidden()
                .onChange(of: draft) { _, text in if text.count > renameLimit { draft = String(text.prefix(renameLimit)) } }
                .onSubmit(save)
            Button("Save", action: save).disabled(cleanName(draft).isEmpty)
            Button("Cancel") { renaming = false }
        }
    }

    private func save() {
        let text = cleanName(draft)
        guard !text.isEmpty, let client = model.client else { return }
        Task { if await state.act(account.id, client, { try await $0.rename(account: account.id, name: text) }) { renaming = false } }
    }

    @ViewBuilder private func actions(waiting: Bool) -> some View {
        let busy = state.pending.contains(account.id)
        HStack(spacing: 6) {
            if !account.active && !account.signedOut {
                Button("Switch to this") { run { try await $0.use(account: account.id) } }.disabled(busy)
            }
            if needsSignIn(account) {
                Button(waiting ? "Waiting for the Mac" : "Sign in") { run { try await $0.signIn(account: account.id) } }
                    .disabled(busy || waiting || list.waiting)
            }
            if !renaming {
                Button("Rename") { draft = account.name; renaming = true }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Rename \(account.name)")
            }
        }
        .controlSize(.small)
    }

    private func run(_ call: @escaping @Sendable (GhostShellClient) async throws -> AccountList) {
        guard let client = model.client else { return }
        Task { await state.act(account.id, client, call) }
    }

    private var chats: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Running chats").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(account.chats) { chat in
                HStack {
                    Button { model.navigator.openSession(chat.id) } label: { Text(chat.title.isEmpty ? "Untitled" : chat.title).lineLimit(1) }
                        .buttonStyle(.plain).foregroundStyle(.tint)
                    Spacer(minLength: 8)
                    Text(chatStateWords(chat.state)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}
