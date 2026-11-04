# Setup

How to set the password, start the server, run the tests, sign in with a password or a passkey and install GhostShell as an app.

## Set the password and start the server

```bash
npm run set-password
node server.mjs
```

There are no npm dependencies (Node 20 or later), and the page's libraries are vendored. GhostShell keeps the password only as a scrypt hash in `~/.config/capcom/auth.json`, and setting a new one signs every browser out and removes every passkey. Until one is set, GhostShell refuses every request.

## Tests

`npm test` runs the unit tests with Node's own test runner. They cover:

- the file uploads
- the cron parser
- the routine scheduler
- the start timeout
- the transcript parser
- the live work tracker
- the messages the CLI holds
- the thread display
- the order of a group
- the layout file
- the project and group routes
- the arrow-key and move rules of the sidebar tree
- which view of the list holds a session
- what a view's lamp and count show and which views a search finds
- the session list and what a message does to it
- the sign-in and the passkey checks

The tests of the model menu in a page run it in Playwright's Chromium headless shell, the newest in Playwright's cache or the one that `CAPCOM_BROWSER` names, and skip when there is none.

## How long a sign-in lasts

A browser that signs in stays signed in while it is used at least every 90 days, for up to a year from the sign-in. Each day it is used, GhostShell pushes the expiry 90 days out, but no later than a year after the sign-in, and sends the cookie again with the time that is left. GhostShell records, for every sign-in, when it was made, when it was last used and a short device label such as "Chrome 155 on macOS".

## Passkeys

Passkeys are the second way in. A passkey signs you in with a fingerprint, face or screen lock, and the password keeps working beside it. After a password sign-in the page offers once to add one, and Passkeys, in the Account menu at the foot of the session list, adds, lists and removes them.

Browsers offer passkeys only on an https address or on localhost, so http://localhost:4310 works as it is. A remote address needs more (see [passkeys over https](remote-access.md#passkeys-over-https)).

GhostShell keeps the public keys in `passkeys.json` in its state folder. A new password removes every passkey, so a passkey added with a stolen cookie cannot outlast a reset. Add yours again once you have signed in with the new password. To end one passkey, remove it under Passkeys and delete it from the device or password manager that holds it as well.

## Install as an app

GhostShell has a web app manifest, so Chrome or Safari can install it as an app of its own, with its own window and Dock icon. Window managers then see it as its own app rather than as the browser. An installed window opens with Chrome's normal title bar. Click the toggle in that title bar to draw the window's controls over the page, and GhostShell's logo then sits in the title bar. On the Mac, install it from http://localhost:4310, because Chrome only offers Install on a secure address, and it treats localhost as one.

To keep the server running without a terminal, see [always on](always-on.md).
