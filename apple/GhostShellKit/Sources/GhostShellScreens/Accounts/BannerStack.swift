import GhostShellKit
import SwiftUI

/// The banners at the top of the sidebar: sign-in, out of usage, switched by itself, Chrome, update, in that order.
/// The page also offers a passkey here, which is made in a browser, so this app leaves it out.
public struct BannerStack: View {
    @Environment(AppModel.self) private var model
    @State private var state = BannersState()
    @State private var height: CGFloat = 0
    private var presence = AccountsPresence.shared

    public init() {}

    private var cards: [BannerCard] {
        guard !state.absent, let banners = state.banners else { return [] }
        // The Accounts screen shows the Chrome banner itself.
        return bannerCards(banners).filter { !($0.kind == .chrome && presence.open) }
    }

    public var body: some View {
        Group {
            if !cards.isEmpty {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(cards) { card in
                            BannerCardView(card: card, problem: state.refusal(for: card), busy: state.pending.contains(card.kind) || (card.kind == .update && state.forcing),
                                           onAction: { act(card) }, onForce: { force() }, onDismiss: { dismiss(card) })
                        }
                    }
                    .padding(8)
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { height = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: min(height, 220))
            }
        }
        .task(id: model.visible) {
            guard model.visible, let client = model.client else { return }
            while true {
                await state.load(client)
                guard await pause(state.absent ? bannerAbsentPoll : state.polling) else { return }
            }
        }
        .alert("Force restart \u{201C}GhostShell\u{201D}?", isPresented: Binding(get: { state.asking != nil }, set: { if !$0 { state.asking = nil } }), presenting: state.asking) { _ in
            Button("Cancel", role: .cancel) {}
            Button("Force restart", role: .destructive) {
                if let card = cards.first(where: { $0.kind == .update }), let client = model.client { Task { await state.forceRestart(card, client) } }
            }
        } message: { ask in
            Text(ask.question)
        }
    }

    private func act(_ card: BannerCard) {
        guard let client = model.client else { return }
        let banners = state.banners
        Task {
            switch card.kind {
            case .login: await state.press(card, client) { try await $0.bannerSignIn(account: banners?.login?.accountId) }
            case .update: await state.press(card, client) { try await $0.update() }
            case .out:
                guard let to = banners?.accounts?.out?.to else { return }
                await state.press(card, client, reload: true) { _ = try await $0.use(account: to.id); return nil }
            case .chrome: await state.press(card, client, reload: true) { _ = try await $0.chromeOpen(); return nil }
            case .auto: break
            }
        }
    }

    private func dismiss(_ card: BannerCard) {
        guard let client = model.client else { return }
        Task {
            switch card.kind {
            case .auto: await state.press(card, client, reload: true) { _ = try await $0.seenAutoSwitch(); return nil }
            case .chrome: await state.press(card, client, reload: true) { _ = try await $0.chromeSeen(); return nil }
            default: break
            }
        }
    }

    private func force() {
        guard let client = model.client else { return }
        Task { await state.askToForce(client) }
    }
}
