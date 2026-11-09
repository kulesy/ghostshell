import GhostShellKit
import SwiftUI

/// The sections of the chosen view, each folding on its heading and keeping that fold in SidebarState.
struct SidebarSections: View {
    @Environment(SidebarState.self) private var state
    let sections: [OutlineSection]

    var body: some View {
        ForEach(sections) { section in
            Section(isExpanded: open(section.id)) {
                if section.kind == .routines { RoutineBuckets(buckets: section.buckets) } else { FamilyRows(rows: section.rows) }
            } header: {
                HeadingRow(heading: SidebarHeading(section), count: section.count)
            }
        }
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
            DisclosureGroup(isExpanded: Binding(get: { state.isOpen(bucket.id) }, set: { state.setOpen(bucket.id, $0) })) {
                Rows(bucket: bucket)
            } label: {
                HeadingRow(heading: SidebarHeading(id: bucket.id, title: bucket.heading ?? "", kind: .routineHeading), count: bucket.routines.count + bucket.idle.count)
            }
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

/// A section, group or routine heading: its name in capitals, then the slot buttons and the count, which stays when it is folded.
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
        #if os(iOS)
        .modifier(HeadingLongPressMenu(heading: heading))
        #else
        .contextMenu { HeadingMenuSlot(heading: heading) }
        #endif
        .modifier(HeadingSlot(heading: heading))
    }
}

#if os(iOS)
/// A phone's list header takes a long press as a tap on the fold, so `.contextMenu` never opens there. A long press asks with an action sheet instead.
// NOTE: [9 Nov 2026] EK - Items in HeadingMenuSlot must be plain Buttons on iOS, because a confirmationDialog drops Menus and other content.
private struct HeadingLongPressMenu: ViewModifier {
    let heading: SidebarHeading
    @State private var asking = false

    func body(content: Content) -> some View {
        // A routine sub-heading has no items, so its long press stays off rather than open a dialog with only Cancel.
        content
            .highPriorityGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in asking = true }, including: heading.kind == .routineHeading ? .subviews : .all)
            .confirmationDialog(heading.title, isPresented: $asking, titleVisibility: .visible) { HeadingMenuSlot(heading: heading).textCase(nil) }
    }
}
#endif
