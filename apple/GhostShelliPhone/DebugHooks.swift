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
        // A UI test run always passes this. The Simulator plays a clip through the Mac's speakers (https://github.com/kulesy/ghostshell/issues/127). It also stills spinners and clocks so the iOS 27 runner is not left waiting on them (https://github.com/kulesy/ghostshell/issues/148).
        if ProcessInfo.processInfo.arguments.contains("-GSKeychainService") { ClipSound.silent = true; LiveMotion.still = true }
        let store: TokenStore = args.string(forKey: "GSKeychainService").map { KeychainTokenStore(service: $0) } ?? KeychainTokenStore()
        let defaults = args.string(forKey: "GSDefaultsSuite").flatMap { UserDefaults(suiteName: $0) } ?? .standard
        if let folder = args.string(forKey: "GSAttachDir") { AttachWatcher.start(folder: URL(fileURLWithPath: folder)) }
        return AppModel(store: store, defaults: defaults, address: args.string(forKey: "GSAddress"))
    }
}

/// The Files sheet is empty on a fresh Simulator, and a test can't put a file into it. With `-GSAttachDir <folder>` a test writes `attach.txt` holding
/// `<number> <file path>` there, and the composer attaches that file as if the sheet had returned it. The Photos picker is driven for real.
@MainActor
enum AttachWatcher {
    private static var handled = ""
    private static var timer: Timer?

    static func start(folder: URL) {
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
            MainActor.assumeIsolated {
                guard let request = try? String(contentsOf: folder.appendingPathComponent("attach.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
                      request != handled, let space = request.firstIndex(of: " ") else { return }
                handled = request
                NotificationCenter.default.post(name: Notification.Name("GSDebugAttach"), object: String(request[request.index(after: space)...]))
            }
        }
    }
}
#endif
