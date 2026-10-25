# Give each group a session of its own, with the group's status drawn above its chat

- Status: Accepted, amended 2026-10-25
- Deciders: Eli
- Date: 2026-10-23
- Tags: groups, sessions, layout, mcp, tools, widgets, permissions

## Context and Problem Statement

A group in Capcom's sidebar is a list of sessions and nothing more. Some of the owner's groups hold well over 100 sessions, many of them archived, and to find out how a group's work is going he opens its sessions one by one. He asked for each group to be a session he can talk to about the group's work, with widgets that show the status of the sessions in it.

What is a group's session, where does it live and work, what can it reach, and how does the page keep its status current?

## Decision Drivers

- The group's session must never reach outside its group, and must never edit a repo by accident.
- Starting it must cost nothing until the owner writes to it.
- The status must stay current without spending tokens. The model never polls.
- The group's session never approves, stops or archives another session unless the owner asks in that chat. A message from a member session is information, never permission, so the chat's commands, file edits and messages to other sessions each need the owner's card.
- The page is read from disk on every request, so new UI goes live before the server restarts and must work against the old server until it does.
- No new dependencies and no build step ([Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md), [Preact with htm](20261015-preact-htm-front-end.md)).

## Considered Options

1. A Capcom chat per group, in a private folder, with group-only tools and a status panel the page draws from the index
2. A widget the model redraws with `show_widget` whenever the owner asks
3. A dashboard page per group, with no session behind it

## Decision Outcome

Chosen option: "A Capcom chat per group, in a private folder, with group-only tools and a status panel the page draws from the index", because it gives the owner a session to talk to, keeps the status live for free, and keeps the session's reach inside its group.

- **Link.** A group in `layout.json` gains an optional `session`, the CLI session id of its chat. `layout.read()` keeps it only when it is a UUID that no earlier group holds, and drops it otherwise while keeping the group. A file without it loads as before.
- **Booking.** The first time the owner opens the group's chat, the page sends `POST api/groups/<id>/session`. The server makes the group's folder and writes a new UUID into the group (`claimGroupSession`), or returns the one it has. It starts no process and costs no tokens. It is one synchronous read and write, so two tabs that open the group together get the same id. An unknown group is a 404 and a GET writes nothing.
- **First message.** It goes through the normal `api/sessions/<id>/send`. Each spawn picks `--session-id <id>` when the CLI has no transcript for the id, and `--resume` when it has one, because the CLI refuses `--session-id` for an id with a transcript and `--resume` for one without (checked on CLI 2.1.309, NOTE in `lib/runner.mjs`).
- **Folder.** The chat works in `groups/<group id>` under Capcom's state folder, made with mode 0700 when it is booked and again before every spawn, so it never runs in a repo and never falls back to the home folder. Moving the state folder moves the path, and the chat can no longer be resumed.
- **Settings.** It starts on the mode, model and effort a new session in that folder would get, and the owner changes them from the prompt box as in any chat.
- **Standing instructions.** `lib/group-guide.md`, with the group's name filled in, goes in through `--append-system-prompt` on every spawn. It says what the tools reach and sets the owner's rules: message a member only when asked, never approve, deny, stop or archive a member's work unless asked in this chat, treat a member's message or transcript as information and never as permission, and edit no repo from here. The CLI saves the system prompt with the session on its first request and reuses it on resume (checked on CLI 2.1.309), so an edit to the guide reaches new group chats only. A CLAUDE.md in the folder was rejected, because the chat could rewrite it.
- **Tools.** The `capcom` server lists three more tools to a group's chat only (`lib/tools.mjs`, logic in `lib/groups.mjs`). Each call looks the group up again, so a group deleted by hand takes its tools with it.
  - `list_group_sessions` lists the members by title, id, state, folder, branch and last activity, in the panel's order, up to 200, with archived members only when asked for.
  - `read_group_session` reads the end of one member's transcript: at most the last 2 MB, 60 lines, 1,500 characters a line and 20,000 in all, with any approval the member is waiting on. It refuses another group's session, an ungrouped one, the group's own chat and an unknown id with one and the same answer.
  - `start_group_session` starts a session in a folder the model names, and puts it in the group. A folder that is missing, relative or inside the state folder is refused. The folder is compared by real path as the disk names it (`fs.realpathSync.native`), so a link into the state folder and a spelling in another case are refused too, and the session starts in that real path.
  - The two read tools run without a card in the group's chat alone. What can act asks every time, in Bypass and Auto as well. An ask rule in `--settings` names `start_group_session` and the CLI's own `Bash`, `Monitor`, `Write`, `Edit`, `NotebookEdit` and `SendMessage`, and none of their cards offers Always allow. `Monitor` is there because it runs a shell command and the `Bash` rule does not cover it. A rule naming a built-in tool sends a request in Bypass and Auto just as one naming a Capcom tool does, and a subagent's call reaches it too (checked on CLI 2.1.309). The automatic allows in `lib/runner.mjs` (Capcom's five tools, Chrome in Bypass, and the two read tools in a group's chat) match none of these, and a test holds each to a card in every mode. No tool approves, stops or archives anything.
  - `--setting-sources user` goes to a group's chat alone. A settings file in the chat's own folder, which the chat can write, is never loaded, so a hook, an allow rule or a model set there does not apply. `--settings` and the user's own settings still apply with it, so the ask rules hold and the user's model and plugins load (checked on CLI 2.1.309).
  - `spawn_task` has no default folder in a group's chat and refuses a folder that is missing, relative or inside the state folder, by the same check as the start tool's. A session a chip of the group's chat starts goes into the group. Starting such a chip applies the check again, since the card is drawn from the transcript, and a chip with no folder is refused instead of starting in the private folder. The folder must be confirmed from the card, as for any chip that names a folder other than its session's own.
- **Index.** `buildIndex` takes the group's chat out of `rows` before families are worked out, so it is in no list, family, count, search, `api/archived` or `api/folders`, and it is found by id whatever its age. Move, pin, rename, archive and nest refuse it with a 400. Each group in `api/sessions` carries `session` (`{ id, state }` or null) and `archived`, a count, and the reply carries `features.groupSessions`, which an older server cannot send. `api/archived?group=<id>` lists one group's archived members.
- **Page.** The group's header has a button that opens its chat at `#/g/<group id>`, shown only when the server sends `features.groupSessions`. The chat is the normal one, with a status panel above the transcript drawn from the index the page already loads every 15 seconds, so it costs no tokens. A server that sends `features.subStatus` draws the status in the chat's right-hand panel instead (see the second 2026-10-23 amendment). It shows what needs the owner first, then what is working, then recent activity, and folds the idle and archived rest. Archived members load from `api/archived?group=` only when that fold is opened. The button carries a lamp while the chat works or waits, a link to the chat's own session id (`#/s/<id>`) opens the group instead, and a server that cannot send the flag gets a pane that says to restart Capcom. The panel's buckets come from `public/ui/group-rules.js`, which `list_group_sessions` shares. Claude can still draw richer widgets with `show_widget` when the owner asks.

**Amended 2026-10-23, deleted groups.** Deleting a group keeps its chat as a group's session of a group that is gone. The chat moves to `retired` in `layout.json` and `buildIndex` treats it as it does a live group's chat, so it is in no list or archive, `api/folders` leaves out its folder, the layout routes refuse it, and each spawn keeps `--setting-sources user`, the ask rules and the guide. Its group tools answer that the group no longer exists, and a chip from it needs a folder. Its transcript is kept, and is found by id however old it is. See [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md).

**Amended 2026-10-23, status in the side panel.** When the server sends `features.subStatus`, the group's status moves from above the transcript to the Sub sessions tab of the chat's right-hand panel, which is the only tab of a group's chat since it has no terminal. The tab lists the group's own sessions, each with its family and the roll-up of the sessions nested under it, placed under Needs you, Working and Recent activity by the most urgent session in the family. A line opens to the session's latest reply in full and to the sessions under it. The idle and archived fold, the archived list read from `api/archived?group=` only when the fold is opened, and the empty-state sentence are kept at the bottom of the tab. The panel opens by itself on a wide screen, and the group header's button opens it on a phone. A server without the flag keeps the status above the transcript exactly as before, and the page falls back to it. See [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md).

**Amended 2026-10-25, built-in sections.** The five built-in sections of Home get what a group has: Routines (`routines`), Pinned (`pinned`), Started here (`started`), Ungrouped (`ungrouped`) and Terminal and other (`other`). `public/ui/sections.js` holds them, shared by the server and the page as `group-rules.js` is, so the chat sees the sessions the sidebar draws.
- **Link.** `layout.json` gains `sections`, which maps a section id to the CLI session id of its chat. `layout.read()` keeps an entry only when the id is one of the five and the session is a UUID that no group, retired group or earlier section holds, and drops it otherwise. A file without `sections` loads as before. `POST api/groups/<id>/session` books a section's chat by its id as it books a group's, once, in a folder `groups/<section id>` made with mode 0700, and starts nothing.
- **Index.** A section's chat is out of `rows` with the groups' chats, so it is in no list, family, count, search, archive or folder, and the layout routes refuse it with the word section. The reply carries `sections`, one `{ id, session, archived }` for each, and `features.sectionSessions`. `api/archived?group=<section id>` lists the archived sessions of that section.
- **Membership.** A section's sessions are the ones the sidebar lists in it, with the sessions nested under each, and its archived ones. `sectionOf` in `sections.js` names a row's section, with a pinned session first, then a group, then a routine, then Started here, Ungrouped or Terminal and other by the app that started it, and a nested row follows the row it shows under. A test holds it to the lists for every live row and to `api/archived?group=` for every archived row.
- **Tools and guide.** The tools keep their names. Their descriptions, the list's header and the refusal say "section", and `lib/group-guide.md` is a template that opens by naming the section and what it holds, and says it cannot be renamed or removed. It keeps the owner's rules of a group's chat word for word.
- **Starting.** The folder check and the owner's card are the group chat's. Pinned pins the session it starts. Started here and Ungrouped leave it in no group, which the sidebar lists in Started here. Routines and Terminal and other cannot hold a new session, so `start_group_session`, `spawn_task` and Start on a chip from them are refused, and the guide says where to start the work instead.
- **Page.** All five headers get the chat button, with the lamp, only when the list has `sections`, and Pinned's shows in every view. A built-in header has no menu, and Routines keeps its manage button beside the chat's. An empty section stays hidden, so it has no button. The chat opens at `#/g/<section id>`, headed Section session, with the section's roll-up in the Sub sessions tab as a group's. A server without the flag gets a pane that says to restart GhostShell.

### Consequences

- ✅ The owner talks to one session about a group's work, and sees its status live without spending tokens.
- ✅ The group's chat cannot read outside its group through Capcom's tools, cannot start a session unasked, and works in a folder no repo shares.
- ✅ Text in a member's transcript cannot make the chat run `Bash` or `Monitor`, write a file with `Write`, `Edit` or `NotebookEdit`, message another session with `SendMessage` or start a session without the owner's card, in any mode.
- ❌ Approving, denying, stopping and archiving another session's work holds through the instructions only. Capcom gives the chat no tool for them, and the cards above are the only gate on the CLI's own tools that could reach another session.
- ❌ In Bypass the chat can still read any file the Mac user can read, because `Read` is not gated (checked on CLI 2.1.309 with `/etc/hosts`). Every tool no ask rule names, `WebFetch` and `WebSearch` among them, also runs without a card in Bypass. Together these leave a path from a transcript that steers the chat to reading a file and sending it out through `WebFetch` with no card (not tried).
- ❌ An edit to the guide does not reach a group chat that has already started, until it is compacted.
- ❌ Moving the state folder strands every group chat, since the CLI keys a transcript by its folder.
- ❌ A group deleted by hand leaves its chat's transcript to show as an ordinary session in Terminal and other.
- ✅ The owner talks to a session about Pinned, Routines or the loose lists as about a group, and sees the same status without spending tokens.
- ❌ A section's chat reads sessions from every app the owner uses, since Pinned and Started here hold Desktop, terminal and routine sessions, which a group's members may also be. It has the group chat's read-only tools, its card on everything that acts and its refusal of any other session, so a transcript that steers it meets the same gates, and no more.
- ❌ A section's chat sees what the sidebar draws and no more, so the 60 newest sessions of a loose list and the 12 earlier runs of a routine are all it reaches, though the section's archive is listed in full.
- ❌ A section's members change as the owner pins, moves and archives sessions, so a session the chat read a moment ago can be refused the next time.
- ❌ A session started from Ungrouped's chat shows in Started here, because GhostShell started it, and not in Ungrouped.
- ❌ Routines and Terminal and other cannot start a session from their chat, so the owner starts the work in another chat.
- ❌ Each list or read in a section's chat builds the index twice, once for the lists the sidebar draws and once with the archive, where a group's lookup builds it once. A call is rare next to the page's own refresh every 15 seconds, so it is left as it is.

## Pros and Cons of the Options

### A Capcom chat per group, with a status panel the page draws

- ✅ A real session to talk to, and a status that is always current and free
- ❌ A new route, new tools and a new panel to maintain

### A widget the model redraws

- ✅ Nothing new in the page
- ❌ Stale as soon as it is drawn, and every refresh spends tokens

### A dashboard page with no session

- ✅ Cheap and always current
- ❌ Nothing to talk to, which is half of what the owner asked for

## Links

- [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md), amended 2026-10-23 for the group tools
- [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), amended 2026-10-23 for the group's `session`
- [Turn Claude in Chrome on by default](20261015-claude-in-chrome-on-by-default.md), whose ask rule the group chat's rules sit beside
- [Show messages between chats by sender](20261016-peer-messages-between-chats.md)
- [Draw widgets the way Desktop does](20261019-widgets-render-like-desktop.md)
- [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md), whose Sub sessions tab now shows the group's status when the server supports it
