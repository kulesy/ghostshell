import Foundation
import Security

/// Where a sign-in token lives. A token is kept per server address, so a changed address never finds another server's token.
public protocol TokenStore: Sendable {
    func token(for server: ServerAddress) async -> String?
    func save(_ token: String, for server: ServerAddress) async
    func clear(for server: ServerAddress) async
}

/// For tests and previews. Nothing reaches disk.
public actor MemoryTokenStore: TokenStore {
    private var tokens: [String: String] = [:]
    public init() {}
    public func token(for server: ServerAddress) -> String? { tokens[server.key] }
    public func save(_ token: String, for server: ServerAddress) { tokens[server.key] = token }
    public func clear(for server: ServerAddress) { tokens[server.key] = nil }
}

/// The Keychain, in the legacy file keychain on a Mac because it is the only one open to an ad hoc signed build.
///
/// NOTE: [7 Nov 2026] EK - A read can block on a macOS dialog, and `kSecUseAuthenticationUIFail` does not stop it. A build with a new code hash
/// is asked about once per entry. Every call therefore runs on its own queue, and a refusal or any failure reads as signed out.
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service: String
    private let queue = DispatchQueue(label: "ghostshell.keychain")

    /// Tests and the Debug app pass a service name that is new for the run, so they never read an entry made by another build.
    public init(service: String = "com.kulesy.ghostshell") { self.service = service }

    public func token(for server: ServerAddress) async -> String? {
        await onQueue { [service] in
            var query = Self.query(service, server)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var found: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
    }

    public func save(_ token: String, for server: ServerAddress) async {
        await onQueue { [service] in
            var item = Self.query(service, server)
            item[kSecValueData as String] = Data(token.utf8)
            #if !os(macOS)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            #endif
            if SecItemAdd(item as CFDictionary, nil) == errSecDuplicateItem {
                SecItemUpdate(Self.query(service, server) as CFDictionary, [kSecValueData as String: Data(token.utf8)] as CFDictionary)
            }
        }
    }

    public func clear(for server: ServerAddress) async {
        await onQueue { [service] in _ = SecItemDelete(Self.query(service, server) as CFDictionary) }
    }

    private static func query(_ service: String, _ server: ServerAddress) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: server.key]
    }

    private func onQueue<T: Sendable>(_ work: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { continuation in queue.async { continuation.resume(returning: work()) } }
    }
}
