import SwiftUI

struct UnreachableLine: View {
    var body: some View {
        Text("Can't reach the server. Trying again.")
            .font(.footnote)
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
    }
}
