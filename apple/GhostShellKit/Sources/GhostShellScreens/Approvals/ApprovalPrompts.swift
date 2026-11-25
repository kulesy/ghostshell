import GhostShellKit
import SwiftUI

/// The prompts waiting on this chat, oldest first, above the composer. The stack scrolls once it passes about half the chat's height, so the thread stays visible.
struct ApprovalPrompts: View {
    let chat: ChatContext
    @Environment(\.chatHeight) private var chatHeight

    #if os(macOS)
    // The page's 0.5rem over the cards and, with the composer's own 0.5rem, its 0.75rem under them.
    private static let topPadding = 0.5 * GhostMetrics.current.rem
    private static let bottomPadding = 0.25 * GhostMetrics.current.rem
    #else
    private static let topPadding: CGFloat = 10
    private static let bottomPadding: CGFloat = 10
    #endif

    var body: some View {
        let model = chat.store(ApprovalsModel.self) { ApprovalsModel() }
        let pending = chat.status?.pending ?? []
        let cap = max(chatHeight * 0.5, 120)
        if !pending.isEmpty {
            VStack(spacing: 0) {
                // The floor shows one card's title, a short body and its buttons, so a tall draft and chips cannot squeeze the card out.
                HuggingScroll(minHeight: ChatStyle.cardChrome + 40, maxHeight: cap) {
                    VStack(spacing: 10) {
                        ForEach(pending) { prompt in
                            ApprovalCard(prompt: prompt, chat: chat, model: model).id(prompt.requestID)
                        }
                    }
                    .frame(maxWidth: ChatStyle.column)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16).padding(.top, Self.topPadding).padding(.bottom, Self.bottomPadding)
                    // The title, the buttons and the padding take ChatStyle.cardChrome, so the rest is the body's. CardFrame takes an error line off it.
                    .environment(\.approvalBodyCap, max(cap - ChatStyle.cardChrome, 60))
                }
            }
            .background(ChatStyle.dock)
            // Under the composer's 1, so a composer holding chips takes its room first and the stack scrolls in what is left. Over the thread's 0.
            .layoutPriority(0.5)
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
