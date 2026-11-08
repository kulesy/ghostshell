import GhostShellKit
import SwiftUI

/// An audio file in the panel: play, scrub, and when the chat links more clips, a way to step through them.
struct AudioPane: View {
    let store: FilesStore
    let path: String
    // Optional, so the panel still draws if the inspector does not inherit the chat's model.
    @Environment(ChatModel.self) private var model: ChatModel?

    var body: some View {
        let player = store.player
        let clips = clipPaths
        let at = clips.firstIndex(of: path)
        VStack(alignment: .leading, spacing: 14) {
            switch store.media {
            case .failed(let words):
                Text(verbatim: words).font(ChatStyle.small).foregroundStyle(.secondary)
            case .loading, .none:
                ProgressView("Loading").controlSize(.small)
            default:
                if player.failed {
                    Text("GhostShell cannot play this file.").font(ChatStyle.small).foregroundStyle(.secondary)
                } else {
                    controls(player)
                }
            }
            if clips.count > 1, let at {
                Divider()
                clipNav(clips, at: at)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func controls(_ player: ClipPlayer) -> some View {
        HStack(spacing: 10) {
            playButton(player)
            Slider(value: Binding(get: { player.elapsed }, set: { player.seek(to: $0) }), in: 0...max(player.duration, 0.01))
                .accessibilityLabel("Position")
            Text(verbatim: "\(ClipTime.text(player.elapsed)) / \(ClipTime.text(player.duration))")
                .font(ChatStyle.small.monospacedDigit()).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func playButton(_ player: ClipPlayer) -> some View {
        let symbol = player.isPlaying ? "pause.fill" : "play.fill"
        #if os(iOS)
        Button { player.toggle() } label: {
            Image(systemName: symbol).foregroundStyle(.white).frame(width: 44, height: 44).background(Color.accentColor, in: Circle())
        }
        .buttonStyle(.plain).accessibilityLabel(player.isPlaying ? "Pause" : "Play")
        #else
        Button { player.toggle() } label: { Image(systemName: symbol).frame(width: 16, height: 16) }
            .buttonStyle(.borderedProminent).controlSize(.regular).clipShape(Circle())
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
        #endif
    }

    private func clipNav(_ clips: [String], at: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { store.open(path: clips[(at + clips.count - 1) % clips.count], line: nil, autoplay: true) } label: {
                    Label("Previous", systemImage: "backward.fill").labelStyle(.iconOnly)
                }
                .phoneIconTouch()
                Button { store.open(path: clips[(at + 1) % clips.count], line: nil, autoplay: true) } label: {
                    Label("Next", systemImage: "forward.fill").labelStyle(.iconOnly)
                }
                .phoneIconTouch()
                Text(verbatim: "\(at + 1) of \(clips.count)").font(ChatStyle.small).foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(clips, id: \.self) { clip in
                    Button { store.open(path: clip, line: nil, autoplay: true) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: clip == path ? "speaker.wave.2.fill" : "speaker").frame(width: 16).foregroundStyle(.secondary)
                            Text(verbatim: (clip as NSString).lastPathComponent).font(ChatStyle.small).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).phoneIconTouch().help(clip)
                    .accessibilityAddTraits(clip == path ? .isSelected : [])
                }
            }
        }
    }

    /// The clips the loaded chat links, once each, in the order its replies show them.
    private var clipPaths: [String] {
        guard let model else { return [] }
        let texts = model.rows.flatMap { row -> [ChatItem] in
            switch row {
            case .item(let item): [item]
            case .group(let group): group.rows
            }
        }
        let blocks = texts.compactMap { item -> [MDBlock]? in
            switch item.body {
            case .assistant(_, let text), .thinking(_, let text): model.blocks(key: item.key, text: text)
            default: nil
            }
        }
        return ChatFiles.clipPaths(in: blocks)
    }
}
