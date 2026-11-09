import AVFoundation
import Observation

/// A scripted test run sets `silent`, so a clip shows as playing but never starts, and the run makes no sound.
@MainActor public enum ClipSound {
    public static var silent = false
}

/// Plays one audio clip from bytes in memory. The bytes are never written to disk.
@Observable @MainActor
final class ClipPlayer {
    private(set) var isPlaying = false
    private(set) var elapsed: TimeInterval = 0
    private(set) var duration: TimeInterval = 0
    private(set) var failed = false

    @ObservationIgnored private(set) var player: AVAudioPlayer?
    @ObservationIgnored private var ticker: Task<Void, Never>?

    /// Replaces whatever played before. A clip the system cannot decode sets `failed`.
    func load(_ data: Data, autoplay: Bool) {
        stop()
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        #endif
        do {
            let fresh = try AVAudioPlayer(data: data)
            fresh.prepareToPlay()
            player = fresh
            duration = fresh.duration
            failed = false
            if autoplay { play() }
        } catch {
            failed = true
        }
    }

    func toggle() { isPlaying ? pause() : play() }

    func play() {
        guard let player else { return }
        if player.currentTime >= player.duration - 0.05 { player.currentTime = 0 }
        isPlaying = true
        guard !ClipSound.silent else { return }
        player.play()
        tick()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        elapsed = player?.currentTime ?? 0
        ticker?.cancel()
    }

    func seek(to time: TimeInterval) {
        guard let player else { return }
        player.currentTime = min(max(0, time), player.duration)
        elapsed = player.currentTime
    }

    /// Stops and forgets the clip, so a closed file stops making sound.
    func stop() {
        ticker?.cancel()
        player?.stop()
        player = nil
        isPlaying = false
        elapsed = 0
        duration = 0
        failed = false
    }

    private func tick() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard let self, let player = self.player else { return }
                self.elapsed = player.currentTime
                if !player.isPlaying {
                    // The clip ran to its end, so the next play starts it again.
                    self.isPlaying = false
                    return
                }
            }
        }
    }
}

enum ClipTime {
    /// 0:07, 3:25, 1:02:03.
    static func text(_ seconds: TimeInterval) -> String {
        let s = Int(max(0, seconds.rounded(.down)))
        return s >= 3600 ? "\(s / 3600):\(String(format: "%02d", s % 3600 / 60)):\(String(format: "%02d", s % 60))" : "\(s / 60):\(String(format: "%02d", s % 60))"
    }
}
