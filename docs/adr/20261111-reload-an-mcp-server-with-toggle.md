# Reload one MCP server in a running chat by switching it off and on

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-11
- Tags: ui, cli, mcp, context popover

Technical Story: https://github.com/kulesy/ghostshell/issues/132

## Context and Problem Statement

A chat's MCP servers start with its process and take their `env` from the user's `.claude.json` at that moment. Editing a server's `env` has no effect on a chat that is already running, and a new session loses the transcript and the context. How can the owner make one server run with its new `env` inside the running chat?

## Decision Drivers

- The chat's process, transcript and context must stay as they are.
- GhostShell must not pass a command, arguments, `env` or any config to the CLI, so the page cannot start anything the owner did not configure.
- The owner reloads a server, not the whole chat.
- It must work through the CLI's own requests, with nothing written to `.claude.json` by GhostShell.

## Considered Options

1. `mcp_reconnect` for the named server
2. `mcp_toggle` off and then on for the named server
3. Restart the chat's process, which resumes the session

## Decision Outcome

Chosen option: "`mcp_toggle` off and then on", because it is the only request that makes the CLI read the server's config from disk again, and it leaves the process, the transcript and the context alone.

Checked on CLI 2.1.322 with a throwaway `CLAUDE_CONFIG_DIR` and a stdio server that logs its `env` each time it starts:

- **`mcp_reconnect`** replies success and respawns the server, but with the old `env`, because the CLI reconnects from the config it cached when the process started.
- **`mcp_toggle`** with `enabled: false` and then `enabled: true` both reply success, and the respawned server has the new `env`. Switching off writes the name into `disabledMcpServers` for the folder in `.claude.json` and switching on removes it again, so the config ends as it began.
- **`mcp_status`** lists each server's name, status, scope, config type and tools. Its `config` leaves out `env`.

How it works:

- **The routes.** `POST api/sessions/<id>/mcp` lists the servers and `POST api/sessions/<id>/mcp-reload` with `{ "name": "..." }` reloads one. Both are POSTs behind the same sign-in and same-origin check as every other write.
- **The allowlist.** The name is used only if it equals, exactly, a name in that chat's own `mcp_status` list at that moment. The list comes from the CLI and never from the request, and the request carries nothing else to the CLI.
- **What is refused.** The server GhostShell itself serves in the process (config type `sdk`), and a server the owner has switched off, since a reload would switch it on. A server that a failed reload in that chat left off is the exception. A chat with no process is not started: the answer says its servers load fresh when it next starts.
- **One at a time.** A second reload in the same chat gets a 409 while one runs.
- **A failed reload.** If the off fails nothing has changed. If the off works and the on fails, the answer says the server was switched off and did not come back on, with the fresh list, so the page shows where it was left. The chat remembers the servers a failed reload left off, and those keep their Reload button, so the owner can press it again.
- **The page.** The context popover gets an "MCP servers" section: a row for each server with its status in words and a Reload button, hidden for the two refused kinds. The list and the error text are shaped on the server to name, status, scope and error, so config never reaches the browser.

### Consequences

- ✅ An edited `env` takes effect in the running chat, with the transcript and the context kept.
- ✅ GhostShell sends the CLI a name and nothing else, so it cannot start a command that is not already in the owner's config.
- ❌ The three requests are not a published contract. If the CLI changes them, a reload fails with the CLI's words, or the section hides if `mcp_status` stops answering.
- ❌ The toggle briefly writes to `.claude.json`, so two chats in the same folder reloading at the same moment can leave a server off. The failure message names that case.
- ❌ A reload during a turn can fail a tool call that is in flight on that server. GhostShell does not block it, because a server that has hung is a reason to reload.

## Pros and Cons of the Options

### `mcp_reconnect` for the named server

- ✅ Writes nothing to `.claude.json`.
- ❌ Starts the server with the old `env`, which is the one thing the owner wants changed.

### `mcp_toggle` off and then on for the named server

- ✅ Starts the server from the config on disk.
- ❌ Two requests, and a window where the server is off.

### Restart the chat's process

- ✅ Every server starts fresh.
- ❌ Reloads all servers, interrupts a turn in progress and drops anything the process held in memory.

## Links

- Builds on [Show a chat's context usage from the CLI's own count](20261022-context-usage-from-the-cli.md), whose popover holds the section
- Builds on [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose process answers the requests
