#if os(macOS)
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

/// The panel under the thread: the commands run for this chat as blocks with their output, and the line that runs the next one.
struct TerminalPanel: View {
    let chat: ChatContext
    private let store: TerminalStore
    @Environment(\.colorScheme) private var colorScheme
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var pinned = true
    @State private var dragStart: CGFloat?

    init(chat: ChatContext) {
        self.chat = chat
        store = chat.terminal
    }

    private var state: TerminalState { store.state }

    var body: some View {
        VStack(spacing: 0) {
            handle
            header
            Divider()
            runs
            if !state.error.isEmpty { errorLine }
            TerminalInput(chat: chat, store: store)
        }
        .containerRelativeFrame(.vertical) { length, _ in min(store.height, length * 0.55) }
        .background(.background)
        .overlay(alignment: .top) { Divider() }
        .task { store.start() }
        .onChange(of: state.announceCount) { AccessibilityNotification.Announcement(state.announce).post() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Terminal")
    }

    // MARK: Parts

    /// A strip along the top edge that resizes the panel.
    private var handle: some View {
        Color.clear.frame(height: 6)
            .contentShape(Rectangle())
            #if os(macOS)
            .pointerStyle(.rowResize)
            #endif
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { drag in
                    let start = dragStart ?? store.height
                    dragStart = start
                    store.height = min(max(start - drag.translation.height, 120), 800)
                }
                .onEnded { _ in dragStart = nil })
            .accessibilityHidden(true)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Label("Terminal", systemImage: "terminal").font(ChatStyle.small.weight(.medium)).labelStyle(.titleAndIcon)
            Text(TerminalRules.inHome(state.cwd, home: state.home))
                .font(ChatStyle.monoSmall).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                .help(state.cwd)
            Spacer(minLength: 8)
            Button("Clear") { Task { await store.clear() } }
                .buttonStyle(.borderless).font(ChatStyle.small)
                .disabled(state.runs.allSatisfy(\.running))
                .help("Clear finished commands")
            Button { chat.terminalOpen = false } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).help("Close the terminal").accessibilityLabel("Close terminal")
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
    }

    private var runs: some View {
        ScrollView {
            // Not lazy: a lazy stack estimates the rows it has not drawn from the ones it has, and a first run thousands of lines tall skews that estimate.
            VStack(spacing: 12) {
                ForEach(state.runs, id: \.key) { run in
                    TerminalRunBlock(run: run, home: state.home, store: store).equatable()
                }
            }
            .padding(12)
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
                    .font(ChatStyle.small).foregroundStyle(.secondary).multilineTextAlignment(.center)
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
                .buttonStyle(.borderless).help("Dismiss").accessibilityLabel("Dismiss")
        }
        .padding(.vertical, 6).padding(.leading, 12).padding(.trailing, 8)
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(AnsiStyler(colorScheme).danger.opacity(0.4)))
        .padding(.horizontal, 12).padding(.bottom, 6)
        .accessibilityElement(children: .combine)
    }
}

/// One command: what was run, its output and how it ended.
struct TerminalRunBlock: View, Equatable {
    let run: TerminalRun
    let home: String
    let store: TerminalStore
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rendered: AnsiOutput?
    @State private var lastDraw: ContinuousClock.Instant?
    @State private var drawnRevision = -1
    @State private var copied = false

    nonisolated static func == (a: TerminalRunBlock, b: TerminalRunBlock) -> Bool { a.run == b.run && a.home == b.home }

    private var live: Bool { run.running && !run.pending }
    private var state: TerminalRules.RunState { TerminalRules.runState(run) }

    var body: some View {
        let styler = AnsiStyler(colorScheme)
        VStack(alignment: .leading, spacing: 0) {
            head(styler)
            if !run.output.isEmpty {
                Divider()
                Group {
                    if let rendered { AnsiLines(output: rendered).textSelection(.enabled) } else { Text(" ").font(ChatStyle.terminal) }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.12))
            }
            Divider().opacity(run.output.isEmpty ? 1 : 0)
            foot(styler)
        }
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(state == .failed ? styler.danger.opacity(0.4) : Color.secondary.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Command \(run.command.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? "")")
        .task(id: run.revision) { await draw() }
    }

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
        HStack(alignment: .top, spacing: 8) {
            HStack(spacing: 5) {
                Text(TerminalRules.folderOf(run.cwd, home: home)).lineLimit(1).truncationMode(.tail).frame(maxWidth: 110, alignment: .leading)
                    .help(TerminalRules.inHome(run.cwd, home: home))
                Text(run.source == "bang" ? "!" : "$").accessibilityHidden(true)
            }
            .foregroundStyle(.secondary)
            Text(run.command).foregroundStyle(.primary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 2) {
                if live { tool("Stop command", "stop.fill") { Task { if let id = run.id { await store.stop(id) } } } }
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
        .font(Font.system(size: 13, design: .monospaced))
        .padding(.leading, 12).padding(.trailing, 4).padding(.vertical, 4)
    }

    private func tool(_ label: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 11)).frame(width: 22, height: 20) }
            .buttonStyle(.borderless).help(label).accessibilityLabel(label)
    }

    private func foot(_ styler: AnsiStyler) -> some View {
        HStack(spacing: 8) {
            if live { Lamp(color: styler.color(2), still: reduceMotion) }
            if live {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(TerminalRules.runStanding(run, now: context.date.timeIntervalSince1970 * 1000))
                }
            } else {
                Text(TerminalRules.runStanding(run, now: 0))
            }
            Spacer(minLength: 0)
        }
        .font(ChatStyle.small)
        .foregroundStyle(state == .failed ? AnyShapeStyle(styler.danger) : state == .running ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
        .padding(.horizontal, 12).padding(.vertical, 5)
    }
}

/// The small light beside a running command.
private struct Lamp: View {
    let color: Color
    let still: Bool
    @State private var dim = false

    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7)
            .opacity(dim ? 0.35 : 1)
            .animation(still ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = !still }
            .accessibilityHidden(true)
    }
}
#endif
