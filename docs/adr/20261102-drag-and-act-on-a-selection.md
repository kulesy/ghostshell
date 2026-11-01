# Drag a selection of sessions as one, and act on it from a menu

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-02
- Tags: sessions, drag, selection, layout

## Context and Problem Statement

A row can be picked with Cmd or Ctrl click, but only to archive it or to give the picked rows a [new parent](20261022-nest-sessions-under-a-parent.md). Moving ten sessions to a group meant ten drops or ten menu trips, each its own write and its own Undo. How does a selection move, nest and take out as one thing?

## Decision Drivers

- A drag on a picked row should carry the whole pick, and say so while it is carried.
- One drop is one layout write and one Undo, never a half-applied move.
- Every drag has a way from the keyboard and a phone, which have no drag.
- No new dependency, and the single-row paths keep behaving as they do.

## Considered Options

1. Carry the pick on a drag and offer the same actions from a Move menu, with one request and one Undo per action.
2. Call the single-row routes once for each picked session.
3. Add a separate selection mode with its own toolbar.

## Decision Outcome

Chosen option: "Carry the pick on a drag and offer the same actions from a Move menu", because it reuses the pick bar and the row menu people already have, and one request is the only way to make the change all or nothing.

- **What a drag carries.** Dragging a picked row, when two or more rows are picked, lifts one copy with a count badge and dims every picked row. Dragging a row outside the pick, or a pick of one, carries that row alone as before. A picked session nested under another picked session rides with its parent, so the family stays whole. A session whose parent is not picked is carried and leaves that parent.
- **Where a drop lands.** A section (Pinned, a group, Started here, Ungrouped) moves every carried session there. A row nests every carried session under that row's root, and families stay one level deep. A drop on a carried row, or on a row whose root is carried, is refused with "Can't nest" while over it and with the sentence "A session cannot nest under itself or a session nested under it." on release. Routines take no drop.
- **One write, one Undo.** `POST /api/layout/many` takes `ids` and one `to`, which is `{group}`, `{pinned: true}`, `{parent: id}` or `{parent: null}`. The server checks every id and the loop rule first, writes once, and answers with an Undo token and a count. A refusal writes nothing. `POST /api/layout/many/undo` puts back the entries the write replaced, exactly. The token is held in memory for ten minutes, so a restart or the end of the window ends the Undo, and the note says to move the sessions back by hand. A drop that changes nothing writes nothing and offers no Undo.
- **Bulk actions.** The pick bar's Move button and the picked row's menu share one list: Move to (groups, Pinned and Started here, with a search), Nest under (with a search), Move out of parent, New parent session from two rows, then Archive and Clear selection. These are the keyboard and phone way to do everything a drag does. The selection stays after a move so the next action can follow.
- **Left out.** Rename, because a title belongs to one session. Mark read, because a single row has no such action and opening a chat clears it. Unarchive, because the pick only holds listed rows. Pin and unpin are in Move to, as on a single row.
- **Targets.** Projects, Home and the Move to strip take groups, not sessions, so a session drag drops on sections and rows only. Move to in the menu lists the groups of other projects too, and that is how a selection reaches them.
- **Phone.** A long press lifts the pick as it lifts a row. Swipe to archive is off while anything is picked, so a swipe cannot archive one row out from under a selection.

### Consequences

- ✅ A selection moves, nests or leaves its parent in one step that Undo reverses whole.
- ✅ The menu and the drag share one set of rules in `public/ui/many-rules.js`, so they cannot disagree about where a session may go.
- ❌ An Undo token is lost when the server restarts, because it lives in memory.
- ❌ Sessions cannot be dropped on a project, so a move to another project goes through the menu.

## Pros and Cons of the Options

### Request per session

- ✅ No new route.
- ❌ A failure in the middle leaves some sessions moved and some not, and Undo is one note per session.

### A separate selection mode

- ✅ Room for more actions.
- ❌ A second way to pick, which the pick bar already gives.

## Links

- [Nest sessions under a parent, and follow the links Desktop records](20261022-nest-sessions-under-a-parent.md), whose pick, families, loop rule and New parent this builds on.
- [Give sessions tools to find, archive, rename and move sessions, and read chips](20261028-layout-tools-for-sessions.md), whose single-session moves share the layout steps.
