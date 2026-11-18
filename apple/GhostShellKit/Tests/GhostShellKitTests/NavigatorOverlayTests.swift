import SwiftUI
import XCTest
@testable import GhostShellScreens

@MainActor
final class NavigatorOverlayTests: XCTestCase {
    func testALayerComesDownOnlyForItsOwner() {
        let navigator = Navigator()
        navigator.raise("force", AnyView(Text("Force restart")))
        navigator.lower("viewer")
        XCTAssertNotNil(navigator.overlay, "a chat's viewer leaving must not remove the dialog")
        navigator.lower("force")
        XCTAssertNil(navigator.overlay)
    }

    func testTheNewestLayerWinsAndSetsItsDim() {
        let navigator = Navigator()
        navigator.raise("force", AnyView(Text("Force restart")))
        navigator.raise("viewer", dim: 0.92, AnyView(Text("Picture")))
        XCTAssertEqual(navigator.overlayDim, 0.92)
        navigator.lower("force")
        XCTAssertNotNil(navigator.overlay)
    }

    func testClearDropsAStaleLayer() {
        let navigator = Navigator()
        navigator.raise("force", AnyView(Text("Force restart")))
        navigator.clear()
        XCTAssertNil(navigator.overlay)
        navigator.lower("force")
        XCTAssertNil(navigator.overlay)
    }
}
