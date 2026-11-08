import Foundation
import GhostShellKit
import Observation

/// The accounts the Accounts screen shows. A reply older than the one on screen is dropped, so a slow answer cannot put an earlier state back.
@Observable @MainActor
final class AccountsState {
    private(set) var list: AccountList?
    private(set) var problem = ""
    /// The server's refusal of a press, keyed by the row it came from, or `add` and `auto`. It goes at the next press.
    private(set) var refused: [String: String] = [:]
    private(set) var pending: Set<String> = []
    private var asked = 0
    private var drawn = 0

    var polling: TimeInterval { list?.waiting == true || list?.chrome?.checking == true ? 2 : 5 }

    private func take(_ ticket: Int, _ reply: AccountList) {
        guard ticket > drawn else { return }
        drawn = ticket
        list = reply
    }

    func load(_ client: GhostShellClient) async {
        asked += 1
        let ticket = asked
        do { take(ticket, try await client.accounts()); problem = "" } catch is CancellationError {} catch { problem = error.localizedDescription }
    }

    /// Asks the running chats for their plan usage. A failure leaves what is shown as it was.
    func refreshPlans(_ client: GhostShellClient) async {
        asked += 1
        let ticket = asked
        if let reply = try? await client.refreshPlans() { take(ticket, reply) }
    }

    /// Runs a press and shows the reply. Returns whether the server took it.
    @discardableResult
    func act(_ key: String, _ client: GhostShellClient, _ call: @Sendable (GhostShellClient) async throws -> AccountList) async -> Bool {
        refused[key] = nil
        pending.insert(key)
        defer { pending.remove(key) }
        asked += 1
        let ticket = asked
        do {
            take(ticket, try await call(client))
            return true
        } catch {
            refused[key] = error.localizedDescription
            return false
        }
    }
}
