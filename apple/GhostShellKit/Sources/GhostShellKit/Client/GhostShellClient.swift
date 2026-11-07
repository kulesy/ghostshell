import Foundation

public enum AuthState: Sendable, Equatable { case signedIn, signedOut }

/// Every call to the server goes through here. There is one request builder, one address type, no cookie store, no cache and no redirects,
/// so the token can only ever travel to the address it was saved for.
public actor GhostShellClient {
    public nonisolated let address: ServerAddress
    /// Fires when a sign-in succeeds and when the token goes (sign-out, or a 401 on any call). One reader.
    public nonisolated let authChanges: AsyncStream<AuthState>

    private let store: TokenStore
    private let session: URLSession
    private let changes: AsyncStream<AuthState>.Continuation
    private var token: String?
    private var loaded = false

    public init(address: ServerAddress, store: TokenStore) {
        self.init(address: address, store: store, protocols: [])
    }

    // Tests slip a URLProtocol in here. Nothing else about the session can be changed.
    init(address: ServerAddress, store: TokenStore, protocols: [AnyClass]) {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15
        config.protocolClasses = protocols + (config.protocolClasses ?? [])
        self.address = address
        self.store = store
        self.session = URLSession(configuration: config, delegate: Refuse(), delegateQueue: nil)
        (authChanges, changes) = AsyncStream.makeStream()
    }

    deinit { session.finishTasksAndInvalidate() }

    // MARK: Signing in

    /// Reads the saved token. True when there is one. The read can block on a Keychain dialog, so callers wait for it off the main actor.
    public func restore() async -> Bool {
        await loadToken()
        return token != nil
    }

    // NOTE: [7 Nov 2026] EK - The login route answers 303 with `Set-Cookie: capcom=<token>`, and 401 for wrong and locked alike (see server.mjs).
    // If either moves, every sign-in reads as the wrong password.
    public func signIn(password: String) async throws {
        let body = Data(("password=" + FormEncoding.encode(password)).utf8)
        let request = try build("POST", "login", body: body, contentType: "application/x-www-form-urlencoded", token: nil)
        let (data, response) = try await transport(request)
        switch response.statusCode {
        case 303:
            guard let fresh = Self.cookieToken(response) else { throw GhostShellError.server(status: 303) }
            token = fresh
            loaded = true
            await store.save(fresh, for: address)
            changes.yield(.signedIn)
        case 401, 429:
            throw String(decoding: data.prefix(20_000), as: UTF8.self).contains("Too many tries") || response.statusCode == 429 ? GhostShellError.locked : GhostShellError.wrongPassword
        default:
            throw GhostShellError.server(status: response.statusCode)
        }
    }

    /// Forgets the token here first, so the app is signed out at once, then asks the server to revoke it. An unreachable server changes nothing locally.
    public func signOut() async {
        await loadToken()
        let old = token
        await forget()
        guard let old, let request = try? build("POST", "logout", token: old) else { return }
        _ = try? await transport(request)
    }

    // MARK: Calls

    public func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try decode(try await call("GET", path, query: query))
    }

    public func post<T: Decodable & Sendable>(_ path: String, json body: some Encodable & Sendable) async throws -> T {
        try decode(try await call("POST", path, body: try JSONEncoder().encode(body), contentType: "application/json"))
    }

    /// A POST whose reply is not read.
    public func send(_ path: String, json body: some Encodable & Sendable) async throws {
        _ = try await call("POST", path, body: try JSONEncoder().encode(body), contentType: "application/json")
    }

    /// Any call with a raw reply or body: DELETE, PATCH, a byte upload with `?path=` in `query`, a byte read. Cookie and Origin always come from the
    /// address and token. A `contentType` with a control character, or a method outside GET, POST, PUT, PATCH and DELETE, is refused. So is an extra
    /// header whose name is not plain token characters, whose value has a control character, or that is one the client sets itself.
    public func data(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil,
                     headers: [String: String] = [:]) async throws -> Data {
        try await call(method, path, query: query, body: body, contentType: contentType, headers: headers)
    }

    /// Opens a stream and hands back its bytes. Reaching `api/sessions/<id>/events` this way has a side effect, see Endpoints/Sessions.swift.
    func openStream(_ path: String) async throws -> AsyncThrowingStream<UInt8, Error> {
        await loadToken()
        var request = try build("GET", path, token: token, accept: "text/event-stream")
        // The server sends a keep-alive every 20 seconds, so a stream's idle timeout must be longer than that.
        request.timeoutInterval = 65
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do { (bytes, response) = try await session.bytes(for: request) } catch { throw Self.failure(error) }
        guard let http = response as? HTTPURLResponse else { throw GhostShellError.unreachable }
        if http.statusCode == 401 { await forget(); throw GhostShellError.signedOut }
        guard http.statusCode == 200 else { throw GhostShellError.server(status: http.statusCode) }
        return AsyncThrowingStream { continuation in
            let reader = Task {
                do {
                    for try await byte in bytes { continuation.yield(byte) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.failure(error))
                }
            }
            continuation.onTermination = { _ in reader.cancel() }
        }
    }

    // MARK: Inside

    private func call(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil,
                      headers: [String: String] = [:]) async throws -> Data {
        await loadToken()
        guard let token else { throw GhostShellError.signedOut }
        let request = try build(method, path, query: query, body: body, contentType: contentType, headers: headers, token: token)
        let (data, response) = try await transport(request)
        if response.statusCode == 401 { await forget(); throw GhostShellError.signedOut }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.refusal(response.statusCode, data)
        }
        return data
    }

    // A refusal carries the server's own words in `{error}` (see `send(res, status, { error })` in server.mjs), and the screens show them as they are,
    // cleaned first: control characters and line breaks (also U+2028 and U+2029) dropped, trimmed, capped at 300. A refused form also carries `{problems}`.
    // NOTE: [8 Nov 2026] EK - The server's "Not found" is its answer for a route it lacks, so it stays `.server(404)`. BannersState reads that as a server with no banners.
    private static func refusal(_ status: Int, _ body: Data) -> GhostShellError {
        struct Words: Decodable {
            var error: String?, itself: Bool?, subs: Int?, changed: Bool?
            var problems: [String: String]?
            private enum Key: String, CodingKey { case error, itself = "self", subs, problems, changed }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: Key.self)
                (error, problems) = (try? c.decode(String.self, forKey: .error), try? c.decode([String: String].self, forKey: .problems))
                (itself, subs) = (try? c.decode(Bool.self, forKey: .itself), try? c.decode(Int.self, forKey: .subs))
                changed = try? c.decode(Bool.self, forKey: .changed)
            }
        }
        let reply = try? JSONDecoder().decode(Words.self, from: body.prefix(20_000))
        guard [400, 403, 404, 409, 413, 415, 507].contains(status), let raw = reply?.error,
              !(status == 404 && raw == "Not found") else { return .server(status: status) }
        let clean = String(String.UnicodeScalarView(raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !CharacterSet.newlines.contains($0) }))
        let words = String(clean.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))
        if words.isEmpty { return .server(status: status) }
        if status == 409, reply?.itself != nil || reply?.subs != nil { return .running(itself: reply?.itself ?? false, subs: reply?.subs ?? 0, message: words) }
        return .refused(status: status, message: words, problems: reply?.problems ?? [:], changed: reply?.changed == true)
    }

    // The one place a request is made. NOTE: [7 Nov 2026] EK - strictOrigin in server.mjs refuses an owner route that arrives with no Origin,
    // so every non-GET carries one. Only the Cookie and the Origin come from the address and token, never from a caller.
    private nonisolated func build(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil,
                                   headers: [String: String] = [:], token: String?, accept: String = "application/json") throws -> URLRequest {
        guard ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(method) else { throw GhostShellError.badPath(method) }
        if let contentType, contentType.isEmpty || contentType.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) {
            throw GhostShellError.badPath(contentType)
        }
        for (name, value) in headers {
            guard Self.isPlainHeader(name), !Self.reserved.contains(name.lowercased()),
                  !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw GhostShellError.badPath(name) }
        }
        var request = URLRequest(url: try address.url(for: path, query: query))
        request.httpMethod = method
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if method != "GET" { request.setValue(address.origin, forHTTPHeaderField: "Origin") }
        if let token {
            guard Self.isPlausible(token) else { throw GhostShellError.signedOut }
            request.setValue("capcom=\(token)", forHTTPHeaderField: "Cookie")
        }
        if let body {
            request.httpBody = body
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func transport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw GhostShellError.unreachable }
            return (data, http)
        } catch { throw Self.failure(error) }
    }

    private func loadToken() async {
        guard !loaded else { return }
        loaded = true
        let saved = await store.token(for: address)
        if let saved, !Self.isPlausible(saved) { await store.clear(for: address); return }
        token = saved
    }

    private func forget() async {
        loaded = true
        token = nil
        await store.clear(for: address)
        changes.yield(.signedOut)
    }

    nonisolated func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw GhostShellError.server(status: 0) }
    }

    private static func failure(_ error: Error) -> Error {
        if error is GhostShellError || error is CancellationError { return error }
        return (error as? URLError)?.code == .cancelled ? CancellationError() : GhostShellError.unreachable
    }

    private static func cookieToken(_ response: HTTPURLResponse) -> String? {
        let header = response.value(forHTTPHeaderField: "Set-Cookie") ?? ""
        for piece in header.split(whereSeparator: { $0 == ";" || $0 == "," }) {
            let text = piece.trimmingCharacters(in: .whitespaces)
            if text.hasPrefix("capcom="), isPlausible(String(text.dropFirst(7))) { return String(text.dropFirst(7)) }
        }
        return nil
    }

    // The headers the client sets itself, which a caller's extra header can never replace.
    private static let reserved: Set<String> = ["cookie", "origin", "content-type", "content-length", "accept", "host", "authorization", "transfer-encoding"]

    private static func isPlainHeader(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x61 && $0 <= 0x7A) || $0 == 0x2D }
    }

    // A token goes into a header, so only the characters a real one has are allowed.
    private static func isPlausible(_ token: String) -> Bool {
        !token.isEmpty && token.utf8.count <= 256 && token.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x61 && $0 <= 0x7A) || $0 == 0x2D || $0 == 0x5F || $0 == 0x2E }
    }
}

/// Every redirect is refused. A hand-set Cookie header would follow one, to wherever the server named. The login's 303 is read as the answer itself.
private final class Refuse: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// application/x-www-form-urlencoded with an allow-list, so `+`, `&` and `=` in a password survive.
enum FormEncoding {
    private static let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    static func encode(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
}
