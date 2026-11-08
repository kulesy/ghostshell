import Foundation

// The routes behind the composer: sending, stopping, the pickers, slash commands, uploads and starting a session.

/// A picture as the send and new routes take it: the media type and the bytes as base64 with no `data:` prefix.
public struct OutgoingImage: Codable, Hashable, Sendable {
    public var mediaType: String
    public var data: String

    public init(mediaType: String, data: String) { (self.mediaType, self.data) = (mediaType, data) }
}

/// What the person typed and attached, in the shape of `POST api/sessions/<id>/send`. Empty lists are left out of the body.
public struct OutgoingMessage: Sendable, Equatable {
    public var text: String
    public var mode: String?
    public var images: [OutgoingImage]
    /// Ids that `uploadFile` returned.
    public var files: [String]

    public init(text: String, mode: String? = nil, images: [OutgoingImage] = [], files: [String] = []) {
        (self.text, self.mode, self.images, self.files) = (text, mode, images, files)
    }

    fileprivate var body: Body { Body(text: text, mode: mode, images: images.isEmpty ? nil : images, files: files.isEmpty ? nil : files) }
    fileprivate struct Body: Encodable, Sendable { var text: String; var mode: String?; var images: [OutgoingImage]?; var files: [String]? }
}

/// The reply to a send: the chat's status, and whether the send brought the session back from the archive.
public struct SendReply: Decodable, Sendable {
    public let status: ChatStatus
    public let unarchived: Bool

    private enum Key: String, CodingKey { case unarchived }
    public init(from decoder: Decoder) throws {
        status = try ChatStatus(from: decoder)
        let c = try decoder.container(keyedBy: Key.self)
        // The server answers true, or an object describing the move, so anything present that is not false or null counts.
        if let flag = try? c.decode(Bool.self, forKey: .unarchived) { unarchived = flag } else { unarchived = (try? c.decodeNil(forKey: .unarchived)) == false }
    }
}

/// One slash command the CLI offers.
public struct SlashCommand: Hashable, Sendable, Decodable {
    public var name: String
    public var description: String
    public var hint: String
    public var aliases: [String]

    public init(name: String, description: String = "", hint: String = "", aliases: [String] = []) {
        (self.name, self.description, self.hint, self.aliases) = (name, description, hint, aliases)
    }

    private enum Key: String, CodingKey { case name, description, hint, aliases }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        name = try c.decode(String.self, forKey: .name)
        description = (try? c.decode(String.self, forKey: .description)) ?? ""
        hint = (try? c.decode(String.self, forKey: .hint)) ?? ""
        aliases = (try? c.decode([String].self, forKey: .aliases)) ?? []
    }
}

/// A model the CLI lists, and whether it takes fast mode.
public struct ListedModel: Hashable, Sendable, Decodable {
    public var id: String
    public var label: String
    public var fast: Bool

    public init(id: String, label: String, fast: Bool = false) { (self.id, self.label, self.fast) = (id, label, fast) }

    private enum Key: String, CodingKey { case id, label, fast }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        label = (try? c.decode(String.self, forKey: .label)) ?? id
        fast = (try? c.decode(Bool.self, forKey: .fast)) ?? false
    }
}

/// How much a server takes as a file, besides pictures.
public struct UploadLimits: Hashable, Sendable, Decodable {
    public var maxBytes: Int
    public var maxFiles: Int

    public init(maxBytes: Int, maxFiles: Int) { (self.maxBytes, self.maxFiles) = (maxBytes, maxFiles) }
}

/// A file the server saved, named by the id a message carries.
public struct UploadedFile: Hashable, Sendable, Decodable {
    public var id: String
    public var name: String
    public var type: String
    public var size: Int
}

/// What a folder starts a session with. Each is nil when the server names none.
public struct SessionDefaults: Hashable, Sendable, Decodable {
    public var mode: String?
    public var model: String?
    public var shownModel: String?
    public var effort: String?

    public init(mode: String? = nil, model: String? = nil, shownModel: String? = nil, effort: String? = nil) {
        (self.mode, self.model, self.shownModel, self.effort) = (mode, model, shownModel, effort)
    }

    private enum Key: String, CodingKey { case mode, model, shownModel, effort }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        mode = try? c.decode(String.self, forKey: .mode)
        model = try? c.decode(String.self, forKey: .model)
        shownModel = try? c.decode(String.self, forKey: .shownModel)
        effort = try? c.decode(String.self, forKey: .effort)
    }
}

/// The first message of a new session, in the shape of `POST api/new`. Model, effort and fast go only when the person changed them.
public struct NewSessionRequest: Sendable, Equatable {
    public var cwd: String
    public var message: OutgoingMessage
    public var model: String?
    public var effort: String?
    public var fast: Bool?

    public init(cwd: String, message: OutgoingMessage, model: String? = nil, effort: String? = nil, fast: Bool? = nil) {
        (self.cwd, self.message, self.model, self.effort, self.fast) = (cwd, message, model, effort, fast)
    }

    fileprivate var body: Body {
        Body(cwd: cwd, text: message.text, mode: message.mode, model: model, effort: effort, fast: fast,
             images: message.images.isEmpty ? nil : message.images, files: message.files.isEmpty ? nil : message.files)
    }
    fileprivate struct Body: Encodable, Sendable {
        var cwd: String; var text: String; var mode: String?; var model: String?; var effort: String?; var fast: Bool?
        var images: [OutgoingImage]?; var files: [String]?
    }
}

extension GhostShellClient {
    // MARK: Sending and stopping

    /// The server takes a message while Claude is working too, and Claude reads it before its next step. A 400, 404 or 409 comes back as `.refused` with the server's sentence.
    public func sendMessage(_ message: OutgoingMessage, to sessionID: String) async throws -> SendReply {
        try await post(try Self.sessionPath(sessionID, "send"), json: message.body)
    }

    /// A 409 means the session is not running here.
    public func stop(sessionID: String) async throws -> ChatStatus {
        try await post(try Self.sessionPath(sessionID, "stop"), json: Empty())
    }

    // MARK: The pickers

    public func setMode(_ mode: String, sessionID: String) async throws {
        let _: ModeReply = try await post(try Self.sessionPath(sessionID, "mode"), json: ["mode": mode])
    }

    public func setModel(_ model: String, sessionID: String) async throws -> ChatStatus {
        try await post(try Self.sessionPath(sessionID, "model"), json: ["model": model])
    }

    public func setEffort(_ effort: String, sessionID: String) async throws -> ChatStatus {
        try await post(try Self.sessionPath(sessionID, "effort"), json: ["effort": effort])
    }

    public func setFast(_ fast: Bool, sessionID: String) async throws -> ChatStatus {
        try await post(try Self.sessionPath(sessionID, "fast"), json: ["fast": fast])
    }

    // MARK: Lists

    /// The slash commands of a session, or of a folder for a session that does not exist yet.
    public func commands(_ target: ListTarget) async throws -> [SlashCommand] {
        let reply: CommandsReply = try await post("api/commands", json: target)
        return reply.commands
    }

    public func models(_ target: ListTarget) async throws -> [ListedModel] {
        let reply: ModelsReply = try await post("api/models", json: target)
        return reply.models
    }

    // MARK: Files

    /// Nil on a server that takes only pictures.
    public func uploadLimits() async -> UploadLimits? {
        try? await get("api/uploads")
    }

    /// Raw bytes as the body, the file's type as the content type and its name percent-encoded in `x-file-name`.
    public func uploadFile(_ bytes: Data, name: String, type: String) async throws -> UploadedFile {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: Self.unreserved) ?? ""
        let reply = try await data("POST", "api/uploads", body: bytes, contentType: type.isEmpty ? "application/octet-stream" : type,
                                   headers: ["x-file-name": encoded])
        guard let file = try? JSONDecoder().decode(UploadedFile.self, from: reply) else { throw GhostShellError.server(status: 0) }
        return file
    }

    // MARK: A new session

    public func defaults(cwd: String) async throws -> SessionDefaults {
        try await get("api/defaults", query: [URLQueryItem(name: "cwd", value: cwd)])
    }

    /// Starts a session with its first message and returns its id.
    public func startSession(_ request: NewSessionRequest) async throws -> String {
        let reply: NewReply = try await post("api/new", json: request.body)
        return reply.id
    }

    // MARK: Inside

    /// A session or, before it exists, a folder: what `api/commands` and `api/models` are asked about.
    public struct ListTarget: Encodable, Sendable, Equatable {
        public var id: String?
        public var cwd: String?
        public static func session(_ id: String) -> ListTarget { ListTarget(id: id, cwd: nil) }
        public static func folder(_ cwd: String) -> ListTarget { ListTarget(id: nil, cwd: cwd) }
    }

    private struct ModeReply: Decodable, Sendable { let mode: String }
    private struct CommandsReply: Decodable, Sendable { let commands: [SlashCommand] }
    private struct ModelsReply: Decodable, Sendable { let models: [ListedModel] }
    private struct NewReply: Decodable, Sendable { let id: String }

    private static let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")

    private static func sessionPath(_ id: String, _ action: String) throws -> String {
        "api/sessions/\(try pathID(id))/\(action)"
    }
}
