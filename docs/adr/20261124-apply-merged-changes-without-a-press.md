# Let the server apply merged changes itself when no chat is running

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-24
- Tags: updates, restart, server, security

Technical Story: https://github.com/kulesy/ghostshell/issues/57

## Context and Problem Statement

Update merges the changes waiting on `main` and starts the restart helper, which waits up to 30 minutes for every chat to finish and then gives up. With 8 to 12 chats running it gives up most times. Merged work then sits unreleased for days, until someone presses again at a moment when no chat happens to be running. How does merged work reach the live service without a press, while a running chat is never cut and the weekday morning stays quiet?

## Decision Drivers

- A running chat is never cut and a restart is never forced.
- Nothing restarts on weekdays from 07:00 to 09:45.
- A checkout someone is working in never moves.
- No fault in the update code may turn into a restart loop.
- A long wait for chats must not block other work. The restart lock holds every sign-in and the retries of failed routine starts.
- No state file, dependency or page change.

## Considered Options

1. The server waits for the quiet moment itself, then merges and runs the helper for a short wait
2. The server starts the helper for 30 minutes at every check
3. A launchd job or routine that pulls and restarts

## Decision Outcome

Chosen option: "The server waits for the quiet moment itself", because it costs a count in memory while chats run. The helper, its lock and the new page files stay out of the way until a restart is likely to happen.

### When it acts

The server checks for merged changes every 30 minutes, as before. After a check finds some, it looks every 5 seconds for a moment when all of these hold:

1. `autoUpdate` is on, which is the default, and launchd runs this server. A server started by hand or from a test never applies anything. The server asks launchd at each check until it answers yes, and then remembers.
2. The checkout is on `main`, has no uncommitted change to a tracked file, and has no commit that `origin/main` lacks. Otherwise nothing merges, nothing restarts, and the banner gives the reason.
3. No update or restart is already under way.

A page-only change is then merged. A change that needs a restart also waits until all of these hold, so it never merges early and leaves new page files in front of the old server:

4. No chat is working or waiting on an answer.
5. The time is outside the quiet window, with at least a whole minute of wait left before it.
6. The server has been up for 30 minutes.
7. No sign-in is waiting on the Mac.

It then fetches and checks again, and tests every condition against that result before it fast-forwards to the commit it checked. It starts `npm run restart -- --wait <minutes>` with at most 5 minutes, which is enough for the helper's two clear polls. The helper tests again that no chat is running, and it restarts nothing when one is. After the merge it tests the quiet window, the chats and the sign-in once more, and asks for the restart only if they still hold. Otherwise the checkout stays merged and the next look restarts it. Both the server and the helper must agree, so a chat that starts in between is waited for. The automatic path never passes `--now` or `--take-over`, and Force restart stays the owner's button.

### What stops a loop

1. Each check allows one attempt, so a failed merge, a failed read or a helper that gave up is tried again after the next check, 30 minutes later. A "not yet" found after the fetch, such as a chat that started during it, gives the attempt back, and the cheap conditions on the fresh result stop the next look, so it never fetches every 5 seconds.
2. The server must have been up for 30 minutes before it restarts itself. A server that keeps restarting for any reason never adds a restart of its own, and a fault in the comparison could cause at most two restarts an hour.
3. A restart is asked for only when the checkout holds the commit it is for, so the new server starts on that commit and finds nothing waiting.
4. The helper's lock allows one restart at a time, and it refuses a server that has been up for less than 60 seconds.

### What it trusts

With the setting on, a commit on `origin/main` runs on the Mac as the owner with no press. Write access to that branch becomes the ability to run code there. The press was never a review of the code, since the banner shows titles only, but it did put a person in front of each release. GhostShell does not verify signatures or the state of the commit's checks. It fetches with the checkout's own remote and credentials, and only fast-forwards. A rewritten `main` is refused as a checkout with commits of its own. `config.local.json` wins over a merged `config.json`, so a merge cannot switch the setting back on for a machine that turned it off there.

### Consequences

- ✅ Merged work goes live at the first moment with no chat running, at any hour outside the window.
- ✅ Sign-ins and routine retries are held for at most 5 minutes in 30.
- ✅ With the setting off, the banner works as it did.
- ❌ A chat that waits on an answer counts as running, so one left waiting holds every release until it is answered or Force restart is confirmed.
- ❌ A commit that stops the server from starting goes live with no one watching, and has to be fixed by hand on the Mac.
- ❌ Two changes that need a restart within 30 minutes of each other go live up to 30 minutes apart.
- ❌ It does not build the Mac app. `npm run apple:install` still follows a Swift change.

## Pros and Cons of the Options

### The server waits for the quiet moment itself

- ✅ Watches all day, where the helper watches for 30 minutes.
- ✅ Nothing on disk changes until the restart is likely.
- ❌ The server's own count and the helper's reading of the transcripts can disagree, and the helper then gives up after 5 minutes.

### The server starts the helper for 30 minutes at every check

- ✅ Nothing new waits.
- ❌ The helper would hold its lock nearly all day, and a sign-in is refused while it does. A sign-in that ends in that time stops every chat.
- ❌ The checkout moves first, so the old server runs behind new page files for days.

### A launchd job or routine that pulls and restarts

- ✅ Survives a server that cannot start.
- ❌ A second place that decides when to restart. A submitted job that relaunched itself is what restarted the service in a loop in October 2026.

## Links

- Amends [Show banners in the sidebar for Claude's sign-in ending and for merged changes waiting](20261102-banners-for-sign-in-and-updates.md)
- The restart helper is described in [Always on](../always-on.md)
