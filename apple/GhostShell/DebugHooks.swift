#if DEBUG
import AppKit
import GhostShellKit
import GhostShellScreens
import WebKit

/// Hooks for the scripted test run, compiled into Debug builds only. A Release build has none of this, and `apple/scripts/build` checks that.
/// They are read from the launch arguments: -GSKeychainService, -GSAddress, -GSDefaultsSuite, -GSAppearance (light or dark), -GSShotDir,
/// -GSNotify (on turns notifications on in a test run, which otherwise starts with them off) and -GSAlertLog (a file that gets one line per alert).
enum DebugHooks {
    // A test run must never raise the system permission dialog, because System Events keystrokes are global and the dialog would take them.
    static var notificationsOnByDefault: Bool {
        let args = UserDefaults.standard
        return args.string(forKey: "GSDefaultsSuite") == nil || args.string(forKey: "GSNotify") == "on"
    }

    @MainActor static func alertPoster() -> AlertPoster? {
        UserDefaults.standard.string(forKey: "GSAlertLog").map { AlertLogPoster(file: URL(fileURLWithPath: $0)) }
    }

    @MainActor static func makeModel() -> AppModel {
        let args = UserDefaults.standard
        let store: TokenStore = args.string(forKey: "GSKeychainService").map { KeychainTokenStore(service: $0) } ?? KeychainTokenStore()
        let defaults = args.string(forKey: "GSDefaultsSuite").flatMap { UserDefaults(suiteName: $0) } ?? .standard
        switch args.string(forKey: "GSAppearance") {
        case "light": NSApplication.shared.appearance = NSAppearance(named: .aqua)
        case "dark": NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        default: break
        }
        // Only a real launch argument arms the watchers. `UserDefaults` also reads a stored `defaults write` value, which would arm the click hook in
        // every later Debug launch.
        let shotDir = ProcessInfo.processInfo.arguments.firstIndex(of: "-GSShotDir").flatMap { at in
            ProcessInfo.processInfo.arguments.dropFirst(at + 1).first
        }
        if let shotDir {
            ShotWatcher.start(folder: URL(fileURLWithPath: shotDir))
            ClickWatcher.start(folder: URL(fileURLWithPath: shotDir))
            // A regular test app is fronted by macOS when a sibling test app quits. An accessory app is not.
            NSApplication.shared.setActivationPolicy(.accessory)
        }
        let model = AppModel(store: store, defaults: defaults, address: args.string(forKey: "GSAddress"))
        model.ignoresOcclusion = shotDir != nil
        return model
    }
}

/// Writes one line per alert to a file, so a test can see what would have been shown without touching the notification centre.
@MainActor
final class AlertLogPoster: AlertPoster {
    var onOpen: ((String) -> Void)?
    private let file: URL

    init(file: URL) { self.file = file }

    func requestAuthorization() async { append("authorize") }
    func isDenied() async -> Bool { false }
    func post(_ alert: SessionAlert) { append("post \(alert.sessionID) \(alert.kind.rawValue) \(alert.title)") }
    func withdraw(_ sessionIDs: [String]) { sessionIDs.forEach { append("withdraw \($0)") } }
    func setBadge(_ count: Int?) { append("badge \(count.map(String.init) ?? "none")") }

    private func append(_ line: String) {
        guard let data = (line + "\n").data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: file)
        }
    }
}

/// Screen capture permission is off for the test run, so the window draws itself to a PNG.
/// A script writes `request.txt` holding `<number> <name>`. The app saves `<name>.png` and writes the number to `done.txt`.
@MainActor
enum ShotWatcher {
    private static var handled = ""
    private static var timer: Timer?

    static func start(folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
            MainActor.assumeIsolated { check(folder) }
        }
    }

    private static func check(_ folder: URL) {
        guard let request = try? String(contentsOf: folder.appendingPathComponent("request.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              request != handled else { return }
        let parts = request.split(separator: " ", maxSplits: 1).map(String.init)
        guard parts.count == 2, parts[1].allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) else { return }
        handled = request
        Task { @MainActor in
            let saved = await capture().flatMap { try? $0.write(to: folder.appendingPathComponent("\(parts[1]).png")) } != nil
            try? "\(parts[0]) \(saved ? "ok" : "failed")".write(to: folder.appendingPathComponent("done.txt"), atomically: true, encoding: .utf8)
        }
    }

    // The frame view above the content view includes the title bar and toolbar. An alert or a popover is a window of its own, so it is drawn over the main one.
    private static func capture() async -> Data? {
        let windows = NSApplication.shared.windows
        // The frontmost window first, so the settings shots capture Settings rather than the main window behind it. The app is never active, so there is no key window to go by.
        guard let main = NSApplication.shared.orderedWindows.first(where: { $0.isVisible && $0.canBecomeMain }) else { return nil }
        let over = windows.filter { $0 !== main && $0.isVisible && !$0.canBecomeMain && $0.frame.width > 1 && $0.frame.intersects(main.frame) }
        let canvas = over.reduce(main.frame) { $0.union($1.frame) }
        var drawn: [(NSImage, NSRect)] = []
        for window in [main] + over {
            guard let view = window.contentView?.superview, let picture = await picture(of: view) else { continue }
            drawn.append((picture, NSRect(x: window.frame.minX - canvas.minX, y: window.frame.minY - canvas.minY, width: window.frame.width, height: window.frame.height)))
        }
        let image = NSImage(size: canvas.size)
        image.lockFocus()
        for (picture, rect) in drawn { picture.draw(in: rect) }
        image.unlockFocus()
        return image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0) }?.representation(using: .png, properties: [:])
    }

    // NOTE: [8 Nov 2026] EK - cacheDisplay draws a web view blank, so each one is snapshotted by WebKit and laid over the picture.
    private static func picture(of view: NSView) async -> NSImage? {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        var pieces: [(NSImage, NSRect)] = []
        for web in webViews(in: view) where !web.isHiddenOrHasHiddenAncestor && web.window != nil {
            // Only the part in view, so a partly scrolled widget does not draw over the toolbar or composer.
            let visible = web.visibleRect
            guard !visible.isEmpty else { continue }
            let config = WKSnapshotConfiguration()
            config.rect = visible
            if let image = try? await web.takeSnapshot(configuration: config) { pieces.append((image, web.convert(visible, to: view))) }
        }
        let picture = NSImage(size: view.bounds.size)
        picture.lockFocus()
        rep.draw(in: NSRect(origin: .zero, size: view.bounds.size))
        for (image, rect) in pieces { image.draw(in: rect) }
        picture.unlockFocus()
        return picture
    }

    private static func webViews(in view: NSView) -> [WKWebView] {
        if let web = view as? WKWebView { return [web] }
        return view.subviews.flatMap { webViews(in: $0) }
    }
}

/// A script writes `click.txt` holding `<number> <x> <y>`, a point in screen coordinates as accessibility reports it. The app sends a left mouse
/// down and up there in its main window and writes the number to `clicked.txt`.
// NOTE: [8 Nov 2026] EK - A widget only counts an owner's click, and an accessibility press is not one, so this sends real mouse events to the app's
// own window. It is started only with -GSShotDir and only under #if DEBUG, so a Release build cannot be made to fake a click.
// See https://github.com/kulesy/ghostshell/issues/90.
@MainActor
enum ClickWatcher {
    private static var handled = ""
    private static var timer: Timer?

    static func start(folder: URL) {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            MainActor.assumeIsolated { check(folder) }
        }
    }

    private static func check(_ folder: URL) {
        guard let request = try? String(contentsOf: folder.appendingPathComponent("click.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              request != handled else { return }
        handled = request
        let parts = request.split(separator: " ").map(String.init)
        guard parts.count == 3, let x = Double(parts[1]), let y = Double(parts[2]) else { return }
        let sent = click(atScreenPoint: CGPoint(x: x, y: y))
        try? "\(parts[0]) \(sent ? "ok" : "failed")".write(to: folder.appendingPathComponent("clicked.txt"), atomically: true, encoding: .utf8)
    }

    // Accessibility measures from the top left of the first screen, and a window from the bottom left.
    // NOTE: [8 Nov 2026] EK - The app is never active, and an inactive window swallows a click that is sent to it. So the event goes through
    // NSApplication.sendEvent, which is where the widget's click monitor sees it, and then straight to the view under the point.
    private static func click(atScreenPoint point: CGPoint) -> Bool {
        guard let window = NSApplication.shared.windows.first(where: { $0.isVisible && $0.canBecomeMain }),
              let screen = NSScreen.screens.first, let root = window.contentView else { return false }
        let inWindow = window.convertPoint(fromScreen: NSPoint(x: point.x, y: screen.frame.height - point.y))
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: inWindow, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                 windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0),
                  let view = root.hitTest(root.superview?.convert(inWindow, from: nil) ?? inWindow) else { return false }
            NSApplication.shared.sendEvent(event)
            if type == .leftMouseDown { view.mouseDown(with: event) } else { view.mouseUp(with: event) }
        }
        return true
    }
}
#endif
