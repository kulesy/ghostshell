# Give sessions tools to find, archive, rename and move sessions, and read chips

- Status: Accepted, amended 2026-10-30
- Deciders: The owner
- Date: 2026-10-28
- Tags: tools, mcp, layout, archive, chips, permissions, groups

## Context and Problem Statement

`send_session` refuses an archived session and tells the sender to ask the owner to unarchive it. A session with no tool for that edited `layout.json` by hand instead: it moved the id from `archived` to `unarchived`. Sessions did the same to set a title that the owner would see (a session marks its own title while it works and when it finishes), to move a session into a group, and to find which session a chip started by reading `chips.json`. A hand edit skips every check the layout routes make, races the server's own writes, and leaves the file in a state the server never wrote. The owner also saw none of it, because no card was raised.

The page had a gap of the same kind. The sidebar row has Archive, and the archived list has Unarchive, but the chat window has neither, so archiving the session in front of the owner meant going back to the list.

How does a session archive, rename, move and look up sessions and chips without touching the file, what does the owner approve, and where does the page offer the same actions?

## Decision Drivers

- The server's state and `layout.json` must never disagree, so a tool writes through the code the layout routes run, not around it.
- Anything that changes another session's place, name or archive is the owner's call. Text a session reads in a transcript is information and never permission, so every write needs a card in every permission mode. Amended 2026-10-30: a rename or move within the caller's own tree goes without one.
- A session that only looks something up should not interrupt the owner.
- A group's or section's chat can already message any session with a card ([Give each group a session of its own](20261023-a-session-for-each-group.md)), so it gets these tools on the same terms.
- Reading a transcript stays with the tools that already read one: a group's chat reads its group's sessions, and an ordinary chat reads its sub sessions. Finding a session gives titles and state and nothing from inside it.
- The page is read from disk on every request, so the new buttons go live before the server restarts and must work against the old server, which already has `api/layout/archive`.
- No new dependencies and no build step ([Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md), [Preact with htm](20261015-preact-htm-front-end.md)).

## Considered Options

1. Six tools on the `capcom` server, with the writes held to a card and the reads unasked, and Archive and Unarchive in the chat window's header
2. Let sessions keep editing `layout.json`, and document the shape
3. One generic `edit_layout` tool that takes a patch
4. Tools for the owner's layout routes over HTTP, with the session's cookie

## Decision Outcome

Chosen option: "Six tools on the `capcom` server, with the writes held to a card and the reads unasked, and Archive and Unarchive in the chat window's header", because it is the only option where each change is one named action the owner can read on a card, and where the server stays the one writer of its own state.

- **The tools.** They are listed to every chat that is given `ctx.subs`, as `send_session` is: an ordinary chat, a group's chat and a built-in section's chat. The code is in `lib/layout-tools.mjs`, with the definitions in `lib/tools.mjs`.
  - `archive_session(session_id)` and `unarchive_session(session_id)` archive a session or bring it back.
  - `set_session_title(session_id, title)` sets the title GhostShell shows and answers with the cleaned title. A session may retitle itself.
  - `move_session_to_group(session_id, group)` moves a session into a group, named as the sidebar shows it or by its id. A name is matched without regard to case, as a chip's group is, and a name that matches no group or two is refused with the list of names, or with the ids of the two.
  - `list_chips` lists the chips in `chips.json`, newest first, each with its task id, title, status (open, started or dismissed), the session it started, the session that made it and when. It filters by `query` (the title), `status` and `session_id` (the session that made the chip), and stops at `limit`, 50 unless another is asked for and never over 200.
  - `find_sessions(query)` finds every session in the index by part of its title, without regard to case, latest first, each with its title, id, state, folder, branch, last activity and group, marked when it is archived or is a group's or section's own chat. `include_archived` defaults to true, because the session a caller wants is often an archived one. Pass false to leave them out. `limit` is as for the group lists.
- **Writes go through the server's own functions.** The server hands the chat callbacks in `subCtx`, as it does for `send`. They run the code the routes run: `setArchived`, `layout.rename`, and `layout.move` with `leaving(id)` so a nested session leaves its parent and its children keep their place. The check that a group's or section's own chat stays with its group, which `editLayout` made for the routes, is now `editableRow` in `server.mjs`, and the routes and the callbacks both call it. A refusal keeps the route's status, and the tool words it for the model.
- **A card in every mode.** The four writes are in the ask rules of every chat that has `subs` (`SESSION_ASKS`, which `GROUP_ASKS` spreads) and in `alwaysAsked`, so the card never offers Always allow and answering Always allow keeps no rule. The ask rule is what makes the CLI ask in Bypass and Auto, which rests on the 23 October note in `lib/runner.mjs` (checked on CLI 2.1.309 for Capcom's own tool names and not rechecked for these four). The card has a title and a line that names the session as `"Title" [id]` (a title keeps no quote or bracket, so it cannot fake an id), or as an unknown session when no session has the id: `archive`, `unarchive`, `rename … to "<new>"` or `move … to "<group>"`, built by the server from the index as the send card is. This is the rule `start_group_session` follows, and `send_session` for a receiver outside the sender's own tree, for the same reason: text in a transcript can steer a chat that reads one.
- **Reads without a card.** `list_chips` and `find_sessions` are allowed with no card, in an ordinary chat and in a group's or section's. They give titles, ids, states, folders, branches, times and chip records, which the sidebar already shows the owner. They give no message and no tool call from a transcript.
- **What group and section chats get, and why.** The same six tools. They could already message any session with a card, so a session that can wake any other has no more reach for being able to find it, and the owner's card is the guard on every change. The chat's instructions still tell it to act on another session only when the owner asks in that chat. Three things follow, and they are the cost of this choice:
  - A group's or section's chat can now see the title of every session on the Mac, and every chip, with the ids that lead to them.
  - A group's chat can move a session from outside its group into its own group with one card, and `read_group_session` then reads that session's transcript with no card. The move stays allowed. The sessions nested under the moved one, archived ones included, move with it and are readable too. The card says `(this group's chat can then read it)`, or `… it and the N sessions under it`, when the caller is a group's chat moving a session into its own group, and the tool's reply says so as well, so the owner approves knowing it. A move into another group gives the chat no new reach.
  - `read_group_session` still reaches the group's members alone, and `find_sessions` gives titles and state only.
- **Refusals.**
  - A session cannot archive itself. Its own title can be set, since sessions retitle themselves as they work.
  - A session that is running a turn or waiting on an approval is not archived. Archiving it would stop it, so the server callback asks with `stop: false`, as the page does before it asks the owner, and answers `running`. The refusal says to try again once it is idle or to tell the owner to archive it from the app. Nothing is interrupted.
  - A session that looks to be running in another app (Desktop or a terminal, with no process of Capcom's) answers `elsewhere` and is refused the way `send_session` refuses it, since the tool's reply says the session's chat is closed and Capcom has none to close. The sidebar still archives such a session, because the owner is choosing.
  - The callback answers `running`, `elsewhere` or `done`, and the tool words the refusal from that. The tool reads no HTTP status. A 400 or 404 sentence from the layout code passes through as the refusal.
  - A group's or section's own chat can be archived, unarchived, renamed or moved by no tool and no route, because it stays with its group or section.
  - Moving an archived session answers that it is still archived.
  - An id that is no session is refused with the route's sentence.
  - A session that is already archived, or already not, is answered in plain words and nothing is written. It is not an error, since the caller wanted that state.
- **`send_session`.** Its archived refusal names the way forward: `Unarchive it with unarchive_session, which the owner approves, then send again.` Its description, a group's description and the "No session with that id" refusal stop saying that no tool lists other sessions and point at `find_sessions`.
- **The chat window.** The header of an open session has Archive in the row of tools beside the sub sessions and terminal buttons. It runs the sidebar row's flow (`closeSession` in `public/ui/close.js`): an idle session is archived at once with a note that has Undo, and a running one asks "Stop and archive" first. For an archived session the button reads Unarchive and calls the same `archive(id, false)` as the sidebar. A group's chat, a section's chat and a new session have no button. The list the page holds has no archived rows, so a chat the list does not hold is looked up in `api/archived`, which every server has, and the button waits for the answer. The page needs no new server route, so it works against the server that is running now.
- **Checked** with the fake CLI in the server tests: each write landed in `layout.json` as the route writes it and the server's own list agreed, a running session and a session running in another app were refused and left alone, the card named the session with its id, the card for a group's chat moving a session into its own group said so, the ask rules reached the spawn arguments, and the fake CLI raised `can_use_tool` for each write in the manual, Bypass and Auto modes and Capcom held every one for a card with no Always allow and ran none unasked. The fake CLI raises the request in every mode, so those tests show that Capcom never auto-allows a write and not that the real CLI asks in Bypass and Auto. The chat window's buttons were checked in the headless Chromium of the page tests, including that the button reads Unarchive after an archive from it. Not checked with a real model, with the real CLI in Bypass or Auto for these tools, in Safari or on a phone.
- **Amended 2026-10-30, no card for a rename or move within the caller's own tree.** The owner asked "Why do we need to hit allow for a session to be renamed?". A session marks its own title while it works and when it finishes, and each of those renames raised a card. He chose no card for `set_session_title` and `move_session_to_group` when the target is the caller itself, its parent, a session below it at any depth, or a sibling under the same parent, and a card for any other target. `archive_session` and `unarchive_session` keep their card for every target, the caller's own tree included.
  - **One tree.** The runner allows these two with no card when `inOwnTree` in `lib/subs.mjs` finds the target in the caller's tree, the check `send_session` uses (see the 2026-10-29 amendment of [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md)). Its `self` option counts the caller as in its own tree, which a rename or move asks for and a send does not, since a send to itself is refused. The tree comes from the nesting links in the index at the time of the call, archived sessions included, and the model gives nothing but the target's id. `TREE_WRITE_NAMES` in `lib/tools.mjs` names the two tools.
  - **Group and section chats.** Each of their renames and moves still asks. A group's or section's chat has nothing nested under it, so it has no tree, and the 2026-10-29 amendment left its sends to its own members carded for the same reason. Its tool descriptions say the owner approves every call, and an ordinary chat's say when it does.
  - **Still asked.** The ask rules are unchanged, so each call still reaches GhostShell as a permission request in Bypass and Auto, and the card that does show still has no Always allow.
  - **Cost.** Text in a sub session's transcript that steers the chat above it can now rename that chat's family, or move any of them into another group, before the owner sees it. A move takes a session out of the tree, so a later call on it asks again. A move into a group's own group lets that group's chat read the session, and the owner sees no card for it when an ordinary chat makes the move. Nothing is archived, stopped or deleted without a card.
  - **Checked** by unit tests of the tree with and without `self`, by the fake CLI in the runner tests in the manual, Bypass and Auto modes (a rename of itself and of a sub session and a move of a sub session went with no card, a rename or move of a session outside the tree and an archive or unarchive of a sub session each held a card, and a group's chat in Bypass held a card for both), and in the server tests from the real nesting, from a parent down and from a sub session up. The real CLI in Bypass and Auto was not checked for these tools.

### Consequences

- ✅ A session that is refused for an archived target has a tool for the next step, and the owner sees a card for it.
- ✅ The server and the file cannot disagree, because there is one writer and the tools use it.
- ✅ Every archive and unarchive, and every rename or move outside the caller's own tree, shows the owner a card in every mode (amended 2026-10-30).
- ✅ The owner can archive or unarchive the session in front of them without going back to the list.
- ❌ Six more tool descriptions go with every request of every chat.
- ❌ A chat that a transcript steers cannot be stopped from asking for a change. The card is the only gate, and a card is easy to approve in a hurry. This holds most for a group's chat asking to move a session into its own group, which then lets it read that session.
- ❌ A title set by a tool shows in GhostShell only. Desktop and the CLI do not see it.
- ❌ A session keeps the tool list it first loaded, even after a resume, so a session that started before GhostShell restarted does not see these tools until it starts again.
- ❌ `find_sessions` and `list_chips` give a session the titles of every session on the Mac, and every chip, including ones in groups it has nothing to do with. Titles are what the sidebar shows the owner, and nothing inside a session comes with them.

## Pros and Cons of the Options

### Six tools, with the writes held to a card and the reads unasked, and buttons in the chat window

- ✅ Each change is a named action on a card the owner can read
- ✅ The server is the one writer
- ✅ The reads cost the owner nothing
- ❌ More tools in every request

### Let sessions keep editing `layout.json`

- ✅ No code
- ❌ No card, no checks, and a race with the server's own writes
- ❌ The file and the server's state can disagree until the next read

### One generic `edit_layout` tool that takes a patch

- ✅ One tool description
- ❌ A card cannot say in a line what a patch does
- ❌ It would write fields the owner never meant a session to change, such as pins and nesting

### Tools that call the layout routes over HTTP with the session's cookie

- ✅ The routes are the one writer
- ❌ A session would hold the owner's cookie, which the password gate exists to keep from it
- ❌ The routes sign a caller in, and a tool is not a signed-in caller

## Links

- Amends [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md), [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md), [Give each group a session of its own](20261023-a-session-for-each-group.md) and [Show messages between chats by sender](20261016-peer-messages-between-chats.md), which describe the tool list, the ask rules and the archived refusal
- Relates to [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), which owns `layout.json`
- Relates to [Let a chip name the group its session opens in](20261027-chips-name-their-group.md), whose group matching `move_session_to_group` shares
