import GhostShellKit
import SwiftUI

/// One of the ways the answer did not come, in the words of `WatchProblem`.
struct ProblemView: View {
    let problem: WatchProblem
    var retry: (() -> Void)?

    private var symbol: String {
        switch problem {
        case .phoneUnreachable: "iphone.slash"
        case .signedOut: "person.crop.circle.badge.exclamationmark"
        case .serverUnreachable: "wifi.exclamationmark"
        case .refused, .invalid, .outOfDate: "exclamationmark.triangle"
        }
    }

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.title3).foregroundStyle(.orange).accessibilityHidden(true)
            Text(problem.words).font(.headline).multilineTextAlignment(.center)
            if problem.canRetry, let retry {
                Button("Try again", action: retry)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
    }
}
