import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The Settings window (Cmd-,). Everything under the first switch is off and dimmed while notifications are off.
public struct NotificationSettingsView: View {
    @Bindable private var settings: NotificationSettings

    public init(settings: NotificationSettings) { self.settings = settings }

    public var body: some View {
        Form {
            Section {
                Toggle("Notify me about sessions", isOn: $settings.enabled)
                if settings.systemDenied {
                    deniedNotice
                }
            }
            Section("Tell me when a session") {
                Toggle("Needs you", isOn: $settings.needsYou)
                Toggle("Finishes", isOn: $settings.finished)
                Toggle("Fails", isOn: $settings.failed)
            }
            .foregroundStyle(settings.enabled ? .primary : .secondary)
            .disabled(!settings.enabled)
            Section("Which sessions") {
                Picker("Notify for", selection: $settings.pinnedOnly) {
                    Text("All sessions").tag(false)
                    Text("Pinned sessions only").tag(true)
                }
                Toggle("Include routine runs", isOn: $settings.routineRuns)
            }
            .foregroundStyle(settings.enabled ? .primary : .secondary)
            .disabled(!settings.enabled)
            Section("Dock") {
                Toggle("Show the waiting count on the Dock icon", isOn: $settings.dockCount)
            }
            .foregroundStyle(settings.enabled ? .primary : .secondary)
            .disabled(!settings.enabled)
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var deniedNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("macOS is blocking notifications from GhostShell.", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            #if os(macOS)
            Button("Open System Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
            }
            #endif
        }
    }
}
