# Hand off before the prompt cache goes cold

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-24
- Tags: chat, cost, cache, sessions

Technical Story: https://github.com/kulesy/ghostshell/issues/232

## Context and Problem Statement

The prompt cache of a chat lasts one hour. A message that reaches a session after that reloads its whole context at the price of a cache write. How can the owner come back to a long idle session without paying that?

Measured over the last 14 days of the owner's transcripts:

- 89,340 replies wrote a one hour cache, none wrote a five minute one, and 5,232 wrote nothing.
- Resumes after 31 to 58 idle minutes still hit the cache: 92% of 48. From 58 minutes on, none of 138 did.
- 151 returns came after 50 or more idle minutes on sessions of 150,000 tokens or more. 92 were the owner's own message, 46 came from another session and 13 were a task notification.

## Decision Drivers

- The cost falls on the first message after the hour, so the work has to happen before it.
- A session must not lose what it knows, even though the next message cannot reuse its context.
- Nothing may reach a session the owner is using, or one that is busy.
- Old clients must keep working.

## Considered Options

1. Keep the cache warm with a periodic message
2. Ask the idle session for a handoff at about 50 minutes and start a fresh session from it on the owner's next message
3. Do nothing and accept the write

## Decision Outcome

Chosen option: "Ask for a handoff and start a fresh session", because it spends one cheap turn while the cache is warm, and the fresh session starts with a short note and not a reloaded context.

- **When.** The last reply is 50 to under 58 minutes old, wrote a one hour cache, and the context is at least `cacheHandoffTokens` (150,000 by default, 0 for off). The session is not compacted and is idle, and scope rules leave out archived, done, group, section, routine and plan mode sessions, open cards, background jobs and chats another app runs. One ask for each idle stretch.
- **The ask.** A message that stands alone and names `~/.claude/handoffs/<session id>.md`. While it is outstanding the runner allows a Write and a Read of that exact path and refuses any other tool call that would need a card, since nobody is there to answer one. The turn is quiet and holds the row's place.
- **Saved.** A regular, non-empty file written since the ask. Any other message voids the ask, a restart fails an outstanding one, and a reply another app adds after the ask ends the handoff within a minute.
- **Return.** The send action takes `handover: true` from the prompt box and the group reply box. Without it the message goes to the old session, which clears the handoff. With it, and only on a saved, unarchived row and text that is not a slash command, a new session starts with the old one's settings. The seed holds the handoff, or only its path when it is over 64 KB or has an @ in it, because the CLI loads a file a message names with @. The new session takes the old one's place in one layout write and its chips, a lock for each session answers a second send with 409, and a failed start changes nothing.
- **Shown.** `/api/sessions` rows carry `cold`, `continues` and `continuedIn`, and the page and the Mac app show a ring, a line by the prompt box and links between the two sessions.
- **Recorded.** `cache-handoffs.json` holds each session's state and `cache-handoffs.jsonl` logs ask, written, failed, cleared, returned and not-moved.

### Consequences

- ✅ A return after an idle hour starts from a note of a few thousand tokens and not a reloaded context.
- ✅ The old session stays in the archive with its transcript, and links to the new one.
- ❌ Each ask is a turn that costs the cache read of the whole context, once.
- ❌ The new session knows only what the handoff says, so a poor handoff loses detail. The transcript path is in the seed.
- ❌ The window comes from `cache_creation.ephemeral_1h_input_tokens` in the CLI's transcript, which is not a published contract. If it moves, no handoff is asked for.

## Pros and Cons of the Options

### Keep the cache warm with a periodic message

- ✅ The session keeps its whole context.
- ❌ It spends a turn every few minutes on every idle session, which costs more than most returns save.

### Do nothing

- ✅ No new behaviour.
- ❌ The write is paid on 151 returns in 14 days, each on a session of 150,000 tokens or more.
