# Tools

The tools GhostShell gives a session: its own `capcom` MCP server, and the Desktop features that are still Desktop only.

GhostShell sessions get the standard Claude Code tools, the claude.ai connectors and the MCP servers in `~/.claude.json`. Desktop serves its own built-in tools from inside the Desktop app, so GhostShell cannot borrow them. It adds its own instead, the same way: a server called `capcom`, declared in the initialize request and answered over the session's stdio (`lib/tools.mjs`).

How sessions start, what they inherit from Desktop and how hand-off works are in [how it works](how-it-works.md#settings-follow-claude-desktop).

## Chips

The `spawn_task` and `dismiss_task` tools make chips. A chip shows as a card with Start and Dismiss. Start opens a new GhostShell session with the chip's prompt, in the folder printed on the card. A chip can carry a model and an effort level, which the card shows after the folder. The session it starts runs on them, and you can change either from the model menu afterwards. Chips that Desktop sessions created can be started too. A session started from a chip [nests under the session that made it](session-list.md#sessions-started-from-a-chip), and so shows in that session's group.

A chip can also name a group with the `group` field, the name as the sidebar shows it, such as Reviewing. The name is matched when the chip is made, without regard to case. An unknown name, or one that two groups share, is refused with the list of group names. Start then opens the session in that group on its own, not nested under the session that made the chip. If the group was deleted by then, Start asks you to have the session suggest the task again. The card says where the session opens, with the group's current name. Sessions see the `group` field after GhostShell restarts. See [Let a chip name the group its session opens in](adr/20261027-chips-name-their-group.md).

With more than one account listed, `spawn_task` also takes an optional `account`, the account's id or its name as the Accounts page shows it, matched without regard to case. A name that no account has, or that two share, is refused with one fixed sentence that names no account. With one account the field is not in the tool. The chip stores the account's id, and the tool's reply echoes only what the agent sent. No tool, `list_chips` included, shows a chip's account, and no tool reads or sets the pin of a session that exists. The card says which account the session starts on and where that comes from: the chip, the pins of the place it opens in, or the active account. It also says when the chip's account replaces a pin, and when a pinned account's overflow takes the start. A Change account menu on the card follows the pins or picks another account, and the pick wins over the chip. A signed out account disables Start and shows Sign in, and a removed account disables Start. Start sends the account the card showed, and the server refuses with the reason when the account the session would really start on has changed since. The tool input in the transcript is never read for an account. A server older than the page keeps today's card. See [Pin a session, group, project or routine to one Claude account](adr/20261104-pin-work-to-an-account.md).

## Chapters

The `mark_chapter` tool makes chapters, which show as titled dividers.

## Sub sessions

Every chat that is not a group's or a section's gets `list_sub_sessions`, `read_sub_session` and `send_session`. The first two reach the sessions below that chat, at any depth, and no others. `list_sub_sessions` lists them as a tree, the ones that need you first, each with its roll-up, a `PR:` line when it has a main pull request (the status its card shows and the address, read from GitHub and up to 2 minutes old) and the first sentence of its latest reply. `read_sub_session` reads the end of one of them and what it waits on. Those two only read, so they run with no card in every mode. An id outside the chat's family gets the same refusal as an id that is no session.

`send_session(session_id, message)` sends a message to any other session on this Mac, so a parent can hand a sub session more work, and a chat can pass a note to a session that is not below it. `find_sessions` looks an id up by part of a title when the id is not at hand ([below](#finding-and-changing-sessions)).

1. **It asks outside the sender's own tree.** A send to the sender's parent, to a session below it at any depth, or to a sibling under the same parent goes with no card. A chip session also reaches, with no card, the session that made its chip, the one that chip opened under and the maker's family root, when each is a listed session of its own project (read from the chip, so moving it into a group does not cut the link). Any other send shows a card in the sender's chat every time, in every permission mode including Bypass and Auto, with no Always allow. The card does not hold the sender: the CLI is told at once that the message is queued and not delivered, the turn goes on, and your answer reaches the sender as a note from GhostShell in its own chat. Approving delivers it through the same checks as any send, and denying drops it. A queued send lives in memory, so a GhostShell restart before you answer drops it with no note. GhostShell works out the tree from the nesting links when the send is made, never from what the chat says. A group's or section's chat has no tree, so each of its sends asks. The card names the session by its title and shows the message. The owner's setting [Messages between sessions](#messages-between-sessions) can let more sends go with no card.
2. **An idle session is started.** A session with no process is resumed and reads the message at once. The tool answers "Delivered".
3. **A busy session is queued.** A session in the middle of a turn is never interrupted. The message waits behind the turn and the session reads it before its next step. The tool answers "Queued", and says so when the session is waiting for you to approve something.
4. **A session running in another app is refused.** If Desktop or a terminal looks to be running it and GhostShell has no process of its own for it, a second process on the same transcript could corrupt it, so the tool asks the parent to try again later.
5. **An archived session is refused.** The tool tells the chat to call `unarchive_session`, which shows you a card, and then to send again. `send_session` never unarchives anything itself.
6. **The session must exist and not be the sender.** An id that is no session gets "No session with that id on this Mac" and a pointer to `find_sessions`, and a chat cannot send to itself. The message must be text and at most 20,000 characters.
7. **No reply is awaited.** The tool returns at once. The session sees the message as a turn wrapped in a `<session-message>` tag, and the chat draws it as a notice titled "Message from" and the sender's name, with "(your parent session)" when the sender is its parent and "(another session)" for any other session, a parent or a sibling included.
8. **Only a sub session's reply can be read back.** For a sub session the tool tells the chat to call `read_sub_session` later. For any other session it says that `read_sub_session` cannot read the reply, and that you see the reply in that session's own chat, so the message should say what the session is to do.
9. **Nothing is pushed.** GhostShell never passes status up on its own and starts no turn in a parent by itself. A message outside the sender's own tree goes only when you approve its card in the sender's chat, unless you have set Messages between sessions to let it go, and the receiver reads it as a message from another session, never as permission. `crossSessionInbound` stays off.

A model may treat a message that reaches a running session in the middle of a turn as untrusted text and carry on without it. This was seen twice in testing with Haiku 5.5, so a chat that needs an answer from a sub session reads it afterwards and sends again if it is missing.

A session keeps the tool list it first loaded, even after a resume. One that started before GhostShell restarted does not see `send_session`, and only a session started afterwards does.

`list_sub_sessions` and `read_sub_session` name a session by the title the parent gave its chip in `spawn_task`, as the sidebar and the search do. A name you gave it by renaming still wins, and a session with no chip keeps the title it had before.

These two tools count by session state alone. A session that waits on you for a pull request counts as waiting in the [tab](session-list.md#pull-requests) and on the header button, and not in what they list.

GhostShell never starts a turn in a parent to pass status up. A parent's model learns what is below it when it calls these tools, and you see the same status in the chat's [Sub sessions tab](session-list.md#sub-session-status).

### Messages between sessions

An owner-only setting decides which `send_session` calls go with no card. You choose it on the page, in the Mac app or on the iPhone: the sidebar's Account button, then Settings, then Messages between sessions. The Account menu shows Settings only when the server sends `features.sendReach`. The watch has no accounts screen, so it has no Settings. It has three values, and a send that none of them covers asks, as item 1 says ([issue 240](https://github.com/kulesy/ghostshell/issues/240)).

- **`family`**, shown as Its own family, is the default. Only a send within the sender's tree or chip family goes with no card.
- **`project`**, shown as Its own project, adds a send from an ordinary chat to a session in the sender's own project. Home counts as a project of its own, so two sessions on Home reach each other. A group's own chat counts as a member of its group's project. A section's chat, a group that is gone and an archived session are never reached.
- **`any`**, shown as Any session, adds a send from an ordinary chat to any session that is not archived and not the sender.

A group's or section's chat asks for every send under every value. Archive, unarchive, rename and move, and every move of a project, group or routine, ask exactly as before, because the setting covers `send_session` alone. GhostShell reads the target's project from its own rows and groups, never from the tool's input, so extra fields in a call change nothing.

A message starts a turn in a session that may run in Bypass, and text from a web page, an email or a pull request comment could steer the chat that sends it. A send with no card is therefore capped. Each session may send 10 with no card, and the 11th and every later send from it asks until you next write to that session. Only your own message to the sender, typed in its chat, resets its count. A message from another session, an approved card, a "Continue." and a group's update do not. The count is saved in `send-reach.json` in the state folder, so a restart keeps it. Each session has its own 10, so a chain of sessions that each pass a message on can send more than 10 in all.

`GET api/settings` returns `{"sendReach": "family"}` and `POST api/settings` with `{"sendReach": "any"}` sets it. The write needs the same-origin check the Accounts routes use, and any other value gets a 400. The server sends `features.sendReach` so a page can tell. No tool can read or set it, and a chat cannot raise its own limit. A chat with shell access on the Mac runs as you and can edit `send-reach.json`, and a chat that drives your signed-in Chrome can click the setting, so the setting does not stop a chat that has either.

### Finding and changing sessions

Every chat that has `send_session` also has thirteen tools that work on sessions, chips, projects and groups in place of a hand edit of `layout.json` or `chips.json`.

- **`find_sessions(query)`** lists the sessions whose title has the text in it, or that link the pull request when the text is a number, `#number`, `pull/number` or a pull request address, latest first, with their id, state, folder, branch, last activity and group. It includes archived sessions unless `include_archived` is false, and takes a `limit`. It gives titles and state, and from inside a session only the pull request links that match the query, and it runs with no card.
- **`list_chips`** lists the chips, newest first, with their status, the session each started and the session that made it. It filters by `query`, `status` (open, started or dismissed) and `session_id`, and takes a `limit`. It runs with no card.
- **`archive_session`, `unarchive_session`, `set_session_title` and `move_session_to_group`** change one session. They run the code the sidebar's menu runs. A card names the session by title and id and says what will happen, such as `rename "Old" [id] to "New"` or `move "Title" [id] to "Group" [cg-1]`, with the group's id because two groups can share a name, in every permission mode including Bypass and Auto, with no Always allow.
  - **Archive and unarchive** show you a card for every session. Archiving takes every sub session under it too, and its card says how many. Unarchiving brings back only the ones archived with it.
  - **Rename and move** go with no card when an ordinary chat renames or moves itself, its parent, a session below it at any depth, or a sibling under the same parent. GhostShell works out that tree from the nesting links at the time of the call, as it does for a send. Any other session shows you a card. A group's or section's chat has no tree, so each of its renames and moves shows one.

- **`nest_session(session_id, parent)` and `unnest_session(session_id)`** nest a session under another, and take one out from under its parent, by the code the sidebar's drag and menu run. Both ids are the sessions' ids, and `parent` is never left out: a missing one is refused and is never read as a take out. Being nested is an access grant, so a nest shows a card every time, in every permission mode including Bypass and Auto, with no Always allow, even for a group's chat and for a session nesting itself. The card's first line is the action, `nest "Kid" [kid] under "Boss" [boss]`, and a line under it says each consequence that applies: what the parent can then read, that the family can message, rename, move and take out one another with no card, which sessions under it then show beside it, where it leaves and where it shows, a change of project or account, which group's or section's chat can then read it, which chips' sessions can then send to the parent with no card, whether this chat is involved, and that archiving the parent archives it. When the parent is itself nested, the session goes under its root and the card says so.
  - **Recheck.** The call works the plan out again when it writes. If anything the card showed has changed since, such as a parent, a group, a project, an account or the sessions under it, it refuses, says so and writes nothing, and the session asks again. An approval is for that one call, so a second call, another call, a denied card, another chat or a restart has none and writes nothing. Always allow and an answer keep nothing.
  - **Take out** goes with no card only when an ordinary chat takes out itself or a session in its own tree and neither the account nor the project changes. Any other take out shows a card, and so does one the server cannot work out.
  - **Refused**, with nothing changed: a session under itself or its own child, an archived parent or session, a group's or section's chat on either side, a routine run, an unknown id, and a nest already in place.

- **`create_project(name)` and `create_group(name, project?)`** make a project, or a group on Home or inside a project, by the code the sidebar's New project and New group run. A session can then go from no project to a new group in a new project with these two and `move_session_to_group`. `project` is a name or an id, and leaving it out, or leaving it blank, puts the group on Home. Both show a card every time, in every permission mode including Bypass and Auto, with no Always allow, even for an ordinary chat acting on itself: `create the project "Side"`, or `create the group "Shiny" in the project "Side" [cp-1]` or `... on Home`, with the project's id because two projects can share a name. Each reply gives the new id.

- **`move_group_to_project(group, project?)`** moves a group into a project, or back to Home when `project` is left out or blank, by the code the sidebar's group move runs. `group` and `project` are names or ids, matched without regard to case. It shows a card every time, in every permission mode including Bypass and Auto, with no Always allow: `move the group "Shiny" [cg-1] to the project "Side" [cp-1]` or `move the group "Shiny" [cg-1] to Home`, with ids because two groups can share a name. When the group has no pin of its own and the two projects run on different accounts, the card says which account its sessions will run on. A group already there is answered with nothing changed. A section such as Pinned is not a group and is refused.

- **`move_project(project, before | after)`** puts a project before or after another in the projects sidebar, by the code the sidebar's Move up and Move down run. The three are names or ids, matched without regard to case, and exactly one of `before` and `after` is given. It shows a card every time, in every permission mode including Bypass and Auto, with no Always allow: `move the project "Side" [cp-1] after "Work" [cp-2]`, with ids because two projects can share a name. A project already there is answered with nothing changed. A name that matches no project, or two, is refused with the names or the ids. Home is not a project and stays first.
- **`move_routine_to_project(routine, project?)`** gives a routine a project, or sends it back to Home when `project` is left out or null. `routine` is the routine's title as the Routines page shows it, or its id, and `project` is a name or an id, both matched without regard to case. It shows a card every time, in every permission mode including Bypass and Auto, with no Always allow: `move the routine "Daily digest" [daily-digest] to the project "Side" [cp-1]`. A routine already there is answered with nothing changed. A name that matches no routine or project, or two, is refused with the names or the ids. The routine's runs move with it, and the link is kept in the layout, never in `routines.json`.

Some calls are refused. A name already in use is refused for a new project or group, ignoring case and extra spaces, and the refusal gives the existing id and says nothing changed. A group's name is checked against every group, on Home and in every project, because tools find a group by name alone. A project's name is checked against projects only, so a group may share a project's name. The sidebar still lets you make duplicates. A project that is unknown, or that two projects share the name of, is refused with the names or the ids. A chat cannot archive itself. A session that is working or waiting for you is not archived, since that would stop it, so the tool says to try again once it is idle. A session that looks to be running in another app is refused the same way. A group's or section's own chat cannot be archived, renamed or moved. A session that is already archived, or not, gets a plain answer and nothing changes. A group is named as the sidebar shows it, or by its id, and a name that fits two groups is refused. A group's chat can read the sessions in its group, so when it moves a session into its own group the card says "(this group's chat can then read it)", with "and the N sessions under it" when it has some, and the tool's reply says it too. Those sessions move with it. The title shows in GhostShell only.

## Group and section sessions

A click on a group's header opens the group's own chat at `#/g/<group id>`, and so does a click on the header of each built-in section of Home: Routines, Pinned, Started here, Ungrouped and Terminal and other. A section's chat opens at `#/g/pinned`, `#/g/started` and so on. The header lights with the chat's mark while that chat works or waits for you. A section has no menu, because none of a group's actions fits it, and a section with no sessions is not drawn, so it has no header to click.

The chat works in a private folder under GhostShell's state folder, shows the live status of its sessions in its side panel, and gets three tools that reach those sessions alone: `list_group_sessions`, `read_group_session` and `start_group_session`. A fourth, `github_status`, reads the live status of GitHub pull requests and issues from their addresses, through the same reader as the pull request cards, so the chat does not run `gh` for it. It also gets `send_session` and the eight tools of [finding and changing sessions](#finding-and-changing-sessions), which reach any session. The tools keep those names in a section's chat, and their descriptions say "section". A section's chat sees exactly the sessions the sidebar lists in that section, the same ones with the same caps, with the sessions nested under each, and lists the section's archived ones when it asks for them. Pinned holds the sessions you pinned, from any app, and Routines holds the runs of every routine, so those chats can read sessions from every app you use. Another section's session, a group's session and any other id all get the same refusal. Starting a session always asks first, in every permission mode, and it needs a folder that is not GhostShell's own. A command follows the chat's permission mode, as in any chat, so in Bypass it runs without a card. Every file edit asks every time with no Always allow, but in Bypass a command can write a file or call GhostShell's own API without one, so the cards hold outside Bypass only.

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

## Forms

The `show_form` tool asks you several questions at once. Each question is a single choice, a multiple choice, a short text, a date or a slider, and every choice question has a box for your own answer. The page draws the form from the questions it was sent, so model-written code never runs in it. A date must be a real day within the range the form gives. A question marked optional can be left blank.

Send answers sends one message with your answers, and Skip sends a message that says you skipped. Either one settles the form, which then shows as Answered or Skipped, on every device and after a reload. A form takes one send, so a second click or a second device cannot send it again. Enter in a field does not send it. The turn ends when Claude calls the tool, and your message starts the next one.

A form you have started but not sent holds back the page's automatic reload after an update. `AskUserQuestion` is the better tool for one question Claude needs before it can go on, and it stays as it was. The Mac app shows a form call as an ordinary tool row for now, and `docs/parity.md` tracks the gap.

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
