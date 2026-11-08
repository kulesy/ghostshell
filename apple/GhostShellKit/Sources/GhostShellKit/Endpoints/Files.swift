import Foundation

// NOTE: [8 Nov 2026] EK - These types and routes mirror lib/files.mjs and the `preview`, `file`, `save` and `images` routes in server.mjs.
// A chat may open only a path its replies link, and the server enforces it. This app never reads a path itself: every byte arrives through here.
// Decoding is lenient: a kind this app does not know is kept as `.other`, and a missing field reads as empty.

extension GhostShellClient {
    /// What the server says of a file the chat links: how to show it, and the text when it can.
    public func preview(sessionID: String, path: String) async throws -> FilePreview {
        try await get("api/sessions/\(try Self.checked(sessionID))/preview", query: [URLQueryItem(name: "path", value: path)])
    }

    /// The file's bytes. The server stops at 20 MB, and at 1 GB for audio.
    public func fileBytes(sessionID: String, path: String, download: Bool = false) async throws -> Data {
        let query = [URLQueryItem(name: "path", value: path)] + (download ? [URLQueryItem(name: "download", value: "1")] : [])
        return try await data("GET", "api/sessions/\(try Self.checked(sessionID))/file", query: query)
    }

    /// Saves text over a file this chat may edit. `base` is the `version` the text was read at, so a change on disk since is refused with a 409.
    public func saveFile(sessionID: String, path: String, text: String, base: String) async throws -> FilePreview {
        try await post("api/sessions/\(try Self.checked(sessionID))/save", json: SaveRequest(path: path, text: text, base: base))
    }

    /// Every picture of the chat in the order the thread draws them, as items with refs and no bytes.
    public func chatImages(sessionID: String) async throws -> [ChatItem] {
        let list: ImageList = try await get("api/sessions/\(try Self.checked(sessionID))/images")
        return list.items
    }

    /// One picture's bytes. A ref that does not have the server's shape is refused without a request.
    public func imageBytes(sessionID: String, ref: String) async throws -> Data {
        guard Self.isImageRef(ref) else { throw GhostShellError.badPath(ref) }
        return try await data("GET", "api/sessions/\(try Self.checked(sessionID))/images/\(ref)")
    }

    /// The shape of a ref is `<byte offset>.<r?><index>.<line id>`, as `readImage` in lib/transcripts.mjs reads it.
    public nonisolated static func isImageRef(_ ref: String) -> Bool {
        ref.range(of: #"^[0-9]+\.r?[0-9]+\.[A-Za-z0-9_-]*\z"#, options: .regularExpression) != nil
    }

    private static func checked(_ sessionID: String) throws -> String {
        guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
        return sessionID
    }
}

private struct SaveRequest: Encodable, Sendable {
    var path: String
    var text: String
    var base: String
}

private struct ImageList: Decodable, Sendable {
    var items: [ChatItem]

    enum Key: String, CodingKey { case items }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        items = ((try? c.decode([LossyItem<ChatItem>].self, forKey: .items)) ?? []).compactMap(\.value)
    }
}

// MARK: Preview

public enum FileKind: Hashable, Sendable {
    case markdown, text, pdf, image, audio, binary
    /// A kind this app does not know. It is shown like a binary file.
    case other(String)

    init(_ word: String) {
        self = switch word {
        case "markdown": .markdown
        case "text": .text
        case "pdf": .pdf
        case "image": .image
        case "audio": .audio
        case "binary": .binary
        default: .other(word)
        }
    }
}

public struct FilePreview: Hashable, Sendable {
    public var name: String
    public var path: String
    public var size: Int
    public var kind: FileKind
    public var tooLarge: Bool
    public var text: String?
    public var truncated: Bool
    /// The hash of the text as read, which a save sends back as `base`.
    public var version: String?
    public var editable: Bool
    /// Why this file cannot be edited, in the server's words.
    public var readOnly: String?

    public init(name: String = "", path: String = "", size: Int = 0, kind: FileKind = .binary, tooLarge: Bool = false,
                text: String? = nil, truncated: Bool = false, version: String? = nil, editable: Bool = false, readOnly: String? = nil) {
        (self.name, self.path, self.size, self.kind, self.tooLarge) = (name, path, size, kind, tooLarge)
        (self.text, self.truncated, self.version, self.editable, self.readOnly) = (text, truncated, version, editable, readOnly)
    }
}

extension FilePreview: Decodable {
    private enum Key: String, CodingKey { case name, path, size, kind, tooLarge, text, truncated, version, editable, readOnly }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        func str(_ k: Key) -> String? { try? c.decode(String.self, forKey: k) }
        func flag(_ k: Key) -> Bool { (try? c.decode(Bool.self, forKey: k)) ?? false }
        self.init(name: str(.name) ?? "", path: str(.path) ?? "", size: Int((try? c.decode(Double.self, forKey: .size)) ?? 0),
                  kind: FileKind(str(.kind) ?? ""), tooLarge: flag(.tooLarge), text: str(.text), truncated: flag(.truncated),
                  version: str(.version), editable: flag(.editable), readOnly: str(.readOnly).flatMap { $0.isEmpty ? nil : $0 })
    }
}

// MARK: What the file screens decide

/// The small rules of the file panel, the clip list and the image viewer, as plain functions on plain data so they run without a screen.
public enum ChatFiles {
    // MARK: Audio clips

    /// The server's bytes still decide what a file is. This name test only finds a chat's clips.
    public static func isClip(_ path: String) -> Bool { clipName.matches(path) }
    private static let clipName = Rx(#"\.(?:wav|mp3|m4a)$"#, .caseInsensitive)

    /// The paths a chat links as clips, once each and in the order the replies show them. `blocks` is one parsed text each.
    public static func clipPaths(in blocks: [[MDBlock]]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        func take(_ path: String) { if isClip(path), seen.insert(path).inserted { out.append(path) } }
        func inlines(_ list: [MDInline]) {
            for inline in list {
                switch inline {
                case .file(let text, let path, _): take(path); inlines(text)
                case .strong(let inner), .em(let inner), .del(let inner): inlines(inner)
                case .link(let text, _): inlines(text)
                case .text, .code, .lineBreak: break
                }
            }
        }
        func walk(_ list: [MDBlock]) {
            for block in list {
                switch block {
                case .paragraph(let text), .heading(_, let text): inlines(text)
                case .list(_, _, let items): for item in items { inlines(item.text); walk(item.children) }
                case .quote(let inner): walk(inner)
                case .table(let head, let rows): head.forEach(inlines); rows.forEach { $0.forEach(inlines) }
                case .code, .rule: break
                }
            }
        }
        blocks.forEach(walk)
        return out
    }

    // MARK: Pictures

    /// One picture of the chat. `tool` is the call that made it, or nil for one a person sent.
    public struct Picture: Hashable, Sendable {
        public var ref: String
        public var type: String
        public var tool: String?
        public init(ref: String, type: String = "", tool: String? = nil) { (self.ref, self.type, self.tool) = (ref, type, tool) }
    }

    /// The pictures of the items `chatImages` returns, in the order the thread draws them.
    public static func pictures(in items: [ChatItem]) -> [Picture] {
        items.flatMap { item -> [Picture] in
            switch item.body {
            case .user(let message): message.images.map { Picture(ref: $0.ref, type: $0.type) }
            case .tool(let call): call.images.map { Picture(ref: $0.ref, type: $0.type, tool: call.name) }
            case .result(let result): result.images.map { Picture(ref: $0.ref, type: $0.type, tool: "") }
            default: []
            }
        }
    }

    /// Where the viewer starts: the tapped picture's place in the chat's list, or nil when the list does not hold it.
    public static func start(of ref: String, in pictures: [Picture]) -> Int? { pictures.firstIndex { $0.ref == ref } }

    // MARK: Words

    /// The lines of a text file as the panel numbers them: every line ending read as one, and a last empty line left off.
    public static func lines(of text: String) -> [String] {
        var lines = ChatText.lf(text).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }
        return lines
    }

    /// A server-supplied file name made safe to show and to offer in a save panel: no control or bidi characters (U+202E can disguise an extension), no leading dots.
    public static func displayName(_ name: String) -> String {
        let kept = String.UnicodeScalarView(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !CharacterSet.newlines.contains($0) })
        let clean = String(kept).trimmingCharacters(in: .whitespacesAndNewlines).drop(while: { $0 == "." })
        let trimmed = String(clean).trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "file" : trimmed
    }

    /// 1 byte, 900 bytes, 1.5 KB, 12 KB, 3.4 MB. The panel's size, as format.js `fileSize` words it.
    public static func fileSize(_ bytes: Int) -> String {
        if bytes < 1024 { return ChatText.plural(bytes, "byte") }
        let kb = Double(bytes) / 1024
        if kb.rounded() < 1024 { return "\(trimmed(kb, kb < 10 ? 1 : 0)) KB" }
        let mb = kb / 1024
        return "\(trimmed(mb, mb < 10 ? 1 : 0)) MB"
    }

    private static func trimmed(_ value: Double, _ places: Int) -> String {
        let text = String(format: "%.\(places)f", value)
        return text.contains(".") ? text.replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression) : text
    }

    /// The size on a file card: 900 B, 12 KB, 3.4 MB. files.js `sizeLabel`.
    public static func cardSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let kb = Int((Double(bytes) / 1024).rounded())
        return kb < 1024 ? "\(kb) KB" : String(format: "%.1f MB", Double(bytes) / 1_048_576)
    }

    /// The last extension, lowercased, or "" for a name with none. A name that is only a dot and letters, such as .gitignore, has none.
    public static func fileExtension(_ name: String) -> String { extensionRx.groups(name)?[1].lowercased() ?? "" }
    private static let extensionRx = Rx(#".\.([A-Za-z0-9]{1,10})$"#, .dotMatchesLineSeparators)

    /// The extension in capitals and " file", or just "File". The card for a file the panel cannot show.
    public static func kindName(_ name: String) -> String {
        guard let ext = kindRx.groups(name)?[1] else { return "File" }
        return "\(ext.uppercased()) file"
    }

    private static let kindRx = Rx(#"\.([A-Za-z0-9]{1,8})$"#)
    private static let kinds = ["pdf": "PDF", "csv": "CSV", "doc": "Word", "docx": "Word", "xls": "Excel", "xlsx": "Excel", "ppt": "PowerPoint",
                                "pptx": "PowerPoint", "txt": "Text", "md": "Markdown", "json": "JSON", "zip": "ZIP"]

    /// The quiet line on a user's file card: its kind and size.
    public static func cardLine(_ file: ChatFile) -> String {
        let ext = fileExtension(file.name)
        let kind = kinds[ext] ?? (ext.isEmpty ? "File" : ext.uppercased())
        return "\(kind) · \(cardSize(file.size))"
    }

    /// Where a tool's output came from, worded for a sentence: its server, else the built-in tool itself. Format.js `toolSource`.
    public static func toolSource(_ name: String, connectors: [String: String] = [:]) -> String {
        let server = ChatText.serverLabel(name, connectors: connectors)
        if server == "connector" { return "a connector" }
        return server.isEmpty ? ChatText.toolLabel(name) : server
    }

    /// The accessible name of a tile, as gallery.js `tileLabel` words it. Four tiles show, and the last stands for every picture after it.
    public static let tiles = 4
    public static func overflow(_ total: Int) -> Int { total > tiles ? total - (tiles - 1) : 0 }
    public static func tileLabel(_ index: Int, of total: Int, source: String) -> String {
        if overflow(total) > 0, index == tiles - 1 { return "View \(overflow(total)) more images" }
        return total > 1 ? "View image \(index + 1) of \(total), from \(source)" : "View image from \(source)"
    }
}
