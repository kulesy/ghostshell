import GhostShellKit
import SwiftUI

/// The prompts waiting on this chat, oldest first, above the composer. The stack scrolls once it passes about half the chat's height, so the thread stays visible.
struct ApprovalPrompts: View {
    let chat: ChatContext
    @State private var cap: CGFloat = 280

    var body: some View {
        let model = chat.store(ApprovalsModel.self) { ApprovalsModel() }
        let pending = chat.status?.pending ?? []
        if !pending.isEmpty {
            VStack(spacing: 0) {
                Divider()
                ScrollView(.vertical) {
                    VStack(spacing: 10) {
                        ForEach(pending) { prompt in
                            ApprovalCard(prompt: prompt, chat: chat, model: model).id(prompt.requestID)
                        }
                    }
                    .frame(maxWidth: ChatStyle.column)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    // The title, the buttons and the padding take about 125pt, so the rest is the body's. CardFrame takes an error line off it.
                    .environment(\.approvalBodyCap, max(cap - 125, 60))
                }
                .frame(maxHeight: cap)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    Color.clear
                        .containerRelativeFrame(.vertical) { length, _ in length * 0.5 }
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cap = max($0, 120) }
                }
            }
            .background(.bar)
            .onChange(of: pending.map(\.requestID)) { _, ids in model.keep(Set(ids)) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Waiting for your answer")
        }
    }
}

/// Picks the card for a prompt by what it asks.
private struct ApprovalCard: View {
    let prompt: PendingApproval
    let chat: ChatContext
    let model: ApprovalsModel

    var body: some View {
        let state = model.state(for: prompt.requestID)
        switch Approvals.kind(of: prompt) {
        case .question: QuestionCard(prompt: prompt, chat: chat, model: model, state: state)
        case .plan: PlanCard(prompt: prompt, chat: chat, model: model, state: state)
        case .permission: PermissionCard(prompt: prompt, chat: chat, model: model, state: state)
        }
    }
}
