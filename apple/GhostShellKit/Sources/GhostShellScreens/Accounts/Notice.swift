import SwiftUI

/// A short line that something went wrong or needs a look: orange triangle, ordinary text.
struct Notice: View {
    let text: String
    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Whether the Accounts screen is on show, which is when the sidebar leaves the Chrome banner to it.
@Observable @MainActor
final class AccountsPresence {
    static let shared = AccountsPresence()
    var open = false
}

/// Sleeps for `seconds`, and returns false when the task was cancelled meanwhile.
func pause(_ seconds: TimeInterval) async -> Bool {
    (try? await Task.sleep(for: .seconds(seconds))) != nil && !Task.isCancelled
}
