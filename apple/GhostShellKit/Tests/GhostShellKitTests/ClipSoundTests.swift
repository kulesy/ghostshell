import XCTest
@testable import GhostShellScreens

/// A scripted test run must never reach the speakers. See https://github.com/kulesy/ghostshell/issues/127.
@MainActor final class ClipSoundTests: XCTestCase {
    /// A tenth of a second of 8 kHz mono silence, so this test is quiet even if the guard breaks.
    private func silentWav() -> Data {
        let samples = 800
        func le<T: FixedWidthInteger>(_ v: T) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
        var d = Data("RIFF".utf8) + le(UInt32(36 + samples * 2)) + Data("WAVEfmt ".utf8)
        d += le(UInt32(16)) + le(UInt16(1)) + le(UInt16(1)) + le(UInt32(8000)) + le(UInt32(16000)) + le(UInt16(2)) + le(UInt16(16))
        return d + Data("data".utf8) + le(UInt32(samples * 2)) + Data(count: samples * 2)
    }

    func testASilentRunShowsTheClipPlayingWithoutStartingIt() {
        ClipSound.silent = true
        defer { ClipSound.silent = false }
        let clip = ClipPlayer()
        clip.load(silentWav(), autoplay: true)
        XCTAssertFalse(clip.failed)
        XCTAssertTrue(clip.isPlaying)
        XCTAssertEqual(clip.player?.isPlaying, false)
        clip.toggle(); clip.toggle()
        XCTAssertEqual(clip.player?.isPlaying, false)
    }
}
