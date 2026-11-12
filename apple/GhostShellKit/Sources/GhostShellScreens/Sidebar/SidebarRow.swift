import GhostShellKit
import SwiftUI

/// A fold control on a row: an open chevron, with its words for the tooltip and VoiceOver.
struct RowFold {
    var open: Bool
    var label: String
    var toggle: () -> Void
}

struct SessionRowView: View {
    let title: String
    let dot: SessionDot?
    var turnStart: Date?
    var fold: RowFold?

    var body: some View {
        HStack(spacing: 10) {
            StateMark(dot: dot)
            Text(title.isEmpty ? "Untitled" : title).lineLimit(1)
            Spacer(minLength: 4)
            if let turnStart { TurnTimer(start: turnStart) }
            if let fold { FoldButton(fold: fold) }
        }
        .accessibilityElement(children: .combine)
    }
}

/// How long the open turn has run, counted on this Mac's clock and redrawn each second.
struct TurnTimer: View {
    let start: Date

    var body: some View {
        EverySecond { now in
            let text = Text(SidebarOutline.duration(ms: now.timeIntervalSince(start) * 1000))
            #if os(iOS)
            text.font(.geistMono(11, relativeTo: .caption2)).foregroundStyle(Color.ghost.sidebarMuted)
            #else
            text.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            #endif
        }
    }
}

struct FoldButton: View {
    let fold: RowFold

    var body: some View {
        Button(action: fold.toggle) {
            Image(systemName: "chevron.right").rotationEffect(.degrees(fold.open ? 90 : 0)).font(.caption2.weight(.semibold)).frame(width: 14, height: 14)
        }
        .buttonStyle(.borderless)
        .help(fold.label)
        .accessibilityLabel(fold.label)
        .accessibilityValue(fold.open ? "Expanded" : "Collapsed")
    }
}

/// Orange waits for you, red failed, blue is unread, a ring is working. Nothing else gets colour.
struct StateMark: View {
    let dot: SessionDot?

    var body: some View {
        Group {
            switch dot {
            case .awaiting?: Circle().fill(.orange)
            case .error?: Circle().fill(.red)
            case .ready?: Circle().fill(.blue)
            case .running?: Circle().strokeBorder(.secondary, lineWidth: 1.5)
            default: Color.clear
            }
        }
        .frame(width: 8, height: 8)
        .accessibilityElement()
        .accessibilityLabel(label)
    }

    private var label: String {
        switch dot {
        case .awaiting?: "Waiting for you"
        case .error?: "Failed"
        case .ready?: "Unread"
        case .running?: "Working"
        default: ""
        }
    }
}
