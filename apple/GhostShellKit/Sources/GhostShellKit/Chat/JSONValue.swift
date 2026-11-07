import Foundation

/// Any JSON, for the parts of a chat the app shows without knowing their shape, such as a tool's input.
public enum JSONValue: Hashable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var string: String? { if case .string(let s) = self { s } else { nil } }
    public var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
    public var bool: Bool? { if case .bool(let b) = self { b } else { nil } }
    public var number: Double? { if case .number(let n) = self { n } else { nil } }

    /// Two-space indented JSON with the keys sorted, as the tool rows show an input. The server's key order is not kept.
    public func pretty() -> String {
        var out = ""
        write(&out, depth: 0)
        return out
    }

    private func write(_ out: inout String, depth: Int) {
        let pad = String(repeating: "  ", count: depth + 1)
        switch self {
        case .null: out += "null"
        case .bool(let v): out += v ? "true" : "false"
        case .number(let v): out += v == v.rounded() && abs(v) < 1e15 ? String(Int64(v)) : String(v)
        case .string(let v): out += Self.quote(v)
        case .array(let items):
            if items.isEmpty { out += "[]"; return }
            out += "[\n"
            for (n, item) in items.enumerated() {
                out += pad
                item.write(&out, depth: depth + 1)
                out += n < items.count - 1 ? ",\n" : "\n"
            }
            out += String(repeating: "  ", count: depth) + "]"
        case .object(let fields):
            if fields.isEmpty { out += "{}"; return }
            out += "{\n"
            let keys = fields.keys.sorted()
            for (n, key) in keys.enumerated() {
                out += pad + Self.quote(key) + ": "
                fields[key]?.write(&out, depth: depth + 1)
                out += n < keys.count - 1 ? ",\n" : "\n"
            }
            out += String(repeating: "  ", count: depth) + "}"
        }
    }

    private static func quote(_ text: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(text) else { return "\"\"" }
        return String(decoding: data, as: UTF8.self)
    }
}
