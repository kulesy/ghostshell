#if os(iOS)
import GhostShellKit
import SwiftUI

/// A session in the phone's list as the page draws it: the title over a muted line, the status dot and a menu button at the right, and a fold chevron
/// when it has sessions nested under it. A nested row sits 19pt in, with a thin line back to its parent.
struct PhoneSessionRow: View {
    @Environment(SidebarState.self) private var state
    let row: SessionRow
    let title: String
    let dot: SessionDot?
    var fold: RowFold?
    var nested = false
    var last = false

    var body: some View {
        let name = title.isEmpty ? "Untitled" : title
        let line = SidebarOutline.tooltip(row, title: title)
        // The page's rows are 48pt with 4pt between them. The gap is inside the row so the nest line runs through it.
        HStack(spacing: 0) {
            if nested { NestLine(last: last).stroke(Color.ghost.sidebarBorder, lineWidth: 1).frame(width: 19) }
            HStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.geist(14, relativeTo: .body)).foregroundStyle(Color.ghost.sidebarForeground).lineLimit(1)
                    if !line.isEmpty { Text(line).font(.geist(12, relativeTo: .caption)).foregroundStyle(Color.ghost.sidebarMuted).lineLimit(1) }
                }
                .padding(.leading, 6)
                Spacer(minLength: 4)
                if let start = row.turnStart { TurnTimer(start: start) }
                if let fold { PhoneFoldButton(fold: fold) }
                PhoneStatusDot(dot: dot)
                if !state.editing { RowMore(row: row, name: name) }
            }
            .padding(.vertical, 2)
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(name)
    }
}

/// The corner that ties a nested row to its parent. Rows touch, so the vertical runs on through every child but the last, which turns toward its text.
private struct NestLine: Shape {
    let last: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let x = rect.minX + 9.5, mid = rect.midY, radius: CGFloat = 4
        path.move(to: CGPoint(x: x, y: rect.minY))
        if last {
            path.addLine(to: CGPoint(x: x, y: mid - radius))
            path.addQuadCurve(to: CGPoint(x: x + radius, y: mid), control: CGPoint(x: x, y: mid))
            path.addLine(to: CGPoint(x: rect.maxX, y: mid))
        } else {
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
            path.move(to: CGPoint(x: x, y: mid))
            path.addLine(to: CGPoint(x: rect.maxX, y: mid))
        }
        return path
    }
}

/// The row's ⋯ button. It holds the same items as the row's long press.
private struct RowMore: View {
    let row: SessionRow
    let name: String

    var body: some View {
        Menu {
            SessionRowMenuSlot(row: row)
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.ghost.sidebarMuted).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.borderless)
        .accessibilityLabel("Actions for \(name)")
    }
}

struct PhoneFoldButton: View {
    let fold: RowFold

    var body: some View {
        Button(action: fold.toggle) {
            Image(systemName: "chevron.right").rotationEffect(.degrees(fold.open ? 90 : 0)).font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.ghost.sidebarMuted).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(fold.label)
        .accessibilityValue(fold.open ? "Expanded" : "Collapsed")
    }
}
#endif
