# Serve Desktop-style tools from Capcom's own MCP server

- Status: Accepted, amended 2026-10-19 and 2026-10-23
- Deciders: Eli
- Date: 2026-10-07
- Tags: tools, mcp, chips, widgets, security

## Context and Problem Statement

Claude Desktop gives its sessions built-in tools, such as suggested-task chips, chapter dividers and inline widgets. Desktop serves them from inside its own process, so a session that Capcom runs through the CLI cannot use them. The owner wanted Capcom to have Desktop's built-in tools.

Capcom needs another way to offer the ones that only draw in the page.

## Decision Drivers

- The owner wanted Desktop's built-in tools in Capcom.
- These tools only draw in the page, so they should not ask for approval.
- Model-written HTML in a widget must not reach Capcom or its cookie.

## Considered Options

1. Serve Capcom's own SDK MCP server, the way Desktop serves its tools
2. Borrow Desktop's tools
3. Offer the standard Claude Code tools and the owner's MCP servers only

## Decision Outcome

Chosen option: "Serve Capcom's own SDK MCP server", because it is the mechanism Desktop uses, and Desktop's own tools are out of reach.

Capcom declares a server named `capcom` in the CLI's `initialize` request and answers its `mcp_message` requests over the session's stdio (`lib/tools.mjs`). The server has four tools:

- `spawn_task` and `dismiss_task` make chips, which are cards with Start and Dismiss. Start opens a new Capcom session with the chip's prompt.
- `mark_chapter` draws a titled divider.
- `show_widget` draws HTML or SVG in an iframe sandboxed to `allow-scripts`. A content policy blocks network requests from the frame, apart from script loads from two public script hosts.

Capcom allows its own tools by exact name, with no approval card.

**Amended 2026-10-19.** The server has a fifth tool, `widget_guide`. It takes no input and returns a guide to writing a widget for Capcom (`lib/widget-guide.md`), which `show_widget`'s shorter description asks the model to read once per chat. `show_widget` also takes a new first field, `loading_messages`. The frame's content policy now lets a widget load scripts, styles, images and fonts, and make requests, to four public hosts (cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net and unpkg.com), and load styles and fonts from Google Fonts, because widgets written for Desktop load Chart.js from cdnjs and mermaid from esm.sh. The frame also gets host styles, icons, and a gate on what a widget sends and opens. See [Draw widgets the way Desktop does](20261019-widgets-render-like-desktop.md).

**Amended 2026-10-23.** A chip that is started now nests its new session under the session that made the chip (see [Nest sessions under a parent, and follow the links Desktop records](20261022-nest-sessions-under-a-parent.md)).

**Amended 2026-10-23, group sessions.** A group's own chat gets three more tools, listed to that chat alone: `list_group_sessions`, `read_group_session` and `start_group_session`. They reach that group's sessions only. The two that read run with no card in that chat, and starting a session always asks, in Bypass and Auto too, with no Always allow, as do the CLI's `Bash`, `Monitor`, file edits and `SendMessage` in that chat. A tool call can now be answered later, as a start waits for the CLI to name the new session. See [Give each group a session of its own](20261023-a-session-for-each-group.md).

**Amended 2026-10-23, sub sessions.** Every chat that is no group's own gets two more tools: `list_sub_sessions` and `read_sub_session`. They reach the sessions below that chat at any depth and no others, and both run with no card since they only read (see [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md)).

**Amended 2026-10-27, sending to a session.** That chat gets a third tool, `send_session`, which starts or queues a turn in any other session. Its reads still reach sub sessions alone. It asks with a card every time, in every mode, with no Always allow, as the group tools that start work do (see the same record).

**Amended 2026-10-28, sending from a group's chat.** The chat of a group or a built-in section gets `send_session` too, with the same card, so every chat can message any other session (see [Give each group a session of its own](20261023-a-session-for-each-group.md)).

### Consequences

- ✅ Chips, chapters and widgets work in Capcom. The owner can also start chips that Desktop sessions made.
- ✅ The sandbox keeps widget code away from Capcom's cookie and page.
- ❌ The server relies on the Agent SDK's wire format (`sdkMcpServers` and `mcp_message`), which is not a published contract. It was proven on CLI 2.1.292. If chips stop appearing after a CLI update, check this first.
- ❌ Three Desktop tools stay out of reach: the in-app browser, the iOS Simulator panel and computer use.

## Pros and Cons of the Options

### Capcom's own MCP server

- ✅ Same mechanism as Desktop, and the CLI accepts it
- ❌ Capcom builds and maintains each tool

### Borrow Desktop's tools

- ✅ Nothing to build
- ❌ Not possible, because the tools live inside Desktop's process

### Standard tools only

- ✅ No protocol risk
- ❌ No chips, chapters or widgets

## Links

- [Headless CLI per chat](20261006-headless-claude-cli-per-chat.md)
- [Claude in Chrome on by default](20261015-claude-in-chrome-on-by-default.md), a Desktop tool the CLI provides with a flag
- [Capcom is the only client](20261015-capcom-is-the-only-client.md)
- [Give each group a session of its own](20261023-a-session-for-each-group.md), amended this record 2026-10-23
- [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md), amended this record 2026-10-23
