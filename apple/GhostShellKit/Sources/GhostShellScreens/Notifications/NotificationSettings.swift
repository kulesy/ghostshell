import GhostShellKit
import Observation
import Foundation

/// What the person chose to be told about, kept in the model's defaults so it survives a restart. The pane, the toolbar bell and the watcher all read it.
@Observable @MainActor
public final class NotificationSettings {
    public var enabled: Bool { didSet { save(enabled, "enabled") } }
    public var needsYou: Bool { didSet { save(needsYou, "needsYou") } }
    public var finished: Bool { didSet { save(finished, "finished") } }
    public var failed: Bool { didSet { save(failed, "failed") } }
    public var pinnedOnly: Bool { didSet { save(pinnedOnly, "pinnedOnly") } }
    public var routineRuns: Bool { didSet { save(routineRuns, "routineRuns") } }
    public var dockCount: Bool { didSet { save(dockCount, "dockCount") } }
    /// True when macOS has notifications turned off for the app. The watcher keeps this up to date.
    public var systemDenied = false

    private let defaults: UserDefaults

    /// `enabledByDefault` is only the answer when nothing is stored yet.
    public init(model: AppModel, enabledByDefault: Bool = true) {
        let defaults = model.defaults
        self.defaults = defaults
        func read(_ key: String, _ fallback: Bool) -> Bool { defaults.object(forKey: "notifications.\(key)") as? Bool ?? fallback }
        enabled = read("enabled", enabledByDefault)
        needsYou = read("needsYou", true)
        finished = read("finished", true)
        failed = read("failed", true)
        pinnedOnly = read("pinnedOnly", false)
        routineRuns = read("routineRuns", true)
        dockCount = read("dockCount", true)
    }

    var filter: AlertFilter { AlertFilter(needsYou: needsYou, finished: finished, failed: failed, pinnedOnly: pinnedOnly, routineRuns: routineRuns) }

    private func save(_ value: Bool, _ key: String) { defaults.set(value, forKey: "notifications.\(key)") }
}
