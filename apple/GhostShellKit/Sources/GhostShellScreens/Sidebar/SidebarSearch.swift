import GhostShellKit
import SwiftUI

/// What the search field finds: live sessions, sessions nested under another, then archived ones. An archived hit opens its session and stays archived.
struct SearchSections: View {
    let hits: SearchHits

    var body: some View {
        #if os(iOS)
        part("Sessions", hits.sessions)
        part("Sub sessions", hits.subSessions)
        part("Archived", hits.archived)
        #else
        if !hits.sessions.isEmpty { Section("Sessions") { ForEach(hits.sessions) { SessionLine(row: $0) } } }
        if !hits.subSessions.isEmpty { Section("Sub sessions") { ForEach(hits.subSessions) { SessionLine(row: $0) } } }
        if !hits.archived.isEmpty { Section("Archived") { ForEach(hits.archived) { SessionLine(row: $0) } } }
        #endif
    }

    #if os(iOS)
    @ViewBuilder private func part(_ title: String, _ rows: [SessionRow]) -> some View {
        if !rows.isEmpty {
            PhoneSectionLabel(title: title)
            ForEach(rows) { SessionLine(row: $0) }
        }
    }
    #endif
}
