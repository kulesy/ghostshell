import GhostShellKit
import SwiftUI

/// The sections of the chosen view, each folding on its heading and keeping that fold in SidebarState.
struct SidebarSections: View {
    @Environment(SidebarState.self) private var state
    let sections: [OutlineSection]

    var body: some View {
        ForEach(Array(sections.enumerated()), id: \.element.id) { at, section in
            HeadingRow(heading: SidebarHeading(section), count: section.count, first: at == 0)
            if state.isOpen(section.id) {
                if section.kind == .routines { RoutineBuckets(buckets: section.buckets) } else { FamilyRows(rows: section.rows) }
            }
        }
    }
}

/// The loose routines first, then one folding sub-heading per name.
private struct RoutineBuckets: View {
    @Environment(SidebarState.self) private var state
    let buckets: [RoutineBucket]

    var body: some View {
        ForEach(buckets.filter { $0.heading == nil }) { Rows(bucket: $0) }
        ForEach(buckets.filter { $0.heading != nil }) { bucket in
            HeadingRow(heading: SidebarHeading(id: bucket.id, title: bucket.heading ?? "", kind: .routineHeading), count: bucket.routines.count + bucket.idle.count)
            if state.isOpen(bucket.id) { Rows(bucket: bucket) }
        }
    }

    private struct Rows: View {
        let bucket: RoutineBucket

        var body: some View {
            ForEach(bucket.routines) { RoutineRows(routine: $0) }
            ForEach(bucket.idle) { IdleRoutineRowSlot(routine: $0) }
        }
    }
}

extension SidebarHeading {
    init(_ section: OutlineSection) {
        let kind: Kind = switch section.kind {
        case .routines: .routines
        case .pinned: .pinned
        case .started: .started
        case .ungrouped: .ungrouped
        case .other: .other
        case .group: .group
        }
        self.init(id: section.id, title: section.title, kind: kind, group: section.group)
    }
}
