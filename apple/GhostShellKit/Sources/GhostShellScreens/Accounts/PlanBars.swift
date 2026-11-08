import GhostShellKit
import SwiftUI

/// The plan usage rows: a label, the words, and a bar. Amber and red are only for the rows the server marks.
struct PlanBars: View {
    let rows: [PlanRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.label).font(.callout)
                        Spacer(minLength: 8)
                        Text(row.text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
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
                Capsule().fill(Color.secondary.opacity(0.2))
                Capsule().fill(color).frame(width: box.size.width * percent / 100)
            }
        }
        .frame(height: 6)
    }

    private func tint(_ severity: PlanSeverity?) -> Color {
        switch severity {
        case .critical?: .red
        case .warning?: .orange
        default: .primary
        }
    }
}
