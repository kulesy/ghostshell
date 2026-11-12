import GhostShellKit
import SwiftUI

/// The plan usage rows: a label, the words, and an 8pt bar with square ends. Amber and red are only for the rows the server marks.
struct PlanBars: View {
    let rows: [PlanRow]
    /// The Accounts page sets the words at 16pt like the page, and the context popover keeps its smaller ones.
    var page = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.label).font(page ? .geist(16) : .callout).foregroundStyle(page ? Color.ghost.foreground : .primary)
                        Spacer(minLength: 8)
                        Text(row.text).font(page ? .geist(16) : .caption).foregroundStyle(page ? Color.ghost.foreground : .secondary).multilineTextAlignment(.trailing)
                    }
                    bar(Double(min(max(row.percent, 0), 100)), tint(row.severity))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(row.label), \(row.text)")
            }
        }
    }

    // A ProgressView tinted .primary draws almost no fill inside a dark popover, so the bar is drawn by hand like the context gauge.
    private func bar(_ percent: Double, _ color: Color) -> some View {
        GeometryReader { box in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.ghost.muted)
                Rectangle().fill(color).frame(width: box.size.width * percent / 100)
            }
            .clipShape(RoundedRectangle(cornerRadius: GhostRadius.sm, style: .continuous))
        }
        .frame(height: 8)
    }

    private func tint(_ severity: PlanSeverity?) -> Color {
        switch severity {
        case .critical?: Color.ghost.destructive
        case .warning?: Color.ghost.warning
        default: Color.ghost.primary
        }
    }
}
