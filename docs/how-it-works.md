# How it works

Where sessions come from, how a chat runs, how approvals and settings work, how GhostShell reads long sessions and how it looks.

## Where sessions come from

Sessions come from two places, and GhostShell reads both without writing to either.

- Claude Code saves every session as a JSON lines file under `~/.claude/projects`.
- Claude Desktop keeps its titles, groups and pins under `~/Library/Application Support/Claude`.

GhostShell reads the titles, the records and the links between sessions each time, and the groups and pins once (see [groups and pins](session-list.md#groups-and-pins) and [nested sessions](session-list.md#nested-sessions)). Those Desktop files are internal and undocumented. When a Desktop update moves them, the list carries on from the session files alone and says so at the top.

## Chatting

A chat runs the real CLI headless, one process per open chat:

```bash
claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio
```

An existing session adds `--resume <id>`. The process uses your normal login, skills, hooks and MCP servers. It stops after 30 idle minutes and starts again on the next message.

The [chat page](chat.md) covers the prompt box, live work and messages between chats. A group, and each built-in section of the list, also has a chat of its own, which GhostShell books the first time you open it and which runs the same way in a private folder (see [group and section sessions](tools.md#group-and-section-sessions)).

## Approvals

Approvals arrive from the CLI as permission requests and show as cards above the reply box. Closing the page leaves the work running, and a waiting approval is still there when you come back.

"Always allow" applies the rule Claude suggests. The rule usually lands in the folder's `.claude/settings.local.json`.

## Settings follow Claude Desktop

A session Desktop knows continues with the permission mode, model and effort Desktop recorded for it. Any other session, and every new one, gets:

- Desktop's mode for that folder, falling back to `permissions.defaultMode` in `~/.claude/settings.json`.
- Desktop's effort level, unless the session starts from a [chip](tools.md#chips) that names one.
- The model from `~/.claude/settings.json`, unless the session starts from a [chip](tools.md#chips) that names one.

You can change the mode, model, effort and fast mode per chat from the [prompt box](chat.md#the-prompt-box).

## Sessions started here

Sessions started in GhostShell stay in GhostShell, under "Started here", and do not appear in Desktop's sidebar.

Each new session gets a short title in GhostShell's own layout: its chip's title when it has one, otherwise one a small Haiku 5.5 call writes after the first reply (see [naming a new session](session-list.md#naming-a-new-session)).

With `desktopHandoff` set to `true` (see [configuration](configuration.md#desktophandoff)), GhostShell hands each new session to Desktop when its first reply finishes. It stops its own process for the session, adds a title to the transcript, and opens Desktop's hand-off link (`claude://resume?session=<id>`). Desktop adds the session to its sidebar and switches its window to it. The next message sent from GhostShell starts the process again.

## A session open in both apps

Opening a session that is also open in Desktop continues the same session. If you use both at once, the two can drift apart.

## Reading long sessions

The page loads only the last 2 MB of a long session, with "Load earlier" for the rest. Sessions running somewhere else, in Desktop or a terminal, update as their file grows.

### Images in a transcript

The images in a message, and the pictures a tool returned to Claude, are not part of what the page loads. Each message or tool result names them, and the page fetches each one from `api/sessions/<id>/images/<ref>` when it draws the thumbnail. For a strip of Claude's pictures, that is when the thumbnail scrolls near the screen.

The [image viewer](attachments.md#the-image-viewer) uses the same address, so the browser reuses what the thumbnail loaded. The viewer also loads the pictures either side of the one on screen ahead of time.

### Pictures before the loaded part

For the pictures before the part it has loaded, the page asks `api/sessions/<id>/images?before=<offset>` when the viewer opens, and keeps the answer until Load earlier moves that offset. The answer names each picture by its ref and type and carries no image data.

The server builds the list in one pass over the transcript, keeps it, and afterwards reads only the lines added since. The first list for a 130 MB chat takes about 200 ms and later ones 1 ms.

## The look

GhostShell is built on shadcn/ui and follows the system's light or dark setting. Every device gets the Ghost look, inspired by the Ghost in Destiny: black, white and grey, cut corners, status dots drawn as eyes, and a working spinner shaped like a shell that opens and turns round its eye. Sign-in and setup keep the plain shadcn/ui look. [The decision record](adr/20261022-ghost-look.md) says what changes and why.
