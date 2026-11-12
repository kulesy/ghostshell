#if os(iOS)
import GhostShellKit
import SwiftUI

/// A section, group or routine heading drawn as an ordinary row of the list, so a long press opens its menu. Its name is in bold tracked capitals,
/// the count follows it, and the fold chevron ends the row. A rule above it separates it from the group before.
// NOTE: [11 Nov 2026] EK - Not a Section header: a header takes a long press as a tap on the fold and never opens a context menu. See SidebarSections.
struct PhoneHeadingRow: View {
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise
    let heading: SidebarHeading
    let count: Int
    var first = false

    var body: some View {
        let open = state.isOpen(heading.id)
        let sub = heading.kind == .routineHeading
        let renaming: OrganiseModel.Naming? = {
            guard let named = organise.naming, let group = heading.group, named.target == .group(group.id) else { return nil }
            return named
        }()
        VStack(spacing: 0) {
            // The page puts 8pt of group padding each side of the rule, and rows already leave 2pt below themselves.
            if !first && !sub { Rectangle().fill(Color.ghost.sidebarBorder).frame(height: 1).padding(.trailing, 8).padding(.vertical, 6) }
            HStack(spacing: 6) {
                if let renaming {
                    PhoneNameField(naming: renaming, heading: true).id(renaming.id)
                } else {
                    Text(heading.title)
                        .font(.geist(12, weight: sub ? .medium : .semibold, relativeTo: .caption))
                        .textCase(sub ? nil : .uppercase)
                        .tracking(sub ? 0 : 0.96)
                        .foregroundStyle(Color.ghost.sidebarForeground)
                        .lineLimit(1)
                    Text("\(count)").font(.geist(11, relativeTo: .caption2)).monospacedDigit().foregroundStyle(Color.ghost.sidebarMuted)
                        .accessibilityLabel("\(count) session\(count == 1 ? "" : "s")")
                    Spacer(minLength: 4)
                    // The page keeps the chat icon for real groups. Ungrouped and the built-in sections have no group chat there.
                    if heading.kind == .group { HeadingAccessorySlot(heading: heading) }
                    PhoneFoldButton(fold: RowFold(open: open, label: open ? "Fold \(heading.title)" : "Unfold \(heading.title)") { state.setOpen(heading.id, !open) })
                }
            }
            .padding(.leading, 6)
            .frame(minHeight: 44)
        }
        .contentShape(Rectangle())
        .onTapGesture { if renaming == nil { state.setOpen(heading.id, !open) } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(heading.title)
        .accessibilityAddTraits(.isHeader)
        .contextMenu { HeadingMenuSlot(heading: heading) }
        .modifier(HeadingSlot(heading: heading))
        .phoneListRow()
        .selectionDisabled()
    }
}

/// The field at the top of the list while a new group is being named, drawn like a heading.
struct PhoneNewGroupRow: View {
    @Environment(OrganiseModel.self) private var organise

    var body: some View {
        if let naming = organise.naming, naming.target == .newGroup {
            PhoneNameField(naming: naming, heading: true).id(naming.id).padding(.leading, 6).phoneListRow().selectionDisabled()
        }
    }
}

/// A search result group's label, drawn as a heading with no fold.
struct PhoneSectionLabel: View {
    let title: String

    var body: some View {
        Text(title).font(.geist(12, weight: .semibold, relativeTo: .caption)).textCase(.uppercase).tracking(0.96)
            .foregroundStyle(Color.ghost.sidebarForeground)
            .padding(.leading, 6)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            .phoneListRow()
            .selectionDisabled()
    }
}
#endif
