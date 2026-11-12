import GhostShellKit
import SwiftUI

public struct PasskeysScreen: View {
    @Environment(AppModel.self) private var model
    @State private var list: PasskeyList?
    @State private var problem = ""
    @State private var asking: String?

    public init() {}

    public var body: some View {
        FlatForm(spacing: 16) {
            Text(passkeyLead).ghostMuted(16).fixedSize(horizontal: false, vertical: true)
            if let list {
                VStack(alignment: .leading, spacing: 0) {
                    Rule()
                    if list.passkeys.isEmpty {
                        Text("No passkeys added yet.").ghostMuted(16).padding(.vertical, 14)
                        Rule()
                    } else {
                        ForEach(list.passkeys) { passkey in
                            row(passkey)
                            Rule()
                        }
                    }
                }
                // A passkey is made by the browser, which this app is not, so the page does the adding.
                if let url = pageURL {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Add a passkey from the page in a browser.").font(.geist(14)).foregroundStyle(Color.ghost.foreground)
                        Link(url.absoluteString, destination: url).font(.geist(14)).frame(minHeight: 44, alignment: .leading)
                    }
                }
                if !list.available { Text(passkeyUnavailable).ghostMuted(13).fixedSize(horizontal: false, vertical: true) }
                if !list.passkeys.isEmpty { Text(passkeyFootnote).ghostMuted(13).fixedSize(horizontal: false, vertical: true) }
            } else if problem.isEmpty {
                Text("Loading passkeys").ghostMuted()
            }
            if !problem.isEmpty { Notice(text: problem) }
        }
        .navigationTitle("Passkeys")
        .task { await load() }
    }

    private var pageURL: URL? {
        guard let base = model.address?.baseURL.absoluteString else { return nil }
        return URL(string: (base.hasSuffix("/") ? String(base.dropLast()) : base) + "/#/passkeys")
    }

    private func row(_ passkey: Passkey) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(passkeyDevice(passkey)).font(.geist(16, weight: .semibold)).foregroundStyle(Color.ghost.foreground)
                    Text([passkey.rpId, "Added \(passkeyDate(passkey.created))", lastUsedWords(passkey.used)].filter { !$0.isEmpty }.joined(separator: "   "))
                        .font(.geistMono(12)).foregroundStyle(Color.ghost.mutedForeground)
                }
                Spacer(minLength: 8)
                if asking != passkey.id {
                    Button("Remove") { asking = passkey.id }
                        .buttonStyle(.ghost(.outline, size: .compact))
                        .accessibilityLabel("Remove the passkey for \(passkey.device.isEmpty ? "an unknown browser" : passkey.device), added \(passkeyDate(passkey.created))")
                }
            }
            if asking == passkey.id {
                HStack(spacing: 8) {
                    Text("Remove this passkey?").font(.geist(14)).foregroundStyle(Color.ghost.foreground)
                    Button("Keep") { asking = nil }.buttonStyle(.ghost(.outline, size: .compact))
                    Button("Remove") { Task { await remove(passkey.id) } }.buttonStyle(.ghost(.destructive, size: .compact))
                }
            }
        }
        .padding(.vertical, 14)
    }

    private func load() async {
        guard let client = model.client, let origin = model.address?.origin else { return }
        do { list = try await client.passkeys(origin: origin) } catch is CancellationError {} catch { problem = "Could not load passkeys: \(error.localizedDescription)" }
    }

    private func remove(_ id: String) async {
        problem = ""
        defer { asking = nil }
        guard let client = model.client else { return }
        do { list?.passkeys = try await client.removePasskey(id: id) } catch { problem = error.localizedDescription }
    }
}
