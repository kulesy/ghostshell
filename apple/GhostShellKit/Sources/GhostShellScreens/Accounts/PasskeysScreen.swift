import GhostShellKit
import SwiftUI

public struct PasskeysScreen: View {
    @Environment(AppModel.self) private var model
    @State private var list: PasskeyList?
    @State private var problem = ""
    @State private var asking: String?

    public init() {}

    public var body: some View {
        Form {
            Section { Text(passkeyLead).font(.callout).foregroundStyle(.secondary) }
            if let list {
                Section {
                    if list.passkeys.isEmpty {
                        Text("No passkeys added yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(list.passkeys) { passkey in row(passkey) }
                    }
                }
                Section {
                    // A passkey is made by the browser, which this app is not, so the page does the adding.
                    if let url = pageURL {
                        Text("Add a passkey from the page in a browser.").font(.callout)
                        Link(url.absoluteString, destination: url).font(.callout)
                    }
                    if !list.available { Text(passkeyUnavailable).font(.caption).foregroundStyle(.secondary) }
                }
                if !list.passkeys.isEmpty { Section { Text(passkeyFootnote).font(.caption).foregroundStyle(.secondary) } }
            } else if problem.isEmpty {
                Section { Text("Loading passkeys").foregroundStyle(.secondary) }
            }
            if !problem.isEmpty { Section { Notice(text: problem) } }
        }
        .formStyle(.grouped)
        .navigationTitle("Passkeys")
        .task { await load() }
    }

    private var pageURL: URL? {
        guard let base = model.address?.baseURL.absoluteString else { return nil }
        return URL(string: (base.hasSuffix("/") ? String(base.dropLast()) : base) + "/#/passkeys")
    }

    private func row(_ passkey: Passkey) -> some View {
        SideBySide {
            VStack(alignment: .leading, spacing: 3) {
                Text(passkeyDevice(passkey)).font(.headline)
                Text([passkey.rpId, "Added \(passkeyDate(passkey.created))", lastUsedWords(passkey.used)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.callout).foregroundStyle(.secondary)
            }
            #if os(macOS)
            Spacer(minLength: 8)
            #endif
            if asking == passkey.id {
                SideBySide(alignment: .center, spacing: 6) {
                    Text("Remove this passkey?").font(.callout)
                    Button("Keep") { asking = nil }.phoneTouch()
                    Button("Remove", role: .destructive) { Task { await remove(passkey.id) } }.phoneTouch()
                }
                .controlSize(.small)
            } else {
                Button("Remove") { asking = passkey.id }
                    .controlSize(.small)
                    .phoneTouch()
                    .accessibilityLabel("Remove the passkey for \(passkey.device.isEmpty ? "an unknown browser" : passkey.device), added \(passkeyDate(passkey.created))")
            }
        }
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
