import Foundation

/// The server's own words for a refused write: the 400 `{error, problems}` of a bad form, the 409 of a routine that is still running, and the like.
/// `problems` holds one sentence for each refused field, keyed by the API's field name (`cron`, `jitterSeconds`, `cwd`, `file`, `prompt`, `at`).
public struct ServerRefusal: Error, LocalizedError, Equatable, Sendable {
    public var status: Int
    public var message: String
    public var problems: [String: String]

    public init(status: Int, message: String, problems: [String: String] = [:]) {
        (self.status, self.message, self.problems) = (status, message, problems)
    }

    /// Nil when the body is not the server's `{error}` shape, so the caller falls back to `GhostShellError.server`.
    init?(status: Int, body: Data) {
        guard let object = try? JSONDecoder().decode(Body.self, from: body), let message = object.error, !message.isEmpty else { return nil }
        self.init(status: status, message: message, problems: object.problems ?? [:])
    }

    public var errorDescription: String? { message }

    // NOTE: [8 Nov 2026] EK - These orders copy FIELDS in public/ui/routine-rules.js and scheduled-rules.js, so the first refusal gets the focus as it does there.
    public static let routineFields = ["title", "heading", "cron", "jitterSeconds", "cwd", "model", "effort", "mode", "account", "file", "prompt"]
    public static let scheduledFields = ["title", "at", "cwd", "model", "effort", "mode", "group", "prompt"]

    /// The refused fields that the form has, in its order. The first one is the one to focus. Fields the form lacks and empty sentences are dropped.
    public func fields(in order: [String]) -> [(field: String, sentence: String)] {
        order.compactMap { key in problems[key].flatMap { $0.isEmpty ? nil : (key, $0) } }
    }

    private struct Body: Decodable {
        var error: String?
        var problems: [String: String]?
        private enum Key: String, CodingKey { case error, problems }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Key.self)
            error = try? c.decode(String.self, forKey: .error)
            problems = (try? c.decode([String: String].self, forKey: .problems))
        }
    }
}
