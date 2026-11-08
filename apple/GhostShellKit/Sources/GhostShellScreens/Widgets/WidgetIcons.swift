import Foundation
import GhostShellKit

/// The icon font and the names it draws, fetched once for the app and handed to each widget that uses an icon. A failed fetch is not kept, so the next
/// widget to ask tries again. There is one per server address, and each fetch uses the caller's client, because signing in again makes a new one.
@MainActor
final class WidgetIcons {
    struct Loaded {
        var fontBase64: String
        var glyphs: [String: String]
    }

    private static var held: [ServerAddress: WidgetIcons] = [:]

    /// The app's copy for this server.
    static func shared(for address: ServerAddress) -> WidgetIcons {
        if let found = held[address] { return found }
        let made = WidgetIcons()
        held[address] = made
        return made
    }

    private var loading: Task<Loaded?, Never>?
    private var loaded: Loaded?

    private init() {}

    func load(with client: GhostShellClient) async -> Loaded? {
        if let loaded { return loaded }
        if let loading { return await loading.value }
        let task = Task { () -> Loaded? in
            guard let font = try? await client.widgetIconFile(.font), let css = try? await client.widgetIconFile(.styles) else { return nil }
            return Loaded(fontBase64: font.base64EncodedString(), glyphs: WidgetRules.parseGlyphs(String(decoding: css, as: UTF8.self)))
        }
        loading = task
        let result = await task.value
        loading = nil
        loaded = result
        return result
    }
}
