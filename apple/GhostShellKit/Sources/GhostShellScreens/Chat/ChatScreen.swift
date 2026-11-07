import SwiftUI

/// A stub. It shows the chosen session's title and nothing else. The chat PBI replaces this file.
struct ChatScreen: View {
    @Environment(AppModel.self) private var model
    let sessionID: String

    var body: some View {
        let title = model.rows.first { $0.id == sessionID }?.title ?? ""
        Text(title.isEmpty ? "Untitled" : title)
            .font(.title2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(title.isEmpty ? "Untitled" : title)
    }
}
