import GhostShellKit
import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The web view a widget runs in. One per widget, with its own data store, so a widget shares no cookie or storage with another or with the app.
final class WidgetWebView: WKWebView {
    /// False once the frame says it holds nothing to focus, so Tab skips it.
    var tabbable = true
    /// Tells this widget apart in `WidgetClaim`. A counter, because a freed view's address can be reused by a new one.
    let claimID: Int
    @MainActor private static var made = 0

    @MainActor
    init(delegate: WidgetWebDelegate) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isElementFullscreenEnabled = false
        // NOTE: [8 Nov 2026] EK - The bridge and its handler live in a named world, so the widget's own page world never sees `window.webkit.messageHandlers`.
        // See https://github.com/kulesy/ghostshell/issues/90.
        let bridge = WKUserScript(source: WidgetBridge.source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: WidgetBridge.world)
        config.userContentController.addUserScript(bridge)
        config.userContentController.add(delegate, contentWorld: WidgetBridge.world, name: WidgetBridge.handlerName)
        Self.made += 1
        claimID = Self.made
        super.init(frame: .zero, configuration: config)
        navigationDelegate = delegate
        uiDelegate = delegate
        isInspectable = false
        allowsLinkPreview = false
        allowsBackForwardNavigationGestures = false
        #if os(macOS)
        allowsMagnification = false
        setValue(false, forKey: "drawsBackground")
        underPageBackgroundColor = .clear
        unregisterDraggedTypes()
        #else
        isOpaque = false
        backgroundColor = .clear
        scrollView.backgroundColor = .clear
        scrollView.isScrollEnabled = false
        #endif
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("WidgetWebView is made in code") }

    /// Stops the widget and lets go of the bridge, so nothing it started keeps running.
    @MainActor
    func shutDown() {
        navigationDelegate = nil
        uiDelegate = nil
        stopLoading()
        configuration.userContentController.removeAllUserScripts()
        configuration.userContentController.removeScriptMessageHandler(forName: WidgetBridge.handlerName, contentWorld: WidgetBridge.world)
        loadHTMLString("", baseURL: nil)
    }

    #if os(macOS)
    override var canBecomeKeyView: Bool { tabbable && super.canBecomeKeyView }

    // A dropped file must not load into the widget.
    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation { [] }
    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation { [] }
    override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool { false }
    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool { false }

    // Only the copy items stay, so a menu cannot open a page, a window or the inspector.
    private static let allowedMenuItems: Set<String> = ["WKMenuItemIdentifierCopy", "WKMenuItemIdentifierCopyLink", "WKMenuItemIdentifierCopyImage"]

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        for item in menu.items where !Self.allowedMenuItems.contains(item.identifier?.rawValue ?? "") { menu.removeItem(item) }
    }
    #endif
}

/// Hosts a widget's web view in SwiftUI. The controller owns the view, so a row that scrolls away and back finds the widget still running.
#if os(macOS)
struct WidgetWebHost: NSViewRepresentable {
    let view: WidgetWebView
    func makeNSView(context: Context) -> WidgetWebView { view }
    func updateNSView(_ nsView: WidgetWebView, context: Context) {}
}
#else
struct WidgetWebHost: UIViewRepresentable {
    let view: WidgetWebView
    func makeUIView(context: Context) -> WidgetWebView { view }
    func updateUIView(_ uiView: WidgetWebView, context: Context) {}
}
#endif

// MARK: The bridge

enum WidgetBridge {
    static let handlerName = "widget"
    @MainActor static let world = WKContentWorld.world(name: "ghostshell.widget")

    /// Relays what the widget's frame says, and nothing else, to the app, and relays the app's messages into the frame. It runs in its own world.
    /// A message counts only when its source is the one frame the host holds and it carries a string `capcom` field. The app checks every field again.
    static let source = #"""
    (() => {
      const handler = window.webkit.messageHandlers.widget;
      const frame = () => document.querySelector('iframe');
      const pick = {
        height: m => ({ h: m.h }),
        tabbable: m => ({ yes: m.yes }),
        prompt: m => ({ text: m.text }),
        link: m => ({ url: m.url }),
      };
      addEventListener('message', e => {
        const f = frame();
        const m = e.data;
        if (!f || e.source !== f.contentWindow || !m || typeof m !== 'object' || typeof m.capcom !== 'string') return;
        if (!Object.prototype.hasOwnProperty.call(pick, m.capcom)) return;
        try {
          handler.postMessage(JSON.stringify({ kind: m.capcom, ...pick[m.capcom](m) }));
        } catch (err) {}
      });
      window.ghostshellTell = (kind, fields) => {
        const f = frame();
        if (!f || !f.contentWindow) return;
        const message = { capcom: kind, ...fields };
        if (kind === 'icons') {
          const text = atob(fields.font);
          const bytes = new Uint8Array(text.length);
          for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
          message.font = bytes.buffer;
        }
        f.contentWindow.postMessage(message, '*');
      };
    })();
    """#
}

/// Answers for one widget's web view: what it may load, what it may ask the person for, and what it says through the bridge. It is the message
/// handler too, and holds its controller weakly, so the content controller never keeps the controller alive.
@MainActor
final class WidgetWebDelegate: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    weak var controller: WidgetController?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == WidgetBridge.handlerName, message.frameInfo.isMainFrame, let text = message.body as? String else { return }
        controller?.receive(text)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if navigationAction.shouldPerformDownload { return .cancel }
        guard let controller else { return .cancel }
        return controller.judge(navigationAction)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        navigationResponse.canShowMIMEType ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.cancel { _ in } }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.cancel { _ in } }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { controller?.didLoad() }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo,
                 type: WKMediaCaptureType) async -> WKPermissionDecision { .deny }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo) async -> WKPermissionDecision { .deny }
    // NOTE: [8 Nov 2026] EK - No open panel, alert, confirm or prompt handler on purpose. WebKit shows none without one, so a file input opens nothing.
}
