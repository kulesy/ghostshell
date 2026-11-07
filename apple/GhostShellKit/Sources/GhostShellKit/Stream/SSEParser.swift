import Foundation

/// One server-sent event: its name (`message` when the server gave none) and its data lines joined by newlines.
public struct SSEEvent: Equatable, Sendable {
    public var name: String
    public var data: String

    public init(name: String, data: String) {
        self.name = name
        self.data = data
    }

    /// The data read as JSON.
    public func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(type, from: Data(data.utf8))
    }
}

/// Reads the bytes of a text/event-stream, however they are split into chunks. Comments are dropped, and LF, CR and CRLF all end a line.
public struct SSEParser: Sendable {
    private var line: [UInt8] = []
    private var afterCR = false
    private var name = ""
    private var data: [String] = []

    public init() {}

    /// Returns the event this byte completes, if it does.
    public mutating func feed(_ byte: UInt8) -> SSEEvent? {
        if byte == 0x0A {
            if afterCR { afterCR = false; return nil }
            return endLine()
        }
        if byte == 0x0D {
            afterCR = true
            return endLine()
        }
        afterCR = false
        line.append(byte)
        return nil
    }

    public mutating func feed<S: Sequence>(_ bytes: S) -> [SSEEvent] where S.Element == UInt8 {
        bytes.compactMap { feed($0) }
    }

    private mutating func endLine() -> SSEEvent? {
        let text = String(decoding: line, as: UTF8.self)
        line.removeAll(keepingCapacity: true)
        if text.isEmpty {
            defer { name = ""; data = [] }
            return data.isEmpty ? nil : SSEEvent(name: name.isEmpty ? "message" : name, data: data.joined(separator: "\n"))
        }
        if text.hasPrefix(":") { return nil }
        let colon = text.firstIndex(of: ":")
        let field = colon.map { String(text[..<$0]) } ?? text
        var value = colon.map { String(text[text.index(after: $0)...]) } ?? ""
        if value.hasPrefix(" ") { value.removeFirst() }
        switch field {
        case "event": name = value
        case "data": data.append(value)
        default: break
        }
        return nil
    }
}
