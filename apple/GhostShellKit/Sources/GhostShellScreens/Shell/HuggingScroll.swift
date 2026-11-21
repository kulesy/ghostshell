import SwiftUI

/// A vertical scroll as tall as its content, held between `minHeight` and `maxHeight`, that scrolls past the top. A stack can squeeze it down to
/// `minHeight`, where `fixedSize` would hold it at its full height.
struct HuggingScroll<Content: View>: View {
    var minHeight: CGFloat = 0
    let maxHeight: CGFloat
    @ViewBuilder let content: Content
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView(.vertical) {
            // Read inside the scroll, which offers unlimited height, so the frame set from it never changes it.
            content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(minHeight: min(contentHeight, minHeight, maxHeight), maxHeight: min(contentHeight, maxHeight))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
