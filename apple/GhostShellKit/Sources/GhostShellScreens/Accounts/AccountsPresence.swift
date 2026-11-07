import SwiftUI

/// Whether the Accounts screen is on show, which is when the sidebar leaves the Chrome banner to it.
@Observable @MainActor
final class AccountsPresence {
    static let shared = AccountsPresence()
    var open = false
}
