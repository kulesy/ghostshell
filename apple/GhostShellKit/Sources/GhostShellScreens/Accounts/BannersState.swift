import Foundation
import GhostShellKit
import Observation

/// What the sidebar banners say. A reply older than the one on screen is dropped, so a slow answer cannot put an earlier state back.
@Observable @MainActor
final class BannersState {
    private(set) var banners: Banners?
    /// True once the server answers 404, which is a server that has no banners.
    private(set) var absent = false
    private(set) var pending: Set<BannerKind> = []
    private(set) var forcing = false
    /// A refusal answers one press, so it stays only while the card it came from still says the same.
    private var refusals: [BannerKind: (words: String, card: String)] = [:]
    /// Set while the Force restart question is up.
    var asking: ForceAsk?
    private var asked = 0
    private var drawn = 0

    struct ForceAsk: Identifiable, Equatable {
        let id = UUID()
        let question: String
    }

    var polling: TimeInterval { bannerPollInterval(banners) }

    /// Which card and label a refusal belongs to, so it clears once the server's state moves on.
    private func signature(_ card: BannerCard) -> String { "\(card.title)|\(card.action?.label ?? "")" }

    func refusal(for card: BannerCard) -> String {
        guard let held = refusals[card.kind], held.card == signature(card) else { return "" }
        return held.words
    }

    @discardableResult
    func load(_ client: GhostShellClient) async -> Banners? {
        asked += 1
        let ticket = asked
        do {
            let got = try await client.banners()
            absent = false
            if ticket > drawn { drawn = ticket; banners = got }
            return got
        } catch GhostShellError.server(status: 404) {
            absent = true
            return nil
        } catch {
            if let held = banners { banners = keptWhileRestarting(held) }
            return nil
        }
    }

    /// Runs a banner's button and shows the reply. `reload` is for routes that answer with accounts and not banners.
    func press(_ card: BannerCard, _ client: GhostShellClient, reload: Bool = false, _ call: @Sendable (GhostShellClient) async throws -> Banners?) async {
        refusals[card.kind] = nil
        pending.insert(card.kind)
        defer { pending.remove(card.kind) }
        asked += 1
        let ticket = asked
        do {
            if let got = try await call(client) {
                if ticket > drawn { drawn = ticket; banners = got }
            }
            if reload { await load(client) }
        } catch {
            refusals[card.kind] = (error.localizedDescription, signature(card))
        }
    }

    /// The count in the question is read fresh, since chats start and finish while the banner sits there. Nothing is asked unless the server still offers it.
    func askToForce(_ client: GhostShellClient) async {
        refusals[.update] = nil
        let now = await load(client)?.update ?? banners?.update
        guard let now, now.force else { return }
        asking = ForceAsk(question: forceQuestion(now))
    }

    func forceRestart(_ card: BannerCard, _ client: GhostShellClient) async {
        forcing = true
        defer { forcing = false }
        await press(card, client) { try await $0.forceRestart() }
    }
}
