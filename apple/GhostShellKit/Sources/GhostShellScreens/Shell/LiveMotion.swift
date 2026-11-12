import SwiftUI

/// A scripted test run sets `still`, so no spinner turns, no clock ticks and no sidebar row can be dragged, and the test runner can see the app go idle. See https://github.com/kulesy/ghostshell/issues/148.
@MainActor public enum LiveMotion {
    public static var still = false
}

/// A `ProgressView` that is a static mark while `LiveMotion.still` is set.
struct Spinner: View {
    var size: ControlSize = .small

    var body: some View {
        if LiveMotion.still { Image(systemName: "ellipsis").foregroundStyle(.secondary) } else { ProgressView().controlSize(size) }
    }
}

/// Redraws `content` each second, or once while `LiveMotion.still` is set.
struct EverySecond<Content: View>: View {
    @ViewBuilder let content: (Date) -> Content

    var body: some View {
        if LiveMotion.still { content(.now) } else { TimelineView(.periodic(from: .now, by: 1)) { content($0.date) } }
    }
}
