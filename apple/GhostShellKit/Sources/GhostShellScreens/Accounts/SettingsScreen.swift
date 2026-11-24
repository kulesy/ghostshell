import GhostShellKit
import SwiftUI

/// The page's Settings pane (public/ui/settings.js): how far a session's send_session goes with no card. Only a tap on a row writes it.
public struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var state = SettingsState()

    public init() {}

    public var body: some View {
        FlatForm(spacing: 0) {
            if let shown = state.shown {
                VStack(alignment: .leading, spacing: 4) {
                    Text(sendReachTitle).font(.geist(16, weight: .semibold)).foregroundStyle(Color.ghost.foreground).accessibilityAddTraits(.isHeader)
                    Text(sendReachLead).ghostMuted().fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Rule()
                    ForEach(SendReach.allCases, id: \.self) { reach in
                        row(reach, chosen: shown == reach)
                        Rule()
                    }
                }
                .padding(.top, 16)
                Text(sendReachNote).ghostMuted(13).fixedSize(horizontal: false, vertical: true).padding(.top, 16)
            } else if state.problem.isEmpty {
                Text("Loading settings").ghostMuted()
            }
            if state.saving || !state.status.isEmpty { Text(state.saving ? "Saving" : state.status).ghostMuted(13).padding(.top, 8) }
            if !state.problem.isEmpty { Notice(text: state.problem).padding(.top, 14) }
        }
        .pageHeader("Settings")
        .task { if let client = model.client { await state.load(client) } }
        .onChange(of: state.status) { if !state.status.isEmpty { AccessibilityNotification.Announcement(state.status).post() } }
    }

    // SwiftUI has no radio trait, so a row is a button that reads as selected, with its words after its name.
    private func row(_ reach: SendReach, chosen: Bool) -> some View {
        Button {
            guard let client = model.client else { return }
            Task { await state.pick(reach, client) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: macOr(16, 20)))
                    .foregroundStyle(chosen ? Color.ghost.primary : Color.ghost.mutedForeground)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(reach.choiceName).font(.geist(14, weight: .medium)).foregroundStyle(Color.ghost.foreground)
                        if reach.isDefault {
                            Text("Default").font(.geist(12, weight: .medium)).foregroundStyle(Color.ghost.foreground)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .overlay { Capsule().strokeBorder(Color.ghost.border, lineWidth: 1) }
                        }
                    }
                    Text(reach.choiceWords).ghostMuted(13).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)
            .frame(minHeight: GhostMetrics.current.target, alignment: .top)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(state.saving && !chosen)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
