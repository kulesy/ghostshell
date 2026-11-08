import Foundation

public enum FeedConnection: Sendable, Equatable { case connecting, live, unreachable }

public enum FeedUpdate: Sendable, Equatable {
    case index(SessionIndex)
    case connection(FeedConnection)
}

/// The live list of sessions. Callers read `updates` and call `pause` and `resume` as the app hides and shows.
///
/// NOTE: [7 Nov 2026] EK - The server has no push for the index, so this polls `api/sessions` every 3 seconds. A push replaces the polling inside this type only.
public actor SessionIndexFeed {
    public nonisolated let updates: AsyncStream<FeedUpdate>

    private let fetch: @Sendable () async throws -> SessionIndex
    private let interval: Duration
    private let continuation: AsyncStream<FeedUpdate>.Continuation
    private var task: Task<Void, Never>?
    private var last: SessionIndex?
    private var connection = FeedConnection.connecting
    private var stopped = false

    public init(fetch: @escaping @Sendable () async throws -> SessionIndex) {
        self.init(interval: .seconds(3), fetch: fetch)
    }

    init(interval: Duration, fetch: @escaping @Sendable () async throws -> SessionIndex) {
        self.interval = interval
        self.fetch = fetch
        (updates, continuation) = AsyncStream.makeStream()
    }

    /// Starts, or starts again after `pause`, with a look at once.
    public func resume() {
        guard !stopped, task == nil else { return }
        task = Task { await self.run() }
    }

    /// Looks now, so a change the app just made shows without waiting for the next look. The timed looks carry on as before.
    public func refresh() async {
        guard !stopped else { return }
        await poll()
    }

    /// Stops looking while the app is hidden.
    public func pause() {
        task?.cancel()
        task = nil
    }

    /// Ends the feed for good.
    public func stop() {
        stopped = true
        pause()
        continuation.finish()
    }

    private func run() async {
        while !Task.isCancelled {
            await poll()
            try? await Task.sleep(for: interval)
        }
    }

    private func poll() async {
        do {
            let index = try await fetch()
            guard !Task.isCancelled else { return }
            report(.live)
            if index != last {
                last = index
                continuation.yield(.index(index))
            }
        } catch GhostShellError.signedOut {
            stop()
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled { report(.unreachable) }
        }
    }

    private func report(_ state: FeedConnection) {
        guard state != connection else { return }
        connection = state
        continuation.yield(.connection(state))
    }
}
