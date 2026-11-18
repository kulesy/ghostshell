import GhostShellKit
import SwiftUI

/// The button that opens and closes the terminal panel. The Mac chat's head shows it only in a chat that has a terminal, as a bare `>_` like the page's.
/// A phone's toolbar always has it and turns it off for a chat whose server has no terminal, because UIKit does not take a toolbar item added to a window that is showing.
struct TerminalToggle: View {
    let chat: ChatContext

    var body: some View {
        #if os(macOS)
        if chat.terminalAvailable {
            Button { chat.terminalOpen.toggle() } label: {
                Text(verbatim: ">_").font(.geistMono(GhostMetrics.current.rem, weight: .medium))
            }
            .buttonStyle(.ghost(.ghost, size: .icon))
            .help(chat.terminalOpen ? "Close the terminal" : "Open the terminal")
            .accessibilityLabel("Terminal")
            .accessibilityValue(chat.terminalOpen ? "Open" : "Closed")
        }
        #else
        Button { chat.terminalOpen.toggle() } label: {
            Label("Terminal", systemImage: chat.terminalOpen ? "terminal.fill" : "terminal")
        }
        .disabled(!chat.terminalAvailable)
        .help(!chat.terminalAvailable ? "This chat has no terminal" : chat.terminalOpen ? "Close the terminal" : "Open the terminal")
        .accessibilityValue(chat.terminalOpen ? "Open" : "Closed")
        #endif
    }
}

/// The Run button in the head of a code block. It draws only for a block that is a command, and runs it in the terminal only when tapped.
struct TerminalRunButton: View {
    let block: ChatCodeBlock
    let chat: ChatContext

    var body: some View {
        if chat.terminalAvailable, let runnable = TerminalRules.runnableBlock(language: block.language, text: block.text) {
            Button("Run") { run() }
                .buttonStyle(.borderless).font(ChatStyle.caption).foregroundStyle(runnable.hidden ? .tertiary : .secondary)
                .phoneIconTouch()
                .disabled(runnable.hidden)
                .help(runnable.hidden ? "This block holds hidden characters, so it cannot be run" : "Run in terminal")
                .accessibilityLabel(runnable.hidden ? "Run in terminal, unavailable because the block holds hidden characters" : "Run in terminal")
        }
    }

    // The block and the terminal are checked again at the tap, as the page does, and a command holding characters the owner cannot see is refused here as well.
    private func run() {
        guard chat.terminalAvailable, let runnable = TerminalRules.runnableBlock(language: block.language, text: block.text) else { return }
        let terminal = chat.terminal
        terminal.start()
        chat.terminalOpen = true
        if runnable.hidden {
            terminal.report("That command holds characters you cannot see, so it was not run.")
            return
        }
        Task { if let problem = await terminal.run(runnable.command, source: .block) { terminal.report(problem) } }
    }
}
