import GhostShellKit
import SwiftUI

/// The toolbar button that opens and closes the terminal panel. It shows only for a chat whose server has a terminal.
struct TerminalToggle: View {
    let chat: ChatContext

    var body: some View {
        if chat.terminalAvailable {
            Button { chat.terminalOpen.toggle() } label: {
                Label("Terminal", systemImage: chat.terminalOpen ? "terminal.fill" : "terminal")
            }
            .help(chat.terminalOpen ? "Close the terminal" : "Open the terminal")
            .accessibilityValue(chat.terminalOpen ? "Open" : "Closed")
        }
    }
}

/// The Run button in the head of a code block. It draws only for a block that is a command, and runs it in the terminal only when tapped.
struct TerminalRunButton: View {
    let block: ChatCodeBlock
    let chat: ChatContext

    var body: some View {
        if chat.terminalAvailable, let runnable = TerminalRules.runnableBlock(language: block.language, text: block.text) {
            Button("Run") { run(runnable.command) }
                .buttonStyle(.borderless).font(ChatStyle.caption).foregroundStyle(.secondary)
                .disabled(runnable.hidden)
                .help(runnable.hidden ? "This block holds hidden characters, so it cannot be run" : "Run in terminal")
                .accessibilityLabel(runnable.hidden ? "Run in terminal, unavailable because the block holds hidden characters" : "Run in terminal")
        }
    }

    private func run(_ command: String) {
        let terminal = chat.terminal
        terminal.start()
        chat.terminalOpen = true
        Task { if let problem = await terminal.run(command, source: .block) { terminal.report(problem) } }
    }
}
