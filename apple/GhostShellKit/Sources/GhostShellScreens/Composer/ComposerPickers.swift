import GhostShellKit
import SwiftUI

/// The model, effort and permission mode of the chat, in the box's footer. With little room each one shrinks to its icon.
struct ComposerPickers: View {
    let model: ComposerModel
    let compact: Bool

    var body: some View {
        HStack(spacing: 2) {
            modelMenu
            effortMenu
            modeMenu
        }
        .task(id: model.folder) {
            // A typed folder probes the CLI on the server, so wait for typing to pause.
            if model.chat == nil {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
            }
            await model.loadModels()
        }
    }

    private func look(_ name: String, _ symbol: String) -> some View {
        Group {
            if compact { Image(systemName: symbol) } else { Text(name) }
        }
        .font(ChatStyle.small)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6).padding(.vertical, 3)
        #if os(iOS)
        .frame(minWidth: 44, minHeight: 44)
        #endif
        .contentShape(Rectangle())
    }

    private func choice<T: Equatable>(_ get: @escaping @MainActor () -> T, _ set: @escaping (T) -> ComposerSetting) -> Binding<T> {
        Binding(get: get, set: { value in Task { await model.pick(set(value)) } })
    }

    private var modelName: String { model.shownModel.map { ComposerOptions.modelName($0, listed: model.listedModels) } ?? "Model" }

    private var modelMenu: some View {
        Menu {
            Picker("Model", selection: choice({ model.shownModel ?? "" }, { .model($0) })) {
                ForEach(ComposerOptions.mainModels) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.inline)
            Menu("More models") {
                Picker("More models", selection: choice({ model.shownModel ?? "" }, { .model($0) })) {
                    ForEach(ComposerOptions.moreModels(listed: model.listedModels)) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.inline)
            }
            if model.takesFast {
                Divider()
                Toggle("Fast mode", isOn: choice({ model.fast }, { .fast($0) }))
            }
        } label: {
            look(modelName + (model.fast ? " fast" : ""), model.fast ? "bolt.fill" : "cpu")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(compact ? .hidden : .visible)
        .fixedSize()
        .help("Model: \(modelName)")
        .accessibilityLabel("Model: \(modelName)")
    }

    private var effortMenu: some View {
        let name = model.effort.map(ComposerOptions.effortName) ?? "Effort"
        return Menu {
            Picker("Effort", selection: choice({ model.effort ?? "" }, { .effort($0) })) {
                ForEach(ComposerOptions.efforts) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.inline)
        } label: {
            look(name, "speedometer")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(compact ? .hidden : .visible)
        .fixedSize()
        .help("Effort: \(name)")
        .accessibilityLabel("Effort: \(name)")
    }

    private var modeMenu: some View {
        let name = model.mode.map(ComposerOptions.modeName) ?? "Permissions"
        return Menu {
            Picker("Permission mode", selection: choice({ model.mode ?? "" }, { .mode($0) })) {
                ForEach(ComposerOptions.modes) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.inline)
        } label: {
            look(name, "lock.shield")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(compact ? .hidden : .visible)
        .fixedSize()
        .help("Permission mode: \(name)")
        .accessibilityLabel("Permission mode: \(name)")
    }
}
