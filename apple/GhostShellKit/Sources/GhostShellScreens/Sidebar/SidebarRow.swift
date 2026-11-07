import GhostShellKit
import SwiftUI

struct SessionRowView: View {
    let title: String
    let dot: SessionDot?

    var body: some View {
        HStack(spacing: 10) {
            StateMark(dot: dot)
            Text(title.isEmpty ? "Untitled" : title).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
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
