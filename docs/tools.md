# Tools

The tools GhostShell gives a session: its own `capcom` MCP server, and the Desktop features that are still Desktop only.

GhostShell sessions get the standard Claude Code tools, the claude.ai connectors and the MCP servers in `~/.claude.json`. Desktop serves its own built-in tools from inside the Desktop app, so GhostShell cannot borrow them. It adds its own instead, the same way: a server called `capcom`, declared in the initialize request and answered over the session's stdio (`lib/tools.mjs`).

How sessions start, what they inherit from Desktop and how hand-off works are in [how it works](how-it-works.md#settings-follow-claude-desktop).

## Chips

The `spawn_task` and `dismiss_task` tools make chips. A chip shows as a card with Start and Dismiss. Start opens a new GhostShell session with the chip's prompt, in the folder printed on the card. A chip can carry a model and an effort level, which the card shows after the folder. The session it starts runs on them, and you can change either from the model menu afterwards. Chips that Desktop sessions created can be started too. A session started from a chip [nests under the session that made it](session-list.md#sessions-started-from-a-chip).

## Chapters

The `mark_chapter` tool makes chapters, which show as titled dividers.

## Sub sessions

Every chat that is not a group's or a section's gets `list_sub_sessions`, `read_sub_session` and `send_session`. The first two reach the sessions below that chat, at any depth, and no others. `list_sub_sessions` lists them as a tree, the ones that need you first, each with its roll-up and the first sentence of its latest reply. `read_sub_session` reads the end of one of them and what it waits on. Those two only read, so they run with no card in every mode. An id outside the chat's family gets the same refusal as an id that is no session.

`send_session(session_id, message)` sends a message to any other session on this Mac, so a parent can hand a sub session more work, and a chat can pass a note to a session that is not below it. A chat has no tool that lists sessions outside its family, so the id has to come from you or from the text the chat is working on.

1. **It always asks.** The card appears in the parent chat every time, in every permission mode including Bypass and Auto, and has no Always allow. Sending makes another session act, and the chat reads sub sessions without asking, so you decide each send. The card names the session by its title and shows the message.
2. **An idle session is started.** A session with no process is resumed and reads the message at once. The tool answers "Delivered".
3. **A busy session is queued.** A session in the middle of a turn is never interrupted. The message waits behind the turn and the session reads it before its next step. The tool answers "Queued", and says so when the session is waiting for you to approve something.
4. **A session running in another app is refused.** If Desktop or a terminal looks to be running it and GhostShell has no process of its own for it, a second process on the same transcript could corrupt it, so the tool asks the parent to try again later.
5. **An archived session is refused.** The tool tells the parent to ask you to unarchive it. It never unarchives anything itself.
6. **The session must exist and not be the sender.** An id that is no session gets "No session with that id on this Mac", and a chat cannot send to itself. The message must be text and at most 20,000 characters.
7. **No reply is awaited.** The tool returns at once. The session sees the message as a turn wrapped in a `<session-message>` tag, and the chat draws it as a notice titled "Message from" and the sender's name, with "(your parent session)" when the sender is its parent, "(your ancestor session)" when it is further up, and "(another session)" for any other session, a parent or a sibling included.
8. **Only a sub session's reply can be read back.** For a sub session the tool tells the chat to call `read_sub_session` later. For any other session it says that `read_sub_session` cannot read the reply, and that you see the reply in that session's own chat, so the message should say what the session is to do.
9. **Nothing is pushed.** GhostShell never passes status up on its own and starts no turn in a parent by itself. A message to any session, a parent included, goes only when you approve its card in the sender's chat, and the receiver reads it as a message from another session, never as permission. `crossSessionInbound` stays off.

A model may treat a message that reaches a running session in the middle of a turn as untrusted text and carry on without it. This was seen twice in testing with Haiku 5.5, so a chat that needs an answer from a sub session reads it afterwards and sends again if it is missing.

A session keeps the tool list it first loaded, even after a resume. One that started before GhostShell restarted does not see `send_session`, and only a session started afterwards does.

`list_sub_sessions` and `read_sub_session` name a session by the title the parent gave its chip in `spawn_task`, as the sidebar and the search do. A name you gave it by renaming still wins, and a session with no chip keeps the title it had before.

These two tools count by session state alone. A session that waits on you for a pull request counts as waiting in the [tab](session-list.md#pull-requests) and on the header button, and not in what they list.

GhostShell never starts a turn in a parent to pass status up. A parent's model learns what is below it when it calls these tools, and you see the same status in the chat's [Sub sessions tab](session-list.md#sub-session-status).

## Group and section sessions

Each group's header has a button that opens the group's own chat at `#/g/<group id>`, and so does the header of each built-in section of Home: Routines, Pinned, Started here, Ungrouped and Terminal and other. A section's chat opens at `#/g/pinned`, `#/g/started` and so on. The button lights with the chat's mark while that chat works or waits for you. A section has no menu, because none of a group's actions fits it, and a section with no sessions is not drawn, so it has no button.

The chat works in a private folder under GhostShell's state folder, shows the live status of its sessions in its side panel, and gets three tools that reach those sessions alone: `list_group_sessions`, `read_group_session` and `start_group_session`. The tools keep those names in a section's chat, and their descriptions say "section". A section's chat sees exactly the sessions the sidebar lists in that section, the same ones with the same caps, with the sessions nested under each, and lists the section's archived ones when it asks for them. Pinned holds the sessions you pinned, from any app, and Routines holds the runs of every routine, so those chats can read sessions from every app you use. Another section's session, a group's session and any other id all get the same refusal. Starting a session always asks first, in every permission mode, and it needs a folder that is not GhostShell's own.

Where a session started from a section's chat goes depends on the section:

- **Pinned** pins it, so it shows in Pinned.
- **Started here** and **Ungrouped** leave it in no group. GhostShell started it, so it shows in Started here, whichever of the two chats started it.
- **Routines** and **Terminal and other** cannot hold a new session. Their chat refuses `start_group_session` and `spawn_task`, a chip from them refuses Start, and the chat's instructions suggest starting the work from a group's chat, from the chat of Pinned or Started here, or in a new session.

[The decision record](adr/20261023-a-session-for-each-group.md) says what these chats can and cannot do.

### The status in the chat

The page draws the status from the list it already loads, so it costs no tokens. It is the chat's Sub sessions tab, laid out as [a session's](session-list.md#sub-session-status): each line is one of the group's or section's sessions with its whole family under it, placed by the most urgent session in the family, and the line at the top rolls up all of them, as "5 sessions, 1 waiting on you, 1 working". A section rolls up as a group does for the same sessions. The panel opens by itself on a wide screen, and the button in the chat's header opens it on a phone. A section with nothing in it says so in the tab.

Idle sessions show last, under their own heading. Archived sessions stay out of the tab, as they stay out of the list.

A server that started before sub session status draws the status above the transcript instead, folded to one line such as "2 need you · 3 working · 12 recent · 140 more", with the idle and archived sessions in a fold of their own. A server that started before groups had sessions has no button, and the group's page says to restart GhostShell. A server that started before sections had sessions has no section buttons, and a section's page says to restart GhostShell.

## Widgets

The `show_widget` tool draws a widget in an iframe sandboxed to `allow-scripts`, with a content policy that limits requests to cdnjs, esm.sh, jsDelivr, unpkg and Google Fonts, so model-written HTML cannot reach GhostShell or its cookie.

The frame carries Desktop's variable names, SVG classes and colour ramps (with GhostShell's own values) and the Tabler icons, so a widget written for Desktop draws the same.

`sendPrompt` sends a message at once on a click inside the widget and asks you first for anything else, and links always ask first. `widget_guide` tells the model how to write one, once per chat, and its `loading_messages` show in a placeholder while it writes.

## Questions

`AskUserQuestion` shows as option buttons, plus a box for your own answer.

## Claude in Chrome

Claude in Chrome is on in every session and every permission mode, as it is in Desktop. The `chrome` setting turns it off for all of GhostShell (see [configuration](configuration.md#chrome)).

GhostShell starts the CLI with `--chrome` and an ask rule for every Chrome tool, so Chrome asks before each action, even ones your settings already allow, and the question shows as an approval card. Bypass permissions is the exception: GhostShell allows Chrome there without a card, as Desktop does, and a switch to a stricter mode asks again at once. Chrome cards have no Always allow.

## Still Desktop only

These stay in Desktop:

- The in-app browser.
- The iOS Simulator panel.
- Desktop's window and sidebar.
- Computer use (not available to the CLI in `-p` mode).
