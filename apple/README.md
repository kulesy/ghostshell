# GhostShell for Mac, iPhone and Watch

This folder holds the native Swift app. The Node server in the repo root stays. The app is a second client of it, and it talks to the same routes the web page does.

This is the base. It has a project, sign-in, a shared client, a plain session list and a test method. Later PBIs add screens on top of it.

## Layout

```
apple/
  GhostShell.xcodeproj/        Hand-written project. Folder-synced, so a new Swift file edits nothing in it.
  GhostShell/                  The thin Mac app target: entry point, assets, Debug-only test hooks.
  GhostShellKit/               A local Swift package with two libraries.
    Sources/GhostShellKit/       No UI. Foundation and Security only. Builds for macOS, iOS and watchOS.
    Sources/GhostShellScreens/   SwiftUI. Builds for macOS and iOS.
    Tests/GhostShellKitTests/    Unit, integration and Keychain tests.
  Info.plist                   Only the local-network exception for http://localhost.
  scripts/                     Build, test, screenshot and install. All Node, no dependencies.
```

`GhostShellKit` holds the address check, the token store, the client, the event stream, the polling feed and the models. It has one request function. Every call goes through it, so the rules below hold for all of them.

1. The address is one type, `ServerAddress`. Plain http is allowed only for localhost. Everything else must be https.
2. The token lives in the Keychain and nowhere else. It is sent as a `Cookie` header that the client sets by hand.
3. The client has no cookie store and no cache. It refuses every redirect, so the token cannot follow one to another origin.
4. Every POST carries an `Origin` header, because the server refuses owner routes without one.
5. Nothing logs a token or a password.

## Build, run, test

Xcode 16.4 and Node 20 are enough. Nothing needs signing. The app uses an ad hoc signature.

| Command | What it does |
| --- | --- |
| `npm run apple:build` | Builds Debug into `apple/build`. Add `-- --release` for Release. A Release build is then searched for the Debug hooks and fails if it finds one. |
| `npm run apple:test` | Runs the unit tests, then the integration tests against scratch servers, then one Keychain round trip. `-- --unit` runs the unit tests only. |
| `npm run apple:shot` | Runs the Debug app against scratch servers, drives it, checks the flow and saves screenshots. See below. |
| `npm run apple:install` | Builds Release and copies it to `~/Applications/GhostShell.app`. An old copy moves to `~/junk`. `-- --dry-run` only reports. |
| `npm run apple:server` | Starts a scratch server and prints its address and the path of its password file. It stops on Ctrl-C. |

To run the app by hand, start `npm run apple:server`, open `apple/GhostShell.xcodeproj` in Xcode and run the GhostShell scheme. Type the printed address and the password from the file. The scratch server never touches port 4310 or your real state.

The first launch of a new build asks the Keychain for access to its own item. The ad hoc signature changes with every build, so macOS asks again after each rebuild. A stable signature from a paid developer account ends that.

## The test method

1. **Unit tests** run with `swift test` in `apple/GhostShellKit`. They use a stub `URLProtocol`, so they never open a socket.
2. **Integration tests** talk to a real scratch server. They cover sign-in, a wrong password, the lockout, an `Origin` check on a POST, sign-out revoking the token, the session index, the `status` event and a 401 after revoke.
3. **The app run** (`apple/scripts/shots.mjs`) launches the Debug app and drives it through System Events, because XCUITest is not available here. It signs in, checks the list, starts a real Haiku chat and checks that the row appears with no action in the window. It relaunches to check that the sign-in stays, then signs out.

The server for these runs is `node server.mjs` with its own state folder, home folder and port. The password is written to a file with the server's own `writePassword`. `CAPCOM_CLAUDE` points at a wrapper that restores the real home folder, so the Haiku chat is real.

### Screenshots

Screen capture permission is off for scripted runs. A Debug build therefore draws its own window into a PNG when a script writes `request.txt` into the folder named by `-GSShotDir`. `shots.mjs` does this for each state, in light and dark, at the default window size (960 by 640) and the minimum (640 by 420).

The default folder is `apple/screenshots`, which git ignores. Pass `--out <folder>` to save elsewhere.

The Debug hooks are launch arguments: `-GSKeychainService`, `-GSAddress`, `-GSDefaultsSuite`, `-GSAppearance` and `-GSShotDir`. They sit behind `#if DEBUG` in `apple/GhostShell/DebugHooks.swift`. Every run uses a new Keychain service name, so a run never reads an item that an older build made.

## Add a screen

1. Make a folder `GhostShellKit/Sources/GhostShellScreens/<Area>/` and put a SwiftUI view in a new file. SwiftPM picks it up. Nothing else changes.
2. If it needs the server, add `GhostShellKit/Sources/GhostShellKit/Endpoints/<Area>.swift` as an extension of `GhostShellClient`. Call `get` or `post`. Do not build a `URLRequest` anywhere else.
3. Show the screen with `navigator.show { MyScreen() }` from wherever the person reaches it, such as a sidebar row, a button or a menu command. The `Navigator` keeps the detail pane as a type-erased view, so there is no central list of destinations.
4. Read `AppModel` from the environment (`@Environment(AppModel.self)`) for the rows, the connection state and sign-out.
5. Add a unit test in `Tests/GhostShellKitTests`. Add an integration test if you add an endpoint.

Opening a session's `events` stream marks that session read. Open it only for the session the person is looking at, never for each row.

## Files that are still shared

A new Swift file edits none of these. Edit one only when the work needs it, and keep the change small.

1. `GhostShell.xcodeproj/project.pbxproj`: new targets (iPhone, Watch) and build settings.
2. `GhostShellKit/Package.swift`: a new target or dependency.
3. `GhostShellKit/Sources/GhostShellScreens/Shell/AppModel.swift`, `RootView.swift` and `Navigator.swift`.
4. `GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarScreen.swift`: the entry point for most screens.
5. `GhostShellKit/Sources/GhostShellKit/Client/GhostShellClient.swift`: the one request function.
6. `GhostShellKit/Sources/GhostShellKit/Models/SessionIndex.swift`: add new fields as optional so old servers still decode.
7. `GhostShell/GhostShellApp.swift`: scenes and menu commands.
8. `package.json`: the `apple:*` scripts.

## Folder map for later PBIs

Each row is a suggested home. Folders sit under `GhostShellScreens` and files under `GhostShellKit/Endpoints`, unless the row says otherwise.

| PBI | Screens folder | Kit file |
| --- | --- | --- |
| [https://github.com/kulesy/ghostshell/issues/83](https://github.com/kulesy/ghostshell/issues/83) Chat | `Chat/` (replaces the stub) | `Chat.swift` |
| [https://github.com/kulesy/ghostshell/issues/84](https://github.com/kulesy/ghostshell/issues/84) Composer | `Composer/` | `Composer.swift` |
| [https://github.com/kulesy/ghostshell/issues/85](https://github.com/kulesy/ghostshell/issues/85) Approvals | `Approvals/` | `Approvals.swift` |
| [https://github.com/kulesy/ghostshell/issues/86](https://github.com/kulesy/ghostshell/issues/86) Sidebar | `Sidebar/` | `Sessions.swift` |
| [https://github.com/kulesy/ghostshell/issues/87](https://github.com/kulesy/ghostshell/issues/87) Sidebar | `Sidebar/` | `Sessions.swift` |
| [https://github.com/kulesy/ghostshell/issues/88](https://github.com/kulesy/ghostshell/issues/88) Groups | `Groups/` | `Groups.swift` |
| [https://github.com/kulesy/ghostshell/issues/89](https://github.com/kulesy/ghostshell/issues/89) Files | `Files/` | `Files.swift` |
| [https://github.com/kulesy/ghostshell/issues/90](https://github.com/kulesy/ghostshell/issues/90) Widgets | `Widgets/` | `Widgets.swift` |
| [https://github.com/kulesy/ghostshell/issues/91](https://github.com/kulesy/ghostshell/issues/91) Terminal | `Terminal/` | `Terminal.swift` |
| [https://github.com/kulesy/ghostshell/issues/92](https://github.com/kulesy/ghostshell/issues/92) Routines | `Routines/` | `Routines.swift` |
| [https://github.com/kulesy/ghostshell/issues/93](https://github.com/kulesy/ghostshell/issues/93) Accounts | `Accounts/` | `Accounts.swift` |
| [https://github.com/kulesy/ghostshell/issues/94](https://github.com/kulesy/ghostshell/issues/94) Notifications | `Notifications/`, plus app-level code in `apple/GhostShell/` | `Notifications.swift` |
| [https://github.com/kulesy/ghostshell/issues/81](https://github.com/kulesy/ghostshell/issues/81) iPhone target | A new `apple/GhostShelliPhone/` folder next to `GhostShell/`. It edits the project file. | none |
| [https://github.com/kulesy/ghostshell/issues/95](https://github.com/kulesy/ghostshell/issues/95) Push | App-level code in the iPhone and Mac targets | `Push.swift` |
| [https://github.com/kulesy/ghostshell/issues/82](https://github.com/kulesy/ghostshell/issues/82) Watch | A new `apple/GhostShellWatch/` folder. It uses `GhostShellKit` only. It edits the project file. | none |

The two sidebar PBIs share one folder. Split the work by file inside `Sidebar/`.

## What the base does not do

1. Signing with a stable identity needs a paid developer account. Until then each new build asks for Keychain access once.
2. The iPhone and Watch targets are not in the project yet. The Kit already builds for both. The Watch library is type-checked only, because this machine has no watchOS runtime to link against.
3. The session list polls every 3 seconds while the window is visible. The server has no push for the index. A push would replace `SessionIndexFeed` without touching its callers.
