import XCTest
@testable import GhostShellKit

final class PathChangesTests: XCTestCase {
    private func path(_ satisfied: Bool, _ interfaces: String...) -> NetworkPath { NetworkPath(satisfied: satisfied, interfaces: Set(interfaces)) }

    func testTheFirstReportOnlySetsTheBaseline() {
        var rule = PathChanges()
        XCTAssertFalse(rule.shouldReconnect(path(true, "en0")))
    }

    func testAReportThatChangesNothingIsIgnored() {
        var rule = PathChanges()
        _ = rule.shouldReconnect(path(true, "en0"))
        XCTAssertFalse(rule.shouldReconnect(path(true, "en0")))
    }

    func testLosingTheNetworkWaitsAndComingBackReconnects() {
        var rule = PathChanges()
        _ = rule.shouldReconnect(path(true, "en0"))
        XCTAssertFalse(rule.shouldReconnect(path(false)))
        XCTAssertTrue(rule.shouldReconnect(path(true, "en0")))
    }

    func testSwitchingRouteReconnects() {
        var rule = PathChanges()
        _ = rule.shouldReconnect(path(true, "en0"))
        XCTAssertTrue(rule.shouldReconnect(path(true, "pdp_ip0")))
        XCTAssertTrue(rule.shouldReconnect(path(true, "pdp_ip0", "utun3")))
    }
}
