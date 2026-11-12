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
            HStack(alignment: ChatStyle.titleAlignment, spacing: 8) {
                ChatLamp(state: "waiting").padding(.top, ChatStyle.cardLamp).accessibilityHidden(true)
                Text(verbatim: title).font(ChatStyle.body).fontWeight(.semibold).foregroundStyle(ChatStyle.warningText)
                    .frame(minHeight: ChatStyle.titleHeight).textSelection(.enabled)
            }
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 10) { content }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: state.error == nil ? bodyCap : max(bodyCap - 25, 60))
            .fixedSize(horizontal: false, vertical: true)
            if let error = state.error {
                Text(verbatim: error).font(ChatStyle.small).foregroundStyle(ChatStyle.removed).fixedSize(horizontal: false, vertical: true)
            }
            // Three long labels don't fit side by side on a 375pt phone, so they stack rather than break mid-word.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { actions; busyMark }
                VStack(alignment: .leading, spacing: 8) { actions; busyMark }
            }
            .disabled(state.busy)
        }
        .padding(ChatStyle.cardPadding)
        .chatText()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatStyle.card, in: RoundedRectangle(cornerRadius: ChatStyle.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusCard).strokeBorder(ChatStyle.approvalEdge))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }

    @ViewBuilder private var busyMark: some View {
        if state.busy { Spinner() }
    }
}

private struct LabelledText: View {
    let label: String
    let text: String
    var maxHeight: CGFloat = 180

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(verbatim: label).font(ChatStyle.small).fontWeight(ChatStyle.labelWeight).foregroundStyle(ChatStyle.muted)
            ToolIO(text: text, maxHeight: maxHeight, command: true)
        }
    }
}

/// The lines before and after, as the page draws them: `-` lines tinted red and `+` lines green.
private struct DiffBlock: View {
    let diff: ApprovalParts.Diff

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(diff.removed.enumerated()), id: \.offset) { _, line in row("- ", line, ChatStyle.removed) }
            ForEach(Array(diff.added.enumerated()), id: \.offset) { _, line in row("+ ", line, ChatStyle.added) }
        }
        .padding(.vertical, ChatStyle.diffInset)
        .textSelection(.enabled)
        .background(ChatStyle.well, in: RoundedRectangle(cornerRadius: ChatStyle.radiusInner))
        .clipShape(RoundedRectangle(cornerRadius: ChatStyle.radiusInner))
    }

    /// The page colours the diff's text. The Mac tints each line's background.
    private func row(_ sign: String, _ line: String, _ tint: Color) -> some View {
        Text(verbatim: sign + line).font(ChatStyle.commandMono).lineSpacing(ChatStyle.page ? 4 : 0)
            .foregroundStyle(ChatStyle.page ? AnyShapeStyle(tint) : ChatStyle.text)
            .padding(.horizontal, ChatStyle.diffRowPadding).padding(.vertical, 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(ChatStyle.diffFill))
    }
}

private struct AllInput: View {
    let prompt: PendingApproval
    @Bindable var state: ApprovalCardState

    var body: some View {
        if ChatStyle.page {
            VStack(alignment: .leading, spacing: 4) {
                Button { state.inputOpen.toggle() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).rotationEffect(.degrees(state.inputOpen ? 90 : 0)).frame(width: 12)
                        Text("All input").font(ChatStyle.body)
                    }
                    .frame(minHeight: ChatStyle.titleHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(state.inputOpen ? "expanded" : "collapsed")
                if state.inputOpen { ToolIO(text: Approvals.allInput(of: prompt), maxHeight: 220, command: true) }
            }
            .foregroundStyle(ChatStyle.muted)
        } else {
            DisclosureGroup("All input", isExpanded: $state.inputOpen) {
                ToolIO(text: Approvals.allInput(of: prompt), maxHeight: 220).padding(.top, 4)
            }
            .font(ChatStyle.small).foregroundStyle(.secondary)
        }
    }
}

private extension View {
    @ViewBuilder func decisionButton(primary: Bool = false) -> some View {
        if ChatStyle.page {
            buttonStyle(.ghost(primary ? .primary : .outline, fills: true))
        } else {
            buttonStyle(.bordered).controlSize(.regular)
        }
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
                Text(verbatim: path).font(ChatStyle.monoSmall).foregroundStyle(ChatStyle.muted).textSelection(.enabled)
            }
            ForEach(Array(parts.fields.filter { !$0.value.isEmpty }.enumerated()), id: \.offset) { _, field in
                LabelledText(label: field.label, text: field.value)
            }
            if let diff = parts.diff { DiffBlock(diff: diff) }
            if let description = prompt.description, !description.isEmpty {
                Text(verbatim: description).font(ChatStyle.body).foregroundStyle(ChatStyle.muted).textSelection(.enabled)
            }
            AllInput(prompt: prompt, state: state)
        } actions: {
            Button("Allow") { model.decide(.allow, requestID: id, in: chat) }
                .decisionButton(primary: true).accessibilityHint(Text(verbatim: parts.title))
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
                .background(ChatStyle.planWell, in: RoundedRectangle(cornerRadius: ChatStyle.radiusInner))
            if let description = prompt.description, !description.isEmpty {
                Text(verbatim: description).font(ChatStyle.body).foregroundStyle(ChatStyle.muted).textSelection(.enabled)
            }
            AllInput(prompt: prompt, state: state)
        } actions: {
            Button("Approve plan") { model.decide(.allow, requestID: id, in: chat) }.decisionButton(primary: true)
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
                .decisionButton(primary: true).disabled(!Approvals.isComplete(questions, answers: answers))
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
        VStack(alignment: .leading, spacing: ChatStyle.questionGap) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let header = question.header {
                    Text(verbatim: header).font(ChatStyle.chipFont).fontWeight(.medium).foregroundStyle(ChatStyle.chipInk)
                        .padding(ChatStyle.chipPadding)
                        .background(ChatStyle.chip, in: Capsule())
                }
                Text(verbatim: question.question).font(ChatStyle.questionFont).fixedSize(horizontal: false, vertical: true)
                if question.multiSelect { Text("(pick any)").font(ChatStyle.small).foregroundStyle(ChatStyle.muted) }
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
                .modifier(AnswerField())
                .disabled(busy)
                .accessibilityLabel("Your own answer")
        }
    }
}

/// The "Or write your own answer" field. The page outlines it at 36pt with the input colour, and the Mac keeps the system's rounded field.
private struct AnswerField: ViewModifier {
    func body(content: Content) -> some View {
        if ChatStyle.page {
            content.textFieldStyle(.plain).font(ChatStyle.fieldFont)
                .padding(.horizontal, 12)
                .frame(minHeight: ChatStyle.fieldHeight)
                .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusButton).strokeBorder(ChatStyle.fieldEdge))
        } else {
            content.textFieldStyle(.roundedBorder).font(ChatStyle.body)
        }
    }
}

private struct OptionButton: View {
    let option: ApprovalOption
    let chosen: Bool
    let busy: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if ChatStyle.optionRadio {
                    Image(systemName: chosen ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen ? Color.accentColor : .secondary).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: option.label).font(ChatStyle.body).fontWeight(.medium)
                    if let description = option.description {
                        Text(verbatim: description).font(ChatStyle.optionDescription).foregroundStyle(ChatStyle.muted).multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(ChatStyle.optionPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(chosen ? ChatStyle.selectedFill(scheme) : ChatStyle.optionFill, in: RoundedRectangle(cornerRadius: ChatStyle.radiusInner))
            .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusInner).strokeBorder(chosen ? ChatStyle.selectedBorder : ChatStyle.optionEdge))
            .contentShape(RoundedRectangle(cornerRadius: ChatStyle.radiusInner))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel(Text(verbatim: option.label))
        .accessibilityValue(chosen ? "selected" : "not selected")
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}
