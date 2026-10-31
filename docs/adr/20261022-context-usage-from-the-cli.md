# Show a chat's context usage from the CLI's own count

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-22
- Tags: ui, cli, prompt box, context, tokens

## Context and Problem Statement

Claude Desktop shows how full a session's context window is with a ring under its prompt box: the tokens used out of the window, the percent, and where auto-compact starts. Claude Code's /context lists what fills that context, largest first. Eli asked for both in Capcom's chats.

Capcom runs one headless CLI process per open chat and stops it after 30 idle minutes, so a chat can be open with no process behind it. The window and the auto-compact point differ by model, and a model with "[1m]" in its name has a 1,000,000-token window. Where should the figures come from, so that they match what the CLI uses to decide when to compact, without adding a turn to the session?

## Decision Drivers

- The figures should match the CLI's own, since the CLI decides when to auto-compact.
- Counting must not write to the session. Sending /context as a message would add a turn to the transcript.
- Capcom should not hard-code a window or an auto-compact point.
- A chat with no process should still show what Capcom can know without starting one.
- A count after each turn should cost next to nothing.

## Considered Options

1. Ask the chat's CLI process with the `get_context_usage` control request, and read the session file when there is no process
2. Read the session file alone, with the window and auto-compact point written into Capcom
3. Send /context to the chat as a message

## Decision Outcome

Chosen option: "Ask the chat's CLI process with the `get_context_usage` control request", because it gives the CLI's own figures and parts, follows the model, and runs no turn.

- **The count.** The CLI answers `{"subtype": "get_context_usage", "detail": "summary"}` with the total, the window (`maxTokens`), the auto-compact point (`autoCompactThreshold`, with `isAutoCompactEnabled`) and the parts, each with its tokens. Claude Desktop sends the same request for its own meter. On CLI 2.1.307 the summary answered in about 20 milliseconds, mid-turn as well, and six counts in a row left the session file the same size. `"detail": "full"` counts each part with the API instead of estimating it, which took up to a second the first time and came back from the CLI's cache after that. The ring uses the summary, and the popover asks for the full count when it opens. The page asks for the summary again when a turn ends, the process exits, the session file changes, or the chat's status or model changes, at most once every 5 seconds. A count is not activity, so a page that asks for one does not hold off the 30-minute idle stop.
- **With no process.** Capcom reads the session file backwards from its end, up to 16 MB, to Claude's last reply, and adds its input, cache-write and cache-read tokens. That is the size of the last prompt Claude saw, and it matched the CLI's own total to the token. A compaction after that reply makes the figure stale, so the meter hides. A session file has no parts, so the popover says the breakdown shows while Capcom runs the chat.
- **The window.** Capcom takes the window and the auto-compact point from the CLI's reply and keeps them in `windows.json` in its state folder, under the model the chat was started with, "[1m]" included. It learns them only from a chat with a model of its own, because a chat without one runs whatever model the CLI picks, which can come from a project's settings. A chat with no process uses the figures for its model if Capcom has run that model before, and shows the total alone if not. Capcom never guesses a window from a model's name.
- **The route.** `POST api/sessions/<id>/context` with `{ "detail": "summary" }` or `{ "detail": "full" }`. It is a POST because answering it can write `windows.json`, so Capcom's same-origin check covers it. It never starts a process.
- **The meter.** A ring sits at the right end of the row under the prompt box, after the model and the effort, where Desktop puts its own. It is a shadcn/ui ghost button, and its tooltip gives the tokens used and the percent. The ring turns amber when the total reaches 90% of the auto-compact point, or of the window when auto-compact is off. A chat whose window Capcom does not know yet shows its total as text in place of the ring. Pressing the ring opens a popover after shadcn/ui's Popover: the tokens used out of the window, the percent, a bar with a mark at the auto-compact point, and a table of the parts, largest first, with free space and the auto-compact buffer under a rule. Focus moves into the popover. Esc closes it and puts focus back on the ring without stopping a running chat, and a press outside closes it. On a narrow phone the permission mode's name shortens with an ellipsis when the row runs out of room, so the row stays one line.

### Consequences

- ✅ Capcom shows the CLI's own figures, so the meter and the CLI agree about when a chat compacts.
- ✅ Counting adds nothing to the session and runs no model turn.
- ✅ A "[1m]" model gets its own window, from the CLI.
- ❌ `get_context_usage` is not a published contract, so a CLI update could change it. If the reply has no figures, the meter falls back to the session file's total.
- ❌ The usage fields in the session file are not a published contract either.
- ❌ A chat with no process shows no parts, and no window until Capcom has run its model once.

## Pros and Cons of the Options

### Ask the chat's CLI process with the `get_context_usage` control request

- ✅ The CLI's own total, window, auto-compact point and parts.
- ❌ Relies on a control request the CLI does not document.

### Read the session file alone

- ✅ Works with no process.
- ❌ Gives no parts, and the window and auto-compact point would be numbers in Capcom that go stale when a model or the CLI changes them.

### Send /context to the chat as a message

- ✅ The CLI's own output, the same text a terminal shows.
- ❌ Adds a turn to the session, and the reply is text for a terminal rather than figures.

## Links

- Builds on [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose process answers the count
- Follows [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md) for the meter and its popover
- Asks the CLI the way [List a chat's skills and commands under / from the CLI's own list](20261022-slash-menu-from-the-cli.md) does
- Extended by [Show plan usage in the context popover from the CLI's own figures](20261031-plan-usage-from-the-cli.md), which adds the plan's limits under the parts
