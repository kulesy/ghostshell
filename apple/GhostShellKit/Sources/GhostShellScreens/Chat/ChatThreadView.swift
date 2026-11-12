import GhostShellKit
import SwiftUI

private struct ScrollMetrics: Equatable, Sendable {
    var top: CGFloat = 0
    var gap: CGFloat = 0
    var content: CGFloat = 0
    var container: CGFloat = 0
}

/// The rows of a chat in a lazy stack, so a chat of thousands of items only builds what is in view. It follows the end while the reader is at the end,
/// and loads older items, keeping the row the reader was on, when they scroll near the top.
struct ChatThreadView: View {
    @Environment(ChatModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var pinned = true
    @State private var away = false
    @State private var visible: [String] = []
    /// The items of the row the reader was on, so the row can be found again by what it draws even if its id changed.
    @State private var anchorKeys: [String] = []
    @State private var restoring: Task<Void, Never>?

    private static let near: CGFloat = 40

    var body: some View {
        switch model.phase {
        case .loading:
            VStack(spacing: 10) {
                ProgressView()
                Text("Opening this chat").foregroundStyle(ChatStyle.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
        case .failed(let message):
            ContentUnavailableView {
                Label("Could not open this chat", systemImage: "exclamationmark.bubble")
            } description: {
                Text(verbatim: message)
            } actions: {
                Button("Try again") { Task { await model.retry() } }
            }
        case .loaded:
            if model.isEmpty && model.chat.sending.isEmpty && model.live.isEmpty && model.think == nil && model.turn == .none {
                ContentUnavailableView("Nothing here yet", systemImage: "bubble.left", description: Text("Messages show up here as the chat goes."))
            } else {
                thread
            }
        }
    }

    // The button sits in a strip below the scroll view, not over it, so it never covers a row's text.
    private var thread: some View {
        VStack(spacing: 0) {
            scroller
            if away {
                Button("Scroll to end", systemImage: "arrow.down") {
                    pinned = true
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) { position.scrollTo(edge: .bottom) }
                }
                .labelStyle(.iconOnly).buttonStyle(.bordered).buttonBorderShape(.circle).controlSize(.large)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .background { if ChatStyle.page { Color.ghost.background } }
                .help("Scroll to end")
            }
        }
    }

    private var scroller: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if model.hasEarlier {
                    Button(model.loadingEarlier ? "Loading earlier messages" : "Load earlier") { loadEarlier() }
                        .disabled(model.loadingEarlier)
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 16)
                }
                let rows = model.rows
                ForEach(Array(rows.enumerated()), id: \.element.id) { n, row in
                    ChatRowView(row: row, opened: model.opened, running: isRunning(row, last: n == rows.count - 1), fileLinks: model.chat.fileLinks,
                                connectors: model.chat.session.connectors, gapAbove: n == 0 ? 0 : (Self.toolish(rows[n - 1]) && Self.toolish(row) ? 2 : 20))
                        .equatable()
                }
                ForEach(model.chat.sending) { message in SendingBubble(message: message).padding(.top, 20) }
                LiveArea().padding(.top, 20)
            }
            .scrollTargetLayout()
            .frame(maxWidth: ChatStyle.column)
            .frame(maxWidth: .infinity)
            .padding(ChatStyle.threadInset)
            .chatText()
        }
        .scrollPosition($position)
        .scrollDismissesKeyboard(.interactively)
        .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.1) { visible = $0 }
        .onScrollGeometryChange(for: ScrollMetrics.self) { geometry in
            ScrollMetrics(top: geometry.visibleRect.minY, gap: geometry.contentSize.height - geometry.visibleRect.maxY,
                          content: geometry.contentSize.height, container: geometry.containerSize.height)
        } action: { old, new in
            let resized = new.content != old.content || new.container != old.container
            if resized {
                // A jump made while already at the end re-measures the lazy rows, which can resize the content again and never settle.
                if pinned, new.gap > 0.5 { position.scrollTo(edge: .bottom) }
            } else {
                pinned = new.gap <= Self.near
                away = new.gap > Self.near
                if !pinned, new.top < 400, model.hasEarlier, !model.loadingEarlier { loadEarlier() }
            }
        }
        .onChange(of: model.chat.scrollRequests) {
            pinned = true
            position.scrollTo(edge: .bottom)
        }
        .onChange(of: model.earlierCount) { restore() }
        .accessibilityLabel("Messages")
        .background { if ChatStyle.page { Color.ghost.background.ignoresSafeArea() } }
    }

    /// Puts the reader back on the row they were on. Rows not yet measured are sized by estimate, so one jump lands short and a few more settle it.
    private func restore() {
        guard let anchor = ChatRow.id(holding: anchorKeys, in: model.rows) else { return }
        restoring?.cancel()
        restoring = Task {
            // The list of rows in view follows the jump a moment later, so the first tries are not judged by it.
            for attempt in 0..<10 {
                position.scrollTo(id: anchor, anchor: .top)
                try? await Task.sleep(for: .milliseconds(120))
                let rows = model.rows
                guard !Task.isCancelled, let want = rows.firstIndex(where: { $0.id == anchor }),
                      let seen = rows.firstIndex(where: { visible.contains($0.id) }) else { return }
                if attempt >= 2, seen == want || seen == want - 1 { return }
            }
        }
    }

    private func loadEarlier() {
        guard !model.loadingEarlier else { return }
        // The row is picked once the page has arrived, because a jump to the top reports which rows are in view a moment after it lands.
        Task { await model.loadEarlier { anchorKeys = model.rows.first { visible.contains($0.id) }?.itemKeys ?? [] } }
    }

    /// The last group is the one still at work while a turn runs and no message waits to be sent.
    private func isRunning(_ row: ChatRow, last: Bool) -> Bool {
        guard last, case .group = row else { return false }
        return model.turn != .none && model.chat.sending.isEmpty
    }

    static func toolish(_ row: ChatRow) -> Bool {
        switch row {
        case .group: true
        case .item(let item):
            switch item.body {
            case .thinking, .tool: true
            default: false
            }
        }
    }
}
