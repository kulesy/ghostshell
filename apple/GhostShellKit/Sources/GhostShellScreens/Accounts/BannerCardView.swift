import GhostShellKit
import SwiftUI

/// One banner: a compact callout with a light fill. The warning tone gets a triangle and an orange tint, the rest a quiet grey.
struct BannerCardView: View {
    let card: BannerCard
    var problem = ""
    var busy = false
    var onAction: () -> Void = {}
    var onForce: (() -> Void)?
    var onDismiss: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if card.warning { Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange).accessibilityHidden(true) }
                Text(card.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            }
            Text(card.text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !card.steps.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(card.steps.enumerated()), id: \.offset) { n, step in
                        Text(verbatim: "\(n + 1). \(step)").font(.caption).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Text(card.caution).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !card.changes.isEmpty { changes }
            if !problem.isEmpty || !card.problem.isEmpty { Notice(text: problem.isEmpty ? card.problem : problem).font(.caption) }
            else if !card.progress.isEmpty { Text(card.progress).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            buttons
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(card.warning ? Color.orange.opacity(0.14) : Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.title)
    }

    private var changes: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(card.changes.enumerated()), id: \.offset) { _, change in
                Group {
                    if let url = change.url { Link(change.title, destination: url) } else { Text(change.title) }
                }
                .font(.caption).lineLimit(2)
            }
            if card.more > 0 { Text("and \(card.more) more").font(.caption).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder private var buttons: some View {
        let waiting = busy || card.action?.busy == true
        if card.action != nil || card.force != nil || card.dismiss != nil {
            SideBySide(alignment: .center, spacing: 6) {
                if let action = card.action {
                    Button(action.label, action: onAction).disabled(waiting || action.blocked).phoneTouch(boxed: true)
                }
                if let force = card.force, let onForce {
                    // Force stays live while the update waits on running chats, the one time it is needed.
                    Button(force, action: onForce).disabled(busy).phoneTouch(boxed: true)
                }
                if let dismiss = card.dismiss, let onDismiss {
                    Button(dismiss, action: onDismiss).buttonStyle(.borderless).disabled(busy).phoneTouch()
                }
            }
            .controlSize(.small)
        }
    }
}
