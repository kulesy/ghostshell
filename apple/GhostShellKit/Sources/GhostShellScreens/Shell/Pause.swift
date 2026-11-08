import Foundation

/// Sleeps for `seconds`, and returns false when the task was cancelled meanwhile.
func pause(_ seconds: TimeInterval) async -> Bool {
    (try? await Task.sleep(for: .seconds(seconds))) != nil && !Task.isCancelled
}
