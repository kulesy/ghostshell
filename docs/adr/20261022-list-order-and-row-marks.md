# Order each list and mark each row as Claude Desktop does

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-22
- Tags: sessions, order, sort, marks, unread, local-storage, claude-desktop

## Context and Problem Statement

Capcom sorted a group by title and every other list by the time its transcript was last written. Each row ended in a lamp for the chat's state: working, needs you, active or idle. Claude Desktop lets the owner pick a sort for each section of its sidebar, and it orders by the time a turn began or ended, which it saves in each session's record. It ignores the time of a file. A family sits where its best member sorts. A row ends in one mark that says what the owner has to do: an amber dot for a session that needs input, a blue dot for one with something unread, a grey dot while a turn runs, and a small warning triangle for a turn that failed.

The owner asked for Capcom's list to match Desktop's families, order and marks, so the two sidebars read the same side by side. Capcom already reads the sorts and the sort key, in Desktop's config and records. The rows Desktop marks unread, and the times the owner acknowledged a row, sit in Desktop's Local Storage, a LevelDB folder that Desktop keeps open. Desktop's files hold nothing about the turns Capcom runs. How does Capcom learn each fact without writing to Desktop, and what does it show for the facts it cannot learn?

## Decision Drivers

- The order and the marks follow the rules in Desktop 3.1623.0, as its code states them, except that every list goes A to Z by title.
- Capcom writes nothing under `~/Library/Application Support/Claude`. It reads Local Storage by hand, with no library and no lock.
- Desktop's records hold no trace of a turn Capcom runs, so the list needs a record of its own.
- The server and the page sort alike, because the page places a dropped or nested row before the server's list arrives.
- A chat Capcom runs must still stop at the idle sweep, which stops the chats nobody listens to.
- The state folder stays small however many chats Capcom runs.
- A Desktop update can move any of these files, and the list has to carry on without them.

## Considered Options

1. Read Desktop's sorts, records and Local Storage, and keep the turns Capcom runs in `marks.json`
2. Keep the title and file-time sorts and the state lamp
3. Copy Desktop's sorts and unread rows into `layout.json` once, as the groups and pins were copied

## Decision Outcome

Chosen option: "Read Desktop's sorts, records and Local Storage, and keep the turns Capcom runs in `marks.json`", because it is the only option whose order and marks follow what Desktop shows now, and it writes nothing to Desktop's files.

- **Sort key.** `lib/desktop.mjs` gives each record a `sortKey`: `lastTurnEdgeAt`, else `lastActivityAt`, else `createdAt`, in milliseconds. Desktop sets `lastTurnEdgeAt` when a turn begins and when it ends. A row's `sortAt` is the later of that key and the last time a turn Capcom ran began or ended, so a turn run in Capcom lifts its row. A session with no Desktop record takes the later of its transcript's file time and that edge, and a session Capcom started moments ago, with no transcript yet, takes the time Capcom started it. The file time of a Desktop row's transcript plays no part, because any write moves it. `lastActivityAt` still gives the time a row shows, the folder list and the search. Rows also carry `createdAt`, from Desktop's record, or from `started.json` for a session Capcom started, and 0 for any other.
- **Section sorts.** Desktop's config holds each section's sort at `preferences.epitaxyPrefs['dframe-code-sections'][<scope>].sections`, an array of `{ id, kind, sortBy, ascending }`. `kind` is `pinned`, `routines`, `manual` (a group, named by its id) or `sessions` (the loose list), and `sortBy` is `recency`, `created` or `alpha`. The scope is the one that holds the groups, or else the first scope with sections (`readSorts`), so a config with no groups still gives the sorts. Pinned follows the `pinned` section, Routines follows the `routines` section, and Started here, Ungrouped and Terminal and other all follow `sessions`. The first section of a kind wins. A list with no section goes newest first. A section whose `sortBy` Capcom does not know sorts by recency in the section's own direction. Every list, groups included, goes A to Z by title, whatever Desktop holds for it. The server still reads the sorts, sends them and cuts Started here, Ungrouped and Terminal and other to their first 60 by them, and the page replaces them all with `TITLE_SORT` when the list arrives (`sortByTitle` in `public/ui/tree.js`).
- **Comparators.** `public/ui/order.js` holds Desktop's three, so the server and the page share them. Recency puts the later `sortAt` first. Created puts the later `createdAt` first, and a row whose `createdAt` is missing, zero or later than its `sortAt` counts as created at its `sortAt`. Alpha compares titles with `localeCompare` and puts a row with no title last, and Capcom's `Untitled session` placeholder counts as no title. Ascending turns a sort round, except that alpha keeps the untitled rows last. A tie goes by id, so the same rows come out in the same order whatever order they arrive in. Capcom's old title order put titles that start with an emoji first. Desktop's alpha sort has no such rule, so Capcom dropped it.
- **Families.** Under a recency sort a family sits where its best member sorts, whether that is the head or a shown child, so a busy child keeps its family in view. Under created and alpha it sits where its head sorts. A head's children go depth first: its direct children in the list's order, each followed at once by the children that nest under it, to a depth of 32. A child deeper than that follows the rest. A row's `via` names the nearest ancestor the list shows (see [Nest sessions under a parent](20261022-nest-sessions-under-a-parent.md)).
- **Lists.** `GET /api/sessions` sends `sorts` (`pinned`, `routines` and `sessions`) and a `sort` on each group, and each row carries `sortAt`, `createdAt` and `via`. A routine sits where its latest run's title puts it, and its earlier runs stay newest first. The cut at the newest 60 keeps the first 60 in the list's order, and every family that holds a session brought back from the archive. When the page places a row that was dropped, nested or taken out before the server's list arrives, `public/ui/tree.js` sorts with `TITLE_SORT`, which `sortByTitle` set as the sort of every list. It places a family again when a member leaves it, and shows the sessions straight under that member under the one the member showed under, as the server links them.
- **Marks.** Each row has one mark, `dot` in the index: `error`, `awaiting`, `running`, `ready` or null. `lib/dots.mjs` works it out with Desktop's rules, and the first of these that holds wins:
  1. An archived session has no mark.
  2. A tool approval waits now: awaiting.
  3. Capcom runs the turn now: running.
  4. The last turn failed, and the owner has acknowledged neither the row nor the error: error.
  5. The owner has acknowledged the row since its last turn: rules 6 and 7 do not apply.
  6. The last turn ended asking for input: awaiting.
  7. A turn runs in another app: running.
  8. The row is unread: ready.
  9. Otherwise no mark.

  A row is acknowledged when Desktop's acknowledgement for it is at or after the row's `sortAt`. A turn failed when the post-turn summary's category is `failed`, or the record holds an error from the last 7 days, and no approval waits and no turn runs. A turn ended asking for input when the category is `blocked` or `need_input`. That counts unless the row has lapsed: it is read, and it is a routine's or its last turn began or ended 7 days ago or more.
- **Sources.** Desktop's records give the sort key, the verdict (`postTurnSummary.status_category`) and the error (`error` and `errorAt`).

  Desktop's Local Storage gives `epitaxy-unread-v1`, whose `unreadIds` name the unread rows by Desktop's own id, and `epitaxy-awaiting-ack-v1`, whose `ackedAt` maps a row to the time the owner last acknowledged it. `lib/leveldb.mjs` reads the current value of those two keys from `Local Storage/leveldb` with positioned reads of the folder's table and log files. It writes nothing, takes no lock and holds no file open. `loadDesktop` reads them inside its 4 second cache. A folder that is missing or does not parse leaves both empty and sets no banner. Capcom reads every table and log in the folder and not the manifest that names the live ones, so for a moment after a compaction a table LevelDB has not yet deleted can bring back a deleted value. A log that LevelDB flushes and deletes while Capcom reads the folder costs the values in it, and the list shows the older ones until the next read, at most 4 seconds later.

  `marks.json` in Capcom's state folder holds four maps, by CLI session id and in milliseconds. `edges` is when a turn Capcom runs last began or ended. `seen` is when a page of Capcom last had the chat open. `unread` is when a turn ended with no page open. `errors` is when a turn ended in an error, until the chat's next turn begins. `lib/marks.mjs` reads the file on each use and writes it through a temp file and a rename. Each write drops entries older than 14 days and keeps the newest 1000 in each map. A file that cannot be read counts as empty, and the next write replaces it. Capcom logs a mark it cannot write, and the list loses that one dot.

  `lib/runner.mjs` tells the server when a turn begins, ends or fails through one module-level callback (`onTurn`). A listener on every chat would keep each one alive past the idle sweep. A new chat has no session id until the CLI names it, so Capcom records its first turn under the real id once there is one. `events()` in `server.mjs` records `seen` and clears `unread` when a page opens a chat, and records `seen` when the page closes it.
- **Joining them.** `dotFor` in `server.mjs` combines the three sources.
  - A chat with a page of Capcom open is read, so it is never unread.
  - A row Desktop marks unread stays unread until Capcom's `seen` is at or after the row's `sortAt`. A turn that ended in Capcom with no page open stays unread until `seen` is at or after the time it ended.
  - The record's verdict counts only when its sort key is at or after Capcom's last edge, because a turn run in Capcom since then makes it stale. A Desktop error counts only when no later edge supersedes it. Capcom's own error counts too. Either lasts 7 days.
  - Only Desktop's acknowledgements count. A page opening a chat clears Capcom's unread mark and acknowledges nothing.
  - The chat's `state` gives the approval (`waiting`) and Capcom's own turn (`working`). A turn in another app counts as running only when the transcript holds an open turn (see [Show Claude's live work from the CLI's stream, and ask the CLI for thinking summaries](20261016-live-work-from-the-cli-stream.md)). A write in the last 2 minutes makes a row `active`, and a write is not a turn.
  - `GET /api/sessions` leaves `verdict`, `error`, `errorAt` and `sortKey` out of the rows it sends.
- **Look.** `public/ui/sessions-list.js` draws the mark as a `.row-dot` with the mark in `data-dot`. Awaiting is `--warning`. Running is `--running`, the sidebar's text colour mixed 15% into the sidebar's background, which lands on the grey Desktop draws in light mode. Ready is `--ready`, at oklch(0.577 0.149 260) in light and oklch(0.65 0.15 260) in dark. An error is the warning triangle at 0.75rem in `--warning-foreground`. The dot is 0.4rem on a mouse and 0.5rem on a touch screen, flat, with no ring, no glow and no animation. A row with no mark shows nothing. The line with the folder, branch and state (the row's tooltip on a mouse, a second line on a touch screen) ends in Needs input, Failed or Unread for the marks that have those words, and in the chat's state otherwise. On a mouse a row's text is the sidebar's text colour at 70%, and full strength while the row is selected, open in a menu, a nest target, pressed or hovered. The light colours come from a 2x screenshot of Desktop's sidebar, and nobody has compared dark mode with Desktop. The lamps outside the session list are unchanged.
- **What Capcom cannot see.** Desktop does not save the tool approvals it waits on. A chat Desktop runs that waits on one shows running while its turn is open in the transcript, and nothing otherwise, where Desktop shows awaiting. Capcom cannot write Desktop's unread or acknowledgement stores, so a chat the owner reads only in Capcom stays unread in Desktop. An acknowledgement made in Desktop does reach Capcom. Capcom cannot hear that Desktop opened a chat either, so a turn that ended in Capcom stays unread in Capcom until a page of Capcom opens the chat.

### Consequences

- ✅ Every list goes A to Z by title, and a family sits by its head's title. The sort the owner set in Desktop decides only which 60 sessions each loose list keeps.
- ✅ A row's mark means what Desktop's means, for a session that Desktop or a terminal runs.
- ✅ A turn run in Capcom lifts its row, retires the verdict and error it supersedes, and leaves the chat unread until a page opens it.
- ✅ The server and the page order rows with one module.
- ✅ Nothing is written to Desktop's files.
- ❌ The sorts, the sort key and the two Local Storage keys are Desktop's internal fields, as Desktop 3.1623.0 writes them. After an update that moves them, the lists go newest first and the unread marks and acknowledgements disappear, until the readers change.
- ❌ A chat Desktop runs that waits on a tool approval shows the running dot or nothing.
- ❌ A chat read only in Capcom stays unread in Desktop, and one read only in Desktop stays unread in Capcom if a turn ended in Capcom before.
- ❌ A routine goes by the title its latest run shows, which is how Capcom names a routine. Desktop may compare the routine's own name instead. Nobody has checked.
- ❌ A row no longer shows a lamp for an idle or an active chat. A chat whose file was written moments ago shows no mark unless a turn is open in it.
- ❌ Local Storage is read by hand, so a change in how Chromium stores it can break the reader. The reader returns nothing then, and the other marks carry on.

## Pros and Cons of the Options

### Read Desktop's sorts, records and Local Storage, and keep the turns Capcom runs in `marks.json`

- ✅ The order and the marks follow what the owner has set and done in Desktop, as of the last refresh.
- ✅ A turn run in Capcom gets the same treatment as one run in Desktop.
- ❌ It reads four more of Desktop's internal fields and two Local Storage keys, which an update can move.
- ❌ Reading Local Storage by hand needs its own reader and tests.

### Keep the title and file-time sorts and the state lamp

- ✅ Nothing new is read from Desktop.
- ❌ The two sidebars disagree on order and on which session needs the owner.
- ❌ Any write to a transcript moves its row, so opening a chat can reorder the list.

### Copy Desktop's sorts and unread rows into `layout.json` once

- ✅ After the first start Capcom reads nothing new from Desktop.
- ❌ An unread row changes by the minute, so the copy is stale at once.
- ❌ A sort the owner changes in Desktop never reaches Capcom.

## Links

- [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md), amended 2026-10-22 to cover Local Storage.
- [Nest sessions under a parent, and follow the links Desktop records](20261022-nest-sessions-under-a-parent.md), whose families this record places and orders.
- [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), whose group order this record replaces.
- [Make Capcom the only client and stop integrating with Desktop](20261015-capcom-is-the-only-client.md), which planned unread markers.
- [Show Claude's live work from the CLI's stream, and ask the CLI for thinking summaries](20261016-live-work-from-the-cli-stream.md), whose transcript reader finds a turn another app runs.
- [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md), whose row carries the mark.
