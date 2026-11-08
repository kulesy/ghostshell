import SwiftUI

/// The bell in the sidebar toolbar: one click turns every notification on or off.
struct NotificationToggle: View {
    // Optional, so a window built without the settings shows no bell instead of crashing.
    @Environment(NotificationSettings.self) private var settings: NotificationSettings?

    var body: some View {
        if let settings {
            Button {
                settings.enabled.toggle()
            } label: {
                Label("Notifications", systemImage: settings.enabled ? "bell" : "bell.slash")
            }
            .help(settings.enabled ? "Turn notifications off" : "Turn notifications on")
            .accessibilityLabel("Notifications")
            .accessibilityValue(settings.enabled ? "On" : "Off")
        }
    }
}
