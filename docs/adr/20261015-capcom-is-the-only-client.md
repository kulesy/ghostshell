# Make Capcom the only client and stop integrating with Desktop

- Status: Accepted, amended 2026-10-15, 2026-10-22, 2026-10-23 and 2026-11-07
- Deciders: Eli
- Date: 2026-10-15
- Tags: scope, claude-desktop, roadmap, routines

## Context and Problem Statement

Capcom has worked alongside Claude Desktop from the start. It reads Desktop's records, and from 14 Oct it handed new sessions to Desktop. The owner then asked whether a Capcom message could reach a Desktop session and use Desktop's own tools. On 15 Oct the owner decided to use Capcom alone.

Desktop's built-in tools run inside Desktop's own process, and Desktop keeps its sidebar state in memory. Should Capcom keep integrating with Desktop?

## Decision Drivers

- The owner wants one client.
- Capcom cannot add Desktop's tools to its own sessions.
- Capcom cannot write to Desktop's sidebar.
- The owner wants most of Desktop's functions in Capcom.

## Considered Options

1. Capcom is the only client: no writes to Desktop and no relay
2. A relay session in Desktop that forwards Capcom's messages
3. Remote Control
4. Keep handing new sessions to Desktop

## Decision Outcome

Chosen option: "Capcom is the only client", because Capcom can run any session itself, the relay adds a model turn to each message, and Remote Control does not work from Capcom.

- Capcom makes no writes to Desktop and builds no relay. The Desktop hand-off becomes opt-in (see the [hand-off decision](20261014-hand-new-sessions-to-desktop.md)).
- The list still reads Desktop's records and groups, read only, until Capcom organises sessions itself.
- Three Desktop tools stay out of reach: the in-app browser, the iOS Simulator panel and computer use.
- Desktop stays open for routines until Capcom runs them.
- Next, in this order: Capcom's own session organisation (groups, pins, renaming, archive, unread markers and transcript search), then a richer prompt box (pasted images, attached files, slash commands and @ mentions), then routines.

### Consequences

- ✅ One client to build and test, with no relay to maintain.
- ✅ The hand-off is off by default, so Capcom no longer switches Desktop's window.
- ❌ The in-app browser, the iOS Simulator panel and computer use are not available in Capcom.
- ❌ Desktop has to stay open for routines until Capcom runs them.
- ❌ Capcom has to build its own groups, pins and the rest of the organisation that it now reads from Desktop.

**Amended 2026-10-15.** Groups and pins are now Capcom's own, copied once from Desktop's and changed by dragging rows in the list (see [Capcom keeps its own session layout](20261015-own-session-layout-seeded-from-desktop.md)). Renaming, archive, unread markers and transcript search are still to come.

**Amended 2026-10-15.** Pasted and dropped images are in the prompt box (see [Send pasted images as content blocks](20261015-images-in-the-prompt-box.md)). Attached files, slash commands and @ mentions are still to come.

**Amended 2026-10-15.** Capcom now runs routines itself, from the prompt files Desktop keeps, so Desktop no longer has to stay open for them once the owner has switched each routine over (see [Capcom runs routines itself](20261015-capcom-runs-routines-itself.md)).

**Amended 2026-10-22.** Unread markers are in. Each row ends in the mark Desktop would give it: needs input, unread, running or failed. Capcom reads the rows Desktop marks unread from Desktop's Local Storage, read only, and keeps its own marks for the turns it runs in `marks.json`. It still writes nothing to Desktop, so a session the owner reads only in Capcom stays unread in Desktop. See [Order each list and mark each row as Claude Desktop does](20261022-list-order-and-row-marks.md).

**Amended 2026-10-23.** Attached files are in. The + button, a paste and a drop take any file, Capcom saves it and starts the message with its path as Desktop does, and the CLI reads it. See [Attach any file by saving it and mentioning its path](20261023-attach-files-by-path.md).

**Amended 2026-11-07.** This record is about Claude Desktop, and that stands. GhostShell itself now has two clients for a while: the page and the native Swift apps, both talking to the same server. The Swift apps take over from the page once they match it. See [Replace the page with a native Swift app](20261107-native-swift-app-keeps-the-node-server.md).

## Pros and Cons of the Options

### Capcom is the only client

- ✅ Simplest to keep correct
- ❌ Capcom builds what it needs itself

### A relay session in Desktop

- ✅ The target session would run inside Desktop with all of Desktop's tools
- ❌ It costs a model turn per message and labels each message

### Remote Control

- ✅ The supported way to steer a Desktop session from elsewhere
- ❌ It works only from claude.ai and the Claude app, not from Capcom

### Keep handing new sessions to Desktop

- ✅ New sessions appear in Desktop's sidebar
- ❌ Each hand-off adds to Desktop's sidebar and switches its window

## Links

- [Read-only session list](20261006-read-only-session-list.md), which Capcom's own organisation will replace
- [Own MCP server for Desktop-style tools](20261007-own-mcp-server-for-desktop-style-tools.md)
- [Hand new sessions to Desktop](20261014-hand-new-sessions-to-desktop.md), now opt-in
