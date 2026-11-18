import GhostShellKit
import SwiftUI

extension ChatContext {
    /// This chat's terminal, made on first use.
    var terminal: TerminalStore { store(TerminalStore.self) { TerminalStore(chat: self) } }
}

private struct ScrollMetrics: Equatable, Sendable {
    var gap: CGFloat = 0
    var content: CGFloat = 0
    var container: CGFloat = 0
}

/// The terminal: the commands run for this chat as blocks with their output, and the line that runs the next one. On the Mac it covers the chat pane.
struct TerminalPanel: View {
    let chat: ChatContext
    private let store: TerminalStore
    @Environment(\.colorScheme) private var colorScheme
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var pinned = true

    init(chat: ChatContext) {
        self.chat = chat
        store = chat.terminal
    }

    private var state: TerminalState { store.state }

    var body: some View {
        VStack(spacing: 0) {
            header
            #if os(iOS)
            Divider()
            #endif
            runs
            if !state.error.isEmpty { errorLine }
            TerminalInput(chat: chat, store: store)
        }
        #if os(iOS)
        .background(.background)
        #endif
        .task { store.start() }
        .onChange(of: state.announceCount) { AccessibilityNotification.Announcement(state.announce).post() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Terminal")
    }

    // MARK: Parts

    #if os(macOS)
    /// The page's panel head: the Terminal tab, then clear and close.
    private var header: some View {
        let rem = GhostMetrics.current.rem
        return HStack(spacing: 0.25 * rem) {
            HStack(spacing: 0.375 * rem) {
                Image(systemName: "terminal")
                Text("Terminal")
            }
            .font(.geist(0.875 * rem, weight: .medium)).foregroundStyle(Color.ghost.foreground)
            .padding(.horizontal, 0.625 * rem).frame(height: 2 * rem)
            .background(Color.ghost.muted, in: GhostCorner(GhostMetrics.current.md))
            Spacer(minLength: 0)
            headerButton("Clear finished commands", "trash") { Task { await store.clear() } }
                .disabled(state.runs.allSatisfy(\.running))
            headerButton("Close terminal", "xmark") { chat.terminalOpen = false }
        }
        .padding(EdgeInsets(top: 0.25 * rem, leading: 0.75 * rem, bottom: 0.25 * rem, trailing: 0.5 * rem))
        .frame(minHeight: 3.375 * rem)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.ghost.border).frame(height: 1) }
    }

    private func headerButton(_ label: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 2 * GhostMetrics.current.rem, height: 2 * GhostMetrics.current.rem).contentShape(Rectangle()) }
            .buttonStyle(.plain).foregroundStyle(Color.ghost.foreground).help(label).accessibilityLabel(label)
    }
    #else
    /// Narrow columns drop the title word and keep the icon. The path's ideal width is 0 so it truncates before either does.
    private var header: some View {
        ViewThatFits(in: .horizontal) {
            headerRow(Label("Terminal", systemImage: "terminal").labelStyle(.titleAndIcon))
            headerRow(Label("Terminal", systemImage: "terminal").labelStyle(.iconOnly))
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
    }
    #endif

    #if os(iOS)
    private func headerRow(_ title: some View) -> some View {
        HStack(spacing: 8) {
            title.font(ChatStyle.small.weight(.medium)).lineLimit(1).fixedSize()
            Text(TerminalRules.inHome(state.cwd, home: state.home))
                .font(ChatStyle.monoSmall).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                .frame(idealWidth: 0, maxWidth: .infinity, alignment: .leading)
                .help(state.cwd)
            Button("Clear") { Task { await store.clear() } }
                .buttonStyle(.borderless).font(ChatStyle.small).lineLimit(1).fixedSize()
                .phoneIconTouch()
                .disabled(state.runs.allSatisfy(\.running))
                .help("Clear finished commands")
        }
    }
    #endif

    private var runs: some View {
        ScrollView {
            // Not lazy: a lazy stack estimates the rows it has not drawn from the ones it has, and a first run thousands of lines tall skews that estimate.
            VStack(spacing: 0.75 * GhostMetrics.current.rem) {
                ForEach(state.runs, id: \.key) { run in
                    TerminalRunBlock(run: run, home: state.home, store: store).equatable()
                }
            }
            .padding(0.75 * GhostMetrics.current.rem)
        }
        .scrollPosition($position)
        .onScrollGeometryChange(for: ScrollMetrics.self) { geometry in
            ScrollMetrics(gap: geometry.contentSize.height - geometry.visibleRect.maxY, content: geometry.contentSize.height,
                          container: geometry.containerSize.height)
        } action: { old, new in
            if new.content != old.content || new.container != old.container {
                if pinned { position.scrollTo(edge: .bottom) }
            } else {
                pinned = new.gap <= 40
            }
        }
        .overlay {
            if state.runs.isEmpty {
                Text(state.ready ? "Commands start in \(TerminalRules.inHome(state.cwd, home: state.home)). Type one below, or press Run on a code block in the chat."
                     : "Connecting to the terminal")
                    .font(ChatStyle.small).foregroundStyle(ChatStyle.muted).multilineTextAlignment(.center)
                    .frame(maxWidth: 320).padding(12)
            }
        }
        .accessibilityLabel("Terminal output")
    }

    private var errorLine: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(state.error).font(ChatStyle.small).foregroundStyle(AnsiStyler(colorScheme).danger).textSelection(.enabled)
            Spacer(minLength: 0)
            Button { store.report("") } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).phoneIconTouch().help("Dismiss").accessibilityLabel("Dismiss")
        }
        .padding(.vertical, 6).padding(.leading, 12).padding(.trailing, 8)
        .overlay(GhostCorner(GhostMetrics.current.lg).strokeBorder(AnsiStyler(colorScheme).danger.opacity(0.4)))
        .padding(.horizontal, 0.75 * GhostMetrics.current.rem).padding(.bottom, 0.5 * GhostMetrics.current.rem)
        .accessibilityElement(children: .combine)
    }
}

/// One command: what was run, its output and how it ended.
struct TerminalRunBlock: View, Equatable {
    let run: TerminalRun
    let home: String
    let store: TerminalStore
    @Environment(\.colorScheme) private var colorScheme
    @State private var rendered: AnsiOutput?
    @State private var lastDraw: ContinuousClock.Instant?
    @State private var drawnRevision = -1
    @State private var copied = false

    nonisolated static func == (a: TerminalRunBlock, b: TerminalRunBlock) -> Bool { a.run == b.run && a.home == b.home }

    private var live: Bool { run.running && !run.pending }
    private var state: TerminalRules.RunState { TerminalRules.runState(run) }

    private let rem = GhostMetrics.current.rem

    var body: some View {
        let styler = AnsiStyler(colorScheme)
        let shape = GhostCorner(GhostMetrics.current.lg)
        VStack(alignment: .leading, spacing: 0) {
            head(styler)
            if !run.output.isEmpty {
                rule
                Group {
                    if let rendered { AnsiLines(output: rendered).textSelection(.enabled) } else { Text(" ").font(ChatStyle.terminal) }
                }
                .padding(.horizontal, 0.75 * rem).padding(.vertical, 0.5 * rem)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.ghost.muted)
            } else {
                rule
            }
            foot(styler)
        }
        .background(Color.ghost.card, in: shape)
        .clipShape(shape)
        .overlay(shape.strokeBorder(state == .failed ? styler.danger.opacity(0.4) : Color.ghost.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Command \(run.command.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? "")")
        .task(id: run.revision) { await draw() }
    }

    private var rule: some View { Rectangle().fill(Color.ghost.border).frame(height: 1) }

    /// Draws at most once every 100 ms, so output that never pauses cannot starve the main thread, and the last change always draws.
    private func draw() async {
        if let lastDraw {
            let wait = Duration.milliseconds(100) - lastDraw.duration(to: .now)
            if wait > .zero { try? await Task.sleep(for: wait) }
        }
        guard !Task.isCancelled else { return }
        lastDraw = .now
        let chunks = run.output
        let revision = run.revision
        let out = await Task.detached(priority: .userInitiated) { TerminalAnsi.render(chunks, maxLines: 2000) }.value
        if revision >= drawnRevision {
            drawnRevision = revision
            rendered = out
        }
    }

    private func head(_ styler: AnsiStyler) -> some View {
        HStack(alignment: .top, spacing: 0.5 * rem) {
            HStack(spacing: 0.375 * rem) {
                // The page caps the folder at 9rem and lets it shrink; a frame here would always fill the cap.
                Text(String(TerminalRules.folderOf(run.cwd, home: home).prefix(18))).lineLimit(1)
                    .help(TerminalRules.inHome(run.cwd, home: home))
                Text(run.source == "bang" ? "!" : "$").accessibilityHidden(true)
            }
            .foregroundStyle(Color.ghost.mutedForeground)
            Text(run.command).foregroundStyle(Color.ghost.foreground).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 0.125 * rem) {
                if live { tool("Stop command", "stop") { Task { if let id = run.id { await store.stop(id) } } } }
                if !run.output.isEmpty {
                    tool(copied ? "Output copied" : "Copy output", copied ? "checkmark" : "doc.on.doc") {
                        ChatLinks.copy(TerminalAnsi.plain(run.output))
                        copied = true
                        Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                    }
                }
                if !run.running {
                    tool("Run again", "arrow.counterclockwise") {
                        Task { if let problem = await store.run(run.command, source: .panel) { store.report(problem) } }
                    }
                }
            }
        }
        .font(.geistMono(0.8125 * rem))
        .padding(EdgeInsets(top: 0.25 * rem, leading: 0.75 * rem, bottom: 0.25 * rem, trailing: 0.25 * rem))
    }

    private func tool(_ label: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 0.8 * rem)).frame(width: 1.5 * rem, height: 1.5 * rem).contentShape(Rectangle()) }
            .buttonStyle(.plain).foregroundStyle(Color.ghost.foreground).phoneIconTouch().help(label).accessibilityLabel(label)
    }

    private func foot(_ styler: AnsiStyler) -> some View {
        HStack(spacing: 0.5 * rem) {
            if live { ChatLamp(state: "working").accessibilityHidden(true) }
            if live {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(TerminalRules.runStanding(run, now: context.date.timeIntervalSince1970 * 1000))
                }
            } else {
                Text(TerminalRules.runStanding(run, now: 0))
            }
            Spacer(minLength: 0)
        }
        .font(.geist(0.75 * rem))
        .foregroundStyle(state == .failed ? AnyShapeStyle(styler.danger) : state == .running ? AnyShapeStyle(Color.ghost.foreground) : ChatStyle.muted)
        .padding(.horizontal, 0.75 * rem).padding(.vertical, 0.3125 * rem)
    }
}
