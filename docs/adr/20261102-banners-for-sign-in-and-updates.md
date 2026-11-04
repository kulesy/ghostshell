# Show banners in the sidebar for Claude's sign-in ending and for merged changes waiting

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-02
- Tags: ui, banners, login, updates, restart, routines

## Context and Problem Statement

Every chat GhostShell runs is a headless `claude -p` process, and all of them share one claude.ai login. That login has a hard end about four weeks after an interactive sign-in. A refresh does not move it. On 1 Nov 2026 it ended with nothing to warn anyone: the CLI shows a warning in its own terminal, and a headless chat never shows it. Every chat and every routine failed until the next morning, when the owner noticed.

The second gap showed up the next day. On 2 Nov the server GhostShell runs from was six merged pull requests behind main. Updating means pulling the checkout and, for server code, restarting at a moment when no chat is mid-turn. Nothing in the page said a change was waiting.

How does GhostShell tell its owner about both, early enough to act, without touching anything it should not and without cutting a running chat unless the owner says so?

## Decision Drivers

- A sign-in that ends should be seen days before it does, and a signed out Claude should be seen at once.
- The server must learn the end date without taking a secret anywhere. The date lives in the CLI's private keychain entry.
- An update must not run while the owner is at the Mac working, and must not cut a chat or a routine mid-turn, unless the owner presses Force restart and confirms.
- Both banners should be one component and one style, so a fourth is cheap.
- No dependency and no build step.
- A new page in front of an old server shows nothing, as the other features do.

## Considered Options

1. Banners in the sidebar, fed by the server's own cached checks, with buttons that start the sign-in and the update
2. A notification outside the page, such as a push or an email
3. Tell the owner only in the chat that failed, from its error

## Decision Outcome

Chosen option: "Banners in the sidebar, fed by the server's own cached checks", because the sidebar is where the owner already looks, on any device, and one cached answer costs no git, keychain or CLI work per request.

### The sign-in banner

- **Where the date comes from.** `lib/login.mjs` reads the macOS login keychain entry `Claude Code-credentials` with `security find-generic-password -s "Claude Code-credentials" -a <user> -w`, parses it in memory, keeps `claudeAiOauth.refreshTokenExpiresAt` (epoch milliseconds) and drops the rest at once. The format is the CLI's own and private, checked on CLI 2.1.316. A `NOTE` at the read says so. If the entry is missing, unreadable or changes shape, the date is null and the banner falls back to the CLI's own answer.
- **The trade-off.** The server touches a secret to learn one date. It is contained three ways. The reader returns a number and nothing else. The error from `execFile` carries the output, and the error from `JSON.parse` quotes the input, so neither is ever logged or shown: a failure is a null and nothing more. And nothing the keychain held reaches state, a log, a file or the page, which tests assert with fake entries that hold marker secrets.
- **Signed out.** `claude auth status --json` is run with a clean environment (only `HOME`, `USER`, `PATH` and `TERM`, because Desktop's `CLAUDE_CODE_*` and `ANTHROPIC_BASE_URL` variables break it) and only `loggedIn` is kept. It runs when the date is missing or past, and when a chat's reply carries `error: "authentication_failed"`, at most once a minute. The CLI's own answer wins over a date: a date in the past with the CLI still signed in shows nothing, since another way of signing in can sit beside a stale entry.
- **When to read.** At start, every 6 hours, after a sign-in and after an authentication failure. The page's request reads the cached answer.
- **The threshold is 5 days.** A sign-in early costs nothing, because it starts a fresh four weeks. Five days spans a weekend and at least three weekdays at the Mac, so the banner is seen without nagging for a week.
- **Signing in.** `POST api/banners/sign-in` runs `claude auth login --claudeai` with the same clean environment, with its input a pipe left open and its output ignored, so nothing it prints can be read or leak. Only one runs at a time. It opens a page in the Mac's browser that must be approved there. When it exits, `claude auth status --json` decides: signed in means the banner clears after the date is read again, anything else is a failure with a fixed message that holds the exit code. It is stopped after 10 minutes ("Timed out waiting for the sign-in page to be approved.") and when the server exits.
- **The phone.** The button reads "Sign in on the Mac", and while it waits the banner says to approve the page in the browser on the Mac. The approval cannot move to the phone, because the CLI's callback is on the Mac. The other route is a pasted code, which would pass an auth code through the page, and that route is untested. Starting it from the phone still works when the owner is about to be at the Mac.

### The update banner

- **What is waiting.** `lib/update.mjs` records `git rev-parse HEAD` of the checkout at start, which is the commit the running server loaded. After a delay at start and every 30 minutes it runs `git fetch --quiet origin main` and lists `git log --first-parent` from that commit to `origin/main`. A squash merge subject, `Title (#34)`, becomes a link to the pull request on GitHub, built from the origin remote. A subject with no number is shown as it is. A failed fetch keeps the last result, and a folder that is not a repository shows nothing. The checkout is `CAPCOM_UPDATE_ROOT`, the repository by default, so tests never touch the real one.
- **Page only or a restart.** A change needs a restart when it touches `server.mjs`, anything under `lib/`, `package.json`, `config.json` or a `public/` file the server imports. The imports are found by following relative specifiers from `server.mjs` at the commit the server started from, through `git show`, so a file that a later commit deleted still counts. Everything else, which is the rest of `public/`, docs and tests, is page only, because `public/` loads from disk on each request. That makes the update a pull with no restart.
- **The button.** `POST api/banners/update` refuses, with a fixed reason and no change, when the checkout is not on `main`, has uncommitted changes to tracked files, has diverged from `origin/main`, when a restart is already under way, when a restart is needed while a sign-in waits on the Mac (`claude auth login` is not a chat, so the helper would not wait for it), and when a restart is needed in the quiet window. Otherwise it fast-forwards to the `origin/main` commit the last check looked at and, if the change needs a restart, starts `npm run restart -- --wait <minutes>` in the checkout, detached, with the npm beside the server's node and that folder first on `PATH`. It never calls `launchctl` and never uses `--now`. Both write routes, and the force route below, take the stricter origin check the routine writes use.
- **A checkout pulled by hand.** When HEAD is ahead of the commit the server started from and the change needs a restart, the banner reads "Pulled, waiting for a restart" and the button runs only the helper, under the same window rule. A pulled change that is page only is already live and shows nothing.
- **The quiet window is enforced.** Restarts are refused on weekdays from 07:00 to 09:45, server local time, with the reason "Restarts wait until 09:45 on weekdays." The banner disables its button and shows the reason. A pull of page files stays allowed, since it cuts no chat. Outside the window, `--wait` is the lesser of 30 and the whole minutes until the next weekday 07:00, less one minute, because the helper restarts a few seconds past its deadline when the chats go idle just before it. The window is checked again after the pull, in case the git steps crossed 07:00. Enforcing beats warning because a warning is read after the chat is already gone, and the cost of waiting a morning is small.
- **Running routines are protected by the helper.** `npm run restart` waits until every chat process the server runs is idle, a routine's chat included, and gives up without restarting after the wait. While it waits, the banner says "Restarting once 2 running chats finish." counting this server's chats that are working or waiting on an approval, which are the ones the helper treats as running. If the lock goes away and the old server is still there, the banner returns with a Restart button and the last line of `restart.log` when the helper wrote it for that request. After a restart the new server's start commit is HEAD, and the banner clears by itself.
- **Force restart.** The wait can run the full 30 minutes behind a chat blocked on an approval, and then gives up, so a change that needs a restart also offers Force restart beside the main button. The owner confirms in the house dialog, which says how many running chats will be cut (read fresh when the button is pressed), that the merged changes are pulled first, and that it goes ahead inside the quiet window when it does. `POST api/banners/force-restart` calls `update({ force: true })` and is the only way in: no tool, CLI or query flag. It merges as a normal press does and refuses on the same checkout problems, but it skips both quiet window checks, because the owner has been told and chose it. It runs `npm run restart -- --now`, and it refuses when the server started less than 60 seconds ago, with the helper's own reason, before anything is merged. When a helper is already waiting, the force does not start a second one. `--now` finds the lock holder and, if its command line is a restart worker, sends it `SIGUSR2` and exits 0. The worker installs its handler before it writes its lock, so a pid in the lock always has one. It stops polling within one poll interval and goes on to the usual checks and one kickstart, and a worker already past its wait ignores the signal. A pid whose command is not a restart worker is never signalled. `state.force` tells the page when to offer the button, so a new page in front of an old server shows none, and once the force is under way it reads false and `busy` reads 0.

### One component, one order

`public/ui/banner.js` draws every banner: a title, text, optional children such as a list, a problem line (`role="alert"`), a progress line (`role="status"`) and a row of buttons. A `warning` tone adds the triangle-alert icon and the warning tint and border, with no side stripe. The passkey offer moved onto it. They stack in the sidebar's banner slot in this order: sign-in, update, passkey offer. Sign-in goes first because a signed out Claude breaks every chat and routine, and the update is optional. `GET api/banners` returns `{ login, update }` from memory, and the page reads it every 15 seconds and when it becomes visible, and every 2 seconds while a sign-in waits or a restart is under way. If a read fails during a restart the banner stays and says "Restarting now.". The `banners` flag in `features` keeps a new page from showing anything in front of an older server.

### Consequences

- ✅ The sign-in's end is on screen five days ahead, and a signed out Claude is on screen within a minute of the first chat that fails.
- ✅ A merged change is visible, and a page-only change goes live with one button and no restart.
- ✅ No update restarts the server in the owner's working hours or while a chat or routine is mid-turn, because the helper waits for them. Only a confirmed Force restart skips both.
- ✅ The three banners share one component and one style.
- ❌ The server reads a private keychain entry. If the CLI changes its format the date is lost, and the banner then shows only a signed out Claude, from the CLI's own status.
- ❌ After a pull, the page files are new while the old server keeps running until the helper restarts it. The page already copes with older servers through the `features` flags, and the window lasts at most the helper's wait.
- ❌ A sign-in needs the Mac. From a phone the banner can start it and nothing more.
- ❌ A chat blocked on an approval counts as running, so a restart can wait out the full 30 minutes behind it and give up. Force restart ends that wait and cuts the chat.

### Out of scope

- Holding or re-queuing routines that failed while signed out.
- A long-lived token, which would remove the four week end. It is a different trust decision.
- Updating without the button.

## Pros and Cons of the Options

### Banners in the sidebar, fed by the server's own cached checks

- ✅ Where the owner already looks, on every device, with a button for the fix.
- ✅ One cached answer per request.
- ❌ Seen only when the page is open.

### A notification outside the page

- ✅ Reaches the owner with the page closed.
- ❌ Needs a push channel or a mail account that GhostShell does not have, and cannot run the fix.

### Tell the owner only in the chat that failed

- ✅ No new parts.
- ❌ Too late for the sign-in, which fails every chat at once, and silent about updates. A routine that fails overnight shows it to no one.

## Links

- Builds on [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose chats share the login
- Builds on [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md), whose routines the helper's wait protects
- Builds on [Sign in with passkeys that Capcom checks itself on node:crypto, against a list of origins](20261016-passkeys-on-node-crypto.md), whose offer moved onto the shared banner
- The restart helper is described in [Always on](../always-on.md)
