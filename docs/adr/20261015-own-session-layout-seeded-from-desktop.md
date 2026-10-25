# Capcom keeps its own session layout, seeded once from Desktop's

- Status: Accepted, amended 2026-10-21, 2026-10-22 and 2026-10-23
- Deciders: Eli
- Date: 2026-10-15
- Tags: sessions, groups, pins, archive, rename, nesting, claude-desktop, drag-and-drop

## Context and Problem Statement

Capcom listed sessions under Desktop's groups and pins, read only, because Desktop keeps its sidebar in memory and writes over its files (see the [read-only list record](20261006-read-only-session-list.md)). On 15 Oct the owner chose to use Capcom alone (see the [only-client decision](20261015-capcom-is-the-only-client.md)) and picked "Organise sessions" as the next piece of work. A layout that Capcom can only read leaves the owner organising sessions in an app they no longer open.

Where should the groups and pins live, and how does the layout Desktop holds today get into Capcom?

## Decision Drivers

- The owner uses Capcom alone, including from a phone, so the layout has to change there.
- Desktop's files are off limits for writes, and Desktop writes over them.
- The groups the owner built in Desktop should not be rebuilt by hand.
- Desktop's files are internal, and a Desktop update can move them.

## Considered Options

1. Write to Desktop's files
2. Keep reading Desktop's layout, for good
3. Keep Capcom's own layout, seeded once from Desktop's

## Decision Outcome

Chosen option: "Keep Capcom's own layout, seeded once from Desktop's", because it is the only option the owner can change from Capcom, and after the first start it does not depend on Desktop's files.

- `layout.json` in Capcom's state folder holds the projects (an id and a name), the groups (an id, a name and the project each is in, if any), the group each session is in, keyed by the CLI session id, the pinned sessions, the sessions archived in Capcom with the time of each, the sessions brought back from Desktop's archive, and the title of each session renamed in Capcom. Capcom writes it to a temporary file and renames it over the old one. It reads the file on every list refresh, so a hand edit shows without a restart, and an unreadable file is reported at the top of the list and never written over.
- The first time Capcom starts without a `layout.json`, it copies Desktop's groups, memberships and pins in, mapping Desktop's local session ids to CLI session ids, and records when. A session that Desktop shows as pinned and in a group is copied as pinned only. If Desktop's files cannot be read at that start, the layout starts empty and Capcom tries again on each later start. Anything the owner placed in Capcom before the copy keeps its place.
- From then on Capcom's layout is the only source of groups and pins, and Desktop's later changes are ignored. Titles, folders, archive state and routines still come from Desktop's records, read only, except where Capcom has made its own archive choice (see the second and fourth amendments below) or renamed a session (see the fifth amendment below).
- A session is in one place: a group, Pinned or neither. Pinning takes it out of its group, as in Desktop. Moving it into a group, or out of its group, takes it out of Pinned.
- `POST api/layout/move` (`{ id, group }`, a `group` of null meaning ungrouped) and `POST api/layout/pin` (`{ id, pinned }`) change the layout. Both refuse a session or a group that Capcom does not know.
- In the list, a row is dragged onto a group, Pinned, Ungrouped, Started here or Terminal and other. Routines is not a target. The drag uses pointer events, so one implementation serves a mouse, which drags after a few pixels, and a finger, which drags after a 350 ms long press.

**Amended 2026-10-16.** A group lists its sessions by title, A to Z, with the titles that start with an emoji first and each half in the collator's order (case ignored, 2 before 10). Pinned, Routines and the loose lists still show their newest session first. The server sorts, and the page uses the same module (`public/ui/order.js`) to place a row that was just dropped.

**Amended 2026-10-16.** Sending a message to an archived session unarchives it. Desktop keeps the archive flag in its own record, which Capcom never writes, so `POST api/sessions/<id>/send` adds the session id to `unarchived` in `layout.json` and the list treats that session as not archived. It returns to the group, pin or routine it was in, because the layout keeps the places of archived sessions too. The reply carries `unarchived: true` so the open page reloads its list at once. If Desktop archives the session again, Capcom still shows it, as it ignores Desktop's later changes to groups and pins. If `layout.json` cannot be written, the message still goes through and the session stays archived. A Capcom from before this change does not know `unarchived` and drops it the next time it moves or pins a session, so the sessions that a message brought back return to the archive. Checked by running that version's layout module on a scratch file.

**Amended 2026-10-16.** Groups can sit under projects, and projects and groups are made and changed from menus. `layout.json` gains `projects` and an optional `project` on each group. `POST api/layout/project/add`, `project/rename`, `project/remove`, `group/add` and `group/move` change them, and `GET api/sessions` carries them. See [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md).

**Amended 2026-10-18.** Capcom archives and unarchives sessions itself, from a menu on each row and from the search. `layout.json` gains `archived`, which maps a CLI session id to the time Capcom archived it. `POST api/layout/archive` (`{ id, archived }`) puts a session in `archived` and takes it out of `unarchived`, or the reverse. It keeps the first time when the session is already in `archived`. The list takes Capcom's choice over Desktop's flag: a session in `archived` is archived, otherwise one in `unarchived` is not, otherwise Desktop's flag stands. Capcom never writes Desktop's record, so any session can be archived, whichever app started it. The search lists the archive by the time Capcom archived each session, or by the time Desktop last wrote the record of one only Desktop archived. Ungrouped, Started here and Terminal and other keep every session Capcom brought back, even when it is older than their newest 60, and a routine keeps one past its 12 earlier runs, so a session unarchived without a message can still be found. Archiving a chat that Capcom runs stops it: a turn in progress is interrupted, an approval it waits on is denied and its process closes. A message still unarchives a session and starts its chat again. A Capcom from before the second amendment drops `archived` the next time it moves or pins a session. One from that amendment onward keeps `archived` but does not read it, so it lists the sessions archived in Capcom until this version runs again. Checked by running those versions' layout modules on a scratch file.

**Amended 2026-10-21.** Capcom renames sessions itself, from a double click on a row and from the row's menu, which also gains Move to. `layout.json` gains `titles`, which maps a CLI session id to the title Capcom shows for it. `POST api/layout/rename` (`{ id, title }`) sets one, as a single line of text of 120 characters at most, and refuses a blank or longer title, a title that is not text, and a session Capcom does not know. The list takes Capcom's title over every other, for every session: the title in Desktop's record, the transcript's custom title or first prompt, and the title Capcom started a session with. It applies the title before it sorts, so a group places the session by its new name, and the search, the archive list and the open chat's header carry it too. The title shows in Capcom only. Capcom writes neither Desktop's files, which are off limits and which Desktop writes over, nor the transcript, which belongs to the CLI, so Desktop and the terminal keep the titles they have. A Capcom-started session handed to Desktop (see the [hand-off decision](20261014-hand-new-sessions-to-desktop.md)) takes its Capcom title into the `custom-title` line the hand-off already writes, cut to 60 characters as the hand-off cuts any title. A rename after the hand-off does not reach Desktop. Move to in the row's menu uses the same `POST api/layout/move` and `POST api/layout/pin` as a drop. It lists Pinned, each group (a project's groups under the project's name) and the loose list the session came from, leaving out the place the session is already in. For a routine's run that was moved into a group or pinned, it also offers Routines, which takes the run out of its group or Pinned, as a drop on a loose list does. A Capcom from before the second amendment drops `titles` the next time it moves or pins a session. One from that amendment onward keeps `titles` but does not show them. Checked by running those versions' layout modules on a scratch file.

**Amended 2026-10-21.** `POST api/layout/archive` takes an optional `stop`. With `stop: false` the server refuses to archive a chat that Capcom runs and that is working or waiting, with a 409, and changes nothing. A `stop` that is not true or false is a 400. Cmd+A and the row menu's Archive item send `stop: false`, so neither stops a turn the page did not know had started. Stop and archive sends no `stop`, and stops the chat as before. See [Match Desktop's flow](20261014-desktop-like-prompt-box-flow.md).

**Amended 2026-10-22.** Sessions nest under a parent. `layout.json` gains `parents`, which maps a CLI session id to the id of the session it nests under, or to null for a session that Capcom took out of the parent Desktop links it to. `POST api/layout/nest` (`{ id, parent }`) nests a session, or takes it out when `parent` is null. `POST api/layout/move` and `POST api/layout/pin` also write a null for a session that has a link, so a nested session that is moved or pinned leaves its parent and lands where it was sent. The same write links each session that shows straight under that session to the one that session showed under, so the rest of the family stays where the page showed it. Capcom reads the links Desktop records between sessions, read only and on every refresh, and does not copy them once as it copies groups and pins, so they join the titles, folders and archive state that still come from Desktop's records. A session with no entry in `parents` follows Desktop's link, and an entry beats the link in both directions, as `archived` beats Desktop's archive flag. A Capcom from before this change keeps `parents` when it writes `layout.json` but does not read it, so its list shows no nesting. Checked by running that version's layout module on a scratch file. See [Nest sessions under a parent](20261022-nest-sessions-under-a-parent.md).

**Amended 2026-10-22.** A group no longer lists its sessions by title, and the other lists no longer go by the time a transcript was last written. Each list follows the sort the owner set for that section in Desktop: recency, created or alpha, either way round. Capcom reads the sorts from Desktop's config on every refresh and does not copy them, as it does not copy the links. A group made in Capcom, which Desktop has no section for, goes newest first. Capcom's old rule that put titles starting with an emoji first is gone, as Desktop has none. See [Order each list and mark each row as Claude Desktop does](20261022-list-order-and-row-marks.md).

**Amended 2026-10-23.** A group can hold `session`, the CLI session id of its own chat, booked the first time the owner opens that chat. A value that is not a UUID, or that an earlier group already holds, is dropped as the file is read and the group stays. That chat is in none of the lists, and the layout routes refuse to move, pin, rename, archive or nest it. See [Give each group a session of its own](20261023-a-session-for-each-group.md).

**Amended 2026-10-23, deleted groups.** `layout.json` gains `retired`, a list of `{ id, name, session }`, one for each deleted group that had a chat. Deleting a group moves its chat there and writes nothing to `archived`, `unarchived` or `titles`. A chat in `retired` is a group's session of a group that is gone, so it stays in none of the lists and keeps the group chat's folder and tool protections, and its transcript is kept. An entry with no id or no session UUID is dropped as the file is read. See [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md) and [Give each group a session of its own](20261023-a-session-for-each-group.md).

**Amended 2026-10-23.** Every group lists its sessions by title again, A to Z, whatever Desktop holds for it. It uses Desktop's title comparison, `localeCompare`, so 10 sorts before 2, and there is no emoji rule. A family goes by its head's title. The other lists still follow their Desktop sorts. See [Order each list and mark each row as Claude Desktop does](20261022-list-order-and-row-marks.md).

**Amended 2026-10-25.** `layout.json` gains `sections`, which maps one of the five built-in section ids to the CLI session id of that section's own chat. An unknown id, a session that is not a UUID or one another entry already holds is dropped as the file is read. See [Give each group a session of its own](20261023-a-session-for-each-group.md).

### Consequences

- ✅ The owner can move and pin sessions from Capcom, on a phone too, and Desktop cannot overwrite the result.
- ✅ A Desktop update that moves its settings no longer takes the groups away.
- ✅ The owner can archive any session from Capcom, on a phone too, and bring one back without sending it a message.
- ✅ The owner can rename any session from Capcom, on a phone too, and a rename touches neither Desktop's files nor a transcript.
- ❌ Desktop's later changes to its groups and pins do not reach Capcom, so the two layouts drift apart from the first start.
- ❌ Capcom has no screen yet to rename groups. Until it has, the owner edits `layout.json`. It creates, deletes and orders groups, and creates projects, from menus (see the third amendment above).
- ❌ Ungrouped, Started here and Terminal and other still show their newest 60 sessions each, so a session moved out of a group that is older than those may not show, unless it was brought back from the archive.
- ❌ Capcom's archive and Desktop's drift apart. A session archived in Capcom still shows in Desktop, and one Capcom brought back stays archived there.
- ❌ Undo after Stop and archive brings the session back to the list, but the stopped turn does not resume.
- ❌ A Capcom title shows in Capcom only, so Desktop and the terminal keep the old title, and a title changed in Desktop afterwards does not show in Capcom.
- ❌ Capcom has no way yet to take a title off, so a session keeps its Capcom title until `titles` in `layout.json` is edited.

## Pros and Cons of the Options

### Write to Desktop's files

Capcom's moves and pins would show in Desktop.

- ✅ One layout, shared with Desktop
- ❌ Desktop keeps its sidebar in memory and writes it back over its files, so the changes would be lost. This comes from a read of Desktop's code on 8 Oct, with no live test.

### Keep reading Desktop's layout, for good

- ✅ One layout, with nothing to copy and nothing to drift
- ❌ Capcom can never change it, and the owner no longer opens Desktop
- ❌ It depends on files that any Desktop update can move

### Keep Capcom's own layout, seeded once from Desktop's

- ✅ It starts from the layout the owner built, changes from Capcom, and does not depend on Desktop after the first start
- ❌ It drifts from Desktop's layout, and Capcom has to grow its own screens for groups

## Links

- [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md), amended 2026-10-15 to point here
- [Capcom is the only client](20261015-capcom-is-the-only-client.md), which put Capcom's own session organisation first on the roadmap
- [Give each group a session of its own](20261023-a-session-for-each-group.md), amended this record 2026-10-23
