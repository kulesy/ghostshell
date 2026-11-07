import Foundation

/// The plain sentence for a failed send, stop or pick. The server's own sentence wins when it sent one.
public enum ComposerWords {
    public static func failure(_ error: Error) -> String {
        if case GhostShellError.refused(_, let message) = error { return message }
        if case GhostShellError.server(let status) = error {
            switch status {
            case 400: return "The server refused that message."
            case 404: return "That session is gone."
            case 409: return "That session is not running here."
            case 413: return "That message is too big to send."
            default: break
            }
        }
        return error.localizedDescription
    }
}
