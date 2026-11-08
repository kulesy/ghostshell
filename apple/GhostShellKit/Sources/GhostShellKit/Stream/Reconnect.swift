import Foundation
import Network
import Synchronization

/// Tells every open stream to open again now. A phone wakes with sockets that look open and are dead, so waiting for the idle timeout would leave the chat stale.
public final class ReconnectSignal: Sendable {
    private let listeners = Mutex<[UUID: AsyncStream<Void>.Continuation]>([:])

    public init() {}

    /// A stream of nudges for one listener. A nudge sent before this is called is not replayed, because a listener that is just opening has the fresh state already.
    public func nudges() -> AsyncStream<Void> {
        let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        listeners.withLock { $0[id] = continuation }
        continuation.onTermination = { [weak self] _ in self?.listeners.withLock { $0[id] = nil } }
        return stream
    }

    public func nudge() {
        let all = listeners.withLock { Array($0.values) }
        all.forEach { $0.yield() }
    }
}

/// What the network looked like at one report: whether it can reach out, and by which interfaces.
public struct NetworkPath: Sendable, Equatable {
    public var satisfied: Bool
    public var interfaces: Set<String>

    public init(satisfied: Bool, interfaces: Set<String>) {
        self.satisfied = satisfied
        self.interfaces = interfaces
    }
}

/// Decides which network reports mean the streams should open again: the network came back, or it came back by another route (Wi-Fi to cellular, a VPN
/// switched on or off). A loss alone changes nothing, because there is nothing to open on. The first report is only the starting point.
public struct PathChanges: Sendable {
    private var last: NetworkPath?

    public init() {}

    public mutating func shouldReconnect(_ now: NetworkPath) -> Bool {
        defer { last = now }
        guard let last, now.satisfied else { return false }
        return !last.satisfied || last.interfaces != now.interfaces
    }
}

/// Calls `onChange` each time `PathChanges` says to. It listens until it is let go.
public final class PathWatcher: Sendable {
    private let monitor = NWPathMonitor()

    public init(onChange: @escaping @Sendable () -> Void) {
        let rule = Mutex(PathChanges())
        monitor.pathUpdateHandler = { path in
            let now = NetworkPath(satisfied: path.status == .satisfied, interfaces: Set(path.availableInterfaces.map(\.name)))
            if rule.withLock({ $0.shouldReconnect(now) }) { onChange() }
        }
        monitor.start(queue: DispatchQueue(label: "ghostshell.network-path"))
    }

    deinit { monitor.cancel() }
}
