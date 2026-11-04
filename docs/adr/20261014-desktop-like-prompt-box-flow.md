# Match Desktop's flow for new sessions, settings, stopping and tool calls

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-14
- Tags: prompt-box, control-requests, tool-calls, claude-desktop

## Context and Problem Statement

Capcom's first version had a separate form for new sessions, the mode and Chrome controls in the chat header, a Stop button of its own and one row for each tool call. Desktop puts the controls in the prompt box, turns Send into Stop while Claude works, and summarises a run of tool calls in one line. On 14 Oct the owner chose four changes to build: the new-session flow, the controls, Send turning into Stop, and grouped tool calls.

Should Capcom copy all four?

## Decision Drivers

- The owner uses Desktop and wants the same habits in Capcom.
- Model and effort should change mid-session without a restart.
- A message typed while Claude works should steer it.

## Considered Options

1. Build all four changes
2. Build some of the four
3. Keep the first version's flow

## Decision Outcome

Chosen option: "Build all four changes", because the owner wants Capcom to work the way Desktop does.

- **New session.** "+ New session" opens an empty chat with a folder picker above the prompt box. The first message starts the session in that folder.
- **Controls.** The mode, model and effort pickers sit under the text, with Desktop's labels. The `+` menu holds the Chrome switch. **Amended 2026-10-22.** The model and effort became one button with one menu, which also holds a fast mode switch. See [Pick the model, effort and fast mode from one menu](20261022-model-menu-from-the-cli.md).
- **Send and Stop.** While Claude works and the box is empty, Send turns into Stop, and Esc stops too. A message typed during a turn redirects Claude. The CLI holds it until the running tool finishes, and Claude reads it before its next step.
- **Tool calls.** Calls between Claude's messages collapse into one row, such as "Read 3 files, ran 2 commands". A Normal and Verbose switch in the chat header shows them ungrouped, and the browser remembers the choice.
- **Model and effort.** A change goes to the running process as a `set_model` or `apply_flag_settings` control request, so Capcom does not restart the process. It applies from Claude's next request, even mid-turn. Capcom saves each pick in `picks.json` in its state folder, so the pick survives the idle stop and a restart.

**Amended 2026-10-15.** The owner had the Normal and Verbose switch removed, so tool calls are always grouped and a group opens to show each call. The `+` menu went with the Chrome switch. Ctrl+N starts a new session, and the "+ New session" button was removed. A Ctrl+K spotlight replaced the search box, and every section of the list shows its newest session first, with routines at the top.

**Amended 2026-10-16.** A thought among the calls joins the row, as in "Thought, ran 2 commands", and opens with the calls. A thought with no call beside it is a row of its own. See [Show Claude's live work](20261016-live-work-from-the-cli-stream.md).

**Amended 2026-10-19.** Cmd+N also starts a new session in the installed app, at the owner's request. In a tab, Chrome lists New Window among its reserved commands (`kReservedCommandIds` in [accelerator_table.cc](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/ui/accelerator_table.cc)) and runs it before the page gets the key. In an app's window `BrowserCommandController::IsReservedCommandOrKey` reserves no keys ([browser_command_controller.cc](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/ui/browser_command_controller.cc)), so the page gets Cmd+N first and Capcom calls `preventDefault` to keep it from Chrome. Capcom takes Cmd+N only while `(display-mode: standalone)` or `(display-mode: window-controls-overlay)` matches. A full-screen app window reports `fullscreen`, so Capcom treats it as a tab. The hints in the search, on the Find button and on the empty page name Cmd in the app on a Mac, since only a Mac has a Cmd key, and Ctrl everywhere else. The page never sees the key on the sign-in page or while a widget's sandboxed frame has focus, so there Cmd+N still opens a second Capcom window, and File > New Window always does.

**Amended 2026-10-21.** At the owner's request, New session is back, as the first item in the + menu at the top of the list, above New project and New group. On a phone, with no keyboard, the + and the search are the ways to start a session. The + opens before the list has loaded, with only New session until it has, and the new chat at `#/new` opens without waiting for that first load. The item shows the same key as the search's New session action, Cmd in the app on a Mac and Ctrl everywhere else, and Capcom hides both hints on a touch screen. Later the same day New project moved out of the + into the projects sidebar, so the + now holds New session and New group. See [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md).

**Amended 2026-10-21.** Cmd+A archives a session, at the owner's request. Chrome does not reserve Cmd+A (it is not in `kReservedCommandIds`), so the page gets the key in a tab and in the app, and Capcom calls `preventDefault` when it archives. Capcom takes the key only on a Mac. Elsewhere the Meta key belongs to the system, and Select All is Ctrl+A, which Capcom leaves to the browser on every system. Text fields (`input`, `textarea`, `select`, `contenteditable`) and the forms in the list and the projects sidebar keep Select All. Otherwise the key archives the session whose row menu is open, or else the row that shows the focus ring, or else the open chat (`archiveTarget` in `public/ui/tree.js`). With any other menu open it archives nothing, the search, the image viewer and a question keep the key, and with no session to archive and no ring in the list or the projects sidebar it still selects the page. A row focused by a click shows no ring and does not count, because Chrome leaves the focus on a clicked link, where the owner cannot see it. In headless Chromium 151 such a row stays without `:focus-visible` while Cmd is held. After the key archives a session, the row the focus moves to gets the ring through `focus({ focusVisible: true })`, because Chrome gives none to a script's focus that follows a click. A second press then archives that row. When no row is left beside it, the ring goes to the first header in the list, or to the Projects button when no header is left. A ring on anything in the list or the projects sidebar that is not a row takes the key and archives nothing, so a press too many cannot reach the open chat, which may sit in another view. A key is easier to press by mistake than a menu item, and archiving a chat that is working or waiting stops its turn for good, so for one of those Capcom asks first, in a dialog over the whole page with Cancel focused. While the dialog is open, a capture listener on the document takes Esc, Tab and the app's own keys, so Esc cannot also reach the prompt box and stop the chat. A second question waits for the first, and the question's one text holds for a working chat and a waiting one, since the list can be behind on which it is. The list's state can be 15 seconds old, so any other chat is archived with `stop: false`, by the key and by the menu's Archive item alike. If a turn has started, the server refuses with a 409 and the page asks. Archiving the open chat, from the key or the menu, goes back to the list, because below 56rem the list and its note with Undo are hidden while a chat is open. A refusal goes back too when the list is hidden, so its note can be seen. Undo opens the chat again while the page is still on the list. On a Mac the row menu shows ⌘A beside its archive item, except on a touch screen.

**Amended 2026-10-22.** At the owner's request the search, the question and the note take shadcn/ui's forms. The search is shadcn's command dialog (`public/ui/spotlight.js`): the input keeps the focus, the arrow keys, Home and End light a result as cmdk's do, a pointer moving over a result lights it, and Enter opens it. The search is a dialog and the question an alert dialog, both from `public/ui/dialog.js`, which does what Radix's do: the page behind is locked and hidden from a screen reader, Tab stays inside, Esc closes only the top one, and the focus goes back to what had it. A press outside closes the search and never the question, which is answered with its buttons or Esc, and its Cancel comes first. The note with Undo is a toast in Sonner's style (`public/ui/toast.js`), at the bottom right of the window and across the bottom of a phone. It lasts 10 seconds with Undo and 6 without, and waits while the pointer or the focus is on it. It is drawn over the whole page, so it shows over an open chat as well, and the page still goes back to the list after archiving the open chat, as it did when the note lived in the list. Every hint names its key as ⌘K or ⌃N on a Mac and as Ctrl+N elsewhere (`keyHint` in `public/ui/shortcuts.js`).

**Amended again 2026-10-22.** The search's chips (All, Projects, Groups, Sessions, Routines and Archived) are a Radix tab list. Only the chosen chip is a tab stop, so Tab goes from the field to the chips once and on to the close button, the left and right arrows move the focus and the choice together and wrap at the ends, and Home and End go to the first and last chip. In the list, Alt with the up or down arrow jumps to the previous or next group of results, and Cmd with them to the first or last result, as in cmdk. Capcom leaves out cmdk's Ctrl+J, K, N and P keys, because Ctrl+K and Ctrl+N are Capcom's own. Opening a result from the search leaves the focus in the opened chat's prompt box when the device has a fine pointer, so Cmd+K, a few letters and Enter put the owner back to typing, and on a touch screen the keyboard stays closed. The question and the note name the session in curly quotes, as in Archived “Fix the login”. A finger or a mouse drags the note to the right or down, and it goes when the drag passes 45px or is quick, and springs back otherwise.

**Amended 2026-10-23.** The owner had the folder picker removed, because a new session should always start at the root, which the page reads as the home folder. "+ New session" now opens an empty chat with only the prompt box, and the first message starts the session in the home folder, with the mode and effort Desktop would use there. The server's `api/folders` route stays, but nothing in the page calls it.

**Amended 2026-10-23, the focus after an archive.** At the owner's request the focus stays at the same level of the tree (`stayAbove` in `public/ui/tree.js`). After a nested session is archived it goes to the session above it in the family, or the one below when that session was the first, and to the parent only when no other is left. After a top level row it goes to the row above it in its section, or the row below when it was the first. A routine's next run still takes the place of its latest, and several archived together go by the topmost of them. Only a level left empty sends the focus to the next row in the list, as before. Archiving the open chat now opens the session the focus went to, or the list when there is none, so the page stays on the same branch of the tree. The note is drawn over the whole page, so its Undo shows over that chat on a phone too. Undo opens the archived chat again while the page is still where the archive left it. Moving or nesting a row from its menu moves the focus by the same rule.

**Amended 2026-11-04, walking the sessions.** At the owner's request the up and down arrows in the list also open the session they land on, and Alt with them (Option on a Mac) opens the next or previous one from anywhere, including the prompt box (`shortcut` in `public/ui/shortcuts.js`, `settling` in `public/ui/tree.js`). The search keeps Alt with the arrows for its groups, and an open dialog or name box keeps them too.

### Consequences

- ✅ New sessions, settings and stopping work as they do in Desktop.
- ✅ A model or effort change does not interrupt the work.
- ❌ `set_model` and `apply_flag_settings` are Agent SDK control requests, not a published contract. They were proven on CLI 2.1.299. `apply_flag_settings` accepts any effort level, so `server.mjs` checks the level against the CLI's list first.

## Pros and Cons of the Options

### Build all four

- ✅ One consistent flow, matching Desktop
- ❌ The most work to build and to test

### Build some of the four

- ✅ Smaller change
- ❌ The flow would match Desktop in some places and not others

### Keep the first version's flow

- ✅ No work
- ❌ A separate form, header controls and a separate Stop button that Desktop does not have

## Links

- [Settings follow Claude Desktop](20261008-settings-follow-claude-desktop.md)
- [Preact with htm for the front end](20261015-preact-htm-front-end.md), the rewrite that carries this flow forward
