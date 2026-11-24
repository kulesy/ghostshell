import Foundation

// Ported from public/ui/settings.js. Change them together.

public let sendReachTitle = "Messages between sessions"
public let sendReachLead = "Choose which messages a session can send without asking you. A message starts a turn in the session it reaches, and text on a web page, in an email or in a pull request comment could steer a session into sending one."
public let sendReachNote = "Outside its family, a session can send 10 messages without asking. Then it asks again until you next write to it. A group's or section's chat always asks."

extension SendReach {
    public var choiceName: String {
        switch self {
        case .family: "Its own family"
        case .project: "Its own project"
        case .anySession: "Any session"
        }
    }

    public var choiceWords: String {
        switch self {
        case .family: "Its parent, the sessions beside it and the ones below it. A steered session can start turns only in its own family, including any in Bypass."
        case .project: "Its family and any session in its project. Sessions in no project count as one project. A steered session can start turns across the project, including any in Bypass."
        case .anySession: "Every session that isn't archived, in any project or account. A steered session can start turns in all of them, including any in Bypass."
        }
    }

    /// The choice the page marks "Default".
    public var isDefault: Bool { self == .family }
}
