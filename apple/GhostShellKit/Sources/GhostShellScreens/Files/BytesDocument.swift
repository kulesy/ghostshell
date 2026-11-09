#if os(iOS)
import SwiftUI
import UniformTypeIdentifiers

/// Bytes already in memory, for `.fileExporter`.
struct BytesDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let data: Data

    init(_ data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
#endif
