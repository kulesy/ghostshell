# Find a session by the pull requests it links, from a list a worker thread keeps

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-04
- Tags: search, pull-requests, transcripts, worker-threads, performance

Technical Story: Sessions should be searchable based on PR number

## Context and Problem Statement

A session is usually about a pull request, and the number is what people remember. Ctrl+K and `find_sessions` matched only titles, so a number found a session only when the title happened to hold it.

A session can link many pull requests, and the same number can exist in two repos. `urlsFor` in `lib/pulls.mjs` gives a session's main pull request only, and does it one session at a time when the sidebar asks. Search needs every link of every session at once, on each keystroke, with no `gh` and no network.

Measured on one real `~/.claude/projects`: 2186 top level transcripts, 6.86 GB. Reading them all for `/pull/` took 47 seconds, the newest 100 files 7.7 seconds, and the worst single file blocked for 1.4 seconds. The result was 887 sessions with 4071 links (190 in the busiest session), 139 KB as JSON.

How does a search find sessions by pull request without scanning transcripts when someone types?

## Decision Drivers

- A keystroke must cost nothing beyond filtering lists already in memory.
- The first read is far too long for the main thread, which also serves every chat.
- No dependencies and no build step ([ADR 20261007](20261007-no-dependencies-no-build-step.md)).
- A link read from a transcript must follow the rules the sidebar's pull request badge already uses, so the two cannot disagree about what a session links.

## Considered Options

1. Scan the transcripts on the main thread when a search needs them
2. Keep the links in a file, updated as sessions write
3. A worker thread that scans in the background and sends the server a map of links to hold in memory

## Decision Outcome

Chosen option: "A worker thread", because it keeps the main thread free during a 47 second first read, needs no new state file and needs nothing beyond `node:worker_threads`.

`lib/pull-links-worker.mjs` runs `makeLinkScan` from `lib/pull-links.mjs` at start and then every 15 seconds. A pass visits transcripts newest first, skips a file whose size and modified time are as they were, reads only the bytes a grown file gained, and drops a session whose transcript is gone. A file that throws is skipped and tried again next pass, and a pass that throws does not stop the worker. The worker posts the whole map when it changes, and about every 100 files read during the first pass so recent sessions are searchable within seconds. `GET api/pull-links` answers `{ links, reading }` from memory, and the page asks for it when Ctrl+K opens and every few seconds while `reading` is true. `find_sessions` reads the same map through the tool context.

What counts as a link is what `urlsOfItem` in `lib/pulls.mjs` counts: a pull request address in a message a person or the assistant wrote, or a tool result that ends in one bare address, as `gh pr create` prints. A listing of pull requests in a tool result does not count, and text a skill or CLAUDE.md injected never reaches a message, so it does not leak in. A link is stored as `owner/repo#7969` in the case it was written, and compared without regard to case.

In the search, `7969`, `#7969` and `pull/7969` find every session that links that number in any repo, and still match titles. A pasted pull request address matches only that repo. A matching result shows each matched link as repo and number under the title.

### Consequences

- ✅ A search costs a filter over lists in memory, with no scan, `gh` or network.
- ✅ Any pull request a session links counts, not only its main one.
- ✅ No new state file, and nothing to migrate or repair.
- ❌ After a restart the map is empty and rebuilt by the first pass. Measured on the real folder the worker's first pass took 48 and 63 seconds in two runs, with the first links posted after 7 seconds and the main thread's slowest turn 191 milliseconds (a later pass, with nothing changed, took 0.3 to 0.7 seconds), so a search for a pull request in the first minute can miss older sessions. The empty result says the links are still being read.
- ❌ The map holds every link in memory, about 139 KB as JSON on the folder above, and the worker posts the whole map each time it changes.
- ❌ A pull request a session never wrote out is not found: one that only exists in a screenshot, in a file the session edited, or only in a subagent's own transcript.
- ❌ A session changes at most every 15 seconds in search, so a link written a moment ago may not be found yet.
- ❌ The Move to and Nest under menus still find titles only, as they did.

## Pros and Cons of the Options

### Scan the transcripts on the main thread

- ✅ No new moving part.
- ❌ 47 seconds on the first read, and 1.4 seconds for one large file, with every chat waiting.

### Keep the links in a file

- ✅ A restart would not need a rescan.
- ❌ A second record of what the transcripts already say, which can disagree with them and has to be repaired when it does.

### A worker thread

- ✅ Keeps the first read off the main thread, and the same scan code runs in the tests without a thread.
- ❌ Holds a copy of the map in the main thread, and needs a message each time it changes.

## Links

- [Show a badge after each pull request and issue link in a reply, with a card of its details](20261027-github-link-previews.md)
- [Give sessions tools to find, archive, rename and move sessions, and read chips](20261028-layout-tools-for-sessions.md)
