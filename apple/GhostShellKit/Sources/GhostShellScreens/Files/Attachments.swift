import GhostShellKit
import SwiftUI

/// The pictures and files of a user message, or the pictures of a tool result.
struct AttachmentsView: View {
    let attachments: ChatAttachments
    let chat: ChatContext

    var body: some View {
        switch attachments.source {
        case .user:
            VStack(alignment: .trailing, spacing: 6) {
                if !attachments.images.isEmpty {
                    let pictures = attachments.images.map { ChatPicture.ref($0.ref, alt: "Attached image") }
                    FlowLayout(spacing: 6, alignment: .trailing) {
                        ForEach(pictures.indices, id: \.self) { index in
                            PictureTile(store: store, picture: pictures[index], size: CGSize(width: 120, height: 88),
                                        label: pictures.count > 1 ? "View attached image \(index + 1) of \(pictures.count)" : "View attached image") {
                                store.show(pictures, at: index, widen: pictures[index].id)
                            }
                        }
                    }
                }
                if !attachments.files.isEmpty {
                    FlowLayout(spacing: 6, alignment: .trailing) {
                        ForEach(attachments.files.indices, id: \.self) { index in FileCardView(file: attachments.files[index]) }
                    }
                }
            }
        case .toolResult(let tool):
            toolTiles(tool)
        }
    }

    private var store: FilesStore { FilesSlot.store(chat) }

    private func toolTiles(_ tool: String) -> some View {
        let source = tool.isEmpty ? "a tool" : ChatFiles.toolSource(tool, connectors: chat.session.connectors)
        let pictures = attachments.images.map { ChatPicture.ref($0.ref, alt: "Image from \(source)") }
        let total = pictures.count
        return FlowLayout(spacing: 6) {
            ForEach(0..<min(total, ChatFiles.tiles), id: \.self) { index in
                let more = ChatFiles.overflow(total) > 0 && index == ChatFiles.tiles - 1
                PictureTile(store: store, picture: pictures[index], size: CGSize(width: 92, height: 68), more: more ? "+\(ChatFiles.overflow(total))" : nil,
                            label: ChatFiles.tileLabel(index, of: total, source: source)) {
                    store.show(pictures, at: index, widen: pictures[index].id)
                }
            }
        }
    }
}

/// A picture as a small rounded tile that opens the viewer. `more` covers it with a count, for the last tile when there are more pictures than tiles.
private struct PictureTile: View {
    let store: FilesStore
    let picture: ChatPicture
    let size: CGSize
    var more: String?
    let label: String
    let open: () -> Void

    @State private var image: PlatformImage?
    @State private var failed = false

    var body: some View {
        Button(action: open) {
            ZStack {
                Rectangle().fill(.quaternary.opacity(0.6))
                if let image {
                    Image(platform: image).resizable().scaledToFill().frame(width: size.width, height: size.height).clipped()
                } else {
                    Image(systemName: failed ? "photo.badge.exclamationmark" : "photo").foregroundStyle(.tertiary)
                }
                if let more {
                    Color.black.opacity(0.5)
                    Text(verbatim: more).font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .task(id: picture.id) {
            image = store.pictures.cached(picture.id)
            guard image == nil else { return }
            image = await store.pictures.image(picture)
            failed = image == nil
        }
    }
}

/// A file a person sent. It is not openable, because it was never one of the chat's linked files.
private struct FileCardView: View {
    let file: ChatFile

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc").font(.system(size: 18, weight: .light)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: file.name).font(ChatStyle.small.weight(.medium)).lineLimit(1).truncationMode(.middle)
                Text(verbatim: ChatFiles.cardLine(file)).font(ChatStyle.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .frame(maxWidth: 240, alignment: .leading)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
        .help(file.path)
        .accessibilityElement(children: .combine)
    }
}

/// Wraps its children onto rows, each row to the leading or trailing edge.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var alignment: HorizontalAlignment = .leading

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(in: proposal.width ?? .infinity, subviews)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(in: bounds.width, subviews) {
            var x = alignment == .trailing ? bounds.maxX - row.width : bounds.minX
            for (index, size) in row.items {
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var items: [(Int, CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(in width: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows = [Row()]
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if let last = rows.last, !last.items.isEmpty, last.width + spacing + size.width > width { rows.append(Row()) }
            rows[rows.count - 1].width += (rows[rows.count - 1].items.isEmpty ? 0 : spacing) + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
            rows[rows.count - 1].items.append((index, size))
        }
        return rows
    }
}
