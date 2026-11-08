import Foundation
import GhostShellKit
import Observation
import WebKit

/// What a widget asked for without a click of the owner's. Nothing happens until the owner presses the button.
struct WidgetRequest: Equatable {
    enum Kind: Equatable { case prompt, link }
    var kind: Kind
    /// The prompt's text, or the link's address.
    var text: String
    var host = ""
    var working = false
    var error = ""
}

/// One widget in one chat: its web view, what it measured, and what it has asked for. It stays alive while the chat is open, so a widget that scrolls out
/// of view and back is still running where it was.
@Observable @MainActor
final class WidgetController {
    static let failed = "That did not send. Try again, or cancel."

    let code: String
    let title: String
    let card: Bool
    let ratio: (width: Double, height: Double)?
    private(set) var height: Int?
    private(set) var tabbable = true
    private(set) var closed = false
    private(set) var request: WidgetRequest?

    @ObservationIgnored let webView: WidgetWebView
    @ObservationIgnored private let delegate = WidgetWebDelegate()
    @ObservationIgnored private var navigation = WidgetNavigation()
    @ObservationIgnored private var mode: WidgetMode
    @ObservationIgnored private var lastSent: Double?
    @ObservationIgnored private var lastOpened: Double?
    /// Nil once sent, or the words to show when it was not.
    @ObservationIgnored private let sendPrompt: @MainActor (String) async -> String?
    @ObservationIgnored private let loadIcons: @MainActor () async -> WidgetIcons.Loaded?

    init(code: String, title: String?, mode: WidgetMode, sendPrompt: @escaping @MainActor (String) async -> String?,
         loadIcons: @escaping @MainActor () async -> WidgetIcons.Loaded?) {
        self.code = code
        self.title = WidgetRules.humanTitle(title)
        self.card = WidgetRules.isCard(code)
        self.ratio = WidgetRules.viewBoxRatio(code)
        self.mode = mode
        self.sendPrompt = sendPrompt
        self.loadIcons = loadIcons
        webView = WidgetWebView(delegate: delegate)
        delegate.controller = self
        WidgetActivity.shared.watch()
        let document = WidgetFrame.document(code: code, mode: mode, card: card)
        webView.loadHTMLString(WidgetFrame.host(document: document, title: self.title), baseURL: nil)
    }

    var identity: Int { webView.claimID }

    func setMode(_ next: WidgetMode) {
        guard next != mode, !closed else { return }
        mode = next
        tell("mode", ["mode": next.rawValue])
    }

    func shutDown() { webView.shutDown() }

    // MARK: What the web view reports

    func didLoad() {
        guard !closed else { return }
        tell("mode", ["mode": mode.rawValue])
        guard code.contains("ti-") else { return }
        Task { [weak self] in
            guard let self, let icons = await loadIcons(), !closed else { return }
            tell("icons", ["font": icons.fontBase64, "glyphs": icons.glyphs])
        }
    }

    func judge(_ action: WKNavigationAction) -> WKNavigationActionPolicy {
        let frame = action.targetFrame
        switch navigation.decide(url: action.request.url, mainFrame: frame?.isMainFrame ?? false, inNewWindow: frame == nil) {
        case .allow: return .allow
        case .cancel: return .cancel
        case .close:
            close()
            return .cancel
        }
    }

    /// One message the bridge relayed, as JSON. Every field is checked here again, because the bridge only checks where it came from.
    func receive(_ json: String) {
        guard !closed, let data = json.data(using: .utf8), let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let kind = message["kind"] as? String else { return }
        switch kind {
        case "height":
            if let h = message["h"] as? NSNumber, !isBoolean(h), let px = WidgetRules.clampHeight(h.doubleValue), px != height { height = px }
        case "tabbable":
            if let yes = message["yes"] as? NSNumber, isBoolean(yes) { tabbable = yes.boolValue; webView.tabbable = yes.boolValue }
        case "prompt":
            if let text = message["text"] as? String { decide(prompt: text) }
        case "link":
            if let url = message["url"] as? String { follow(url) }
        default: break
        }
    }

    private func isBoolean(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

    // MARK: What the app decides

    private func decide(prompt text: String) {
        let now = WidgetActivity.now()
        let verdict = WidgetRules.promptGate(text: text, clickedHere: WidgetActivity.shared.clickedHere(identity, now: now), now: now,
                                             lastSent: lastSent, pending: request != nil)
        switch verdict {
        case .drop: break
        case .ask: request = WidgetRequest(kind: .prompt, text: text)
        case .send:
            lastSent = now
            Task { [weak self] in
                guard let self else { return }
                guard let problem = await sendPrompt(text) else { return }
                if request == nil { request = WidgetRequest(kind: .prompt, text: text, error: problem) }
            }
        }
    }

    private func follow(_ url: String) {
        guard let target = WidgetRules.linkTarget(url), let host = URL(string: target)?.host else { return }
        let now = WidgetActivity.now()
        switch WidgetRules.linkGate(clickedHere: WidgetActivity.shared.clickedHere(identity, now: now), now: now, lastOpened: lastOpened) {
        case .ask: if request == nil { request = WidgetRequest(kind: .link, text: target, host: host) }
        case .open:
            lastOpened = now
            open(target)
        }
    }

    private func open(_ target: String) {
        guard let url = URL(string: target) else { return }
        ChatLinks.openInBrowser(.web(url))
    }

    // MARK: The ask bar

    func confirm() {
        guard var asked = request, !asked.working else { return }
        if asked.kind == .link {
            WidgetActivity.shared.forget(identity)
            open(asked.text)
            request = nil
            return
        }
        WidgetActivity.shared.forget(identity)
        asked.working = true
        asked.error = ""
        request = asked
        Task { [weak self] in
            guard let self else { return }
            if let problem = await sendPrompt(asked.text) {
                asked.working = false
                asked.error = problem
                request = asked
            } else {
                lastSent = WidgetActivity.now()
                request = nil
            }
        }
    }

    func cancel() {
        WidgetActivity.shared.forget(identity)
        request = nil
    }

    // A frame that navigated itself anywhere is shut, as the web page does on its second load.
    private func close() {
        guard !closed else { return }
        closed = true
        request = nil
        shutDown()
    }

    private func tell(_ kind: String, _ fields: [String: Any]) {
        webView.callAsyncJavaScript("window.ghostshellTell && window.ghostshellTell(kind, fields)", arguments: ["kind": kind, "fields": fields],
                                    in: nil, in: WidgetBridge.world, completionHandler: nil)
    }
}
