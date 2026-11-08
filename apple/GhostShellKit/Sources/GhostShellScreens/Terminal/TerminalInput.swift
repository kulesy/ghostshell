import GhostShellKit
import SwiftUI

/// The line that runs the next command, or sends a line to the one that is running.
///
/// Return runs it and Shift+Return adds a line. Up and Down walk the commands run before, when no command is taking input and the caret is at an end.
/// Control+C stops the command or clears the box, Control+D ends the command's input, and Escape closes the panel.
struct TerminalInput: View {
    let chat: ChatContext
    let store: TerminalStore
    @FocusState private var focused: Bool
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

    private var state: TerminalState { store.state }
    /// The target at the moment of a key, which a redraw may not have caught up with.
    private var shown: (run: TerminalRun?, ended: Bool) { TerminalRules.inputTarget(runs: state.runs, pin: state.sendTo) }

    var body: some View {
        let target = shown
        let sending = target.run != nil || target.ended
        VStack(alignment: .leading, spacing: 4) {
            label(target)
            HStack(alignment: .bottom, spacing: 8) {
                Text(sending ? ">" : "$").font(ChatStyle.mono).foregroundStyle(.secondary).padding(.bottom, 1).accessibilityHidden(true)
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
                Button(action: submit) { Image(systemName: "play.fill").frame(width: 20, height: 20) }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .disabled(target.ended || (target.run == nil && state.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                    .help(sending ? "Send line" : "Run command")
                    .accessibilityLabel(sending ? "Send line" : "Run command")
            }
            Text(hint(target)).font(ChatStyle.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 8)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
        .onAppear { focused = true }
    }

    private func labelText(_ target: (run: TerminalRun?, ended: Bool)) -> String {
        if let run = target.run { return "Send to \(firstLine(run.command))" }
        return target.ended ? "That command has ended" : "Command in \(TerminalRules.inHome(state.cwd, home: state.home))"
    }

    private func label(_ target: (run: TerminalRun?, ended: Bool)) -> some View {
        Text(target.run.map { firstLine($0.command) } ?? (target.ended ? "That command has ended" : TerminalRules.inHome(state.cwd, home: state.home)))
            .font(ChatStyle.monoSmall).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            .accessibilityHidden(true)
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
            let run = shown.run
            if press.key == KeyEquivalent("c"), caret.empty {
                if let id = run?.id { Task { await store.stop(id) } } else { replaceInput("") }
                return .handled
            }
            if press.key == KeyEquivalent("d"), state.input.isEmpty, let id = run?.id {
                Task { await store.input(id, text: "", eof: true) }
                return .handled
            }
        }
        let target = shown
        guard target.run == nil, !target.ended, mods.isEmpty else { return .ignored }
        if press.key == .upArrow, caret.atStart, caret.empty { return recall(-1) }
        if press.key == .downArrow, caret.atEnd { return recall(1) }
        return .ignored
    }

    // A selection holds indices into the text it was made in. Writing new text under a held one makes SwiftUI trap in the text view, so it is dropped first.
    private func replaceInput(_ text: String, to pin: TerminalRules.InputPin? = nil) {
        selection = nil
        store.setInput(text, to: pin)
    }

    private func recall(_ direction: Int) -> KeyPress.Result {
        guard let next = TerminalRules.recall(list: TerminalRules.historyOf(state.runs), at: walk.at, draft: walk.draft, text: state.input, direction: direction) else { return .ignored }
        walk = Walk(at: next.at, draft: next.draft)
        replaceInput(next.text)
        return .handled
    }

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
