import GhostShellKit
import SwiftUI

/// The banners at the top of the sidebar: sign-in, out of usage, switched by itself, Chrome, update, in that order.
/// The page also offers a passkey here, which is made in a browser, so this app leaves it out.
public struct BannerStack: View {
    @Environment(AppModel.self) private var model
    @State private var state = BannersState()
    @State private var height: CGFloat = 0
    private let cap: CGFloat = 220
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
                .scrollIndicators(.hidden)
                .frame(height: min(height, cap))
                // The page fades the end of a long stack out and does not cut it with a rule.
                .mask {
                    LinearGradient(stops: [.init(color: .black, location: height > cap ? 0.85 : 1), .init(color: height > cap ? .clear : .black, location: 1)],
                                   startPoint: .top, endPoint: .bottom)
                }
            }
        }
        .task(id: model.visible) {
            guard model.visible, let client = model.client else { return }
            while true {
                await state.load(client)
                guard await pause(state.absent ? bannerAbsentPoll : state.polling) else { return }
            }
        }
        #if os(macOS)
        // The page asks in its own dialog over the whole window. A system alert dims only this pane and sits in a narrow card.
        .onChange(of: state.asking != nil) { _, open in
            model.navigator.overlay = open ? AnyView(ForceDialog(question: state.asking?.question ?? "", cancel: { state.asking = nil }, confirm: confirmForce)) : nil
        }
        #else
        .alert("Force restart \u{201C}GhostShell\u{201D}?", isPresented: Binding(get: { state.asking != nil }, set: { if !$0 { state.asking = nil } }), presenting: state.asking) { _ in
            Button("Cancel", role: .cancel) {}
            Button("Force restart", role: .destructive, action: confirmForce)
        } message: { ask in
            Text(ask.question)
        }
        #endif
    }

    private func confirmForce() {
        if let card = cards.first(where: { $0.kind == .update }), let client = model.client { Task { await state.forceRestart(card, client) } }
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

#if os(macOS)
/// The page's question dialog: a wide card, left aligned, with Cancel and the red action at the right.
private struct ForceDialog: View {
    let question: String
    let cancel: () -> Void
    let confirm: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea().onTapGesture(perform: cancel)
            VStack(alignment: .leading, spacing: 8) {
                Text("Force restart \u{201C}GhostShell\u{201D}?").font(.geist(18, weight: .semibold)).foregroundStyle(Color.ghost.foreground)
                Text(question).font(.geist(14)).foregroundStyle(Color.ghost.mutedForeground).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel", action: cancel).buttonStyle(.ghost(.outline)).keyboardShortcut(.cancelAction)
                    Button("Force restart") { cancel(); confirm() }.buttonStyle(.ghost(.destructive))
                }
                .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: 480, alignment: .leading)
            .background(Color.ghost.popover, in: GhostShape(GhostRadius.xl))
            .overlay(GhostShape(GhostRadius.xl).strokeBorder(Color.ghost.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
            .padding(24)
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}
#endif
