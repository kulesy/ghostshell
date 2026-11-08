import Foundation

/// What the pickers offer and what their buttons say. The names are the web page's (public/ui/model-rules.js), which are Claude Desktop's.
public enum ComposerOptions {
    public struct Choice: Hashable, Sendable, Identifiable {
        public let id: String
        public let label: String
    }

    public static let modes: [Choice] = [("manual", "Manual"), ("acceptEdits", "Accept edits"), ("plan", "Plan"), ("auto", "Auto"), ("bypassPermissions", "Bypass permissions")]
        .map(Choice.init)
    public static let efforts: [Choice] = [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra"), ("max", "Max")].map(Choice.init)
    public static let mainModels: [Choice] = [("claude-opus-5-5", "Opus 5.5"), ("claude-fable-5-1", "Fable 5.1"), ("claude-sonnet-5-5", "Sonnet 5.5"), ("claude-haiku-5-5", "Haiku 5.5")]
        .map(Choice.init)
    public static let longModel = Choice(id: "claude-opus-5-5[1m]", label: "Opus 5.5 (1M)")

    /// Until the CLI's list arrives only Opus 5.5 is known to take fast mode, and from then on the list's own flag decides.
    private static let fastBeforeList = ["claude-opus-5-5"]

    /// The CLI lists no `[1m]` ids, so its list is asked about the model without that suffix.
    public static func takesFast(_ model: String?, listed: [ListedModel]?) -> Bool {
        let id = (model ?? "").replacingOccurrences(of: "[1m]", with: "", options: [.caseInsensitive, .anchored, .backwards])
        if let found = listed?.first(where: { $0.id == id }) { return found.fast }
        return fastBeforeList.contains(id)
    }

    /// "More models": the 1M Opus, then the CLI's own list without the models already on the main menu.
    public static func moreModels(listed: [ListedModel]?) -> [Choice] {
        let known = Set(mainModels.map(\.id) + [longModel.id])
        return [longModel] + (listed ?? []).filter { !known.contains($0.id) }.map { Choice(id: $0.id, label: $0.label) }
    }

    public static func modelName(_ model: String, listed: [ListedModel]? = nil) -> String {
        if let known = (mainModels + [longModel]).first(where: { $0.id == model }) { return known.label }
        if let item = listed?.first(where: { $0.id == model }) { return item.label }
        return ChatText.modelLabel(model)
    }

    public static func effortName(_ effort: String) -> String { efforts.first { $0.id == effort }?.label ?? effort }

    public static func modeName(_ mode: String) -> String { modes.first { $0.id == mode }?.label ?? mode }
}

extension ComposerOptions.Choice {
    fileprivate init(_ pair: (String, String)) { (id, label) = pair }
}
