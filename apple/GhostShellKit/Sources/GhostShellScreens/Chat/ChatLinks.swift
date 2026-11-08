import Foundation
import GhostShellKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum ChatLinks {
    /// Opens a web link in the default browser. A file link is not opened here.
    @MainActor @discardableResult
    static func openInBrowser(_ link: ChatLink) -> Bool {
        guard case .web(let url) = link, ["http", "https"].contains(url.scheme?.lowercased()) else { return false }
        #if os(macOS)
        return NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        return true
        #endif
    }

    /// Puts text on the clipboard, for the Copy buttons.
    @MainActor
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}
