import GhostShellKit
import SwiftUI

/// The ring in the toolbar that shows how full the chat's context window is, with the breakdown and the plan usage in a popover.
public struct ContextMeter: View {
    let sessionID: String

    public init(sessionID: String) { self.sessionID = sessionID }

    public var body: some View {
        MeterBody(sessionID: sessionID).id(sessionID)
    }
}

private struct MeterBody: View {
    @Environment(AppModel.self) private var model
    let sessionID: String
    @State private var state = ContextState()
    @State private var open = false

    /// What the chosen chat's row says, which is when its figure may have moved.
    private struct Trigger: Hashable {
        var visible: Bool
        var open: Bool
        var rowState: SessionState?
        var dot: SessionDot?
        var activity: Date?
    }

    private var trigger: Trigger {
        let row = model.rows.first { $0.id == sessionID }
        return Trigger(visible: model.visible, open: open, rowState: row?.state, dot: row?.dot, activity: row?.lastActivityAt)
    }

    var body: some View {
        Group {
            if hasFigure(state.figure), let figure = state.figure {
                let r = readout(figure)
                Button { open.toggle() } label: { face(r) }
                    .buttonStyle(.plain)
                    .help(r.tip)
                    .accessibilityLabel(r.label)
                    .popover(isPresented: $open, arrowEdge: .bottom) { ContextPopover(figure: figure, readout: r, state: state) }
            }
        }
        .task(id: trigger) {
            guard model.visible, let client = model.client else { return }
            await state.refresh(client, sessionID: sessionID, detail: open ? .full : .summary, throttled: !open)
        }
        .task(id: open) {
            guard open, let client = model.client else { return }
            await state.loadPlan(client, sessionID: sessionID)
        }
        .onChange(of: open) { _, now in if !now { state.closePlan() } }
    }

    @ViewBuilder private func face(_ r: ContextReadout) -> some View {
        if let fill = r.fill {
            Ring(fill: fill, warning: r.warning)
        } else if let text = r.text {
            Text(text).font(.caption).monospacedDigit().foregroundStyle(r.warning ? Color.orange : Color.secondary)
        }
    }
}

/// The arc starts at 12 o'clock and runs clockwise. A ring with nothing in it draws no arc, because a round cap would still leave a dot.
private struct Ring: View {
    let fill: Double
    let warning: Bool

    var body: some View {
        ZStack {
            Circle().stroke(.quaternary, lineWidth: 2.25)
            if fill > 0 {
                Circle().trim(from: 0, to: fill / 100)
                    .stroke(warning ? Color.orange : Color.secondary, style: StrokeStyle(lineWidth: 2.25, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .padding(1.5)
        .frame(width: 16, height: 16)
    }
}

private struct ContextPopover: View {
    let figure: ContextFigure
    let readout: ContextReadout
    let state: ContextState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Context").font(.headline)
                Spacer(minLength: 12)
                Text(readout.size).font(.callout).foregroundStyle(.secondary)
            }
            if let fill = readout.fill { gauge(fill) }
            if let line = readout.line { Text(line).font(.callout).foregroundStyle(readout.warning ? Color.orange : Color.secondary) }
            parts
            let rows = planRows(state.plan?.limits)
            if !rows.isEmpty {
                Divider()
                Text(state.plan?.account.map { "Plan usage, \($0)" } ?? "Plan usage").font(.headline)
                PlanBars(rows: rows)
            }
        }
        .padding(14)
        .frame(width: 300)
    }

    private func gauge(_ fill: Double) -> some View {
        GeometryReader { box in
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                Capsule().fill(readout.warning ? Color.orange : Color.accentColor).frame(width: box.size.width * fill / 100)
                if let tick = readout.tick {
                    Rectangle().fill(.secondary).frame(width: 1.5, height: 10).offset(x: box.size.width * tick / 100 - 0.75)
                }
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel("Context used")
        .accessibilityValue(readout.exact)
    }

    @ViewBuilder private var parts: some View {
        if figure.source != .process {
            VStack(alignment: .leading, spacing: 6) {
                Text("From the transcript, as of Claude's last reply. The breakdown shows while GhostShell runs this chat.")
                if figure.window == nil { Text("GhostShell learns this model's window the next time it runs a chat set to it.") }
            }
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        } else if figure.categories != nil {
            let table = contextParts(figure)
            VStack(spacing: 3) {
                ForEach(table.used) { row in line(row) }
                if !table.rest.isEmpty {
                    Divider().padding(.vertical, 2)
                    ForEach(table.rest) { row in line(row) }
                }
            }
        } else if state.failedAt == figure.total {
            Text("The parts could not be counted.").font(.caption).foregroundStyle(.secondary)
        } else {
            HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Counting what fills the window").font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func line(_ row: ContextRow) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(row.name).font(.callout)
            Spacer(minLength: 8)
            Text(row.size).font(.callout).monospacedDigit()
            Text(row.share).font(.caption).foregroundStyle(.secondary).monospacedDigit().frame(width: 44, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}
