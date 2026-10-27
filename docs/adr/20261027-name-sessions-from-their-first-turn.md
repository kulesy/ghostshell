# Name sessions from their first turn, with a small model, and keep titles that are given

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-27
- Tags: sessions, titles, layout, models, cost, chips, routines

## Context and Problem Statement

A session GhostShell starts is listed by the first line of its first message. Many of those messages are briefs that open with a heading, so the list shows titles such as "# Server - Let spawn_task set a chip's effort ## Goal I as...". A chip already carries a short title written by the model that suggested it, but the list ignored it once the transcript existed. The owner wants each new session to get a short title that fits it, without a delay in the chat, without a cost that grows with every session, and without GhostShell overwriting a name he chose.

How is a new session named, when, by whom, and what happens when that fails?

## Decision Drivers

- Cost. A title is a small job, so it must run on a small model with a small prompt, once for each session.
- Never block. Starting a session and its first turn must not wait for a title, and a failed title must never reach the page.
- Never overwrite. A title the owner set, at any moment, wins over every generated one.
- GhostShell only. The title goes in `layout.json`, as a rename does. Desktop's records and the CLI's transcript are not written by this path. With `desktopHandoff` on, the existing hand-off may copy the title into the transcript as a custom title.
- No new dependencies and no new push channel ([Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md)). The page already reads titles from the index every 15 seconds.
- Rules that need no model stay in a module a test can run with the model injected.

## Considered Options

1. Clean the first line only: drop heading marks and a leading "Goal", cut at a word
2. Ask Haiku 5.5 at low effort after the first turn, from the first message and the first reply
3. Ask the chat's own model to title the session as part of its first turn
4. Ask Haiku with the first message only, before the first reply

## Decision Outcome

Chosen option: "Ask Haiku 5.5 at low effort after the first turn", with option 1's rules as the fallback, because the first reply says what the session did, which a heading brief often does not, and the call costs about 700 tokens.

1. **A given title wins at once, with no call.** A session started with an explicit title, by the chip start route or by a group chat's start tool, is recorded in `layout.json` `titles` with the rename the page uses, cut to 120 characters. A title that is blank or shows nothing counts as none, and the session is named as in point 2.
2. **A typed session is named after its first turn.** A session started with no title, from the new session page, hears its chat's `delta` events during the first turn and, on `turn-end`, asks for a title. The model reads the first message (after the quote handling the old title already used, cut to 600 characters, or the names of attached files) and the first reply (cut to 800 characters). A first turn that ended in an error, or said nothing, is named from the first message alone. A message that is only pictures is named from the reply alone, and keeps its title if the model fails, since there is no text of the owner's to fall back on.
3. **Two asks, then the rules.** The answer is tidied: first line only, heading marks, surrounding quotes and a trailing period removed, cut at a word to 80 characters, and refused when it is empty, shows nothing, is a question or a sentence addressed to the owner, or runs past 12 words. A refused answer, a failed process or a 45 second timeout is tried once more. After the second failure the title is `fallbackTitle` of the first message, which keeps a heading brief's "Area - task" line and otherwise takes the first line, cut at a word between 60 and 80 characters. One line is logged on stderr, with the session id and the reason and no text from the session.
4. **Never overwrite.** The title is read from `layout.json` before the first ask and again right before the write, with no `await` between that second read and the write, so a rename that has already been saved wins. Naming is not awaited by the chat or by the request, and each session is tried once in a process, even if its turn ends again.
5. **Routines and group chats are never touched.** Only `newSession` starts a chat that has no session yet. It has four callers: the new session page, the chip start route, the group chat's start tool and a routine's run. `titler.start` runs there when `routine` is unset, so a routine's run keeps the title its routine gave it. A group's chat and a built-in section's chat are never started by `newSession`. They are booked by `bookGroupSession` and resumed through `chatFor`, and the index names them from the group or section, so they have no title to replace.
6. **The ask.** `lib/title-ask.mjs` runs the same `claude` binary, once, with `-p`, `--model claude-haiku-5-5`, `--effort low`, `--no-session-persistence`, `--strict-mcp-config`, hooks off, `--tools ""`, `--setting-sources ""`, a replacing system prompt, the prompt on stdin and `--output-format json`. It runs in the system's temporary folder, so no project's instructions load, and it is stopped with SIGTERM after 45 seconds. It uses the owner's existing sign-in and no API key. It is not `--bare`, which skips the OAuth sign-in.
7. **It is not a session.** `--no-session-persistence` writes no transcript, so the run never reaches the session list (checked: a run left no file under `~/.claude/projects`, and the three sessions of the live test left three files and no fourth). `lib/restart.mjs` counts `claude -p` as a chat only without that flag, so the restart waiter ignores it.
8. **The page learns the way it does for a rename.** The server only writes `layout.json`. The next index poll shows the title, within 15 seconds.
9. **A setting turns it off.** `autoTitle` in `config.json` is `true` by default, and `CAPCOM_AUTO_TITLE=0` overrides it. The test harness turns it off unless a test asks, since the fake CLI would be asked as well.

### Cost, measured

Measured on CLI 2.1.311 with six real calls to Haiku 5.5 at low effort and the same 120-word input.

1. With the owner's usual settings loaded and no other changes, a title read 7,060 input tokens, nearly all of it the owner's CLAUDE.md, skills and plugins, and cost 0.0014 dollars.
2. With `--setting-sources ""` it reads 701 input tokens, of which 2 are fresh and 699 are the fixed prompt and tool framing, and cost 0.00015 dollars. A second call within the cache's lifetime read those 701 tokens from cache and cost 0.000015 dollars.
3. The answer is 16 to 17 output tokens.
4. `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `--disable-slash-commands` changed nothing once `--setting-sources ""` was set (701 tokens with and without either), so neither is passed.
5. Wall time for the whole process was 2.6 to 3.3 seconds, of which about 1.5 seconds was the model. The title shows after the first turn ends, plus that, plus up to 15 seconds for the page's poll.
6. It runs once for each typed session. A chip session, a routine run and a group's chat cost nothing.

### Consequences

- ✅ A typed session is listed by what it did, such as "Server - Explain chip effort field purpose", instead of a pasted heading.
- ✅ A chip's session keeps the title its suggester wrote, with no call.
- ✅ Nothing waits on the model, and a failure ends in a title from the owner's own words.
- ✅ A rename always wins, including one made during the first turn or while the title is being asked for.
- ✅ The ask is a separate short process with no session file, so the list, the restart waiter and Desktop never see it.
- ❌ Each typed session spends about 700 input tokens on Haiku, and the owner's plan is billed for it.
- ❌ The model sees the start of the first message and the first reply. Setting `autoTitle` to `false` sends nothing of a session to it.
- ❌ A title generated at the end of the first turn is not there while that turn runs, and a session stopped during its first turn is named from the first message alone, at the turn end that the exit emits first.
- ❌ A title is written once. A session whose subject changes keeps its first title until it is renamed.

## Pros and Cons of the Options

### 1. Clean the first line only

- ✅ No call, no cost, instant.
- ❌ A brief with a heading and a long first sentence still reads badly, and the first line says what the owner asked, not what the session did.

### 2. Ask Haiku 5.5 at low effort after the first turn

- ✅ The first reply shows what the session is about.
- ✅ A small model with no tools is fast and cheap.
- ❌ One more process and one more cost for each typed session.

### 3. Ask the chat's own model to title itself

- ✅ No second process.
- ❌ It adds a turn or a tool call to the owner's session, on a model that may be a large one, and the title is the model's work product in the transcript.
- ❌ It needs a tool the chat must be allowed to use, and a group's chat and a routine would see it.

### 4. Ask Haiku with the first message only, before the first reply

- ✅ The title is ready sooner.
- ❌ It has the same weakness as option 1 for a brief that starts with a heading, and it asks the model before the session has shown what it is.

## Not covered

1. The quality of generated titles has been looked at on a handful of fabricated messages only, not over a run of real sessions.
2. A routine's run, a group chat's own start tool with no title and a first turn that waits on an approval were not run against the real CLI. The first is covered by the code path above, and the unit tests cover the other two with a fake chat.
3. Desktop's hand-off reads the GhostShell title only if it is already recorded when the hand-off runs, so a session handed off before its title arrives keeps the first line there.

## Links

- Builds on [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md)
- Related: [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md)
