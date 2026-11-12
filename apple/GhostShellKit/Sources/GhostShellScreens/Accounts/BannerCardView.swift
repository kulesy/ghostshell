import GhostShellKit
import SwiftUI

/// One banner: a compact callout with a 1px border. The warning tone gets a triangle and the page's warning colours, the rest the muted ground.
struct BannerCardView: View {
    let card: BannerCard
    var problem = ""
    var busy = false
    var onAction: () -> Void = {}
    var onForce: (() -> Void)?
    var onDismiss: (() -> Void)?

    private var ink: Color { card.warning ? Color.ghost.warningForeground : Color.ghost.foreground }
    private var quiet: Color { card.warning ? Color.ghost.warningForeground : Color.ghost.mutedForeground }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: GhostRadius.base, style: .continuous)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if card.warning { Image(systemName: "exclamationmark.triangle").accessibilityHidden(true) }
                Text(card.title).font(.geist(14, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
            }
            Text(card.text).font(.geist(13)).foregroundStyle(quiet).fixedSize(horizontal: false, vertical: true)
            if !card.steps.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(card.steps.enumerated()), id: \.offset) { n, step in
                        Text(verbatim: "\(n + 1). \(step)").font(.geist(13)).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Text(card.caution).font(.geist(13)).foregroundStyle(quiet).fixedSize(horizontal: false, vertical: true)
            }
            if !card.changes.isEmpty { changes }
            if !problem.isEmpty || !card.problem.isEmpty { Notice(text: problem.isEmpty ? card.problem : problem).font(.geist(13)) }
            else if !card.progress.isEmpty { Text(card.progress).font(.geist(13)).foregroundStyle(quiet).fixedSize(horizontal: false, vertical: true) }
            buttons
        }
        .foregroundStyle(ink)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card.warning ? Color.ghost.warningMuted : Color.ghost.muted, in: shape)
        .overlay { shape.strokeBorder(card.warning ? Color.ghost.warning : Color.ghost.border, lineWidth: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.title)
    }

    private var changes: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(card.changes.enumerated()), id: \.offset) { _, change in
                Group {
                    if let url = change.url { Link(change.title, destination: url) } else { Text(change.title) }
                }
                .font(.geist(13)).lineLimit(2)
            }
            if card.more > 0 { Text("and \(card.more) more").font(.geist(13)).foregroundStyle(quiet) }
        }
    }

    @ViewBuilder private var buttons: some View {
        if card.action != nil || card.force != nil || card.dismiss != nil {
            // The Mac's narrow sidebar has no room for the buttons side by side.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { buttonRow }
                VStack(alignment: .leading, spacing: 4) { buttonRow }
            }
        }
    }

    @ViewBuilder private var buttonRow: some View {
        let waiting = busy || card.action?.busy == true
        if let action = card.action {
            Button(action.label, action: onAction).disabled(waiting || action.blocked).buttonStyle(.ghost(.primary, size: .compact))
        }
        if let force = card.force, let onForce {
            // Force stays live while the update waits on running chats, the one time it is needed.
            Button(force, action: onForce).disabled(busy).buttonStyle(.ghost(.outline, size: .compact))
        }
        if let dismiss = card.dismiss, let onDismiss {
            Button(dismiss, action: onDismiss).disabled(busy).buttonStyle(.ghost(.ghost, size: .compact))
        }
    }
}
