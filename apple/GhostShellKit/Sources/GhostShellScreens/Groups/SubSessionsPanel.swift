import GhostShellKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// The Sub sessions panel: a summary line, then the group's sessions as cards in the parts Waiting on you, Working, Recent activity and Idle.
struct SubSessionsPanel: View {
    @Environment(AppModel.self) private var app
    let target: GroupTarget
    let chat: String
    let cards: GroupCards
    @State private var now = Date()

    var body: some View {
        if let index = app.index {
            let all = index.rows
            let scope = GroupRules.scope(index, chat: chat)
            let needs = cards.needs(in: scope)
            let rows = needs.isEmpty ? all : all.map { GroupRules.withPulls($0, needs) }
            let lines = GroupRules.lines(index, target, now: now, needs: needs)
            let parts = GroupRules.parts(lines, now: now)
            let drawn = GroupBucket.shown.flatMap { GroupRules.drawn(parts[$0] ?? [], open: cards.opened) }
            let summary = GroupRules.summaryLine(index, chat: chat, now: now, needs: needs)
            let key = drawn.map { "\($0.id)\(GroupRules.stamp($0))" }.joined(separator: ",") + "|" + scope.map { "\($0.id)\(GroupRules.stamp($0))" }.joined(separator: ",")
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if !summary.isEmpty { Words(text: summary).font(.callout).foregroundStyle(.secondary) }
                        ForEach(GroupBucket.shown, id: \.self) { bucket in
                            if let part = parts[bucket], !part.isEmpty { PartView(bucket: bucket, lines: part, rows: rows, now: now) }
                        }
                        if lines.isEmpty { Text(GroupRules.emptyNote(target)).font(.callout).foregroundStyle(.secondary) }
                        if cards.failed { Text("Could not read what these sessions last said.").font(.callout).foregroundStyle(.secondary) }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                #if os(iOS)
                .modifier(ReplyButtonsInView(cards: cards, proxy: proxy))
                #endif
                }
                if let toast = cards.toast { ToastBar(toast: toast, dismiss: { cards.toast = nil }) }
            }
            .environment(cards)
            .background(.background, ignoresSafeAreaEdges: [])
            .clipped()
            // Looks when the cards change and every 20 seconds, because pull request answers go stale after a minute. A hidden app does not ask.
            .task(id: "\(key)|\(app.visible)") {
                while true {
                    if app.visible { await cards.refresh(index, chat: chat, drawn: drawn) }
                    guard await pause(20) else { return }
                    now = Date()
                }
            }
            .confirmationDialog(cards.stopQuestion.map { "Stop and archive \u{201C}\($0.title)\u{201D}?" } ?? "", isPresented: stopping, presenting: cards.stopQuestion) { question in
                Button("Stop and archive", role: .destructive) { Task { await cards.confirmStop(question) } }
                Button("Cancel", role: .cancel) {}
            } message: { Text($0.detail) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Sub sessions")
        }
    }

    private var stopping: Binding<Bool> {
        Binding(get: { cards.stopQuestion != nil }, set: { if !$0 { cards.stopQuestion = nil } })
    }
}

#if os(iOS)
/// Scrolls the focused reply box's Send and Cancel above the keyboard, which covers them otherwise. The row also moves when the keyboard comes up and when "Not sent" appears above it.
private struct ReplyButtonsInView: ViewModifier {
    let cards: GroupCards
    let proxy: ScrollViewProxy

    func body(content: Content) -> some View {
        let problem = cards.focusing.map { cards.box($0).problem } ?? ""
        content
            .onChange(of: cards.focusing) { reveal() }
            .onChange(of: problem) { reveal() }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in reveal() }
    }

    private func reveal() {
        guard let id = cards.focusing else { return }
        withAnimation { proxy.scrollTo(GroupReplyBox.buttonsID(id), anchor: .bottom) }
    }
}
#endif

private struct PartView: View {
    let bucket: GroupBucket
    let lines: [SubLine]
    let rows: [SessionRow]
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(bucket.label) (\(lines.count))").font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.6).foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            ForEach(lines) { line in SubSessionCard(node: line, rows: rows, now: now) }
        }
    }
}

/// A line that says what just happened, with Undo after an archive.
private struct ToastBar: View {
    let toast: GroupToast
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(toast.text).font(.callout).foregroundStyle(toast.problem ? Color.red : .primary).lineLimit(2)
            Spacer(minLength: 4)
            if let undo = toast.undo { Button(toast.problem ? "Retry" : "Undo") { dismiss(); undo() }.linkStyle() }
            Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
        .accessibilityElement(children: .contain)
    }
}

/// A text with the words "waiting on you" in the warning color, as the page colors them.
struct Words: View {
    let text: String

    var body: some View {
        let parts = GroupRules.splitWaiting(text)
        if parts.words.isEmpty { Text(verbatim: text) } else {
            Text(verbatim: parts.before) + Text(verbatim: parts.words).foregroundColor(GroupTint.color(.needs)).fontWeight(.medium) + Text(verbatim: parts.after)
        }
    }
}

/// The colors the tones are drawn in. The warning and error colors are mixed toward the text color so they read on both light and dark.
enum GroupTint {
    static func color(_ tone: GroupTone?) -> Color {
        switch tone {
        case .needs: Color.orange.mix(with: .primary, by: 0.4)
        case .error: Color.red.mix(with: .primary, by: 0.3)
        case .ready: Color.green.mix(with: .primary, by: 0.45)
        case .working: Color.primary
        case .quiet, .idle, nil: Color.secondary
        }
    }

    static func fill(_ tone: GroupTone) -> Color {
        switch tone {
        case .needs: Color.orange.opacity(0.18)
        case .error: Color.red.opacity(0.14)
        case .ready: Color.green.opacity(0.14)
        case .working: Color.secondary.opacity(0.16)
        case .quiet, .idle: Color.clear
        }
    }
}
