import GhostShellKit
import Observation
#if os(macOS)
import AppKit
#endif

/// Watches the session list and raises Mac notifications. The app owns one for its whole life, so alerts keep coming
/// when the window is closed or the sidebar is collapsed.
@MainActor
public final class SessionNotifier {
    private let model: AppModel
    private let settings: NotificationSettings
    private let poster: AlertPoster
    /// The marks seen last time. Nil until the first list after sign-in or after alerts were turned on, which only records them.
    private var baseline: [String: SessionDot]?
    private var badge: Int?
    private var requestedAuthorization = false
    /// A click that arrived before the list loaded, opened once it has.
    private var pendingOpen: String?
    private var activity: NSObjectProtocol?

    public init(model: AppModel, settings: NotificationSettings, poster: AlertPoster) {
        self.model = model
        self.settings = settings
        self.poster = poster
    }

    public func start() {
        poster.onOpen = { [weak self] id in self?.open(sessionID: id) }
        arm()
        #if os(macOS)
        // The person comes back from System Settings by switching to the app, which is when a changed permission is worth reading.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshPermission() }
        }
        #endif
    }

    // Reads everything that matters inside the tracking block, so a change to any of it runs `update` again.
    private func arm() {
        withObservationTracking {
            update()
        } onChange: { [weak self] in
            Task { @MainActor in self?.arm() }
        }
    }

    private func update() {
        let signedIn = model.phase == .signedIn
        let on = settings.enabled
        _ = (settings.needsYou, settings.finished, settings.failed, settings.pinnedOnly, settings.routineRuns, settings.dockCount)
        let onScreen = model.navigator.selectedSessionID
        let rows = model.rows
        if model.phase == .signedOut { pendingOpen = nil }
        if let id = pendingOpen, model.index != nil {
            pendingOpen = nil
            open(sessionID: id)
        }
        if model.watchesWhileHidden != (signedIn && on) {
            model.watchesWhileHidden = signedIn && on
            // Stops App Nap from stretching the hidden 3-second poll.
            if signedIn && on {
                activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Watching sessions for notifications")
            } else if let activity {
                ProcessInfo.processInfo.endActivity(activity)
                self.activity = nil
            }
        }

        guard signedIn, on, model.index != nil else {
            if let old = baseline, !old.isEmpty { poster.withdraw(Array(old.keys)) }
            baseline = nil
            setBadge(nil)
            return
        }
        if !requestedAuthorization {
            requestedAuthorization = true
            Task { await poster.requestAuthorization(); settings.systemDenied = await poster.isDenied() }
        }
        let plan = SessionAlerts.plan(previous: baseline, rows: rows, filter: settings.filter, onScreen: isLookingAtWindow ? onScreen : nil)
        baseline = SessionAlerts.dots(rows)
        plan.alerts.forEach(poster.post)
        if !plan.withdraw.isEmpty { poster.withdraw(plan.withdraw) }
        setBadge(settings.dockCount ? SessionAlerts.waitingCount(rows) : nil)
    }

    private func setBadge(_ count: Int?) {
        guard count != badge else { return }
        badge = count
        poster.setBadge(count)
    }

    private var isLookingAtWindow: Bool {
        #if os(macOS)
        NSApp.isActive && NSApp.occlusionState.contains(.visible)
        #else
        true
        #endif
    }

    private func refreshPermission() {
        guard settings.enabled else { return }
        Task { settings.systemDenied = await poster.isDenied() }
    }

    /// A click on a notification: show the window, then the session. A session that has since gone is ignored.
    public func open(sessionID: String) {
        #if os(macOS)
        NSApp.activate()
        // SwiftUI may suffix the scene id in the window's identifier, so match its start.
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true }) {
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
        #endif
        // A click that relaunches the app lands before the first list, so it waits for one.
        guard model.index != nil else { pendingOpen = sessionID; return }
        guard model.rows.contains(where: { $0.id == sessionID }) else { return }
        model.navigator.openSession(sessionID)
    }
}
