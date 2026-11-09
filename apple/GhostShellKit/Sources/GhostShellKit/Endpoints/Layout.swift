import Foundation

// These calls mirror the `api/layout/*` routes in server.mjs and the page's own calls in public/app.js.

// NOTE: [8 Nov 2026] EK - The server wants `null` for "no group", "no parent" and "Home", so those bodies write the key out. A Swift optional would leave it off.
private struct Maybe: Encodable, Sendable {
    var value: String?
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let value { try c.encode(value) } else { try c.encodeNil() }
    }
}

private struct TitleBody: Encodable, Sendable { var id: String; var title: String }
private struct PinBody: Encodable, Sendable { var id: String; var pinned: Bool }
private struct NameOnly: Encodable, Sendable { var name: String }
private struct IDName: Encodable, Sendable { var id: String; var name: String }
private struct IDOnly: Encodable, Sendable { var id: String }

public enum PinKind: String, Hashable, Sendable, Encodable { case session, group, project }

private struct AccountBody: Encodable, Sendable {
    var kind: PinKind
    var id: String
    var account: String?
    private enum Key: String, CodingKey { case kind, id, account }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(id, forKey: .id)
        try c.encode(Maybe(value: account), forKey: .account)
    }
}

private struct MoveBody: Encodable, Sendable {
    var id: String
    var group: String?
    private enum Key: String, CodingKey { case id, group }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(id, forKey: .id)
        try c.encode(Maybe(value: group), forKey: .group)
    }
}

private struct NestBody: Encodable, Sendable {
    var id: String
    var parent: String?
    private enum Key: String, CodingKey { case id, parent }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(id, forKey: .id)
        try c.encode(Maybe(value: parent), forKey: .parent)
    }
}

private struct ArchiveBody: Encodable, Sendable {
    var id: String
    var archived: Bool
    /// Present only as false, which asks the server to refuse when a chat in the family is running. The page leaves it off to stop them.
    var refuseIfRunning: Bool
    private enum Key: String, CodingKey { case id, archived, stop }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(id, forKey: .id)
        try c.encode(archived, forKey: .archived)
        if refuseIfRunning { try c.encode(false, forKey: .stop) }
    }
}

private struct GroupAddBody: Encodable, Sendable {
    var name: String
    var project: String?
    private enum Key: String, CodingKey { case name, project }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(name, forKey: .name)
        try c.encode(Maybe(value: project), forKey: .project)
    }
}

private struct GroupMoveBody: Encodable, Sendable {
    var id: String
    var project: String?
    private enum Key: String, CodingKey { case id, project }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(id, forKey: .id)
        try c.encode(Maybe(value: project), forKey: .project)
    }
}

private struct GroupOrderBody: Encodable, Sendable {
    var id: String
    var beside: String
    var side: OrderSide
    private enum Key: String, CodingKey { case id, before, after }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(id, forKey: .id)
        try c.encode(beside, forKey: side == .before ? .before : .after)
    }
}

public enum OrderSide: Hashable, Sendable { case before, after }

/// Where several sessions go in one write: a group (nil for the loose list of each session's own app), Pinned, or under a parent (nil takes them out).
public enum ManyTarget: Hashable, Sendable {
    case group(String?)
    case pinned
    case parent(String?)
}

private struct ManyBody: Encodable, Sendable {
    var ids: [String]
    var to: ManyTarget
    private enum Key: String, CodingKey { case ids, to }
    private enum Aim: String, CodingKey { case group, pinned, parent }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(ids, forKey: .ids)
        var aim = c.nestedContainer(keyedBy: Aim.self, forKey: .to)
        switch to {
        case .group(let id): try aim.encode(Maybe(value: id), forKey: .group)
        case .pinned: try aim.encode(true, forKey: .pinned)
        case .parent(let id): try aim.encode(Maybe(value: id), forKey: .parent)
        }
    }
}

public struct ArchiveReply: Hashable, Sendable, Decodable {
    public var stopped: Bool
    public var stoppedCount: Int
    public var subs: Int
    private enum Key: String, CodingKey { case stopped, stoppedCount, subs }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        stopped = (try? c.decode(Bool.self, forKey: .stopped)) ?? false
        stoppedCount = (try? c.decode(Int.self, forKey: .stoppedCount)) ?? (stopped ? 1 : 0)
        subs = (try? c.decode(Int.self, forKey: .subs)) ?? 0
    }
}

/// `undo` is the token `api/layout/many/undo` takes, which this app does not use yet.
public struct ManyReply: Hashable, Sendable, Decodable {
    public var undo: String?
    public var count: Int
    private enum Key: String, CodingKey { case undo, count }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        undo = try? c.decode(String.self, forKey: .undo)
        count = (try? c.decode(Int.self, forKey: .count)) ?? 0
    }
}

public struct MadeFolder: Hashable, Sendable, Decodable {
    public var id: String
    public var name: String
    private enum Key: String, CodingKey { case id, name }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
    }
}

public struct RemovedGroup: Hashable, Sendable, Decodable {
    public var stopped: Bool
    private enum Key: String, CodingKey { case stopped }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        stopped = (try? c.decode(Bool.self, forKey: .stopped)) ?? false
    }
}

extension GhostShellClient {
    // MARK: Sessions

    public func renameSession(_ id: String, title: String) async throws {
        try await send("api/layout/rename", json: TitleBody(id: id, title: title))
    }

    public func pinSession(_ id: String) async throws {
        try await send("api/layout/pin", json: PinBody(id: id, pinned: true))
    }

    /// A nil `group` also unpins the session.
    public func moveSession(_ id: String, group: String?) async throws {
        try await send("api/layout/move", json: MoveBody(id: id, group: group))
    }

    public func nestSession(_ id: String, parent: String?) async throws {
        try await send("api/layout/nest", json: NestBody(id: id, parent: parent))
    }

    /// With `stop` false a running chat in the family is refused, which throws `.running`.
    @discardableResult
    public func archiveSession(_ id: String, archived: Bool = true, stop: Bool = true) async throws -> ArchiveReply {
        try await post("api/layout/archive", json: ArchiveBody(id: id, archived: archived, refuseIfRunning: !stop))
    }

    public func stopSession(_ id: String) async throws {
        try await send("api/sessions/\(try pathID(id))/stop", json: Empty())
    }

    @discardableResult
    public func placeSessions(_ ids: [String], to target: ManyTarget) async throws -> ManyReply {
        try await post("api/layout/many", json: ManyBody(ids: ids, to: target))
    }

    /// The server refuses an account that is signed out.
    public func pinAccount(_ kind: PinKind = .session, id: String, account: String?) async throws {
        try await send("api/layout/account", json: AccountBody(kind: kind, id: id, account: account))
    }

    // MARK: Groups

    @discardableResult
    public func addGroup(name: String, project: String?) async throws -> MadeFolder {
        try await post("api/layout/group/add", json: GroupAddBody(name: name, project: project))
    }

    public func renameGroup(_ id: String, name: String) async throws {
        try await send("api/layout/group/rename", json: IDName(id: id, name: name))
    }

    public func moveGroup(_ id: String, project: String?) async throws {
        try await send("api/layout/group/move", json: GroupMoveBody(id: id, project: project))
    }

    public func orderGroup(_ id: String, _ side: OrderSide, beside: String) async throws {
        try await send("api/layout/group/order", json: GroupOrderBody(id: id, beside: beside, side: side))
    }

    @discardableResult
    public func removeGroup(_ id: String) async throws -> RemovedGroup {
        try await post("api/layout/group/remove", json: IDOnly(id: id))
    }

    // MARK: Projects

    @discardableResult
    public func addProject(name: String) async throws -> MadeFolder {
        try await post("api/layout/project/add", json: NameOnly(name: name))
    }

    public func renameProject(_ id: String, name: String) async throws {
        try await send("api/layout/project/rename", json: IDName(id: id, name: name))
    }

    public func removeProject(_ id: String) async throws {
        try await send("api/layout/project/remove", json: IDOnly(id: id))
    }
}
