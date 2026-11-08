import Foundation
import GhostShellKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Which widget, if any, the owner last clicked or typed in. The system reports the click, so a widget cannot claim one, which is what the web page
/// cannot tell and has to ask each frame about. The decisions are in `WidgetClaim`.
@MainActor
final class WidgetActivity {
    static let shared = WidgetActivity()

    private var claim = WidgetClaim()
    private var watching = false
    #if os(macOS)
    private var monitor: Any?
    #endif

    /// Milliseconds on the clock the whole widget layer shares.
    static func now() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }

    /// The widget with this id was the last thing the owner used, and did so within `activeMs`.
    func clickedHere(_ widget: Int, now: Double = WidgetActivity.now()) -> Bool { claim.isActive(widget, at: now) }

    /// Ends this widget's claim, so an earlier click cannot back a request made after the owner answered an ask.
    func forget(_ widget: Int) { claim.forget(widget) }

    /// Starts listening, once. Every widget calls this when it is made.
    func watch() {
        guard !watching else { return }
        watching = true
        #if os(macOS)
        let kinds: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]
        // NOTE: [8 Nov 2026] EK - A local monitor sees the event before the window sends it on, so the owner is noted before the widget's own
        // handler can run and ask for anything. See https://github.com/kulesy/ghostshell/issues/90.
        monitor = NSEvent.addLocalMonitorForEvents(matching: kinds) { [weak self] event in
            MainActor.assumeIsolated { self?.note(event) }
            return event
        }
        #else
        WidgetTouchWatch.install { [weak self] widget in self?.claim.click(widget, at: Self.now()) }
        #endif
    }

    #if os(macOS)
    private func note(_ event: NSEvent) {
        let widget = Self.widget(for: event)
        guard event.type == .keyDown else { return claim.click(widget, at: Self.now()) }
        let flags = event.modifierFlags
        claim.key(widget, escape: event.keyCode == 53, command: flags.contains(.command), control: flags.contains(.control), at: Self.now())
    }

    private static func widget(for event: NSEvent) -> Int? {
        guard let window = event.window else { return nil }
        var view: NSView?
        if event.type == .keyDown {
            view = window.firstResponder as? NSView
        } else if let root = window.contentView {
            view = root.hitTest(root.superview?.convert(event.locationInWindow, from: nil) ?? event.locationInWindow)
        }
        while let current = view {
            if let web = current as? WidgetWebView { return web.claimID }
            view = current.superview
        }
        return nil
    }
    #endif
}

#if os(iOS)
/// A tap recogniser on the window that sees every tap beside the views' own recognisers and works out which widget, if any, it landed in.
@MainActor
private final class WidgetTouchWatch: NSObject, UIGestureRecognizerDelegate {
    static let shared = WidgetTouchWatch()
    private var report: ((Int?) -> Void)?
    private var seen = Set<ObjectIdentifier>()

    static func install(_ report: @escaping (Int?) -> Void) {
        shared.report = report
        shared.attach()
        NotificationCenter.default.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { shared.attach() }
        }
    }

    private func attach() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windows = (scene as? UIWindowScene)?.windows else { continue }
            for window in windows where seen.insert(ObjectIdentifier(window)).inserted {
                let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
                tap.cancelsTouchesInView = false
                tap.delaysTouchesBegan = false
                tap.delaysTouchesEnded = false
                tap.delegate = self
                window.addGestureRecognizer(tap)
            }
        }
    }

    @objc private func tapped(_ tap: UITapGestureRecognizer) {
        guard let window = tap.view as? UIWindow else { return }
        var view = window.hitTest(tap.location(in: window), with: nil)
        while let current = view {
            if let web = current as? WidgetWebView { return report?(web.claimID) ?? () }
            view = current.superview
        }
        report?(nil)
    }

    nonisolated func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
#endif
