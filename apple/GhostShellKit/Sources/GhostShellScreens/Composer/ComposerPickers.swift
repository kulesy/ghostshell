import GhostShellKit
import SwiftUI

/// The model, effort and permission mode of the chat, in the box's footer. On the iPhone each shrinks to its icon with little room. On the Mac the
/// row wraps instead, as the page's does, and the account the chat runs on shows before the model.
struct ComposerPickers: View {
    let model: ComposerModel
    let compact: Bool
    #if os(macOS)
    /// The permission mode on one line and the account, model and effort on the next, at the right.
    var wrapped = false
    #endif

    var body: some View {
        row
        .task(id: model.folder) {
            // A typed folder probes the CLI on the server, so wait for typing to pause.
            if model.chat == nil {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
            }
            await model.loadModels()
        }
    }

    @ViewBuilder private var row: some View {
        #if os(macOS)
        // The page puts the permission mode on the left and the account, model and effort on the right, with no chevrons.
        if wrapped {
            VStack(alignment: .trailing, spacing: 0) {
                HStack(spacing: 2) { modeMenu; Spacer(minLength: 0) }
                HStack(spacing: 2) { AccountLabel(model: model); modelMenu; effortMenu }
            }
        } else {
            HStack(spacing: 2) { modeMenu; Spacer(minLength: 8); AccountLabel(model: model); modelMenu; effortMenu }
        }
        #else
        HStack(spacing: 2) { modelMenu; effortMenu; modeMenu }
        #endif
    }

    #if os(macOS)
    private static let font = ChatStyle.body
    private static let hidesIndicator = true
    /// The effort is the quiet one, as on the page.
    private func ink(_ quiet: Bool) -> AnyShapeStyle { quiet ? ChatStyle.muted : AnyShapeStyle(Color.ghost.foreground) }
    #else
    private static let font = ChatStyle.small
    private static let hidesIndicator = false
    private func ink(_ quiet: Bool) -> AnyShapeStyle { AnyShapeStyle(.secondary) }
    #endif

    private func look(_ name: String, _ symbol: String, quiet: Bool = false) -> some View {
        Group {
            if compact { Image(systemName: symbol) } else { Text(name) }
        }
        .font(Self.font)
        .foregroundStyle(ink(quiet))
        .padding(.horizontal, 6).padding(.vertical, 3)
        #if os(iOS)
        .frame(minWidth: 44, minHeight: 44)
        #else
        // The page's buttons are 2rem tall, which is also the context ring's height beside them.
        .frame(minHeight: 2 * GhostMetrics.current.rem)
        #endif
        .contentShape(Rectangle())
    }

    private func choice<T: Equatable>(_ get: @escaping @MainActor () -> T, _ set: @escaping (T) -> ComposerSetting) -> Binding<T> {
        Binding(get: get, set: { value in Task { await model.pick(set(value)) } })
    }

    private var modelName: String { model.shownModel.map { ComposerOptions.modelName($0, listed: model.listedModels) } ?? "Model" }

    private var modelMenu: some View {
        Menu {
            Picker("Model", selection: choice({ model.shownModel ?? "" }, { .model($0) })) {
                ForEach(ComposerOptions.mainModels) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.inline)
            Menu("More models") {
                Picker("More models", selection: choice({ model.shownModel ?? "" }, { .model($0) })) {
                    ForEach(ComposerOptions.moreModels(listed: model.listedModels)) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.inline)
            }
            if model.takesFast {
                Divider()
                Toggle("Fast mode", isOn: choice({ model.fast }, { .fast($0) }))
            }
            #if os(macOS)
            AccountSubmenu(model: model)
            #endif
        } label: {
            look(modelName + (model.fast ? " fast" : ""), model.fast ? "bolt.fill" : "cpu")
        }
        .pickerMenuStyle()
        .menuIndicator(compact || Self.hidesIndicator ? .hidden : .visible)
        .fixedSize()
        .help("Model: \(modelName)")
        .accessibilityLabel("Model: \(modelName)")
    }

    private var effortMenu: some View {
        let name = model.effort.map(ComposerOptions.effortName) ?? "Effort"
        return Menu {
            Picker("Effort", selection: choice({ model.effort ?? "" }, { .effort($0) })) {
                ForEach(ComposerOptions.efforts) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.inline)
        } label: {
            look(name, "speedometer", quiet: true)
        }
        .pickerMenuStyle()
        .menuIndicator(compact || Self.hidesIndicator ? .hidden : .visible)
        .fixedSize()
        .help("Effort: \(name)")
        .accessibilityLabel("Effort: \(name)")
    }

    private var modeMenu: some View {
        let name = model.mode.map(ComposerOptions.modeName) ?? "Permissions"
        return Menu {
            Picker("Permission mode", selection: choice({ model.mode ?? "" }, { .mode($0) })) {
                ForEach(ComposerOptions.modes) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.inline)
        } label: {
            look(name, "lock.shield")
        }
        .pickerMenuStyle()
        .menuIndicator(compact || Self.hidesIndicator ? .hidden : .visible)
        .fixedSize()
        .help("Permission mode: \(name)")
        .accessibilityLabel("Permission mode: \(name)")
    }
}

private extension View {
    /// The Mac's borderless menu draws its label in the primary colour, which hides the quiet effort. A plain button keeps the label's own colour.
    @ViewBuilder func pickerMenuStyle() -> some View {
        #if os(macOS)
        menuStyle(.button).buttonStyle(.plain)
        #else
        menuStyle(.borderlessButton)
        #endif
    }
}

#if os(macOS)
/// What the composer shows of the account: the chat's own, or for a new session the one it will start on.
@MainActor private func accountOf(_ model: ComposerModel, _ app: AppModel) -> OrganiseRules.ChatAccount {
    let index = app.index ?? SessionIndex()
    if let chat = model.chat { return OrganiseRules.chatAccount(index, app.accounts, id: chat.sessionID) }
    return OrganiseRules.chatAccount(index, app.accounts, group: model.group, picked: model.fresh.account)
}

/// The account's name before the model, as the page's `account-label`. Menus are fixed in size, so this is the first thing to shrink.
private struct AccountLabel: View {
    @Environment(AppModel.self) private var app
    let model: ComposerModel
    private let rem = GhostMetrics.current.rem

    var body: some View {
        let name = OrganiseRules.accountLabel(app.accounts, accountOf(model, app).shown)
        if !name.isEmpty {
            CappedWidth(limit: 9 * rem) {
                Text(verbatim: name).font(Font.geist(0.75 * rem)).foregroundStyle(ChatStyle.muted).lineLimit(1).truncationMode(.tail)
            }
            .padding(.trailing, 0.25 * rem)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Account: \(name)")
        }
    }
}

/// The Account item at the end of the model menu, as the page's: the choice of account, and for an existing chat where it moves when its pin runs out.
private struct AccountSubmenu: View {
    @Environment(AppModel.self) private var app
    let model: ComposerModel

    /// The page shows the pin's name as the item's value, which a native submenu has no place for but its title.
    private func title(_ mine: OrganiseRules.ChatAccount, _ accounts: [Account]) -> String {
        guard let pin = mine.pin else { return "Account" }
        let name = OrganiseRules.accountName(accounts, pin)
        return "Account: \(name.isEmpty ? "Removed" : name)"
    }

    var body: some View {
        let mine = accountOf(model, app)
        if mine.offered, let accounts = app.accounts {
            Divider()
            Menu(title(mine, accounts)) {
                AccountChoices(accounts: accounts, pin: mine.pin, follows: mine.follows, overflow: mine.overflow,
                               pick: { account in Task { await model.pick(.account(account)) } },
                               pickOverflow: model.chat == nil ? nil : { overflow in Task { await model.pick(.overflow(overflow, pin: mine.pin)) } })
            }
        }
    }
}

/// Holds its one child to a width, and no wider than the child wants, which a plain `frame(maxWidth:)` would not.
private struct CappedWidth: Layout {
    let limit: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews[0].sizeThatFits(fitted(proposal, subviews[0]))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let fit = fitted(ProposedViewSize(width: bounds.width, height: bounds.height), subviews[0])
        subviews[0].place(at: bounds.origin, anchor: .topLeading, proposal: fit)
    }

    private func fitted(_ proposal: ProposedViewSize, _ child: LayoutSubview) -> ProposedViewSize {
        let ideal = child.sizeThatFits(.unspecified).width
        return ProposedViewSize(width: min(ideal, limit, proposal.width ?? .infinity), height: proposal.height)
    }
}
#endif
