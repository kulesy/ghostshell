# Replace the page with a native Swift app, and keep the Node server

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-07
- Tags: swift, macos, ios, watchos, clients, authentication, build

Technical Story: https://github.com/kulesy/ghostshell/issues/80, under the tracker https://github.com/kulesy/ghostshell/issues/97

## Context and Problem Statement

GhostShell is a web page served by a Node server on the owner's Mac. The owner wants a native app on the Mac, iPhone and watch in place of the page. The server does work a client can't: it drives the Claude CLI, runs routines, and holds the macOS permissions through Capcom.app.

What should replace the page, what happens to the server, and how does the page leave without the owner losing anything on the way?

## Decision Drivers

- A real native app on each device, with no web view around the page.
- The server keeps its job, its launcher and its API.
- The owner keeps a working client at every step of the move.
- One client library serves the Mac and iPhone. The watch uses the Kit's relay types and goes through the iPhone (see the 9 Nov 2026 note below).
- Many sessions can build screens at once without touching the same files.
- Signing in still means a shell on the Mac, so the token gets the same care as a password.

## Considered Options

1. Native SwiftUI apps that talk to the existing server
2. A native window around the page
3. Electron
4. Flutter

## Decision Outcome

Chosen option: "Native SwiftUI apps that talk to the existing server", because it is the only option that gives a native app on all three devices, and it leaves the server as it is.

- **The server stays.** Node stays on the Mac. The Swift apps use the same HTTP API and Server-Sent Events as the page. `macos/`, Capcom.app and the launchd job stay as they are, because they run the server. GhostShell.app is a client with its own name and bundle id, and it runs nothing.
- **The page stays until Swift matches it.** The tracker lists the screens. The page goes only when everything the owner uses on it works in the apps. Until then GhostShell has two clients, and a new feature needs building in both.
- **No web view around the page.** The one exception is widgets, which stay HTML in a sandboxed web view, because a widget is HTML that a chat writes.
- **Layout.** `apple/` holds an Xcode project with a Mac target, an iPhone target, a watch target and a local Swift package. `GhostShellKit` is the client, with no UI, and builds for macOS, iOS and watchOS. `Sources/GhostShellKit/Watch/` holds the relay between the watch and the iPhone. `GhostShellScreens` holds the SwiftUI screens, one folder each, and builds for macOS and iOS. The app target is a thin entry point. The project uses synced folders and SwiftPM finds a package's files by folder, so adding a Swift file edits no shared project file. `apple/README.md` has the map of which screen goes where.
- **Sign-in.** The app posts the password to `login`, as the page does, and keeps the token from `Set-Cookie` in the Keychain, under the server's address. It sends the token in a `Cookie` header it writes itself, with no cookie store, and sends `Origin` on every write, because the owner's routes refuse a write without one. The server's sign-in is unchanged: the expiry rules, the lock after ten wrong guesses and sign-out all apply to the app as they do to a browser.
- **What the page gets from the browser, the app does itself.** It allows plain http only to the Mac's own loopback address and needs https everywhere else. It refuses every redirect, because a header written by hand would follow one to another host. A token stored for one address never goes to another.
- **Live updates.** A chat's events come over the same Server-Sent Events stream as the page. That stream clears the chat's unread mark when it opens, so the app opens it only for the chat on screen. The session list has no live stream on the server, so the app asks for `api/sessions` every 3 seconds while its window shows, and while hidden when notifications are on, where the page asks every 15. The list sits behind one type, so a stream from the server can replace the asking without any screen changing.
- **Dependencies.** The Swift code uses Apple's SDKs and no third-party packages, for the same reason as the [server](20261007-no-dependencies-no-build-step.md). The server and the page still have no build step. The Swift apps need one.
- **Signing.** The Mac app is signed ad hoc until the owner has a paid Apple Developer account. The iPhone app runs on the owner's free Apple ID, which signs it for 7 days at a time and has no associated domains, so it signs in with the password only. Push needs the paid account.
- **Watch (amended 9 Nov 2026).** The watch app does not use the shared client. It asks the iPhone app over WatchConnectivity, and the iPhone makes the server call with its own token. Apple's TN3135 limits what a watch app may open for itself, and WatchConnectivity needs no entitlement, so the free Apple ID signs it. The watch holds no token and no address.

### Consequences

- ✅ The owner gets native apps, and the server, its launcher and its API don't change.
- ✅ The iPhone joins as a target on the same client, and the watch asks the iPhone to use it, so there is no second copy of sign-in or the API.
- ✅ A new screen is a new folder, so parallel sessions rarely touch the same file.
- ❌ A Swift change needs a new build to go live, where a page change needs a reload.
- ❌ Features get built twice until the page goes.
- ❌ With ad hoc signing, macOS can't tell that a new build is the same app, so it asks once for the Keychain item after each new build. A stable signature from the paid account ends that.
- ❌ Asking for the list every 3 seconds costs the server more than the page's 15 seconds. It stops when the window is hidden, unless notifications are on.
- ❌ The app depends on the cookie's name and on the text of the locked sign-in page. A note on each side of that boundary says so.

## Pros and Cons of the Options

### Native SwiftUI apps

- ✅ Native controls, Keychain, notifications and a watch app
- ✅ One language and one client across the three devices
- ❌ Every screen gets written again

### A native window around the page

- ✅ The quickest to build, with one set of screens
- ❌ It stays a web page, which is what the owner wants to replace

### Electron

- ✅ Reuses the page
- ❌ It is a web page in a bundled browser, and it has no iPhone or watch app

### Flutter

- ✅ One code base for phones and desktops
- ❌ It draws its own controls, and it has no real watch support

## Links

- [Build on Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md), amended for this decision
- [Make Capcom the only client](20261015-capcom-is-the-only-client.md), amended for this decision
- [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md), amended for this decision
- [Capcom app for macOS permissions](20261016-capcom-app-for-macos-permissions.md), which stays
- [Make Ghost the look on every device](20261022-ghost-look.md), the look the app follows
