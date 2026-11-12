import SwiftUI

/// A short line that something went wrong or needs a look: warning triangle, ordinary text.
struct Notice: View {
    let text: String
    var body: some View {
        Label {
            Text(text).foregroundStyle(Color.ghost.foreground).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Color.ghost.warning)
        }
        .font(.geist(14))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
