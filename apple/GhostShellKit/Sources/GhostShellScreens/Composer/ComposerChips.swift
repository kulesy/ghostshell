import GhostShellKit
import SwiftUI

/// The quotes and attachments above the box, each with a button that removes it. On the Mac they are the page's cards.
struct ComposerChips: View {
    let model: ComposerModel

    var body: some View {
        #if os(macOS)
        // As the page's two lists: the quotes in a column and the attachments in a row, each scrolling past 14rem.
        VStack(spacing: 0) {
            if !model.quotes.isEmpty {
                ChipScroll(maxHeight: Self.maxHeight) {
                    VStack(spacing: Self.gap) { ForEach(model.quotes) { quote in QuoteChip(quote: quote, here: model.chat?.sessionID) { model.remove(quote) } } }
                        .padding([.horizontal, .top], Self.inset)
                }
            }
            if !model.attachments.isEmpty {
                ChipScroll(maxHeight: Self.maxHeight) {
                    ChipFlow(spacing: Self.gap) { attachmentChips }.padding([.horizontal, .top], Self.inset)
                }
            }
        }
        #else
        if !model.quotes.isEmpty || !model.attachments.isEmpty {
            // About two rows. Past that the chips scroll, and a small window shrinks the area before the box.
            ChipScroll(maxHeight: Self.maxHeight) {
                ChipFlow(spacing: Self.gap) {
                    ForEach(model.quotes) { quote in QuoteChip(quote: quote, here: model.chat?.sessionID) { model.remove(quote) } }
                    attachmentChips
                }
                .padding([.horizontal, .top], Self.inset)
            }
        }
        #endif
    }

    @ViewBuilder private var attachmentChips: some View {
        ForEach(model.attachments) { item in
            if item.isPicture { PictureChip(item: item) { model.remove(item) } } else { FileChip(item: item) { model.remove(item) } }
        }
    }

    #if os(macOS)
    private static let maxHeight = 14 * GhostMetrics.current.rem
    private static let inset = 0.75 * GhostMetrics.current.rem
    private static let gap = 0.5 * GhostMetrics.current.rem
    #else
    private static let maxHeight: CGFloat = 112
    private static let inset: CGFloat = 0
    private static let gap: CGFloat = 8
    #endif
}

/// Holds its content to `maxHeight` and scrolls past it.
private struct ChipScroll<Content: View>: View {
    let maxHeight: CGFloat
    @ViewBuilder let content: Content
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView(.vertical) {
            content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: min(contentHeight, maxHeight))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Lays the chips out left to right and starts a new line when the next one does not fit.
private struct ChipFlow: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let placed = arrange(in: proposal.width ?? .infinity, subviews)
        return CGSize(width: placed.size.width, height: placed.size.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placed = arrange(in: bounds.width, subviews)
        for (subview, origin) in zip(subviews, placed.origins) {
            subview.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(in width: CGFloat, _ subviews: Subviews) -> (origins: [CGPoint], size: CGSize) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { (x, y, lineHeight) = (0, y + lineHeight + spacing, 0) }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (origins, CGSize(width: widest, height: y + lineHeight))
    }
}

private let chipHeight: CGFloat = 48

private struct RemoveButton: View {
    let label: String
    /// Sits on a picture, so the glyph gets a backing of its own and the 44pt touch area stays clear.
    var onPicture = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            #if os(macOS)
            Image(systemName: "xmark").font(.system(size: 0.6 * GhostMetrics.current.rem, weight: .bold)).foregroundStyle(Color.ghost.foreground)
                .frame(width: 1.5 * GhostMetrics.current.rem, height: 1.5 * GhostMetrics.current.rem)
                .background(Color.ghost.secondary, in: Circle())
                .contentShape(Circle())
            #else
            Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).font(.system(size: 14))
                .background { if onPicture { Circle().fill(.regularMaterial) } }
            #endif
        }
        #if os(macOS)
        .buttonStyle(.plain)
        #else
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .phoneIconTouch()
        #endif
        .accessibilityLabel(label)
        .help(label)
    }
}

private struct PictureChip: View {
    let item: Attachment
    let remove: () -> Void
    private let rem = GhostMetrics.current.rem

    var body: some View {
        #if os(macOS)
        tile
            .frame(width: 5 * rem, height: 5 * rem)
            .clipShape(GhostCorner(GhostMetrics.current.lg))
            .padding(0.5 * rem)
            .background(Color.ghost.card, in: GhostCorner(GhostMetrics.current.xl))
            .overlay(GhostCorner(GhostMetrics.current.xl).strokeBorder(Color.ghost.border))
            .overlay(alignment: .topTrailing) { RemoveButton(label: "Remove \(item.name)", onPicture: true, action: remove).padding(0.75 * rem) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Image \(item.name)")
        #else
        tile
            .frame(width: chipHeight, height: chipHeight)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
            .overlay(alignment: .topTrailing) {
                RemoveButton(label: "Remove \(item.name)", onPicture: true, action: remove)
                    .padding(2)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Image \(item.name)")
        #endif
    }

    private var tile: some View {
        ZStack {
            if let thumb = item.thumbnail {
                Image(decorative: thumb, scale: 1).resizable().scaledToFill()
            } else {
                Rectangle().fill(.quaternary)
            }
            if item.working { ProgressView().controlSize(.small) }
        }
    }
}

private struct FileChip: View {
    let item: Attachment
    let remove: () -> Void
    private let rem = GhostMetrics.current.rem

    var body: some View {
        #if os(macOS)
        FileFace(name: item.name, line: item.working ? "Uploading" : ChatFiles.cardLine(name: item.name, size: item.size), working: item.working)
            .padding(EdgeInsets(top: 0.5 * rem, leading: 0.5 * rem, bottom: 0.5 * rem, trailing: 2.5 * rem))
            .frame(width: 14 * rem, alignment: .leading)
            .background(Color.ghost.card, in: GhostCorner(GhostMetrics.current.xl))
            .overlay(GhostCorner(GhostMetrics.current.xl).strokeBorder(Color.ghost.border))
            .overlay(alignment: .trailing) { RemoveButton(label: "Remove \(item.name)", action: remove).padding(.trailing, 0.5 * rem) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("File \(item.name)")
        #else
        HStack(spacing: 8) {
            ZStack {
                if item.working { ProgressView().controlSize(.small) } else { Image(systemName: "doc").foregroundStyle(.secondary) }
            }
            .frame(width: 32, height: 32)
            .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: item.name).font(ChatStyle.small).lineLimit(1).truncationMode(.middle)
                Text(item.working ? "Uploading" : ByteCountFormatter.string(fromByteCount: Int64(item.size), countStyle: .file))
                    .font(ChatStyle.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: 150, alignment: .leading)
            RemoveButton(label: "Remove \(item.name)", action: remove)
        }
        .padding(.horizontal, 8)
        .frame(height: chipHeight)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("File \(item.name)")
        #endif
    }
}

private struct QuoteChip: View {
    let quote: Quote
    let here: String?
    let remove: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "quote.opening").font(ChatStyle.caption).foregroundStyle(.secondary).padding(.top, 2)
            VStack(alignment: .leading, spacing: 1) {
                if quote.fromID != here {
                    Text("From \(quote.fromTitle.isEmpty ? "another session" : quote.fromTitle)")
                        .font(ChatStyle.caption).fontWeight(.medium).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(verbatim: quote.text).font(ChatStyle.small).lineLimit(quote.fromID != here ? 1 : 2)
            }
            #if os(macOS)
            .frame(maxWidth: .infinity, alignment: .leading)
            #else
            .frame(maxWidth: 220, alignment: .leading)
            #endif
            RemoveButton(label: "Remove quote", action: remove)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(height: chipHeight)
        .background(Color.ghost.card, in: GhostCorner(GhostMetrics.current.xl))
        .overlay(GhostCorner(GhostMetrics.current.xl).strokeBorder(Color.ghost.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Quote: \(quote.text)")
    }
}
