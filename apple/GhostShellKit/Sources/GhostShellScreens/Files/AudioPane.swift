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
                note(words)
            case .loading, .none:
                ProgressView("Loading").controlSize(.small)
            default:
                if player.failed {
                    note("GhostShell cannot play this file.")
                } else {
                    controls(player)
                }
            }
            if clips.count > 1, let at {
                clipNav(clips, at: at)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The page's note under the player when a clip cannot play.
    private func note(_ words: String) -> some View {
        Text(verbatim: words).font(.geist(14, relativeTo: .subheadline)).foregroundStyle(Color.ghost.destructive)
            .frame(maxWidth: .infinity, alignment: .center).multilineTextAlignment(.center)
    }

    private func controls(_ player: ClipPlayer) -> some View {
        HStack(spacing: 10) {
            playButton(player)
            Slider(value: Binding(get: { player.elapsed }, set: { player.seek(to: $0) }), in: 0...max(player.duration, 0.01))
                .tint(Color.ghost.primary)
                .accessibilityLabel("Position")
            Text(verbatim: "\(ClipTime.text(player.elapsed)) / \(ClipTime.text(player.duration))")
                .font(.geist(14, relativeTo: .subheadline).monospacedDigit()).foregroundStyle(Color.ghost.mutedForeground)
        }
    }

    @ViewBuilder private func playButton(_ player: ClipPlayer) -> some View {
        let symbol = player.isPlaying ? "pause.fill" : "play.fill"
        #if os(iOS)
        Button { player.toggle() } label: {
            Image(systemName: symbol).foregroundStyle(Color.ghost.primaryForeground).frame(width: 44, height: 44).background(Color.ghost.primary, in: Circle())
        }
        .buttonStyle(.plain).accessibilityLabel(player.isPlaying ? "Pause" : "Play")
        #else
        Button { player.toggle() } label: { Image(systemName: symbol).frame(width: 16, height: 16) }
            .buttonStyle(.borderedProminent).controlSize(.regular).clipShape(Circle())
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
        #endif
    }

    private func clipNav(_ clips: [String], at: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button("Previous") { store.open(path: clips[(at + clips.count - 1) % clips.count], line: nil, autoplay: true) }
                    .buttonStyle(.ghost(.outline))
                Text(verbatim: "\(at + 1) of \(clips.count)").font(.geist(14, relativeTo: .subheadline).monospacedDigit())
                    .foregroundStyle(Color.ghost.mutedForeground).frame(maxWidth: .infinity)
                Button("Next") { store.open(path: clips[(at + 1) % clips.count], line: nil, autoplay: true) }
                    .buttonStyle(.ghost(.outline))
            }
            Rule()
            VStack(alignment: .leading, spacing: 2) {
                ForEach(clips, id: \.self) { clip in
                    let current = clip == path
                    Button { store.open(path: clip, line: nil, autoplay: true) } label: {
                        Text(verbatim: (clip as NSString).lastPathComponent)
                            .font(.geist(16, weight: current ? .semibold : .regular, relativeTo: .body)).foregroundStyle(Color.ghost.foreground)
                            .lineLimit(1).truncationMode(.middle)
                            .padding(.horizontal, 12)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .background(current ? Color.ghost.foreground.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: GhostRadius.sm, style: .continuous))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).help(clip)
                    .accessibilityAddTraits(current ? .isSelected : [])
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
