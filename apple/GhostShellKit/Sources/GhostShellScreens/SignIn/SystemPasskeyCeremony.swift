#if os(iOS)
import AuthenticationServices
import GhostShellKit
import UIKit

/// The system passkey sheet. It signs `https://<rpId>` as the origin, which is why `PasskeySupport.check` insists the address is exactly that.
@MainActor
public final class SystemPasskeyCeremony: NSObject, PasskeyCeremony, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var pending: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?

    public override init() { super.init() }

    public func assert(challenge: Data, rpId: String) async throws -> PasskeyAssertion {
        let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId).createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        guard let made = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else { throw Self.failed }
        return PasskeyAssertion(credentialID: made.credentialID, clientDataJSON: made.rawClientDataJSON, authenticatorData: made.rawAuthenticatorData,
                                signature: made.signature, userHandle: made.userID)
    }

    public func register(challenge: Data, rpId: String, name: String, userID: Data, excluding: [Data]) async throws -> PasskeyRegistration {
        let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId).createCredentialRegistrationRequest(challenge: challenge, name: name, userID: userID)
        request.userVerificationPreference = .required
        request.excludedCredentials = excluding.map(ASAuthorizationPlatformPublicKeyCredentialDescriptor.init(credentialID:))
        guard let made = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration, let attestation = made.rawAttestationObject else { throw Self.failed }
        return PasskeyRegistration(credentialID: made.credentialID, clientDataJSON: made.rawClientDataJSON, attestationObject: attestation)
    }

    private static let failed = GhostShellError.refused(status: 0, message: "The passkey did not work.")
    // The words public/ui/webauthn.js shows for the browser's InvalidStateError.
    private static let alreadyAdded = GhostShellError.refused(status: 0, message: "This device already has a passkey for GhostShell.")

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        controller = nil
        pending?.resume(with: result)
        pending = nil
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        finish(.success(authorization))
    }

    // Backing out of the sheet is the person's choice, so it is a quiet cancel and not a failure to show.
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        switch (error as? ASAuthorizationError)?.code {
        case .canceled: finish(.failure(CancellationError()))
        case .matchedExcludedCredential: finish(.failure(Self.alreadyAdded))
        default: finish(.failure(Self.failed))
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
    }
}
#endif
