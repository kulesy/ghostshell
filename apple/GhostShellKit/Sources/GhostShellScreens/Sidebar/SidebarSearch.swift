import GhostShellKit
import SwiftUI

/// What the search field finds: live sessions, sessions nested under another, then archived ones. An archived hit opens its session and stays archived.
struct SearchSections: View {
    let hits: SearchHits

    var body: some View {
        part("Sessions", hits.sessions)
        part("Sub sessions", hits.subSessions)
        part("Archived", hits.archived)
    }

    @ViewBuilder private func part(_ title: String, _ rows: [SessionRow]) -> some View {
        if !rows.isEmpty {
            SectionLabel(title: title)
            ForEach(rows) { SessionLine(row: $0) }
        }
    }
}
