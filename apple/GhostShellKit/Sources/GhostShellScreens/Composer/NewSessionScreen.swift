import GhostShellKit
import SwiftUI

/// Starts a session: a folder, then the first message in the same box a chat has. The server makes the session and the chat opens on it.
/// `group` is the group it starts in, and nil starts it in Home.
public struct NewSessionScreen: View {
    @Environment(AppModel.self) private var app
    private let group: String?

    public init(group: String? = nil) { self.group = group }

    public var body: some View {
        if let client = app.client { NewSessionBody(client: client, app: app, group: group) } else { Color.clear }
    }
}

private struct NewSessionBody: View {
    let client: GhostShellClient
    let app: AppModel
    let group: String?
    @State private var model: ComposerModel
    @State private var folders: [String] = []

    private var groupName: String? { group.flatMap { id in app.index?.groups.first { $0.id == id }?.name } }

    init(client: GhostShellClient, app: AppModel, group: String?) {
        self.client = client
        self.app = app
        self.group = group
        _model = State(initialValue: ComposerModel.newSession(client: client, group: group, refreshIndex: { [app] in await app.refreshIndex() }) { app.navigator.openSession($0) })
    }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            VStack(spacing: 18) {
                ShellMark().frame(width: 40, height: 40).opacity(0.85)
                Text("New session").font(.title2.weight(.semibold))
                if let groupName { Text("In \(groupName)").font(.subheadline).foregroundStyle(.secondary) }
                HStack(spacing: 8) {
                    Image(systemName: "folder").foregroundStyle(.secondary).accessibilityHidden(true)
                    TextField("Folder", text: $model.folder, prompt: Text("Path to a folder"))
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .largeOnPhone()
                        .accessibilityLabel("Folder")
                    Menu {
                        ForEach(folders, id: \.self) { path in Button(path) { model.folder = path } }
                    } label: {
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).phoneIconTouch()
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .disabled(folders.isEmpty)
                    .help("Recent folders")
                    .accessibilityLabel("Recent folders")
                }
                .frame(maxWidth: 480)
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            ComposerView(model: model, placeholder: "What should Claude do? Type / for commands", autofocus: true)
        }
        .navigationTitle("New session")
        #if os(iOS)
        // NOTE: [11 Nov 2026] EK - A large title looped the layout on the iPhone 16 Pro and stalled the screen.
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            folders = (try? await client.folders()) ?? []
            if model.folder.isEmpty, let first = folders.first { model.folder = first }
        }
        // The screen is reused when it is shown again, so the state above keeps the folder and picks, and the group follows the new request.
        .onChange(of: group) { model.group = group }
        .task(id: model.folder) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await model.loadDefaults()
        }
    }
}

extension AppModel {
    /// The group Command-N starts a session in: the first group of the project the sidebar shows, or nil for Home.
    public func newSessionGroup() -> String? {
        index.flatMap { SidebarOutline.newSessionGroup($0, view: defaults.string(forKey: SidebarState.projectKey)) }
    }
}
