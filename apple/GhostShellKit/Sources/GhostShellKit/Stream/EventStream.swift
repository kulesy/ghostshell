import Foundation

/// A server-sent event stream that opens again when it drops. Each open gets a fresh snapshot from the server, so nothing is replayed.
public struct EventStream: Sendable {
    public typealias Open = @Sendable () async throws -> AsyncThrowingStream<UInt8, Error>

    private let open: Open
    private let delays: [Duration]

    public init(delays: [Duration] = [.seconds(1), .seconds(2), .seconds(5)], open: @escaping Open) {
        self.open = open
        self.delays = delays
    }

    private enum Ending { case stop, dropped(heard: Bool), restart }

    /// Ends when the caller stops iterating, the client is signed out or the path is refused. Any other drop waits a little and opens again.
    /// A nudge from `restartedBy` closes the open stream and opens another at once, for the network coming back after a sleep.
    public func events(restartedBy nudges: (@Sendable () -> AsyncStream<Void>)? = nil) -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            let task = Task {
                var failures = 0
                while !Task.isCancelled {
                    switch await openOnce(continuation, nudges) {
                    case .stop:
                        continuation.finish()
                        return
                    case .restart:
                        failures = 0
                        continue
                    case .dropped(let heard):
                        if heard { failures = 0 }
                    }
                    try? await Task.sleep(for: delays[min(failures, delays.count - 1)])
                    failures += 1
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // The nudge listener is made for each open, so a nudge that lands while the stream is still opening is heard too.
    private func openOnce(_ continuation: AsyncStream<SSEEvent>.Continuation, _ nudges: (@Sendable () -> AsyncStream<Void>)?) async -> Ending {
        await withTaskGroup(of: Ending.self) { group in
            group.addTask { await read(continuation) }
            if let nudges {
                group.addTask {
                    for await _ in nudges() { return .restart }
                    while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
                    return .stop
                }
            }
            let first = await group.next() ?? .stop
            group.cancelAll()
            return first
        }
    }

    private func read(_ continuation: AsyncStream<SSEEvent>.Continuation) async -> Ending {
        var heard = false
        do {
            var parser = SSEParser()
            for try await byte in try await open() {
                if let event = parser.feed(byte) { heard = true; continuation.yield(event) }
            }
        } catch GhostShellError.signedOut {
            return .stop
        } catch GhostShellError.badPath {
            return .stop
        } catch is CancellationError {
            return .stop
        } catch {}
        return .dropped(heard: heard)
    }
}
