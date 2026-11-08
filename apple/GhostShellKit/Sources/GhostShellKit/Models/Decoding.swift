import Foundation

// Decoding helpers shared by every model file. Each reads a field the server may leave out or word differently as nil or empty, never an error.

// A row or list the app cannot read is left out, so one odd entry never empties the whole index.
struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

func lossy<T: Decodable, K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> [T] {
    ((try? c.decode([Lossy<T>].self, forKey: key)) ?? []).compactMap(\.value)
}

/// A word the server picks from a short list. A word this app does not know is kept in `.other`, never an error.
public protocol ServerWord: Decodable { init(word: String) }
extension ServerWord {
    public init(from decoder: Decoder) throws { self.init(word: try decoder.singleValueContainer().decode(String.self)) }
}

extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key) -> T? { try? decode(T.self, forKey: key) }
    /// A list where one row the app cannot read is left out.
    func list<T: Decodable>(_ key: Key) -> [T] { lossy(self, key) }
    /// The server counts times in milliseconds since 1970.
    func millis(_ key: Key) -> Date? { (try? decode(Double.self, forKey: key)).map { Date(timeIntervalSince1970: $0 / 1000) } }
    func iso(_ key: Key) -> Date? { (try? decode(String.self, forKey: key)).flatMap(parseISO) }
    /// A whole number, which the server may write as 12 or 12.0.
    func count(_ key: Key) -> Int? { (try? decode(Int.self, forKey: key)) ?? (try? decode(Double.self, forKey: key)).map { Int($0) } }
}

func parseISO(_ text: String) -> Date? {
    (try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))) ?? (try? Date(text, strategy: .iso8601))
}

/// An id that goes into a path. The server's own pattern for an id is letters, digits, underscore and hyphen.
func pathID(_ id: String) throws -> String {
    guard !id.isEmpty, id.unicodeScalars.allSatisfy({ $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0) || $0 == "_" || $0 == "-") }) else { throw GhostShellError.badPath(id) }
    return id
}
