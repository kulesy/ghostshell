import Foundation
import GhostShellKit
import Observation

/// The Settings screen's choice. Only `pick`, which the screen calls from the owner's own tap on a row, writes the server. Loading never does.
@Observable @MainActor
final class SettingsState {
    /// What the server holds, and what the radios show, which is the tapped choice at once while it saves.
    private(set) var saved: SendReach?
    private(set) var shown: SendReach?
    private(set) var saving = false
    private(set) var problem = ""
    private(set) var status = ""

    func load(_ client: GhostShellClient) async {
        do {
            let reach = try await client.sendReach()
            (saved, shown) = (reach, reach)
        } catch is CancellationError {} catch { problem = "Could not load the settings: \(error.localizedDescription)" }
    }

    /// Every row but the chosen one is disabled while a save runs, so a late answer is always the latest. A refusal puts the radios back on what the server holds.
    func pick(_ reach: SendReach, _ client: GhostShellClient) async {
        guard !saving, shown != nil, reach != shown else { return }
        shown = reach
        saving = true
        problem = ""
        status = ""
        defer { saving = false }
        do {
            let now = try await client.setSendReach(reach)
            (saved, shown) = (now, now)
            status = "Saved."
        } catch {
            // The server may have saved it and the answer been lost, so it is asked what it holds.
            if let held = try? await client.sendReach() { saved = held }
            shown = saved
            if !(error is CancellationError) { problem = error.localizedDescription }
        }
    }
}
