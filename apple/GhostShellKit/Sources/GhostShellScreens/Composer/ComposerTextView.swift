import GhostShellKit
import SwiftUI

#if os(macOS)
import AppKit

/// The message box. A SwiftUI text field cannot tell Enter from Shift+Enter, give the caret to the slash list, or take a pasted picture, so this is an
/// `NSTextView`. It grows with its text up to `maxHeight` and scrolls past that.
struct ComposerTextView: NSViewRepresentable {
    let model: ComposerModel
    /// Read here so SwiftUI draws this again when the text, a settled caret or a focus request changes.
    let text: String
    let settle: ComposerModel.Settle
    let focusRequests: Int
    let autofocus: Bool

    static let font = NSFont.systemFont(ofSize: 14)
    static let maxHeight: CGFloat = 220

    func makeCoordinator() -> Coordinator { Coordinator(model) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        let view = ComposerNSTextView(usingTextLayoutManager: false)
        view.delegate = context.coordinator
        view.drawsBackground = false
        view.isRichText = false
        view.importsGraphics = false
        view.allowsUndo = true
        view.font = Self.font
        view.textColor = .labelColor
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding = 0
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainer?.widthTracksTextView = true
        // The text is code and commands as often as prose, so it is not rewritten as it is typed.
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.setAccessibilityLabel("Message")
        view.string = text
        view.onFiles = { [weak model] in model?.attach(urls: $0) }
        view.onData = { [weak model] in model?.attach($0) }
        view.onFocus = { [weak model] in model?.focused = $0 }
        scroll.documentView = view
        if autofocus { DispatchQueue.main.async { view.window?.makeFirstResponder(view) } }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? ComposerNSTextView else { return }
        context.coordinator.model = model
        // Text typed through an input method is the box's until the method commits it.
        // `text` can be a keystroke behind the box, so the model's own value decides, or the box would drop what was typed since.
        let current = model.text
        if view.string != current, !view.hasMarkedText() {
            view.string = current
            view.setSelectedRange(NSRange(location: (current as NSString).length, length: 0))
        }
        if context.coordinator.settled != settle.serial {
            context.coordinator.settled = settle.serial
            view.setSelectedRange(NSRange(location: min(settle.at, (view.string as NSString).length), length: 0))
        }
        if context.coordinator.focusRequests != focusRequests {
            context.coordinator.focusRequests = focusRequests
            view.window?.makeFirstResponder(view)
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView scroll: NSScrollView, context: Context) -> CGSize? {
        guard let view = scroll.documentView as? NSTextView, let layout = view.layoutManager, let container = view.textContainer else { return nil }
        let width = proposal.width ?? 400
        container.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        let line = layout.defaultLineHeight(for: Self.font)
        return CGSize(width: width, height: min(max(ceil(layout.usedRect(for: container).height), ceil(line)), Self.maxHeight))
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var model: ComposerModel
        var focusRequests = 0
        var settled = 0

        init(_ model: ComposerModel) { self.model = model }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            model.text = view.string
            model.composing = view.hasMarkedText()
            track(view)
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            model.composing = view.hasMarkedText()
            track(view)
        }

        private func track(_ view: NSTextView) {
            let range = view.selectedRange()
            model.caret = range.length == 0 ? range.location : nil
        }

        // Enter sends and Shift+Enter is a new line. With the slash list open the arrows and Tab drive it, and Escape closes it or stops the chat.
        func textView(_ view: NSTextView, doCommandBy selector: Selector) -> Bool {
            if view.hasMarkedText() { return false }
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
                    view.insertText("\n", replacementRange: view.selectedRange())
                } else if !model.slashKey(.accept) {
                    Task { await model.send() }
                }
                return true
            case #selector(NSResponder.moveUp(_:)): return model.slashKey(.up)
            case #selector(NSResponder.moveDown(_:)): return model.slashKey(.down)
            case #selector(NSResponder.insertTab(_:)):
                if !model.slashKey(.accept) { view.window?.selectNextKeyView(nil) }
                return true
            case #selector(NSResponder.cancelOperation(_:)): return model.escape()
            default: return false
            }
        }
    }
}

/// An `NSTextView` that takes pictures and files from a paste or a drop as attachments, and everything else as plain text.
final class ComposerNSTextView: NSTextView {
    var onFiles: (([URL]) -> Void)?
    var onData: (([Incoming]) -> Void)?
    var onFocus: ((Bool) -> Void)?

    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok { onFocus?(true) }
        return ok
    }

    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        if ok { onFocus?(false) }
        return ok
    }

    private static func fileURLs(_ board: NSPasteboard) -> [URL] {
        board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    }

    /// A picture on the clipboard with no text beside it, such as a screenshot.
    private static func picture(_ board: NSPasteboard) -> Incoming? {
        guard board.string(forType: .string) == nil else { return nil }
        for (type, name) in [(NSPasteboard.PasteboardType.png, "Pasted image.png"), (.tiff, "Pasted image.tiff")] {
            if let data = board.data(forType: type) { return Incoming(name: name, data: data) }
        }
        return nil
    }

    override func paste(_ sender: Any?) {
        let board = NSPasteboard.general
        let urls = Self.fileURLs(board)
        if !urls.isEmpty { onFiles?(urls) } else if let image = Self.picture(board) { onData?([image]) } else { pasteAsPlainText(sender) }
    }

    // Paste is greyed out for a clipboard with only a picture on it unless the box says it can take one.
    override func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        if item.action == #selector(NSText.paste(_:)) {
            let board = NSPasteboard.general
            if !Self.fileURLs(board).isEmpty || Self.picture(board) != nil { return true }
        }
        return super.validateUserInterfaceItem(item)
    }

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        Self.fileURLs(sender.draggingPasteboard).isEmpty ? super.draggingEntered(sender) : .copy
    }

    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        Self.fileURLs(sender.draggingPasteboard).isEmpty ? super.draggingUpdated(sender) : .copy
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        let urls = Self.fileURLs(sender.draggingPasteboard)
        guard !urls.isEmpty else { return super.performDragOperation(sender) }
        onFiles?(urls)
        return true
    }
}
#else

/// On iPhone a plain growing field. Return makes a new line, because there is no Shift key to tell a send from one, and Send is the button beside it.
/// A paste of a picture is not caught here, so a photo comes in through the picker. The caret is taken to be at the end, which is where the slash list is typed.
struct ComposerTextView: View {
    let model: ComposerModel
    let text: String
    let settle: ComposerModel.Settle
    let focusRequests: Int
    /// Unused: the keyboard would cover the thread when a chat opens, so a phone's box takes focus only when tapped or asked.
    let autofocus: Bool
    @FocusState private var focus: Bool

    var body: some View {
        @Bindable var model = model
        // The empty title leaves the placeholder to ComposerView, which draws it for both platforms.
        TextField("", text: $model.text, axis: .vertical)
            .font(ChatStyle.body)
            .lineLimit(1...8)
            .focused($focus)
            .phoneFieldRow($focus)
            .autocorrectionDisabled(model.text.hasPrefix("/"))
            .accessibilityLabel("Message")
            .onChange(of: model.text, initial: true) { _, now in model.caret = now.utf16.count }
            .onChange(of: focus) { _, now in model.focused = now }
            .onChange(of: focusRequests) { focus = true }
    }
}
#endif
