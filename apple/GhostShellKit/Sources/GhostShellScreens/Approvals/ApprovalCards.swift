import GhostShellKit
import SwiftUI

// Every string a card shows came from the server or the model, so it goes through `Text(verbatim:)` and never as Markdown. Only a plan is Markdown.
// No button here takes a keyboard shortcut or the default action, so Return in the composer can never approve anything.

extension EnvironmentValues {
    /// How tall a card's body may grow before it scrolls, so the card's buttons stay in the prompt stack's view.
    @Entry var approvalBodyCap: CGFloat = 280
}

/// The frame all three cards share: a waiting lamp, a title, the body and the buttons. Only the body scrolls, as on the page.
private struct CardFrame<Content: View, Actions: View>: View {
    let title: String
    let state: ApprovalCardState
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions
    @Environment(\.approvalBodyCap) private var bodyCap

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Circle().fill(.orange).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(verbatim: title).font(ChatStyle.body).fontWeight(.semibold).textSelection(.enabled)
            }
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 10) { content }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: state.error == nil ? bodyCap : max(bodyCap - 25, 60))
            .fixedSize(horizontal: false, vertical: true)
            if let error = state.error {
                Text(verbatim: error).font(ChatStyle.small).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                actions
                if state.busy { ProgressView().controlSize(.small) }
            }
            .disabled(state.busy)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.quaternary))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }
}

private struct LabelledText: View {
    let label: String
    let text: String
    var maxHeight: CGFloat = 180

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(verbatim: label).font(ChatStyle.small).foregroundStyle(.secondary)
            ToolIO(text: text, maxHeight: maxHeight)
        }
    }
}

/// The lines before and after, as the page draws them: `-` lines tinted red and `+` lines green.
private struct DiffBlock: View {
    let diff: ApprovalParts.Diff

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(diff.removed.enumerated()), id: \.offset) { _, line in row("- ", line, .red) }
            ForEach(Array(diff.added.enumerated()), id: \.offset) { _, line in row("+ ", line, .green) }
        }
        .textSelection(.enabled)
        .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func row(_ sign: String, _ line: String, _ tint: Color) -> some View {
        Text(verbatim: sign + line).font(ChatStyle.monoSmall)
            .padding(.horizontal, 10).padding(.vertical, 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.14))
    }
}

private struct AllInput: View {
    let prompt: PendingApproval
    @Bindable var state: ApprovalCardState

    var body: some View {
        DisclosureGroup("All input", isExpanded: $state.inputOpen) {
            ToolIO(text: Approvals.allInput(of: prompt), maxHeight: 220).padding(.top, 4)
        }
        .font(ChatStyle.small).foregroundStyle(.secondary)
    }
}

private extension View {
    func decisionButton() -> some View {
        #if os(iOS)
        buttonStyle(.bordered).controlSize(.large)
        #else
        buttonStyle(.bordered).controlSize(.regular)
        #endif
    }
}

struct PermissionCard: View {
    let prompt: PendingApproval
    let chat: ChatContext
    let model: ApprovalsModel
    let state: ApprovalCardState

    var body: some View {
        let parts = Approvals.parts(of: prompt, connectors: chat.session.connectors)
        let id = prompt.requestID
        CardFrame(title: parts.title, state: state) {
            if let path = parts.path, !path.isEmpty {
                Text(verbatim: path).font(ChatStyle.monoSmall).foregroundStyle(.secondary).textSelection(.enabled)
            }
            ForEach(Array(parts.fields.filter { !$0.value.isEmpty }.enumerated()), id: \.offset) { _, field in
                LabelledText(label: field.label, text: field.value)
            }
            if let diff = parts.diff { DiffBlock(diff: diff) }
            if let description = prompt.description, !description.isEmpty {
                Text(verbatim: description).font(ChatStyle.body).foregroundStyle(.secondary).textSelection(.enabled)
            }
            AllInput(prompt: prompt, state: state)
        } actions: {
            Button("Allow") { model.decide(.allow, requestID: id, in: chat) }
                .decisionButton().accessibilityHint(Text(verbatim: parts.title))
            if prompt.always {
                Button("Always allow") { model.decide(.always, requestID: id, in: chat) }
                    .decisionButton().accessibilityHint(Text(verbatim: parts.title))
            }
            Button("Deny") { model.decide(.deny, requestID: id, in: chat) }
                .decisionButton().accessibilityHint(Text(verbatim: parts.title))
        }
    }
}

struct PlanCard: View {
    let prompt: PendingApproval
    let chat: ChatContext
    let model: ApprovalsModel
    let state: ApprovalCardState

    var body: some View {
        let id = prompt.requestID
        CardFrame(title: "Claude has a plan", state: state) {
            MarkdownView(blocks: ChatMarkdown.parse(Approvals.plan(of: prompt) ?? "")).padding(12).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            if let description = prompt.description, !description.isEmpty {
                Text(verbatim: description).font(ChatStyle.body).foregroundStyle(.secondary).textSelection(.enabled)
            }
            AllInput(prompt: prompt, state: state)
        } actions: {
            Button("Approve plan") { model.decide(.allow, requestID: id, in: chat) }.decisionButton()
            if prompt.always {
                Button("Always allow") { model.decide(.always, requestID: id, in: chat) }.decisionButton()
            }
            Button("Keep planning") { model.decide(.deny, requestID: id, in: chat) }.decisionButton()
        }
    }
}

struct QuestionCard: View {
    let prompt: PendingApproval
    let chat: ChatContext
    let model: ApprovalsModel
    @Bindable var state: ApprovalCardState

    var body: some View {
        let questions = Approvals.questions(of: prompt)
        let id = prompt.requestID
        let answers = Approvals.answers(for: questions, picks: picks(questions.count))
        CardFrame(title: "Claude is asking", state: state) {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(questions.enumerated()), id: \.offset) { n, question in
                    QuestionBlock(question: question, pick: pickBinding(n, questions.count), busy: state.busy)
                }
            }
        } actions: {
            Button("Send answers") { model.decide(.answer(answers), requestID: id, in: chat) }
                .decisionButton().disabled(!Approvals.isComplete(questions, answers: answers))
            Button("Skip") { model.decide(.deny, requestID: id, in: chat) }.decisionButton()
        }
    }

    private func picks(_ count: Int) -> [ApprovalPick] {
        state.picks.count == count ? state.picks : Array(repeating: ApprovalPick(), count: count)
    }

    /// Reads the picks, and sizes them to the question count on the first write.
    private func pickBinding(_ n: Int, _ count: Int) -> Binding<ApprovalPick> {
        Binding(
            get: { picks(count)[n] },
            set: { fresh in
                if state.picks.count != count { state.picks = Array(repeating: ApprovalPick(), count: count) }
                state.picks[n] = fresh
            })
    }
}

private struct QuestionBlock: View {
    let question: ApprovalQuestion
    @Binding var pick: ApprovalPick
    let busy: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let header = question.header {
                    Text(verbatim: header).font(ChatStyle.caption).fontWeight(.medium).foregroundStyle(.secondary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.16), in: Capsule())
                }
                Text(verbatim: question.question).font(ChatStyle.body).fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
                if question.multiSelect { Text("(pick any)").font(ChatStyle.small).foregroundStyle(.secondary) }
            }
            ForEach(Array(question.options.enumerated()), id: \.offset) { n, option in
                let chosen = pick.chosen.contains(n)
                OptionButton(option: option, chosen: chosen, busy: busy) { pick.choose(n, multiSelect: question.multiSelect) }
                    .accessibilityHint(Text(verbatim: question.question))
                if chosen, let preview = option.preview { ToolIO(text: preview, maxHeight: 160) }
            }
            TextField("Or write your own answer", text: Binding(
                get: { pick.other },
                set: { pick.type($0, multiSelect: question.multiSelect) }))
                .textFieldStyle(.roundedBorder).font(ChatStyle.body)
                .disabled(busy)
                .accessibilityLabel("Your own answer")
        }
    }
}

private struct OptionButton: View {
    let option: ApprovalOption
    let chosen: Bool
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: chosen ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen ? Color.accentColor : .secondary).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: option.label).font(ChatStyle.body).fontWeight(.medium)
                    if let description = option.description {
                        Text(verbatim: description).font(ChatStyle.small).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(chosen ? Color.accentColor.opacity(0.14) : Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(chosen ? Color.accentColor.opacity(0.6) : .clear))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel(Text(verbatim: option.label))
        .accessibilityValue(chosen ? "selected" : "not selected")
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
