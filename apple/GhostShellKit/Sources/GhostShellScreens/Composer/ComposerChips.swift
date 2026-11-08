import GhostShellKit
import SwiftUI

/// The quotes and attachments above the box, each with a button that removes it.
struct ComposerChips: View {
    let model: ComposerModel

    var body: some View {
        let quotes = model.quotes
        let attachments = model.attachments
        if !quotes.isEmpty || !attachments.isEmpty {
            ChipFlow(spacing: 8) {
                ForEach(quotes) { quote in QuoteChip(quote: quote, here: model.chat?.sessionID) { model.remove(quote) } }
                ForEach(attachments) { item in
                    if item.isPicture { PictureChip(item: item) { model.remove(item) } } else { FileChip(item: item) { model.remove(item) } }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
    let action: () -> Void

    var body: some View {
        Button(action: action) { Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).font(.system(size: 14)) }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            .accessibilityLabel(label)
            .help(label)
    }
}

private struct PictureChip: View {
    let item: Attachment
    let remove: () -> Void

    var body: some View {
        ZStack {
            if let thumb = item.thumbnail {
                Image(decorative: thumb, scale: 1).resizable().scaledToFill()
            } else {
                Rectangle().fill(.quaternary)
            }
            if item.working { ProgressView().controlSize(.small) }
        }
        .frame(width: chipHeight, height: chipHeight)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
        .overlay(alignment: .topTrailing) {
            RemoveButton(label: "Remove \(item.name)", action: remove)
                .background(.regularMaterial, in: Circle())
                .padding(2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Image \(item.name)")
    }
}

private struct FileChip: View {
    let item: Attachment
    let remove: () -> Void

    var body: some View {
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
            .frame(maxWidth: 220, alignment: .leading)
            RemoveButton(label: "Remove quote", action: remove)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(height: chipHeight)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Quote: \(quote.text)")
    }
}
