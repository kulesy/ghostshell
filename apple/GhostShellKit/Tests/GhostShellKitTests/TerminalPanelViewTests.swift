#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import GhostShellKit
@testable import GhostShellScreens

@MainActor
final class TerminalPanelViewTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com/app")!

    /// The runs the shots fixture serves, the first of them 2500 lines long, so its block is far taller than the others.
    private func fixtureBody() -> String {
        let lines = (1...2500).map { "build step \($0): compiled module-\($0).js in \(($0 - 1) * 7 % 90 + 10) ms\n" }
        let long = stride(from: 0, to: lines.count, by: 250).map {
            #"{"stream":"out","text":"\#(lines[$0..<min($0 + 250, lines.count)].joined().replacingOccurrences(of: "\n", with: "\\n"))"}"#
        }.joined(separator: ",")
        func run(_ id: String, _ command: String, running: Bool, output: String) -> String {
            #"{"id":"\#(id)","command":"\#(command)","cwd":"/work/example","source":"panel","startedAt":1000,"endedAt":\#(running ? "null" : "2000"),"exitCode":\#(running ? "null" : "0"),"signal":null,"stopped":false,"running":\#(running),"truncated":false,"delivered":null,"output":[\#(output)]}"#
        }
        let runs = [
            run("r1", "npm run build", running: false, output: long),
            run("r2", "npm test", running: false, output: #"{"stream":"out","text":"\u001b[32m\u2713\u001b[0m uploads a file\n"}"#),
            run("r3", "npm run dev", running: true, output: #"{"stream":"out","text":"> example dev\n"}"#),
        ]
        return #"{"cwd":"/work/example","home":"/Users/example","runs":[\#(runs.joined(separator: ","))]}"#
    }

    /// The panel opens scrolled to its end, so the last run, the one still going, is on screen however tall the runs above it are.
    func testThePanelOpensOnItsLastRunWhateverTheHeightOfTheOnesAboveIt() async throws {
        let body = fixtureBody()
        TerminalStub.reset { _ in (200, body) }
        let tokens = MemoryTokenStore()
        await tokens.save(String(repeating: "ab12", count: 16), for: address)
        let chat = ChatContext(sessionID: "s1", client: GhostShellClient(address: address, store: tokens, protocols: [TerminalStub.self]))
        chat.terminalAvailable = true
        chat.terminalOpen = true
        let host = NSHostingView(rootView: TerminalPanel(chat: chat).frame(width: 700, height: 470))
        let window = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 700, height: 470), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        for _ in 0..<60 { try await Task.sleep(for: .milliseconds(50)) }
        host.layoutSubtreeIfNeeded()
        let rep = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        window.orderOut(nil)
        chat.close()
        XCTAssertEqual(chat.terminal.state.runs.map(\.command), ["npm run build", "npm test", "npm run dev"])
        // The block of the last run sits just above the input line, so a band of the panel holds more than its one flat background colour.
        var colours = Set<UInt32>()
        let top = Int(Double(rep.pixelsHigh) * 0.43), bottom = Int(Double(rep.pixelsHigh) * 0.57)
        for y in stride(from: top, to: bottom, by: 2) {
            for x in stride(from: 0, to: rep.pixelsWide, by: 3) {
                guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
                colours.insert(UInt32(c.redComponent * 255) << 16 | UInt32(c.greenComponent * 255) << 8 | UInt32(c.blueComponent * 255))
            }
        }
        XCTAssertGreaterThan(colours.count, 4, "the band where the last run's block belongs is blank")
    }
}
#endif
