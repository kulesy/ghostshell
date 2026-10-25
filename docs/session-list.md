# Session list

The list of sessions and everything you do in it: start, group, pin, nest, search, archive and rename sessions, and move around with the keyboard.

## The list

### Views

The list shows one view at a time, which you pick in the [projects sidebar](#the-projects-sidebar) (see [projects](#projects)).

- Home shows routines first, then pinned sessions, your groups that are in no project, the sessions started here, ungrouped ones and terminal sessions.
- A project's view shows pinned sessions, then that project's groups, with no header for the project, because the sidebar already names it.

Each group's header, and each of Home's built-in sections (Routines, Pinned, Started here, Ungrouped and Terminal and other), has a button that opens a chat of its own, which shows the status of its sessions in its [Sub sessions tab](tools.md#group-and-section-sessions). Pinned's button shows in every view. A built-in section has no menu, so its header has the chat button alone, and Routines has it beside the button that manages routines.

### Order

Every group lists its sessions by title, A to Z, and a family goes by its head's title. The other sections sort as you set them in Claude Desktop: by last turn, by when the session was made or by title, either way round.

A group shows when it is empty, so a new group can be found and filled. A project with no groups says so beside a New group button. The other sections show only when they hold a session, so an empty section has no chat button either.

### Rows and marks

A session's row is one line on a mouse, as in Claude Desktop: the title, and a mark at the right end that says what the session needs from you.

- The mark is amber when the session needs your input.
- It is blue when the session has something you have not read.
- It is grey while a turn runs.
- It is a small warning triangle when the last turn failed.

A row that needs nothing shows none. GhostShell reads Desktop's unread marks, read only, so a session you read only in GhostShell stays unread in Desktop. On a mouse a row's text is grey, and darkens on the open chat's row and under the pointer.

A folded family's head shows the most urgent mark in its family when that is more urgent than its own, so an amber mark on a folded parent means a session under it needs you. The fold arrow's name and tip say so, as "4 nested sessions, 1 waiting on you".

### Running turns

A row whose turn is running also shows how long that turn has run, left of the mark and of any fold arrow, for a chat GhostShell runs and for one Desktop or a terminal runs. The open chat's row keeps time with its status line. Other rows pick up a turn's start and end on the list's next load, up to 15 seconds later.

### Dots and fold arrows

The dots button takes the mark's place only on a mouse in a window at least 48rem wide, while the pointer is over the row or the focus is in it. The arrow that folds a parent's nested sessions or a routine's earlier runs sits to its left, and shows only then or while they are folded. Below that width, or with no hover, the mark, the arrow and the dots all show.

### Tooltips and touch

A tooltip with the folder, branch, state and when the session last ran opens on the right of the row 700ms after the pointer reaches it, at once if another tooltip closed in the last 300ms, and at once on keyboard focus. A touch screen has no tooltips, so its rows have a second line with those details, and the mark and the buttons always show.

## New sessions

New sessions start from any of these:

- New session, the first item in the + menu at the top of the list.
- The search's New session action.
- Ctrl+N.
- Cmd+N in the installed app.

Each opens an empty chat, and the first message starts the session in the home folder. The + and the keys work while the list is still loading. The search shows its action once the list has arrived.

### Cmd+N in a tab and in the app

In a browser tab Chrome runs Cmd+N as New Window before the page sees the key, so it still opens a window there. In the app's window Chrome gives the page the key first, so there Cmd+N starts a session instead. GhostShell tells a tab from the app's window with the `(display-mode: standalone)` and `(display-mode: window-controls-overlay)` media queries, and treats a full-screen app window as a tab, because Chrome reports it as full screen.

In the app Cmd+N still opens a second GhostShell window on the sign-in page and while a widget has focus, because GhostShell's page never sees the key there. File > New Window in the menu bar opens one too.

### Which key the page names

New session in the + menu and in the search, the Find and Projects buttons' tooltips and the line on the empty page name the modifier that works where GhostShell is running: Cmd in the app on a Mac, and Ctrl otherwise. A touch screen shows no key beside New session.

## Groups and pins

Groups and pins are GhostShell's own, kept in `layout.json` in its state folder. The first time GhostShell starts without that file it copies Desktop's groups, their sessions and its pins in, once, and records when. After that it ignores Desktop's groups and pins. If it cannot read Desktop's files at that start, the layout starts empty and it tries again on each later start.

### Moving a session

Drag a row onto a group to move it there, onto Pinned to pin it, or onto Ungrouped, Started here or Terminal and other to take it out of its group. Routines is not a place to drop. A row drops onto a section on screen. A mouse drags after a few pixels of movement, a finger after a long press, and Esc cancels.

Move to in a row's menu makes the same moves without a drag. It opens a second menu of Pinned, the groups (a project's groups sit under the project's name) and the loose list the session came from, with the place the session is already in left out. It lists the groups of every project, so it also moves a session to a view that is not on screen. A routine's run that was moved into a group or pinned can go back to Routines from there.

Its search box takes the focus when a key opens the menu. Type part of a place's name, or the start of a word in its project's name, and the menu becomes one list: a place in a matching project first, then a place with a matching name. The first result is lit, and Enter moves the session there. An empty box shows the menu as it was.

Each result says where it is:

- A place in a project shows that project beside it.
- A place outside projects shows Home, when a project has places.
- Pinned and Routines show nothing.

### Renaming and deleting groups

There is no screen yet to rename, delete or reorder groups. Edit `layout.json` for those: GhostShell reads it on every refresh, and shows the error at the top of the list if it cannot.

## Nested sessions

### Nesting a session

Nested sessions show under a parent session in the list, indented, with a line from the parent that turns into the last of them, as Claude Desktop draws them.

Drop a row on the middle of another row to nest it there. A row takes a nest only in the middle half of its height, so a row dropped on the top or bottom quarter lands in the section the row is in, as it did before. While you drag, the row that would take the nest lights up and says "Nest here" left of its mark.

Nest under in any session's menu opens a second menu of the other top level sessions in the same section, so a phone nests without a drag. Its search box finds a session by its title, and works as the one in Move to does.

Nesting goes one level deep: a session that holds others takes them along when you nest it, and a drop on a nested row nests under that row's parent. A routine's run and an archived session cannot be a parent.

### Where a nested session shows

A nested session shows in its parent's place, with the parent's group or pin, and counts in that section and project.

The arrow on a parent's row folds its nested sessions. Every family starts open, and the browser remembers which are folded. In a list sorted by last turn a family sorts by its most recent session, so a busy nested session keeps its parent near the top.

### Sub session status

A chat with sessions under it has a Sub sessions tab in its side panel, ahead of Terminal and File. The panel opens on that tab by itself in a window with room for it beside the chat, until you open or close the panel yourself. On a phone or in a narrow window, the list button in the chat's header opens it. That button shows an amber mark while any session below the chat needs you.

The tab lists the sessions under the chat at every depth, so a side chat of a side chat shows there although the list nests one level. The ones that need you come first, then the ones working, the recent ones and the idle ones. Archived sessions stay out of the tab. Each session is a card with its title as a link, when it last moved, its state, the first sentence of its latest reply, what it waits on and a roll-up of the sessions under it, such as "2 sub sessions, 1 waiting on you". Details opens the whole reply in the card, and the sessions under it show below as cards of the same kind. A line at the top of the tab rolls up every level.

GhostShell reads each line's latest reply from the session's transcript, for the lines on show alone, and keeps it until the transcript changes. No model is asked, so the tab costs no tokens. A chat's model can read the same status with two tools of its own ([Sub sessions](tools.md#sub-sessions)). [The decision record](adr/20261023-roll-sub-session-status-up.md) has the detail.

### Taking a session out

Drop a nested session on a section, the indent beside its family included, or move or pin it from its menu, and it leaves its parent and goes there. Move out of in its menu takes it out, and it stays in its parent's group or in Pinned. A parent in neither sends it to the list for where it started: Started here, Ungrouped or Terminal and other.

### Archiving a parent

Archiving a parent archives only the parent. Each session that showed straight under it moves up to its place with the ones under it still under it, and they nest under the parent again when it comes back. Taking a nested session out, moving it, pinning it or archiving it leaves the rest of the family under the parent, even when Desktop links them through that session.

### Links from Desktop

Claude Desktop records which sessions it linked to a parent: side chats, forks and suggested tasks. GhostShell reads those links on every refresh, so it shows the families Desktop shows with no drag, and shows a link Desktop records later on the next refresh.

GhostShell's own choice wins over Desktop's in both directions, as it does for the archive flag. A session you nest stays nested whatever Desktop records, and one you take out stays out although Desktop links it. `layout.json` keeps those choices under `parents`: a parent's id nests a session and a null takes it out. A session with no entry follows the chip it was started from, and then Desktop.

### Sessions started from a chip

A session you start from a chip nests under the session that made the chip, as Desktop nests the tasks it suggests. GhostShell reads that from `chips.json`, so chips you started earlier nest too. Moving the session, pinning it, taking it out or nesting it elsewhere wins over the chip, as it does over Desktop's links. [Chips](tools.md#chips) covers the cards themselves.

## Projects

Projects are an optional level above groups, so a project holds groups and a group holds sessions. A group belongs to at most one project, and one that belongs to none stays at the top level, which Home shows.

Every step below is a menu, so a phone can do all of them. A project's or a group's name runs to 80 characters at most, and two projects may share one.

Group headers fold, and the browser remembers which are folded. A group's name is bold, and a line separates each group from the one above. The + at the top of the list starts a session, or makes a group in the view you are in: at the top level in Home, and in the project in a project's view.

### A project's menu

A project's menu is on its row in the projects sidebar: New group here, Rename and Delete project. The dots at the end of the row open it, and so do a right click, the menu key or Shift+F10, and on a phone a long press.

- Rename puts a name field in the row's place.
- New group here shows that project's list first, as picking it does, and opens the group form there.
- Delete asks first, then moves the project's groups to Home, and shows Home if the project was on screen. No group or session is deleted.

### Moving a group

The dots on a group's header move it into a project, between projects or back to Home, and show only when there is somewhere to move it. A note then says where the group went, and the list stays on the view it was in. A right click or the menu key on a group's header opens the same menu.

Drag a group's header to move the group with its sessions, folded or open. Only your own groups have a handle: Pinned, Routines, Started here, Ungrouped and Terminal and other do not, and neither does a group with nowhere to go. A mouse drags after a few pixels of movement, so a click still folds the group and the dots still open its menu. A finger drags after a long press, so a swipe still scrolls the list, and a long press let go without moving opens the group's menu.

- Between the groups of the view, a line shows where the group will land, and a drop saves that order. The group lands after the groups whose headers are above the pointer, so there is no gap in a group that is open. A drop where the group already is does nothing, and so does a drop over a fixed section or outside the list.
- Onto a project or Home moves the group there, as the menu does. With the projects sidebar open its rows are the targets, and the one under the pointer lights up. With it shut, a Move to strip of Home and the projects appears between the list's header and the list while the group is carried. The view the group is in is left out.
- Esc cancels, and a note says where the group went or why the server refused. After a reorder the focus is on the group's header.

The menu does the same moves for the keyboard and a screen reader: Move up, Move down and the moves to a project.

## The projects sidebar

The projects sidebar picks the view the list shows. Home is first, and each project follows it with the number of sessions in its groups. Pinned sessions show in every view.

### In a wide window

In a window 56rem wide or more, the sidebar is a column on the left, beside the list, and the chat narrows to make room. The Projects button at the left of the list's header opens and closes it, and the browser remembers whether it is open.

Ctrl+B or Cmd+B opens and closes it too, as Cmd+B shows and hides Desktop's sidebar, and closes the search or a menu if one is open. The focus stays where it was, unless it was in the search or in the column as it closed, when it goes to the button.

### In a narrow window

In a narrower window there is no room beside the list, so the sidebar is a sheet that slides in from the left over the page, a chat included. Its top has the same button, pressed, with the title Projects beside it. Ctrl+B or Cmd+B opens and closes the sheet as the button does. A phone always starts with it shut.

These close the sheet:

- Pressing the button.
- Esc.
- A press outside the sheet.
- Picking Home or a project, which also shows that view's list.
- Opening another page.
- A change of view.
- The window growing to 56rem.

With a project's menu open in the sheet, Esc or a press outside closes the menu first.

### The view and the lamps

The browser remembers the view. Opening a chat shows the view that has its row, once for each chat, and a pinned chat leaves the view as it is.

A lamp beside Home and each project is green when a chat in it is working and amber when one needs you. When the sidebar is not showing and a chat in another view needs you, the button has an amber dot.

### New project

New project is the button at the bottom of the sidebar. It asks for a name, shows the reason in the sidebar if GhostShell refuses one, and shows the new project when it takes it.

## Finding a session

Ctrl+K (or Cmd+K), or the search icon at the top of the session list, opens a search laid out like Desktop's. Chips pick what to look through: All, Projects, Groups, Sessions, Routines and Archived, and the left and right arrows move between them from either end of the text.

With nothing typed, All shows recent sessions, then Home and each project, then a New session action. The Groups chip lists every group, Home's first and then each project's in the sidebar's order, or says "No groups yet." when there is none. The Sessions chip lists the newest first.

Typing filters by title, folder, branch or routine, and Home, the projects and the groups by their name. The up and down arrows and Enter open a result, and Esc closes the search.

### The order of results

Every search ranks what it finds the same way: a project first, then a group, then a session, then a session nested under another. In a tie the order the list shows wins.

- Under All the sections are Projects, Groups, Sessions, Sub sessions and Archived.
- The Sessions chip gives Sessions and Sub sessions.
- The Projects and Groups chips give their own section.

Move to's search box uses the same order: a place in a matching project, then a place with a matching name.

### Archived results

Archived sessions stay out of the list and turn up here, under their own chip, most recently archived first, and after the live matches in any search, the ones that are not nested before the ones that are. See [unarchiving](#unarchiving).

### Projects and groups as results

Home, the projects and the groups are results too. Each has its lamp. A project has its number of sessions. A group has the project it is in, or Home, and its number of sessions.

Opening a project or a group closes the search and shows that view in the list. The focus goes to the group's header, after unfolding the group if it was folded. For a project it goes to Home's first header, to a project's first group header, or to New group in a project with no groups.

In a window 56rem wide or more an open chat stays open. In a narrower window the list takes the chat's place. With no project, All leaves the Projects section out, and the Projects chip lists Home alone.

## Archiving

### Archive a session

Right-click a session in the list, or press the menu key or Shift+F10 on it, for a menu with Rename, Move to and Archive. On a phone, long-press the row and let go without moving it. Archive works for any session, whichever app started it. A note at the top of the list then offers Undo for 10 seconds.

When the chat is working or waiting for an approval, the item reads Stop and archive: the turn ends, the approval is denied and the chat's process closes. The list can take up to 15 seconds to show that a turn has started, so if Archive finds the chat running, it asks first.

### Cmd+A

On a Mac, Cmd+A archives too, and the menu shows the key beside the item, except on a touch screen. The key archives the first of these that exists:

1. The session whose menu is open.
2. The row the keyboard moved to, which shows the focus ring.
3. The open chat.

A row you clicked shows no ring, so it doesn't count. For a chat that is working or waiting, Cmd+A asks first with Cancel focused, so Enter or Esc leaves the chat running.

The key does nothing while the ring is on anything in the list or the projects sidebar that is not a session. Text fields and the forms in the list and the projects sidebar keep Cmd+A as Select All. So does the page when no menu is open, no ring is in the list or the projects sidebar, and there is no session to archive. GhostShell leaves Ctrl+A to the browser.

### Where the focus goes

After an archive the focus stays at the same level of the tree.

- After you archive a nested session, the focus goes to the session above it in the family, or the one below when it was the first, and to the parent only when no other is left.
- After you archive a top level row, the focus goes to the row above it in its section, or the row below when it was the first.
- A routine's next run takes the place of its latest.
- When you archive several together, the topmost of them decides where the focus goes.
- Only a section left empty sends the focus to the next row in the list.

After the key archives a session the ring moves there too, so pressing the key again archives that one. When no row is left, the ring moves to the first header, or to the Projects button when there is no header.

Archiving the open chat, from the key or the menu, opens the session the focus went to, or the list when there is none. Undo then opens the archived chat again if you haven't moved on.

### Unarchiving

In the search, each archived result has an Unarchive button, and Shift+Enter unarchives the selected one. Unarchiving, or sending the session a message, brings it back to the group, pin or routine it had.

Desktop's records are read only, so GhostShell keeps these choices in `layout.json`, and its choice wins over Desktop's archive flag in both directions.

## Renaming

Double-click a session's row, or choose Rename in its menu, and a text box takes the row's place with the title selected. Enter saves, Esc cancels, clicking away saves, and a title runs to 120 characters at most. On a phone a double tap opens the session, so rename from the menu.

GhostShell keeps the title in `layout.json` and shows it in place of every other title, for any session, whichever app started it. It shows in GhostShell only: Desktop's records are read only and a terminal session's title belongs to the CLI, so Desktop and the terminal keep the titles they have. A group lists its sessions by the new title, and the search finds them by it.

With `desktopHandoff` set to `true`, a session renamed here before it is handed to Desktop takes its GhostShell title with it (see [sessions started here](how-it-works.md#sessions-started-here)).

## Keyboard in the list

### The list

The up and down arrows move through the section headers and the sessions, and Home and End jump to either end. Left and right fold a section, a routine's runs or the sessions nested under a row.

- Right on a row whose nested sessions show moves to the first of them.
- Left on a nested session or an earlier run moves back to the row above it.
- Enter opens the focused session.
- The menu key or Shift+F10 opens its menu.
- On a Mac, Cmd+A archives it.

With no chat open, up or down steps into the list. Tab reaches the dots on a header, and Enter or Space on them opens the menu.

### Menus

In a menu the up and down arrows, Home and End move between items, Esc closes it, and Tab does nothing, so the focus stays in the menu. In a row's menu the right arrow on Move to or Nest under opens its list with the focus in a search box.

In that box:

- The up and down arrows, Home and End light a result, and Enter picks it.
- The left arrow at the start of the box goes back.
- The letters you type reach the box and no item's key.
- The mouse moving onto the list gives the box the focus.
- A touch leaves the keyboard down until you tap the box.

### The projects sidebar

In the projects sidebar the up and down arrows, Home and End move between the views and the New project button. Tab reaches a project's dots, and the menu key or Shift+F10 on a project opens its menu.

## Routine rows

Routines open their latest run with a click. The arrow at the end of a routine's row folds its earlier runs out underneath. A routine's right-click and ... menus have Run now, Pause or Resume, Edit and Delete, and the calendar button on the Routines heading opens the [Routines page](routines.md#the-routines-page). Runs that GhostShell starts itself (see [routines](routines.md)) list there with the routine's title, beside Desktop's runs of the same routine.
