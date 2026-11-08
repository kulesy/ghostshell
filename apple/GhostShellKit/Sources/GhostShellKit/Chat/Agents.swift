import Foundation

/// A subagent as the chat last heard of it, with the moment a running one began by this app's own clock, since the server sends only how long it ran.
public struct HeardAgent: Hashable, Sendable, Identifiable {
    public var agent: Subagent
    public var since: Date?
    public var id: String { agent.id }

    public func elapsed(at now: Date = Date()) -> Int {
        if agent.state == .running, let since { return max(0, Int(now.timeIntervalSince(since) * 1000)) }
        return max(0, agent.ms)
    }
}

public enum ChatAgents {
    /// A later report can only move a running agent's start earlier, so a slow one never steps its timer back.
    public static func heard(before: [HeardAgent], list: [Subagent], now: Date = Date()) -> [HeardAgent] {
        let was = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        return list.map { agent in
            guard agent.state == .running else { return HeardAgent(agent: agent, since: nil) }
            let since = now.addingTimeInterval(-Double(max(0, agent.ms)) / 1000)
            if let old = was[agent.id], old.agent.state == .running, let earlier = old.since { return HeardAgent(agent: agent, since: min(earlier, since)) }
            return HeardAgent(agent: agent, since: since)
        }
    }

    /// Running agents first, the newest start first, then the finished ones, the newest end first.
    public static func parts(_ agents: [HeardAgent]) -> (running: [HeardAgent], finished: [HeardAgent]) {
        let running = agents.filter { $0.agent.state == .running }.sorted { ($0.agent.startedAt ?? 0) > ($1.agent.startedAt ?? 0) }
        let finished = agents.filter { $0.agent.state != .running }.sorted { ($0.agent.endedAt ?? $0.agent.startedAt ?? 0) > ($1.agent.endedAt ?? $1.agent.startedAt ?? 0) }
        return (running, finished)
    }

    /// "2 running, 5 finished", with a part left out when it is none.
    public static func summaryLine(_ agents: [HeardAgent]) -> String {
        let (running, finished) = parts(agents)
        return [running.isEmpty ? nil : "\(running.count) running", finished.isEmpty ? nil : "\(finished.count) finished"].compactMap { $0 }.joined(separator: ", ")
    }

    public static func stateWord(_ state: Subagent.State) -> String {
        switch state {
        case .running: "Running"
        case .done: "Done"
        case .stopped: "Stopped"
        case .failed: "Failed"
        case .other(let word): word.prefix(1).uppercased() + word.dropFirst()
        }
    }
}
