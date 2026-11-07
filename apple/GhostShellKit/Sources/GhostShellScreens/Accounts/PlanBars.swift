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
                    ProgressView(value: Double(min(max(row.percent, 0), 100)), total: 100).tint(tint(row.severity))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(row.label), \(row.text)")
            }
        }
    }

    private func tint(_ severity: PlanSeverity?) -> Color {
        switch severity {
        case .critical?: .red
        case .warning?: .orange
        default: .primary
        }
    }
}
