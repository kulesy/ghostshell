import GhostShellKit
import SwiftUI

/// The sections of the chosen view, each folding on its heading and keeping that fold in SidebarState.
struct SidebarSections: View {
    @Environment(SidebarState.self) private var state
    let sections: [OutlineSection]

    var body: some View {
        #if os(iOS)
        ForEach(Array(sections.enumerated()), id: \.element.id) { at, section in
            PhoneHeadingRow(heading: SidebarHeading(section), count: section.count, first: at == 0)
            if state.isOpen(section.id) {
                if section.kind == .routines { RoutineBuckets(buckets: section.buckets) } else { FamilyRows(rows: section.rows) }
            }
        }
        #else
        ForEach(sections) { section in
            Section(isExpanded: open(section.id)) {
                if section.kind == .routines { RoutineBuckets(buckets: section.buckets) } else { FamilyRows(rows: section.rows) }
            } header: {
                HeadingRow(heading: SidebarHeading(section), count: section.count)
            }
        }
        #endif
    }

    private func open(_ id: String) -> Binding<Bool> {
        Binding(get: { state.isOpen(id) }, set: { state.setOpen(id, $0) })
    }
}

/// The loose routines first, then one folding sub-heading per name.
private struct RoutineBuckets: View {
    @Environment(SidebarState.self) private var state
    let buckets: [RoutineBucket]

    var body: some View {
        ForEach(buckets.filter { $0.heading == nil }) { Rows(bucket: $0) }
        ForEach(buckets.filter { $0.heading != nil }) { bucket in
            #if os(iOS)
            PhoneHeadingRow(heading: SidebarHeading(id: bucket.id, title: bucket.heading ?? "", kind: .routineHeading), count: bucket.routines.count + bucket.idle.count)
            if state.isOpen(bucket.id) { Rows(bucket: bucket) }
            #else
            DisclosureGroup(isExpanded: Binding(get: { state.isOpen(bucket.id) }, set: { state.setOpen(bucket.id, $0) })) {
                Rows(bucket: bucket)
            } label: {
                HeadingRow(heading: SidebarHeading(id: bucket.id, title: bucket.heading ?? "", kind: .routineHeading), count: bucket.routines.count + bucket.idle.count)
            }
            #endif
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

/// A section, group or routine heading on the Mac: its name in capitals, then the slot buttons and the count, which stays when it is folded.
struct HeadingRow: View {
    let heading: SidebarHeading
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Text(heading.title).font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.8).lineLimit(1)
            Spacer(minLength: 4)
            HeadingAccessorySlot(heading: heading)
            Text("\(count)").font(.caption2.monospacedDigit())
                .accessibilityLabel("\(count) session\(count == 1 ? "" : "s")")
        }
        // Row timers and chevrons end this far inside the list's edge, so the count lines up with them.
        .padding(.trailing, 13.5)
        .contentShape(Rectangle())
        .contextMenu { HeadingMenuSlot(heading: heading) }
        .modifier(HeadingSlot(heading: heading))
    }
}
