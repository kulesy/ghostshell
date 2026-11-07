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

    /// Ends when the caller stops iterating, the client is signed out or the path is refused. Any other drop waits a little and opens again.
    public func events() -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            let task = Task {
                var failures = 0
                while !Task.isCancelled {
                    do {
                        var parser = SSEParser()
                        for try await byte in try await open() {
                            if let event = parser.feed(byte) { failures = 0; continuation.yield(event) }
                        }
                    } catch GhostShellError.signedOut {
                        break
                    } catch GhostShellError.badPath {
                        break
                    } catch is CancellationError {
                        break
                    } catch {}
                    try? await Task.sleep(for: delays[min(failures, delays.count - 1)])
                    failures += 1
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
