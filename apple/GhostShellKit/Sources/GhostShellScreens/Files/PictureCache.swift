import Foundation
import GhostShellKit
import SwiftUI
#if os(macOS)
import AppKit
typealias PlatformImage = NSImage
#else
import UIKit
typealias PlatformImage = UIImage
#endif

extension Image {
    init(platform image: PlatformImage) {
        #if os(macOS)
        self.init(nsImage: image)
        #else
        self.init(uiImage: image)
        #endif
    }
}

/// A picture of a chat: one a person sent, one a tool returned, or a linked image file.
struct ChatPicture: Identifiable, Hashable {
    enum Source: Hashable {
        case ref(String)
        case file(path: String)
    }

    /// The ref, or the path for a file, so it names the same bytes for as long as the chat is open.
    let id: String
    let source: Source
    /// The alternative text for a screen reader.
    let alt: String

    static func ref(_ ref: String, alt: String) -> ChatPicture { ChatPicture(id: ref, source: .ref(ref), alt: alt) }
    static func file(path: String, alt: String) -> ChatPicture { ChatPicture(id: "file:" + path, source: .file(path: path), alt: alt) }
}

/// The pictures of one chat that have been decoded, held in memory only and cut to a size. A picture asked for twice at once is fetched once.
@MainActor
final class PictureCache {
    private let client: GhostShellClient
    private let sessionID: String
    private let held = NSCache<NSString, PlatformImage>()
    private var flights: [String: Task<Data, Error>] = [:]

    init(client: GhostShellClient, sessionID: String) {
        self.client = client
        self.sessionID = sessionID
        held.countLimit = 48
        // The cost is the encoded size, which is far under the decoded one, so this is a loose bound on a few hundred MB at most.
        held.totalCostLimit = 96 * 1024 * 1024
    }

    func cached(_ id: String) -> PlatformImage? { held.object(forKey: id as NSString) }

    /// The picture decoded, or nil when the server would not send it or its bytes are not an image.
    func image(_ picture: ChatPicture) async -> PlatformImage? {
        if let hit = cached(picture.id) { return hit }
        let task: Task<Data, Error>
        if let running = flights[picture.id] {
            task = running
        } else {
            let (client, sessionID, source) = (client, sessionID, picture.source)
            task = Task {
                switch source {
                case .ref(let ref): try await client.imageBytes(sessionID: sessionID, ref: ref)
                case .file(let path): try await client.fileBytes(sessionID: sessionID, path: path)
                }
            }
            flights[picture.id] = task
        }
        defer { flights[picture.id] = nil }
        guard let data = try? await task.value, let image = PlatformImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        held.setObject(image, forKey: picture.id as NSString, cost: data.count)
        return image
    }
}
