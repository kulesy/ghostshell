import Foundation

// NOTE: [15 Nov 2026] EK - These shapes mirror public/ui/webauthn.js (`makePasskey`, `usePasskey`), which the server's lib/passkeys.mjs reads. Change them together.

public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}

/// What the system hands back for a sign-in, sent to `passkey-login` as the page sends it.
public struct PasskeyAssertion: Sendable, Equatable, Encodable {
    public var credentialID, clientDataJSON, authenticatorData, signature: Data
    public var userHandle: Data?

    public init(credentialID: Data, clientDataJSON: Data, authenticatorData: Data, signature: Data, userHandle: Data?) {
        (self.credentialID, self.clientDataJSON, self.authenticatorData, self.signature, self.userHandle) = (credentialID, clientDataJSON, authenticatorData, signature, userHandle)
    }

    private enum Key: String, CodingKey { case id, response }
    private enum Response: String, CodingKey { case clientDataJSON, authenticatorData, signature, userHandle }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(Base64URL.encode(credentialID), forKey: .id)
        var r = c.nestedContainer(keyedBy: Response.self, forKey: .response)
        try r.encode(Base64URL.encode(clientDataJSON), forKey: .clientDataJSON)
        try r.encode(Base64URL.encode(authenticatorData), forKey: .authenticatorData)
        try r.encode(Base64URL.encode(signature), forKey: .signature)
        // The page sends null when the authenticator gave no handle.
        try r.encode(userHandle.map(Base64URL.encode), forKey: .userHandle)
    }
}

/// What the system hands back for a new passkey, sent to `api/passkeys`.
public struct PasskeyRegistration: Sendable, Equatable, Encodable {
    public var credentialID, clientDataJSON, attestationObject: Data

    public init(credentialID: Data, clientDataJSON: Data, attestationObject: Data) {
        (self.credentialID, self.clientDataJSON, self.attestationObject) = (credentialID, clientDataJSON, attestationObject)
    }

    private enum Key: String, CodingKey { case id, response }
    private enum Response: String, CodingKey { case clientDataJSON, attestationObject }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(Base64URL.encode(credentialID), forKey: .id)
        var r = c.nestedContainer(keyedBy: Response.self, forKey: .response)
        try r.encode(Base64URL.encode(clientDataJSON), forKey: .clientDataJSON)
        try r.encode(Base64URL.encode(attestationObject), forKey: .attestationObject)
    }
}

/// The two passkey ceremonies. The real one is the system sheet (GhostShellScreens, iOS only). A person backing out throws `CancellationError`.
public protocol PasskeyCeremony: Sendable {
    func assert(challenge: Data, rpId: String) async throws -> PasskeyAssertion
    /// `excluding` holds the credential IDs this server already has, so the system refuses a second passkey on the same device.
    func register(challenge: Data, rpId: String, name: String, userID: Data, excluding: [Data]) async throws -> PasskeyRegistration
}

/// A ceremony and the host this build may use it for. Only a build with the Associated Domains entitlement for `domain` has one, so a build without it offers no passkey.
public struct PasskeySupport: Sendable {
    public let ceremony: any PasskeyCeremony
    /// nil lets any address through. Only the Debug stub makes that.
    public let domain: String?

    public init(ceremony: any PasskeyCeremony, domain: String?) {
        self.ceremony = ceremony
        self.domain = domain.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
    }

    /// The system signs a passkey's origin as `https://<rpId>`, so the address must be exactly that: https, no port, no other host.
    public func allows(_ address: ServerAddress) -> Bool {
        guard let domain else { return true }
        return !domain.isEmpty && address.origin == "https://\(domain)"
    }

    /// Refuses a ceremony the server would only fail later with a vague word: the address is not the one this build is entitled for, or the
    /// server's relying party is another host than the address.
    public func check(rpId: String, address: ServerAddress) throws {
        guard allows(address) else {
            throw GhostShellError.refused(status: 0, message: "This app can use passkeys only at \(domain ?? ""). Sign in at that address.")
        }
        guard rpId.lowercased() == address.baseURL.host?.lowercased() else {
            throw GhostShellError.refused(status: 0, message: "The server's passkeys belong to another address than this one.")
        }
    }
}
