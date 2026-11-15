import Foundation

// The native half of the page's passkey calls (public/ui/webauthn.js, public/login.js, public/ui/passkeys.js). `origin` is the address's own origin,
// which the server checks against the clientDataJSON the system signs.

private struct OriginBody: Encodable, Sendable { var origin: String }
private struct SignInReply: Decodable, Sendable {
    var options: Options?
    struct Options: Decodable, Sendable { var challenge: String; var rpId: String }
}
private struct AddOptions: Decodable, Sendable {
    var challenge: String
    var rp: Relying
    var user: Handle
    var excludeCredentials: [Excluded]?
    struct Excluded: Decodable, Sendable { var id: String }
    struct Relying: Decodable, Sendable { var id: String }
    struct Handle: Decodable, Sendable { var id: String; var name: String }
}

extension GhostShellClient {
    /// Whether the server has a passkey to sign in with at this address. Asked before sign-in, so it carries no token, and not at all
    /// where this build may not use passkeys.
    public func offersPasskey(using support: PasskeySupport) async -> Bool {
        guard support.allows(address) else { return false }
        return (try? await signInOptions()) != nil
    }

    /// Asks for a challenge, signs it with the system sheet and trades the answer for a token.
    public func signIn(passkeyUsing support: PasskeySupport) async throws {
        guard let options = try await signInOptions() else { throw GhostShellError.refused(status: 404, message: "No passkeys are added for this address.") }
        try support.check(rpId: options.rpId, address: address)
        guard let challenge = Base64URL.decode(options.challenge) else { throw GhostShellError.server(status: 0) }
        let assertion = try await support.ceremony.assert(challenge: challenge, rpId: options.rpId)
        try await signIn(passkey: assertion)
    }

    /// Makes a passkey on this device for the signed-in address, and answers with the server's list.
    public func addPasskey(using support: PasskeySupport) async throws -> [Passkey] {
        let options: AddOptions = try await post("api/passkeys/options", json: OriginBody(origin: address.origin))
        try support.check(rpId: options.rp.id, address: address)
        guard let challenge = Base64URL.decode(options.challenge), let userID = Base64URL.decode(options.user.id) else { throw GhostShellError.server(status: 0) }
        let made = try await support.ceremony.register(challenge: challenge, rpId: options.rp.id, name: options.user.name, userID: userID,
                                                excluding: (options.excludeCredentials ?? []).compactMap { Base64URL.decode($0.id) })
        let reply: PasskeyList = try await post("api/passkeys", json: made)
        return reply.passkeys
    }

    private func signInOptions() async throws -> SignInReply.Options? {
        let (data, response) = try await openPost("passkey-options", json: OriginBody(origin: address.origin))
        guard response.statusCode == 200 else { throw GhostShellError.server(status: response.statusCode) }
        return (try decode(data) as SignInReply).options
    }
}
