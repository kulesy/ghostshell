import GhostShellKit
import SwiftUI

/// The plain list: every session once, newest first, with a small mark for what needs a look.
public struct SidebarScreen: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        @Bindable var navigator = model.navigator
        Group {
            if !model.hasLoaded {
                List {
                    ForEach(0..<8, id: \.self) { _ in SessionRowView(title: "Session title goes here", dot: nil).redacted(reason: .placeholder) }
                }
                .allowsHitTesting(false)
                .accessibilityLabel("Loading sessions")
            } else if model.rows.isEmpty {
                ContentUnavailableView("No sessions yet", systemImage: "bubble.left", description: Text("Start a chat in GhostShell and it will show up here."))
            } else {
                List(model.rows, selection: Binding(get: { navigator.selectedSessionID }, set: { if let id = $0 { navigator.openSession(id) } })) { row in
                    SessionRowView(title: row.title, dot: row.dot)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if model.connection == .unreachable { UnreachableLine() }
        }
        .toolbar {
            ToolbarItem {
                Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right") { Task { await model.signOut() } }
                    .help("Sign Out")
            }
        }
        .navigationTitle("Sessions")
    }
}

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

struct UnreachableLine: View {
    var body: some View {
        Text("Can't reach the server. Trying again.")
            .font(.footnote)
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
    }
}
