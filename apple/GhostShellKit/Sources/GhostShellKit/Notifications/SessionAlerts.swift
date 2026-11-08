import Foundation

/// Which sessions and events raise an alert. A plain copy of the settings, so the rules below need no UI.
public struct AlertFilter: Equatable, Sendable {
    public var needsYou: Bool
    public var finished: Bool
    public var failed: Bool
    public var pinnedOnly: Bool
    public var routineRuns: Bool

    public init(needsYou: Bool = true, finished: Bool = true, failed: Bool = true, pinnedOnly: Bool = false, routineRuns: Bool = true) {
        (self.needsYou, self.finished, self.failed, self.pinnedOnly, self.routineRuns) = (needsYou, finished, failed, pinnedOnly, routineRuns)
    }
}

public enum AlertKind: String, Equatable, Sendable {
    case needsYou = "needs-you", finished, failed

    /// The line a notification shows under the session's title.
    public var text: String {
        switch self {
        case .needsYou: "Needs you"
        case .finished: "Finished"
        case .failed: "Failed"
        }
    }
}

public struct SessionAlert: Equatable, Sendable {
    public var sessionID: String
    public var title: String
    public var kind: AlertKind
}

public struct AlertPlan: Equatable, Sendable {
    public var alerts: [SessionAlert] = []
    /// Sessions whose delivered alert is out of date, because the session was seen or changed again.
    public var withdraw: [String] = []
}

/// When a session should raise a Mac notification. Pure, so the tests never touch the notification centre.
public enum SessionAlerts {
    /// The marks of the rows that have one, by session id. A row with no mark is left out, which reads the same as a row not seen yet.
    public static func dots(_ rows: [SessionRow]) -> [String: SessionDot] {
        rows.reduce(into: [:]) { if let dot = $1.dot { $0[$1.id] = dot } }
    }

    /// The sessions waiting on an approval or an answer, for the Dock icon.
    public static func waitingCount(_ rows: [SessionRow]) -> Int { rows.filter { $0.dot == .awaiting }.count }

    /// `previous` is what `dots` returned last time, or nil for the first look after sign-in or after alerts were turned on, which only records a baseline.
    /// `onScreen` is the session being read, and only when the app is in front. An app behind another app is not being looked at.
    public static func plan(previous: [String: SessionDot]?, rows: [SessionRow], filter: AlertFilter, onScreen: String?) -> AlertPlan {
        guard let previous else { return AlertPlan() }
        var plan = AlertPlan()
        for row in rows {
            let before = previous[row.id], after = row.dot
            guard before != after else { continue }
            if let kind = after.flatMap(Self.kind), allows(kind, row: row, filter: filter, onScreen: onScreen) {
                plan.alerts.append(SessionAlert(sessionID: row.id, title: row.title.isEmpty ? "Untitled" : row.title, kind: kind))
            } else if before.flatMap(Self.kind) != nil {
                plan.withdraw.append(row.id)
            }
        }
        let current = Set(rows.map(\.id))
        plan.withdraw += previous.filter { !current.contains($0.key) && kind($0.value) != nil }.keys.sorted()
        return plan
    }

    private static func kind(_ dot: SessionDot) -> AlertKind? {
        switch dot {
        case .awaiting: .needsYou
        case .ready: .finished
        case .error: .failed
        case .running, .other: nil
        }
    }

    private static func allows(_ kind: AlertKind, row: SessionRow, filter: AlertFilter, onScreen: String?) -> Bool {
        guard !row.archived, row.id != onScreen else { return false }
        guard filter.routineRuns || row.routine == nil, !filter.pinnedOnly || row.pinned else { return false }
        return switch kind {
        case .needsYou: filter.needsYou
        case .finished: filter.finished
        case .failed: filter.failed
        }
    }
}
