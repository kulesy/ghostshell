# GhostShell for Mac, iPhone and Watch

This folder holds the native Swift app. The Node server in the repo root stays. The app is a second client of it, and it talks to the same routes the web page does.

This is the base. It has a project, sign-in, a shared client, a plain session list and a test method. Later PBIs add screens on top of it.

## Layout

```
apple/
  GhostShell.xcodeproj/        Hand-written project. Folder-synced, so a new Swift file edits nothing in it.
  GhostShell/                  The thin Mac app target: entry point, assets, Debug-only test hooks.
  GhostShelliPhone/            The thin iPhone app target: entry point, assets, Debug-only test hooks.
  GhostShelliPhoneUITests/     XCUITests that drive the iPhone app in the Simulator.
  GhostShellWatch/             The watch app: screens, the link to the iPhone, Debug-only test hooks. It uses GhostShellKit only.
  GhostShellKit/               A local Swift package with two libraries.
    Sources/GhostShellKit/       No UI. Foundation, Security and Network only. Builds for macOS, iOS and watchOS. `Watch/` holds the relay between the watch and the iPhone.
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
| `npm run apple:ios-build` | Builds the iPhone app for the Simulator (Debug). Add `-- --release` for a Release device build with signing off, which is then searched for the Debug hooks like the Mac one. |
| `npm run apple:watch-build` | Builds the watch app for the Simulator (Debug). Add `-- --release` for a Release device build with signing off, which is then searched for the Debug hooks. The iPhone app embeds the watch app, so `apple:ios-build` builds it too. |
| `npm run apple:ios-shot` | Runs the iPhone UI tests on an iPhone SE (3rd generation) and an iPhone 16 Pro, light and dark, and saves screenshots to `apple/screenshots/iphone`. See below. |
| `npm run apple:server` | Starts a scratch server and prints its address and the path of its password file. It stops on Ctrl-C. |

To run the app by hand, start `npm run apple:server`, open `apple/GhostShell.xcodeproj` in Xcode and run the GhostShell scheme. Type the printed address and the password from the file. The scratch server never touches port 4310 or your real state.

The first launch of a new build asks the Keychain for access to its own item. The ad hoc signature changes with every build, so macOS asks again after each rebuild. A stable signature from a paid developer account ends that.

## The iPhone app

`GhostShelliPhone` is an iPhone-only target for iOS 18.0 and later (bundle id `com.kulesy.ghostshell.iphone`). It shows the same `RootView` as the Mac. The split view collapses to a stack, the navigator drives it and Back clears the navigator. Accounts, Passkeys and Sign Out are in the More menu at the end of the sidebar's toolbar. Sign-in takes the address and a password, with no passkey step. The Keychain, the client and the sign-in rules are the Mac's. It has no notifications, composer or entitlements yet.

The stream reconnects at once when the app becomes active and when the network path changes to a usable one or to another interface (`ReconnectSignal` and `PathWatcher` in the Kit). A path report that changes nothing does nothing.

`npm run apple:ios-shot` boots the Simulators with `simctl boot` and never opens the Simulator window, so it can run while the Mac is in use. It starts the chat stub behind a small proxy that adds the Accounts, banner and passkey routes and records every widget send and approval, then runs `GhostShelliPhoneUITests` through `xcodebuild`. The tests sign in, open a chat, scroll, go Back, tap the button in a widget (the stub must then have recorded exactly one send, which proves the owner click is counted on iOS), answer an approval, and open Accounts, Passkeys and Sign Out. They also check that the controls they touch are at least 44pt. `--device se|16pro`, `--only light|dark` and `--test <name>` narrow a run. The iPhone SE (3rd generation) simulator is created when it is missing. Every simulator the run booted is shut down at the end.

A phone needs no paid account to run the app, but installing it is a signing step done once in Xcode. Open `apple/GhostShell.xcodeproj`, pick the GhostShelliPhone target, choose a free personal team under Signing, and run it on the phone. The project holds no team, so nothing in the repo changes.

## The test method

1. **Unit tests** run with `swift test` in `apple/GhostShellKit`. They use a stub `URLProtocol`, so they never open a socket.
2. **Integration tests** talk to a real scratch server. They cover sign-in, a wrong password, the lockout, an `Origin` check on a POST, sign-out revoking the token, the session index, the `status` event and a 401 after revoke.
3. **The app run** (`apple/scripts/shots.mjs`) launches the Debug app in the background and drives it through accessibility, because XCUITest is not available here. It signs in, checks the list, starts a real Haiku chat and checks that the row appears with no action in the window. It relaunches to check that the sign-in stays, then signs out. A last pass signs in to a small stub that answers sign-in, the list and the archive, because a chat waiting on an approval or a failed turn can't be had on demand, and it shows all four status marks. The first pass also checks the bell, the Settings pane and a finished-chat alert, and the stub pass checks a needs-you alert and the Dock count. A third pass signs in to the chat stub in `apple/scripts/chat-fixtures.mjs`, which serves a rich chat, a reply that streams in, a 600-pair chat to scroll up through, an empty chat, a chat of widgets and a widget that asks before it sends, because those can't be had on demand either. Widgets are Claude's HTML in a web view, and `GhostShellKit/Sources/GhostShellKit/Widgets/WidgetPage.generated.swift` is generated from the web page by `apple/scripts/widget-frame.mjs`. Regenerate it with `node apple/scripts/widget-frame.mjs`, never edit it by hand. `--check` reports whether it is stale. A fourth pass runs the Accounts, Passkeys, banner and context meter screens against a stub server that answers only those routes and records every call, so no real account, restart or browser is touched. A fifth pass shows a permission, a question and a plan waiting on the chat stub, picks one option and then two of a many-choice question, and shows a failed Deny. A sixth pass organises sessions on the scratch server. A seventh opens the Routines and Scheduled screens against a stub that records and refuses every write, so no real routine is made, run or deleted. An eighth signs in to the files stub in `apple/scripts/files-fixtures.mjs`, which serves one chat that links a markdown file, a text file, a PDF, two audio clips, a binary file and a missing file and carries pictures, with every fixture byte built in code. It opens each through its link and then the picture viewer. A ninth, the groups pass, signs in to the stub in `apple/scripts/group-fixtures.mjs`, which serves a group of sessions in every part, pull requests in two states, a chat with suggested tasks, a first chip Start that fails and a reply the server refuses, and records every call. `--flow main`, `marks`, `chats`, `widgets`, `accounts`, `approvals`, `organise`, `routines`, `files` or `groups` runs one pass alone, `--chats-only` runs the chats and widgets passes, `--widgets-only` is `--flow widgets`, `--approvals-only` is `--flow approvals` and `--files-only` is `--flow files`. `--no-files` skips the files pass. The finished Haiku chat is copied into the scratch server as a plain file (`copyTranscript` in `test-server.mjs`), because the server's transcript index skips a symlinked folder.

The server for these runs is `node server.mjs` with its own state folder, home folder and port. The password is written to a file with the server's own `writePassword`. `CAPCOM_CLAUDE` points at a wrapper that restores the real home folder, so the Haiku chat is real. It runs in `/private/tmp/claude-501/capcom-test-cwd/swift-app`.

### Screenshots

Screen capture permission is off for scripted runs. A Debug build therefore draws its own window into a PNG when a script writes `request.txt` into the folder named by `-GSShotDir`. `shots.mjs` does this for each state, in light and dark, at the default window size (960 by 640) and the minimum (640 by 420).

The app is launched with `open -g -n`, so it never comes to the front, and with `-NSAppSleepDisabled YES`, so App Nap does not slow it down. Its window can sit under others. The shots show the inactive look (grey traffic lights, no focus ring). A run drives the app through `apple/scripts/ax.swift`, a small helper that `shots.mjs` compiles into `apple/build/ax`. The helper talks to the app by its pid through the accessibility API. It reads the window's tree and presses, sets and confirms elements. It sends no keystroke and no click, and it never uses System Events, which finds a process by name and could pick another GhostShell. A check every half second fails the run if a test app is ever the front app. Because the window may be covered, a Debug build with `-GSShotDir` keeps polling the server (`AppModel.ignoresOcclusion`). A widget only counts a real owner click, which an accessibility press is not, so the same build has a second watcher: the script writes `click.txt` (`<number> <x> <y>`, a screen point from the accessibility tree) and the app sends a mouse down and up there to its own window. It runs only under `#if DEBUG` with `-GSShotDir`, so a Release build has no such path. That build is also an accessory app (`setActivationPolicy(.accessory)`), because macOS puts a regular test app in front when a sibling test app quits, which would break runs that go at once.

The default folder is `apple/screenshots`, which git ignores. Pass `--out <folder>` to save elsewhere.

The Debug hooks are launch arguments: `-GSKeychainService`, `-GSAddress`, `-GSDefaultsSuite`, `-GSAppearance`, `-GSShotDir`, `-GSNotify on` and `-GSAlertLog <file>`. A run with `-GSDefaultsSuite` starts with notifications off, so it never raises the system permission dialog, unless it passes `-GSNotify on`. `-GSAlertLog` swaps the notification centre for a file that gets one line per alert. They sit behind `#if DEBUG` in `apple/GhostShell/DebugHooks.swift`. Every run uses a new Keychain service name, so a run never reads an item that an older build made.

## Add a screen

1. Make a folder `GhostShellKit/Sources/GhostShellScreens/<Area>/` and put a SwiftUI view in a new file. SwiftPM picks it up. Nothing else changes.
2. If it needs the server, add `GhostShellKit/Sources/GhostShellKit/Endpoints/<Area>.swift` as an extension of `GhostShellClient`. Call `get`, `post` or `send` for JSON. Call `data(method, path, query:, body:, contentType:)` for DELETE, PATCH, a raw byte upload (`?path=` and a file name go in `query`) or a raw byte read. Do not build a `URLRequest` anywhere else. The client sets Cookie and Origin itself and refuses a `contentType` with a control character.
3. Show the screen with `navigator.show { MyScreen() }` from wherever the person reaches it, such as a sidebar row, a button or a menu command. The `Navigator` keeps the detail pane as a type-erased view, so there is no central list of destinations.
4. Read `AppModel` from the environment (`@Environment(AppModel.self)`). It exposes `client` for calls, `index` for the whole session index, `rows`, the connection state and sign-out. None of that needs an edit to `AppModel.swift`. State that several slots share, such as the routines the sidebar and the Routines screen both show, lives in a store on `AppModel` (`RoutinesStore`) with `start`, `stop` and `setVisible`, which `AppModel` calls on sign-in, sign-out and window visibility. That one line in `AppModel.swift` is the edit.
5. Add a unit test in `Tests/GhostShellKitTests`. Add an integration test if you add an endpoint.

Opening a session's `events` stream marks that session read. Open it only for the session the person is looking at, never for each row.

## The watch app

`GhostShellWatch` is a watchOS 11.0 app (bundle id `com.kulesy.ghostshell.iphone.watchkitapp`) that the iPhone app embeds. It lists the sessions waiting on the owner, opens one to show its question or Claude's latest message, answers a question card, and sends a typed or dictated reply.

The watch talks only to the iPhone app, over WatchConnectivity. The iPhone makes each server call with its own token through `AppModel.client`, so the watch holds no token, no address and no `GhostShellClient`. The watch has no Tailscale, and watchOS limits what an app may open for itself, so a request from the watch would fail on the road the owner uses. WatchConnectivity needs no entitlement, so a free personal team signs it.

1. `GhostShellKit/Watch/WatchRelay.swift` is the wire protocol: a versioned request (waiting, one session, reply, answer) and response, as JSON under the key `gs`.
2. `WatchRelayHandler` runs on the iPhone. It checks every field and maps each request onto the client's existing calls (`sessionIndex`, `messages`, the first `status` frame of `eventStream`, `sendPrompt`, `decide`). It turns errors into the watch's three unreachable states: "Can't reach your iPhone", "Your iPhone can't reach GhostShell" and "Sign in on your iPhone".
3. `WatchOutbox` keeps a typed reply on the watch before it is sent and removes it only when the iPhone says the server took it. A reply or answer survives a relaunch and has Send again and Discard. Each carries an id, and the iPhone remembers the last 50 it delivered, so asking twice sends one message.
4. `GhostShelliPhone/WatchLink.swift` is the iPhone's side of WatchConnectivity. It starts in the app's `init`, because a message from the watch can launch the iPhone app in the background with no scene.

A question card is answered with `decide`, never as a message. `/send` does not look at a pending card, and the CLI holds a message sent mid-turn until the tool finishes, so a reply typed into a session that waits on a question would queue behind the card and leave it open. The watch shows a question with one single-choice part as tappable options (44pt) with a field for the owner's own answer, and sends the same `answers` dictionary the Mac's Approvals screen builds (`Approvals.answers`, keyed by the question's text). A multi-select or multi-part question says "Answer this one on your iPhone or Mac". A permission or a plan is read-only on the watch with a line saying where to answer, and a session waiting on one has no reply box. A 410 shows "Already answered elsewhere", drops the kept answer and refreshes.

The list polls through the iPhone every 5 seconds and a session every 8, only while the watch app is active. Opening a session's `events` stream marks it read, so the iPhone opens it only for the session the watch is showing.

A typed reply goes through `sendPrompt`, as a new message. It does not answer a pending permission or question card, which the Mac and iPhone screens answer with a decision.

Debug builds read launch arguments to drive the app in the Simulator: `-GSWatchFixture` (`list`, `phone`, `server` or `signedout`) serves canned answers with no iPhone, `-GSWatchOpen <session id>` with `-GSWatchOpenTitle`, `-GSWatchDraft <text>`, `-GSWatchSend 1`, `-GSWatchTap <option>` (answers the open question as its button does) and `-GSDefaultsSuite`. A Release build has none of them, and `apple:watch-build -- --release` checks that.

To check the whole road in the Simulator, pair a watch and an iPhone simulator with `xcrun simctl pair`, boot both with `simctl boot`, sign the iPhone Debug app in to a scratch server with `-GSKeychainService`, `-GSDefaultsSuite` and `-GSAddress`, install `GhostShellWatch.app` on the watch with `simctl install` and launch it with the arguments above. The Simulator cannot dictate, so type the reply by launch argument. It also cannot say whether a real watch reaches the server through the iPhone's Tailscale, so that needs the real devices.

A watch needs no paid account either. Open `apple/GhostShell.xcodeproj`, choose a free personal team under Signing for the GhostShelliPhone and GhostShellWatch targets, and run GhostShelliPhone on the phone with the watch paired. A free team signs for 7 days, so the app stops opening after a week and running it from Xcode again installs it afresh.

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
9. `GhostShellKit/Sources/GhostShellScreens/Chat/ChatSlots.swift`: where the later chat PBIs plug in. Each one replaces only its own slot bodies, so two PBIs merge cleanly.
10. `apple/scripts/shots.mjs`: the app run. It sends no key or click, so runs can go at the same time. Two steps share `apple/build`, building the app and compiling the helper, so each run waits for a small lock folder there (`shots-build.lock`, holding the owner pid) and releases it right after. A lock whose owner is dead is cleared.

    Some chat controls need help to be driven through accessibility, so the driver works around them:
    - The chat's contents come through twice, a stale copy with old frames and a live copy. The driver takes the last match, which is the live one.
    - An AXPress on a text link hands the URL to macOS and skips the app's own handler. `MarkdownView` gives each link line an accessibility action named "Open <text>" that calls the app's `OpenURLAction`, and `clickLink` runs that action. `ax act` picks an app-given action by its name.
    - A picture tile's name is an attributed description, so `clickTile` matches the "View image N of M" labels and orders them by position.
    - An icon-only button gives its name only as help text, so the driver reads `desc` and falls back to `help`.
    - The viewer's buttons (Previous image, Next image, Close), alert buttons and Save are pressed by name. The file editor is the text area named "File text"; the driver sets its focus and types into it.

## Folder map for later PBIs

Each row is a suggested home. Folders sit under `GhostShellScreens` and files under `GhostShellKit/Endpoints`, unless the row says otherwise.

| PBI | Screens folder | Kit file |
| --- | --- | --- |
| [https://github.com/kulesy/ghostshell/issues/83](https://github.com/kulesy/ghostshell/issues/83) Chat | `Chat/` (built) | `Chat.swift` |
| [https://github.com/kulesy/ghostshell/issues/84](https://github.com/kulesy/ghostshell/issues/84) Composer | `Composer/` | `Composer.swift` |
| [https://github.com/kulesy/ghostshell/issues/85](https://github.com/kulesy/ghostshell/issues/85) Approvals | `Approvals/` (built) | `Approvals.swift`, `Rules/ApprovalRules.swift` |
| [https://github.com/kulesy/ghostshell/issues/86](https://github.com/kulesy/ghostshell/issues/86) Sidebar | `Sidebar/` | `Sessions.swift` |
| [https://github.com/kulesy/ghostshell/issues/87](https://github.com/kulesy/ghostshell/issues/87) Organise | `Organise/` (built) | `Layout.swift` |
| [https://github.com/kulesy/ghostshell/issues/88](https://github.com/kulesy/ghostshell/issues/88) Groups | `Groups/` (built) | `Groups.swift` |
| [https://github.com/kulesy/ghostshell/issues/89](https://github.com/kulesy/ghostshell/issues/89) Files | `Files/` (built) | `Files.swift` |
| [https://github.com/kulesy/ghostshell/issues/90](https://github.com/kulesy/ghostshell/issues/90) Widgets | `Widgets/` (built) | `Widgets.swift` |
| [https://github.com/kulesy/ghostshell/issues/91](https://github.com/kulesy/ghostshell/issues/91) Terminal | `Terminal/` | `Terminal.swift` |
| [https://github.com/kulesy/ghostshell/issues/92](https://github.com/kulesy/ghostshell/issues/92) Routines | `Routines/` (built) | `Routines.swift` |
| [https://github.com/kulesy/ghostshell/issues/93](https://github.com/kulesy/ghostshell/issues/93) Accounts | `Accounts/` (built) | `Accounts.swift` |
| [https://github.com/kulesy/ghostshell/issues/94](https://github.com/kulesy/ghostshell/issues/94) Notifications | `Notifications/`, plus app-level code in `apple/GhostShell/` | `GhostShellKit/Notifications/SessionAlerts.swift` |
| [https://github.com/kulesy/ghostshell/issues/81](https://github.com/kulesy/ghostshell/issues/81) iPhone target | A new `apple/GhostShelliPhone/` folder next to `GhostShell/`. It edits the project file. | none |
| [https://github.com/kulesy/ghostshell/issues/95](https://github.com/kulesy/ghostshell/issues/95) Push | App-level code in the iPhone and Mac targets | `Push.swift` |
| [https://github.com/kulesy/ghostshell/issues/82](https://github.com/kulesy/ghostshell/issues/82) Watch | A new `apple/GhostShellWatch/` folder. It uses `GhostShellKit` only. It edits the project file. | none |

86 and 87 split the sidebar work: 86 is in `Sidebar/` and 87 is in `Organise/`.

## Sidebar slots

`Sidebar/SidebarSlots.swift` holds the places later features plug into the sidebar. The sidebar already draws each one, and each is empty. A feature writes its view or modifier in its own folder and adds one line to the slot's body. Slots read `SidebarState` (the view, folds, selection and search text) from the environment.

| Slot | What it is | Who fills it |
| --- | --- | --- |
| `SidebarToolbarSlot` | Buttons at the end of the sidebar toolbar, beside Sign Out | 87 (New group), 92 (Routines, Scheduled), 94 (notification bell) |
| `ViewMenuSlot` | Items at the end of the Home and projects menu | 87 (new and edit projects) |
| `SessionRowMenuSlot` | A session row's right-click menu | 87 (rename, move, nest, archive), 92 (routine items) |
| `SessionRowSlot` | Modifiers on each session row | 87 (drag and drop) |
| `HeadingAccessorySlot` | Small buttons on a section or group heading, before its count | 88 (open the group chat, as a tap gesture with a named action, not a `Button`, so an accessibility press on the heading still folds it. A real mouse click on the icon is not covered by the shots, because a background test app swallows clicks on list rows) |
| `HeadingMenuSlot` | A heading's right-click menu | 87 (rename, move, delete a group), 88 |
| `HeadingSlot` | Modifiers on each heading | 87 (drop target) |
| `HomeTopSectionsSlot` | Whole sections at the top of Home | 92 (Scheduled) |
| `IdleRoutineRowSlot` | The row for a routine that has never run, drawn in its routine bucket | 92 (idle routines) |
| `SidebarWatchSlot` | Modifiers on the whole sidebar, for work that watches the index or the chosen session | 92 (routines). 94 (notifications) does not use it, because `SessionNotifier` is owned by the app and keeps working with the sidebar collapsed |

Idle routines reach the sidebar through `SidebarState.idleRoutines`, because the index never carries a routine that has not run. 92 shares one store, `AppModel.routines` (`RoutinesStore`), between its Routines and Scheduled screens and its slots. The store polls `/api/routines` while the window is visible, with `start`, `stop` and `setVisible` called from `AppModel`, and the `SidebarWatchSlot` modifier copies its idle routines into `idleRoutines`. A routine made or deleted in a screen updates every slot through the same store, so neither edits the outline or the sections.

`SessionIndexFeed` pauses while the window is hidden, so notifications (94) keep it running through `AppModel.watchesWhileHidden`.

Selection is a set. One chosen row opens its session, and several stay chosen for 87's bulk actions.

A slot view of 87 reads `OrganiseModel` from the environment. `OrganiseHost`, applied in `SidebarScreen.swift`, provides it and shows its alerts and name sheets, so a slot view built outside the sidebar needs the model as an optional. After any write, a feature calls `AppModel.refreshIndex()` so the sidebar does not wait for the next poll.

## What the base does not do

1. Signing with a stable identity needs a paid developer account. Until then each new build asks for Keychain access once.
2. The watch app has been run only in the Simulator, paired with an iPhone Simulator, and not on a real watch. It cannot dictate in the Simulator, and the Simulator cannot show whether a watch reaches the server through the iPhone's Tailscale. The iPhone app has no composer, notifications or phone layout for the screens in https://github.com/kulesy/ghostshell/issues/114.
3. The session list polls every 3 seconds while the window is visible, and keeps polling while hidden when notifications are on, so alerts arrive within a few seconds. The server has no push for the index. A push would replace `SessionIndexFeed` without touching its callers.
