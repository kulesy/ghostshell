# Build Capcom on Node's standard library and plain browser files

- Status: Partly superseded by [Preact with htm for the front end](20261015-preact-htm-front-end.md) and [a native Swift app](20261107-native-swift-app-keeps-the-node-server.md)
- Deciders: Eli
- Date: 2026-10-07
- Tags: dependencies, build, supply-chain, launchd

## Context and Problem Statement

Capcom runs as an always-on app on the owner's Mac. launchd starts it from the repo folder, and anyone who signs in can run commands as the owner. The owner's other always-on local apps use no packages, and Capcom followed the same pattern from its first build on 7 Oct, without a discussion of alternatives. On 15 Oct the owner asked why and reviewed the choice.

Should Capcom use packages and a build step, or only what Node and the browser provide?

## Decision Drivers

- launchd should run `node server.mjs` straight from the folder, with no install or build step.
- Each third-party package is another place for a compromised release to get in, in an app where signing in means running commands.
- The page was small: a session list and a chat view.
- Capcom should match the owner's other local apps.

## Considered Options

1. Node's built-in `http` and a plain HTML, CSS and JavaScript page
2. A web framework on the server and a framework with a build step for the page

## Decision Outcome

Chosen option: "Node's built-in `http` and a plain page", because nothing needs installing or building, and no outside code runs in the app.

`package.json` lists no dependencies and asks for Node 20 or later. The server uses `node:http` and Server-Sent Events for live updates. The page is plain HTML, CSS and JavaScript served as it is, with a small Markdown renderer in `public/md.mjs`.

**Reviewed 2026-10-15.** The server keeps its empty dependency list. For the page, [Preact with htm](20261015-preact-htm-front-end.md) replaced the hand-written JavaScript on 2026-10-15, still with no build step. The rewrite is in progress.

**Amended 2026-11-07.** The native Swift apps replace the page in steps, and they need a build. The server and the page keep everything above: no packages, no build step, and launchd runs the folder as it is. The Swift code keeps the same rule on packages and uses only Apple's SDKs. See [Replace the page with a native Swift app](20261107-native-swift-app-keeps-the-node-server.md).

### Consequences

- ✅ launchd runs the folder as it is, and there are no packages to update.
- ✅ No outside code runs in an app that can run commands.
- ❌ `public/app.js` keeps the page in step by hand, which gets harder as the page grows.
- ❌ Capcom maintains its own Markdown renderer.

## Pros and Cons of the Options

### Standard library and a plain page

- ✅ No install, build or package updates
- ✅ Few places for outside code to enter
- ❌ Page code needs more hand-written upkeep as it grows

### Frameworks and a build step

- ✅ Components and tooling that suit a large page
- ❌ An install and a build before each restart, and many more packages to trust, for a page this small

## Links

- Partly superseded by: [Preact with htm for the front end](20261015-preact-htm-front-end.md)
- Partly superseded by: [a native Swift app](20261107-native-swift-app-keeps-the-node-server.md)
- [Password sign-in and local bind](20261007-password-sign-in-and-local-bind.md)
