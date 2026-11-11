import PDFKit
import SwiftUI

/// A PDF read from bytes in memory. Its link annotations are removed, so nothing inside a PDF can open an address or another file.
struct PDFPane {
    let data: Data

    @MainActor private func makeView() -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        if let document = PDFDocument(data: data) {
            for index in 0..<document.pageCount {
                guard let page = document.page(at: index) else { continue }
                for note in page.annotations where note.action != nil || note.url != nil || (note.type ?? "").hasSuffix("Link") {
                    page.removeAnnotation(note)
                }
            }
            view.document = document
        }
        return view
    }
}

#if os(macOS)
extension PDFPane: NSViewRepresentable {
    func makeNSView(context: Context) -> PDFView { makeView() }
    func updateNSView(_ view: PDFView, context: Context) {}
}
#else
extension PDFPane: UIViewRepresentable {
    func makeUIView(context: Context) -> PDFView {
        let view = makeView()
        view.backgroundColor = UIColor(Color.ghost.muted)
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) {}
}
#endif
