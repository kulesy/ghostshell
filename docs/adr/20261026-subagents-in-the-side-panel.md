# Show the helpers a session started in the side panel, read from the transcript folder and pushed over the events stream

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-26
- Tags: subagents, side-panel, transcripts, events, sse, failure-detection

## Context and Problem Statement

A session hands work to helpers with the Agent tool: a lookup, an Explore, a general-purpose agent, the PR reviewers. A turn that fans out to four reviewers can run for ten minutes, and the chat says only that a tool call is running. The owner cannot see which helper is still going, which one failed or what any of them is doing, without reading the transcript's tool calls by hand.

He asked for a Subagents tab in the chat's side panel that lists the helpers, says what each is doing and lets him open one. What is the source of the data, how does it reach the page, and what can the server honestly say about a helper that failed?

## Decision Drivers

- It has to work for a chat another app runs, not only for the chats GhostShell runs.
- It has to survive a restart of the server, and show helpers started before the page was opened.
- A helper's transcript can be 30 MB, so a read must be bounded, and a repeat read of an unchanged file must cost a stat.
- The tab has to appear and tick for the chat that is open, without the page asking on a timer.
- A state shown has to be one the files support. A claim of failure must be backed by something the server saw.
- A page older or newer than the server has to cope, and nothing in the repo may name the owner's folders or logins.
- No new dependency and no build step.

## Considered Options

1. Read the folder the CLI writes beside the transcript, and push the list over the chat's events stream
2. Read helpers from the CLI's live stream
3. Read the folder when the page asks, on a timer, as the Sub sessions tab does
4. Find the helpers in the parent transcript's Agent tool calls and results

## Decision Outcome

Chosen option: "Read the folder the CLI writes beside the transcript, and push the list over the chat's events stream", because the folder is written for every chat whatever app runs it, it is still there after a restart, and the events stream already carries what this chat's page must learn as it happens.

- **Source.** For each helper the CLI writes `<project folder>/<session id>/subagents/agent-<id>.jsonl` and `agent-<id>.meta.json`. `lib/subagents.mjs` lists that folder and reads for each file the first lines (when it began, the folder it ran in, the model of its first reply, the start of its prompt) and the end of the file (where it stands and its latest step). The end is read back from the last finished line, 256 KB at a time and no further than 8 MB, so one very large last entry is still found. A half-written last line waits for the next read. A file is parsed again only when its size, its time or its meta file changes, and a read of an unchanged one is a stat. The state is worked out on each read from what was kept, because it depends on the clock. A chat with no folder costs one failed directory read.
- **Not the live stream.** `lib/work.mjs` ignores a helper's own messages (`parent_tool_use_id`), so the stream says nothing of what a helper is doing, and it exists only for a chat GhostShell runs and only while the server is up.
- **The list.** `createSubagents({ now, staleMs, keep })` gives `read(t)`, a list of `{ id, type, description, model, state, startedAt, endedAt, action }`, or an empty list. The 50 newest by write time are listed, running ones first by newest start, then the rest by newest end. `type` and `description` come from the meta file, and a helper with no usable meta file takes its description from the first line of its prompt. `model` is the meta file's alias as given, or the full id of the first reply in the file when the alias is missing or is `inherit`, and is empty before any reply. The page shortens it. `startedAt` and `endedAt` are times, not durations, so the page ticks the elapsed time itself. A helper started by another helper (the meta file names a `parentAgentId`) is left out of the list.
- **Rules.** `lib/subagent-rules.mjs` holds the decisions with no file in reach, as `lib/families.mjs` does: how an entry leaves the agent, the state, how a step reads and the order. `lib/subagents.mjs` only reads. Both are tested, the rules with no files and the reader against made-up folders.
- **State.** `running`, `done`, `failed` or `stopped`. A helper is `failed` when its last entry that says anything is an API error the CLI gave up on (`isApiErrorMessage`), or a reply that stopped for `max_tokens` or `refusal`. It is `done` when the meta file says `finished` or its last reply stopped for `end_turn`, or ended on a tool that ends the turn. An interrupt (`[Request interrupted by user]`) is `stopped` at once. Otherwise it is `running` while its file was written in the last 10 minutes (`STALE_MS`, the same time a chat's turn is live for), and past that it is `stopped`, since the app that ran it quit, unless its last reply was text with no stop reason, which older CLIs wrote for a finished reply, and that reads as `done`. `finished` is not read as success: the CLI sets it on a helper that died of an API error too, so a failure outranks it. Absence of `finished` is not read as running, because about two thirds of finished helpers never get it.
- **Action.** The latest step in a few words, cut to 80 characters: a tool call as a verb and what it touches ("Read lib/work.mjs", "Ran npm test", "Searched for subagent"), built on the same `toolSummary` the transcript and the status line use, or the start of the latest text when the last step was text. A failed helper's action is the error line.
- **Push.** `events()` in `server.mjs` sends a `subagents` event, `{ agents: [...] }`, straight after the first `status`, and again from the same 1.5 s watch that notices another app's turn, only when the list's key changes. The key is the ids, states and actions, not the times, so a running helper does not send an event each second. Unlike the outside turn, the key is not reset when Capcom starts work in the chat, because the page keeps the list through a `state` event. The folder is read only for a chat with a viewer. The list is sent even when empty, so a page can tell "none" from "not heard yet".
- **Detail.** `GET /api/sessions/<id>/subagents/<agentId>` is behind the same sign-in as the other session routes and answers one helper: the list's fields, `steps` (the last 40, each `{ kind: 'tool' | 'text', label, at }`, a text cut to one line of 200 characters) and `reply`, the final text cut to 4,000 characters once the helper is done or failed, otherwise empty. An id that is not `[\w-]+` is a 400, an unknown session is a 404, and an id the folder does not list is a 404 ("No such subagent."), so no path of the caller's is opened and a helper is found only under its own session. It is read-only.
- **Flag.** `GET /api/sessions` carries `features.subagents`. A page that finds it missing shows no tab, and a server that does not send the event leaves the page with no list.
- **No tab without helpers.** The page shows the tab only once the chat has had a helper, as a new session with no terminal has no Terminal tab. A chat that never fans out has a panel exactly as before.
- **Left out.** The whole transcript of a helper, which the owner can still open as a file. Helpers started by helpers, and the helpers a workflow runs (they sit in a `workflows` folder below). Tokens and cost. Any control over a helper: it cannot be stopped or messaged from here.
- **Failure detection, what it covers.** It is checked against the 1,064 meta files and the tails of the 1,067 helper files on the machine this was written on. They hold 7 API errors and one refusal, all as an `isApiErrorMessage` entry at the end of the file, 7 interrupts and 51 old finished replies with no stop reason. It does not read the parent transcript, where the Agent call's result carries `is_error` and `toolUseResult.status`, because finding one call there means scanning a transcript that can be 30 MB. A call that failed before the helper wrote anything leaves no helper to list. A `max_tokens` stop is tested on made-up data only, because no real file has one. A helper whose last entry is a failed tool result reads as running, then stopped, not failed, since a helper normally carries on after one.

<!-- PAGE HALF: the next change adds the Subagents tab here, as a bullet in the style of the Sub sessions tab in 20261023-roll-sub-session-status-up.md (tab and its offer rule, rows, the model name shortened, the ticking time, opening one helper, the old-server case), and its consequences below. -->

### Consequences

- ✅ A chat another app runs shows its helpers the same way as one GhostShell runs, and they show again after a restart.
- ✅ The list costs a directory read and a stat for each file while nothing changes, and no more than about 320 KB for each file that does.
- ✅ A page learns of a helper's new step, ending or failure in 1.5 seconds with no request of its own.
- ✅ A failure is shown only when the file holds it, and a finished helper that died of an error does not read as a success.
- ❌ A helper reads as running for up to 10 minutes after its app quits mid-run, as a chat's turn does.
- ❌ The list changes up to 1.5 seconds after the file, and a helper that is busy inside one long tool call shows the same action until the call returns.
- ❌ An Agent call that failed with no helper written, and a helper that failed for a reason the CLI does not save as an API error entry, are not shown as failed. The parent transcript was not read for them.
- ❌ A `max_tokens` stop and an `is_error` result in the parent were not seen in real files, so the first is tested on made-up data and the second is not detected.
- ❌ The model alias in the meta file is the one the helper was asked for and `inherit` is replaced by the first reply's model, so a helper whose first reply is not yet written shows no model. About 13 percent of meta files have no model.
- ❌ The CLI's folder layout and the meta keys are not a published contract. A CLI that renames them leaves the tab empty and nothing else.
- ❌ Helpers of helpers and workflow helpers are left out, so a chat that only runs those shows no tab.
- ❌ The reads were timed on one machine only: about 4 seconds for the first pass over 355 folders and about 50 milliseconds for a second one. A cold read of one folder with 50 large files was not timed on its own.
- ❌ The page half of this change was not checked in a browser, a phone or Safari by this record.

## Pros and Cons of the Options

### Read the folder beside the transcript, and push the list over the events stream

- ✅ Works for every app's chats, survives a restart, and uses a channel the page already holds open
- ✅ One bounded read for each changed file, and a stat for the rest
- ❌ Relies on files whose layout the CLI does not promise

### Read helpers from the CLI's live stream

- ✅ Nothing is read from disk
- ❌ The stream ignores a helper's own messages, and exists only for a chat GhostShell runs, so it cannot give progress
- ❌ A restart loses every helper

### Read the folder when the page asks, on a timer

- ✅ Needs no push, and suits a list of other sessions, as the Sub sessions tab is
- ❌ The tab has to appear and tick for the chat that is open, and a timer lags a push by its whole period or costs a request every second

### Find the helpers in the parent transcript

- ✅ It carries `is_error` for a failed call
- ❌ The parent transcript can be 30 MB, and a helper that is still running has no result there yet, so progress is missing

## Links

- [Show Claude's live work from the CLI's stream, and ask the CLI for thinking summaries](20261016-live-work-from-the-cli-stream.md), whose tracker ignores a helper's own stream and whose amendment reads another app's turn from the transcript
- [Roll a session's sub session status up to every parent, from the transcripts, with no model calls](20261023-roll-sub-session-status-up.md), whose Sub sessions tab asks the summaries route for visible lines, and whose panel gains this tab
- [Run terminal commands on pipes with no PTY, and run `!` commands in GhostShell](20261023-terminal-without-a-pty.md), whose tab is offered only where it applies, as this one is
