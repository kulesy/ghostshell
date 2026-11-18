import GhostShellKit
import SwiftUI

/// The line that runs the next command, or sends a line to the one that is running.
///
/// Return runs it and Shift+Return adds a line. Up and Down walk the commands run before, when no command is taking input and the caret is at an end.
/// Control+C stops the command or clears the box, Control+D ends the command's input, and Escape closes the panel.
/// A phone has no such keys, so a row of buttons above the box does what Control+C, Control+D, Tab, Up and Down do, through the same functions.
struct TerminalInput: View {
    let chat: ChatContext
    let store: TerminalStore
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme
    @State private var selection: TextSelection?
    @State private var walk = Walk()

    /// Where the Up and Down keys are in the commands run before, and what was being typed when they started.
    private struct Walk { var at: Int?; var draft = "" }

    /// A hardware keyboard sends Return as a key. A touch screen's Return adds a line, so only the button runs it.
    private static let returnRuns: Bool = {
        #if os(macOS)
        true
        #else
        false
        #endif
    }()

    /// The 44pt rows of a phone have their one line in the middle, where the Mac's box grows upward from the bottom.
    private static let rowAlignment: VerticalAlignment = {
        #if os(macOS)
        .bottom
        #else
        .center
        #endif
    }()

    #if os(iOS)
    /// A thumb's 44pt comes from the frame around the button, so the button itself stays the size of the Mac's.
    private static let runSize = ControlSize.regular
    #endif

    private var state: TerminalState { store.state }
    /// The target at the moment of a key, which a redraw may not have caught up with.
    private var shown: (run: TerminalRun?, ended: Bool) { TerminalRules.inputTarget(runs: state.runs, pin: state.sendTo) }

    var body: some View {
        let target = shown
        let sending = target.run != nil || target.ended
        VStack(alignment: .leading, spacing: Self.gap) {
            label(target)
            #if os(iOS)
            keyRow(target)
            #endif
            fieldBox(target, sending: sending)
            Text(hint(target)).font(ChatStyle.caption).foregroundStyle(ChatStyle.muted)
        }
        .padding(Self.inset)
        .background(Self.ground)
        .overlay(alignment: .top) { Rectangle().fill(Color.ghost.border).frame(height: 1) }
        #if os(macOS)
        .onAppear { focused = true }
        #endif
    }

    #if os(macOS)
    private static let gap = 0.25 * GhostMetrics.current.rem
    private static let inset = EdgeInsets(top: 0.5 * GhostMetrics.current.rem, leading: 0.75 * GhostMetrics.current.rem, bottom: 0.75 * GhostMetrics.current.rem, trailing: 0.75 * GhostMetrics.current.rem)
    private static let ground = AnyShapeStyle(Color.ghost.background)
    #else
    private static let gap: CGFloat = 4
    private static let inset = EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
    private static let ground = AnyShapeStyle(.bar)
    #endif

    private func fieldBox(_ target: (run: TerminalRun?, ended: Bool), sending: Bool) -> some View {
        HStack(alignment: Self.rowAlignment, spacing: 8) {
            Text(sending ? ">" : "$").font(ChatStyle.mono).foregroundStyle(ChatStyle.muted).padding(.bottom, 1).accessibilityHidden(true)
            TextField(target.run != nil ? "Send a line to the running command" : "Run a command", text: Binding(get: { state.input }, set: { store.setInput($0) }),
                      selection: $selection, axis: .vertical)
                .textFieldStyle(.plain)
                .font(ChatStyle.mono)
                .lineLimit(1...8)
                .focused($focused)
                .autocorrectionDisabled()
                #if !os(macOS)
                .textInputAutocapitalization(.never)
                #endif
                .onKeyPress(phases: .down) { press in keyPressed(press) }
                .accessibilityLabel(labelText(target))
            runButton(target, sending: sending)
        }
        .phoneFieldRow($focused)
        #if os(macOS)
        .padding(EdgeInsets(top: 0.25 * GhostMetrics.current.rem, leading: 0.75 * GhostMetrics.current.rem, bottom: 0.25 * GhostMetrics.current.rem, trailing: 0.25 * GhostMetrics.current.rem))
        .background(scheme == .dark ? Color.ghost.input.opacity(0.3) : .clear, in: GhostCorner(GhostMetrics.current.lg))
        .overlay(GhostCorner(GhostMetrics.current.lg).strokeBorder(focused ? Color.ghost.ring : Color.ghost.input))
        .overlay { if focused { GhostCorner(GhostMetrics.current.lg).inset(by: -1.5).stroke(Color.ghost.ring.opacity(0.5), lineWidth: 3) } }
        #endif
    }

    private func runButton(_ target: (run: TerminalRun?, ended: Bool), sending: Bool) -> some View {
        Button(action: submit) {
            #if os(macOS)
            Image(systemName: "play")
            #else
            Image(systemName: "play.fill").frame(width: 20, height: 20)
            #endif
        }
        #if os(macOS)
        .buttonStyle(.ghost(.primary, size: .icon))
        #else
        .buttonStyle(.borderedProminent).controlSize(Self.runSize).phoneIconTouch()
        #endif
        .disabled(target.ended || (target.run == nil && state.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
        .help(sending ? "Send line" : "Run command")
        .accessibilityLabel(sending ? "Send line" : "Run command")
    }

    private func labelText(_ target: (run: TerminalRun?, ended: Bool)) -> String {
        if let run = target.run { return "Send to \(firstLine(run.command))" }
        return target.ended ? "That command has ended" : "Command in \(TerminalRules.inHome(state.cwd, home: state.home))"
    }

    // A running command's Stop is also here, because its own block may be scrolled out of the panel.
    private func label(_ target: (run: TerminalRun?, ended: Bool)) -> some View {
        HStack(spacing: 8) {
            Text(target.run.map { firstLine($0.command) } ?? (target.ended ? "That command has ended" : TerminalRules.inHome(state.cwd, home: state.home)))
                .font(ChatStyle.monoSmall).foregroundStyle(ChatStyle.muted).lineLimit(1).truncationMode(.middle)
                .accessibilityHidden(true)
            Spacer(minLength: 0)
            if let run = target.run, run.running, !run.pending, let id = run.id {
                Button("Stop") { Task { await store.stop(id) } }
                    .buttonStyle(.borderless).font(ChatStyle.caption).phoneIconTouch().help("Stop the command")
                    .accessibilityLabel("Stop command")
            }
        }
    }

    private func hint(_ target: (run: TerminalRun?, ended: Bool)) -> String {
        if target.run != nil { return "Ctrl+C stops it. Ctrl+D ends its input." }
        if target.ended { return "Ctrl+C clears the box." }
        return Self.returnRuns ? "Enter runs. Shift+Enter adds a line." : "Enter adds a line. The button runs it."
    }

    private func firstLine(_ command: String) -> String { command.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? "" }

    // MARK: Keys

    private var caret: (atStart: Bool, atEnd: Bool, empty: Bool) {
        let text = state.input
        guard let selection, case .selection(let range) = selection.indices else { return (text.isEmpty, text.isEmpty, true) }
        return (range.isEmpty && range.lowerBound == text.startIndex, range.upperBound == text.endIndex, range.isEmpty)
    }

    private func keyPressed(_ press: KeyPress) -> KeyPress.Result {
        let mods = press.modifiers
        if press.key == .return, Self.returnRuns, !mods.contains(.shift) {
            submit()
            return .handled
        }
        if press.key == .escape {
            chat.terminalOpen = false
            return .handled
        }
        if mods == .control {
            if press.key == KeyEquivalent("c"), caret.empty {
                interrupt()
                return .handled
            }
            if press.key == KeyEquivalent("d"), canEndInput {
                endInput()
                return .handled
            }
        }
        let target = shown
        guard target.run == nil, !target.ended, mods.isEmpty else { return .ignored }
        if press.key == .upArrow, caret.atStart, caret.empty { return recall(-1) }
        if press.key == .downArrow, caret.atEnd { return recall(1) }
        return .ignored
    }

    private func interrupt() {
        if let id = shown.run?.id { Task { await store.stop(id) } } else { replaceInput("") }
    }

    private var canEndInput: Bool { state.input.isEmpty && shown.run?.id != nil }

    private func endInput() {
        guard canEndInput, let id = shown.run?.id else { return }
        Task { await store.input(id, text: "", eof: true) }
    }

    // A selection holds indices into the text it was made in. Writing new text under a held one makes SwiftUI trap in the text view, so it is dropped first.
    private func replaceInput(_ text: String, to pin: TerminalRules.InputPin? = nil) {
        selection = nil
        store.setInput(text, to: pin)
    }

    private var canRecall: Bool { shown.run == nil && !shown.ended }

    private func recall(_ direction: Int) -> KeyPress.Result {
        guard let next = TerminalRules.recall(list: TerminalRules.historyOf(state.runs), at: walk.at, draft: walk.draft, text: state.input, direction: direction) else { return .ignored }
        walk = Walk(at: next.at, draft: next.draft)
        replaceInput(next.text)
        return .handled
    }

    #if os(iOS)
    // The box's text is replaced whole, with the held selection dropped first, so the caret ends up at the end.
    private func insertTab() {
        var text = state.input
        if let selection, case .selection(let range) = selection.indices { text.replaceSubrange(range, with: "\t") } else { text += "\t" }
        replaceInput(text)
    }

    private func keyRow(_ target: (run: TerminalRun?, ended: Bool)) -> some View {
        HStack(spacing: 4) {
            key("Ctrl+C", hint: target.run != nil ? "Stops the running command" : "Clears the box") { interrupt() }
            key("Ctrl+D", hint: "Ends the running command's input") { endInput() }.disabled(!canEndInput)
            key("Tab", hint: "Inserts a tab") { insertTab() }.disabled(target.ended)
            Spacer(minLength: 0)
            key(label: "Previous command", symbol: "chevron.up") { _ = recall(-1) }.disabled(!canRecall)
            key(label: "Next command", symbol: "chevron.down") { _ = recall(1) }.disabled(!canRecall)
        }
    }

    private func key(_ title: String, hint: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(ChatStyle.monoSmall).padding(.horizontal, 6).modifier(KeyCap()) }
            .buttonStyle(.plain).accessibilityLabel(title).accessibilityHint(hint)
    }

    private func key(label: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).modifier(KeyCap()) }
            .buttonStyle(.plain).accessibilityLabel(label)
    }
    #endif

    private func submit() {
        let text = state.input
        let target = shown
        if target.ended {
            store.report("That command has ended, so nothing was sent. Clear the box to run a command.")
            return
        }
        walk = Walk()
        if let id = target.run?.id {
            replaceInput("")
            Task { await store.input(id, text: text + "\n") }
            return
        }
        let command = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else { return }
        replaceInput("")
        Task {
            guard let problem = await store.run(command, source: .panel) else { return }
            store.report(problem)
            if store.state.input.isEmpty { replaceInput(text, to: TerminalRules.InputPin(run: nil)) }
        }
    }
}

#if os(iOS)
/// A key of the phone's key row: 44pt for a thumb, dimmed with the button when it is off.
private struct KeyCap: ViewModifier {
    @Environment(\.isEnabled) private var enabled

    func body(content: Content) -> some View {
        content
            .foregroundStyle(enabled ? Color.primary : Color.secondary.opacity(0.5))
            .phoneIconTouch()
            .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    }
}
#endif
