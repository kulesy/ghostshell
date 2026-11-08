#if DEBUG
import GhostShellKit
import GhostShellScreens
import SwiftUI

/// Hooks for the scripted test run, compiled into Debug builds only. A Release build has none of this, and `apple/scripts/iphone.mjs` checks that.
/// They are read from the launch arguments and match the Mac app's names: -GSKeychainService, -GSAddress, -GSDefaultsSuite, -GSAppearance (light or dark).
enum DebugHooks {
    static var colorScheme: ColorScheme? {
        switch UserDefaults.standard.string(forKey: "GSAppearance") {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

    @MainActor static func makeModel() -> AppModel {
        let args = UserDefaults.standard
        let store: TokenStore = args.string(forKey: "GSKeychainService").map { KeychainTokenStore(service: $0) } ?? KeychainTokenStore()
        let defaults = args.string(forKey: "GSDefaultsSuite").flatMap { UserDefaults(suiteName: $0) } ?? .standard
        return AppModel(store: store, defaults: defaults, address: args.string(forKey: "GSAddress"))
    }
}
#endif
