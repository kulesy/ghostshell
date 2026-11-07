import GhostShellKit
import SwiftUI

/// Starts a session: a folder, then the first message in the same box a chat has. The server makes the session and the chat opens on it.
public struct NewSessionScreen: View {
    @Environment(AppModel.self) private var app

    public init() {}

    public var body: some View {
        if let client = app.client { NewSessionBody(client: client, navigator: app.navigator) } else { Color.clear }
    }
}

private struct NewSessionBody: View {
    let client: GhostShellClient
    @State private var model: ComposerModel
    @State private var folders: [String] = []

    init(client: GhostShellClient, navigator: Navigator) {
        self.client = client
        _model = State(initialValue: ComposerModel.newSession(client: client) { navigator.openSession($0) })
    }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
            VStack(spacing: 18) {
                ShellMark().frame(width: 40, height: 40).opacity(0.85)
                Text("New session").font(.title2.weight(.semibold))
                HStack(spacing: 8) {
                    Image(systemName: "folder").foregroundStyle(.secondary).accessibilityHidden(true)
                    TextField("Folder", text: $model.folder, prompt: Text("Path to a folder"))
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Folder")
                    Menu {
                        ForEach(folders, id: \.self) { path in Button(path) { model.folder = path } }
                    } label: {
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11))
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
        .task {
            folders = (try? await client.folders()) ?? []
            if model.folder.isEmpty, let first = folders.first { model.folder = first }
        }
        .task(id: model.folder) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await model.loadDefaults()
        }
    }
}

/// The sidebar toolbar's button for the New Session screen.
struct NewSessionButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button("New Session", systemImage: "square.and.pencil") { model.navigator.show { NewSessionScreen() } }
            .help("New Session (Command-N)")
    }
}
