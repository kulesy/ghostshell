import Foundation

/// The ways a call to the server fails, in the words the app can show.
public enum GhostShellError: Error, Equatable, Sendable {
    case badAddress
    case badPath(String)
    case wrongPassword
    case locked
    case unreachable
    case server(status: Int)
    /// The server said no in its own words, such as a name already taken.
    case refused(status: Int, message: String)
    case signedOut
}

extension GhostShellError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .badAddress: "That is not an address GhostShell can use. Use https, or localhost on this Mac."
        case .badPath: "That request was refused before it was sent."
        case .wrongPassword: "That password did not match."
        case .locked: "Too many tries. Wait 15 minutes."
        case .unreachable: "Can't reach that server. Check the address and that GhostShell is running."
        case .server(let status): status == 0 ? "The server sent something GhostShell did not understand." : "The server answered with an error (\(status)). Try again."
        case .refused(_, let message): message
        case .signedOut: "You are signed out."
        }
    }
}
