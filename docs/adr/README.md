# Architecture decision records

One file per decision, named by the day the decision was made. A record that a later decision replaced stays in place, marked as superseded, with a link to its replacement. Start a new record from [template.md](template.md).

| Date | Decision | Status |
| --- | --- | --- |
| 2026-10-06 | [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md) | Accepted, amended 2026-10-16 |
| 2026-10-06 | [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md) | Accepted, amended 2026-10-21 and 2026-10-22 |
| 2026-10-07 | [Offer Claude in Chrome as a guarded per-chat switch](20261007-claude-in-chrome-guarded-switch.md) | Superseded by [Claude in Chrome on by default](20261015-claude-in-chrome-on-by-default.md) |
| 2026-10-07 | [Build Capcom on Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md) | Partly superseded by [Preact with htm for the front end](20261015-preact-htm-front-end.md) and [a native Swift app](20261107-native-swift-app-keeps-the-node-server.md) |
| 2026-10-07 | [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md) | Accepted, amended 2026-10-19, 2026-10-23, 2026-10-27 and 2026-10-28 |
| 2026-10-07 | [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md) | Accepted, amended 2026-10-15, 2026-10-16 and 2026-11-07 |
| 2026-10-08 | [Start sessions with the settings Claude Desktop would use](20261008-settings-follow-claude-desktop.md) | Accepted |
| 2026-10-13 | [Publish Capcom as a public repository under the MIT licence](20261013-public-repo-under-mit.md) | Accepted |
| 2026-10-14 | [Match Desktop's flow for new sessions, settings, stopping and tool calls](20261014-desktop-like-prompt-box-flow.md) | Accepted, amended 2026-10-15, 2026-10-16, 2026-10-19, 2026-10-21 and 2026-10-22 |
| 2026-10-14 | [Hand new sessions to Claude Desktop through its resume link](20261014-hand-new-sessions-to-desktop.md) | Accepted, amended 2026-10-15 (opt-in, off by default) |
| 2026-10-15 | [Make Capcom the only client and stop integrating with Desktop](20261015-capcom-is-the-only-client.md) | Accepted, amended 2026-10-15, 2026-10-22, 2026-10-23 and 2026-11-07 |
| 2026-10-15 | [Turn Claude in Chrome on by default in every chat and mode, as Desktop does](20261015-claude-in-chrome-on-by-default.md) | Accepted, amended 2026-10-15 |
| 2026-10-15 | [Rewrite the front end on vendored Preact with htm, with no build step](20261015-preact-htm-front-end.md) | Accepted. Shipped 2026-10-15. |
| 2026-10-15 | [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md) | Accepted, amended 2026-10-16, 2026-10-18, 2026-10-21, 2026-10-22 and 2026-10-23 |
| 2026-10-15 | [Send pasted images as content blocks and show transcript images through an endpoint](20261015-images-in-the-prompt-box.md) | Accepted, amended 2026-10-17 |
| 2026-10-15 | [Capcom runs routines itself, from Desktop's prompt files](20261015-capcom-runs-routines-itself.md) | Partly superseded by [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md) |
| 2026-10-16 | [Run the server under a small Capcom app, so macOS permissions belong to Capcom](20261016-capcom-app-for-macos-permissions.md) | Accepted |
| 2026-10-16 | [Show Claude's live work from the CLI's stream, and ask the CLI for thinking summaries](20261016-live-work-from-the-cli-stream.md) | Accepted, amended 2026-10-19, 2026-10-21 and 2026-10-22 |
| 2026-10-16 | [Show the CLI's own user turns as compact notices, from a closed list of known tags](20261016-notices-for-cli-written-user-turns.md) | Accepted, amended 2026-10-16 and 2026-10-23 |
| 2026-10-16 | [Sign in with passkeys that Capcom checks itself on node:crypto, against a list of origins](20261016-passkeys-on-node-crypto.md) | Accepted |
| 2026-10-16 | [Show messages between chats by sender, and show a held message with no way to approve it](20261016-peer-messages-between-chats.md) | Accepted, amended 2026-10-27 and 2026-10-28 |
| 2026-10-16 | [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md) | Accepted, amended 2026-10-21 and 2026-10-22 |
| 2026-10-19 | [Draw widgets the way Desktop does, in a frame that cannot reach Capcom](20261019-widgets-render-like-desktop.md) | Accepted |
| 2026-10-22 | [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md) | Accepted, amended 2026-10-22 |
| 2026-10-22 | [List a chat's skills and commands under / from the CLI's own list](20261022-slash-menu-from-the-cli.md) | Accepted |
| 2026-10-22 | [Nest sessions under a parent, and follow the links Desktop records](20261022-nest-sessions-under-a-parent.md) | Accepted, amended 2026-10-22, 2026-10-23, 2026-10-27 and 2026-11-02 |
| 2026-10-22 | [Show a chat's context usage from the CLI's own count](20261022-context-usage-from-the-cli.md) | Accepted |
| 2026-10-22 | [Pick the model, effort and fast mode from one menu, with the models read from the CLI](20261022-model-menu-from-the-cli.md) | Accepted |
| 2026-10-22 | [Order each list and mark each row as Claude Desktop does](20261022-list-order-and-row-marks.md) | Accepted, amended 2026-10-23 |
| 2026-10-22 | [Make Ghost the look on every device, in a stylesheet of its own](20261022-ghost-look.md) | Accepted, amended 2026-10-23 |
| 2026-10-23 | [Give each group a session of its own, with the group's status drawn above its chat](20261023-a-session-for-each-group.md) | Accepted, amended 2026-10-23, 2026-10-25, 2026-10-27 and 2026-10-28 |
| 2026-10-23 | [Call the app GhostShell, and keep capcom for every internal name](20261023-ghostshell-name.md) | Accepted, amended 2026-10-23 |
| 2026-10-23 | [Attach any file by saving it and mentioning its path](20261023-attach-files-by-path.md) | Accepted |
| 2026-10-23 | [Run terminal commands on pipes with no PTY, and run `!` commands in GhostShell](20261023-terminal-without-a-pty.md) | Accepted |
| 2026-10-23 | [Quote selected text into the prompt box, and send each quote as a blockquote](20261023-quote-selected-text.md) | Accepted, amended 2026-11-02 |
| 2026-10-23 | [Roll a session's sub session status up to every parent, from the transcripts, with no model calls](20261023-roll-sub-session-status-up.md) | Accepted, amended 2026-10-26, 2026-10-27, 2026-10-28, 2026-10-29 and 2026-10-30 |
| 2026-10-24 | [Manage routines from a page, and keep the prompts GhostShell writes in its own folder](20261024-manage-routines-from-a-page.md) | Partly superseded by [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md) |
| 2026-10-25 | [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md) | Accepted |
| 2026-10-26 | [Show pull request status on session cards, read from the gh CLI on the server](20261026-show-pull-request-status-on-session-cards.md) | Accepted, amended 2026-11-04 and 2026-11-12 |
| 2026-10-26 | [Show the helpers a session started in the side panel, read from the transcript folder and pushed over the events stream](20261026-subagents-in-the-side-panel.md) | Accepted |
| 2026-10-27 | [Name sessions from their first turn, with a small model, and keep titles that are given](20261027-name-sessions-from-their-first-turn.md) | Accepted |
| 2026-10-27 | [Let a chip name the group its session opens in](20261027-chips-name-their-group.md) | Accepted |
| 2026-10-27 | [Show a badge after each pull request and issue link in a reply, with a card of its details](20261027-github-link-previews.md) | Accepted |
| 2026-10-28 | [Give sessions tools to find, archive, rename and move sessions, and read chips](20261028-layout-tools-for-sessions.md) | Accepted, amended 2026-11-06 |
| 2026-10-30 | [Keep a one-off scheduled session in its own list, not as a routine pinned to a date](20261030-a-one-off-is-its-own-list.md) | Accepted |
| 2026-10-31 | [Show plan usage in the context popover from the CLI's own figures](20261031-plan-usage-from-the-cli.md) | Accepted |
| 2026-11-02 | [Show banners in the sidebar for Claude's sign-in ending and for merged changes waiting](20261102-banners-for-sign-in-and-updates.md) | Accepted |
| 2026-11-02 | [Keep a draft for each session, and let quotes follow you between chats](20261102-a-draft-for-each-session.md) | Accepted |
| 2026-11-02 | [Drag a selection of sessions as one, and act on it from a menu](20261102-drag-and-act-on-a-selection.md) | Accepted |
| 2026-11-02 | [Keep two Claude accounts signed in and switch GhostShell between them](20261102-switch-claude-accounts.md) | Accepted, amended 2026-11-04 and 2026-11-09 |
| 2026-11-04 | [Find a session by the pull requests it links, from a list a worker thread keeps](20261104-search-sessions-by-pull-request.md) | Accepted |
| 2026-11-04 | [Remind the owner to move Chrome's extension after an account switch](20261104-chrome-follows-the-account.md) | Accepted |
| 2026-11-04 | [Pin a session, group, project or routine to one Claude account](20261104-pin-work-to-an-account.md) | Accepted, amended 2026-11-09 |
| 2026-11-05 | [Edit a linked text file in the viewer, and keep the places that run code or hold secrets read only](20261105-edit-linked-text-files.md) | Accepted |
| 2026-11-07 | [Replace the page with a native Swift app, and keep the Node server](20261107-native-swift-app-keeps-the-node-server.md) | Accepted |
| 2026-11-09 | [Let a pin name an overflow account that takes its work while the pinned one is out of usage](20261109-spill-pinned-work-to-an-overflow-account.md) | Accepted |
| 2026-11-11 | [Reload one MCP server in a running chat by switching it off and on](20261111-reload-an-mcp-server-with-toggle.md) | Accepted |
