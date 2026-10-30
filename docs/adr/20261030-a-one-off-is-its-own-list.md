# Keep a one-off scheduled session in its own list, not as a routine pinned to a date

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-30
- Tags: scheduled-sessions, routines, scheduler

## Context and Problem Statement

[GhostShell runs routines itself](20261025-ghostshell-is-the-only-home-for-routines.md), each a prompt and a cron schedule. The owner also wants a session that starts once, at a date and time picked in advance, such as "look at the R&D doc on Monday at 09:00". A cron expression can say "09:00 on 2 November", but it repeats every year, so a routine pinned to a date would run again next November unless something switched it off. Where does a one-off live?

## Decision Drivers

- A one-off must never fire twice, including after a crash, a restart or a late catch-up.
- The owner should see what became of it: started, skipped, or called off.
- The scheduler's catch-up, retry and wrapper already work and should not be written again.
- The Routines page and Home's Routines section should keep describing things that repeat.
- No dependency and no build step.

## Considered Options

1. A routine with a date-pinned cron that switches itself off after its first run
2. A one-off kind inside `routines.json`
3. A list of its own, `scheduled.json`, on the routines' check

## Decision Outcome

Chosen option: "A list of its own, `scheduled.json`, on the routines' check", because a one-off has a lifecycle a routine does not, and a list of its own keeps that lifecycle out of the routine rules while the working parts are shared.

- **The store.** `scheduled.json` holds a `scheduled` list. Each entry has an id taken from its title, `at`, `cwd`, `prompt`, `model`, `effort`, `mode`, an optional `group`, and a `status` of `pending`, `started`, `skipped` or `cancelled`, with `sessionId`, `startedAt`, `lastError` and `retry`. It is written atomically and read again at each check, as `routines.json` is. Both files use one shared reader and writer, `makeListFile` in `lib/routines.mjs`.
- **One check.** The 30 second check that runs the routines also runs `scheduled.tick()`. An entry is marked `started` before its session is started, so a crash between the two cannot start it twice.
- **Shared rules.** The catch-up limit (12 hours), the retry backoff, the 12 hour give-up, the wait during a restart and the limit of three at once come from the routines. A start that throws is queued as `retry`. A refusal, such as a folder that is gone, marks the entry `skipped`, because trying again would fail the same way.
- **The wrapper.** The first message uses the `<scheduled-task>` tag and preamble the routines use, with `once="true"`. The transcript reader skips routine detection for a wrapper marked `once`, so the session is a normal session in the list and not a run of a routine. The divider in its chat says "Started by the <name> scheduled session".
- **Its title and group.** The session takes the entry's title, which the titler records as the owner's. If the entry names a group, the session is put there with the same layout call the chips use. A group that has been deleted leaves the session on Home, and `lastError` says so.
- **The page and Home.** A Scheduled sessions page, modelled on Routines, lists the entries and adds, edits, cancels, starts and deletes them. Home shows the pending and skipped ones in a Scheduled section. A started one leaves the section, because it is a session by then.
- **The API.** `api/scheduled` with the same origin check, auth and 400 `problems` shape as routines. `GET api/sessions` says `scheduled: true` in its features.
- **Out of scope.** An MCP tool for a session to schedule one, anything recurring, and prompt files.

### Consequences

- ✅ A one-off cannot repeat, because it has no schedule to repeat on
- ✅ The Routines page and section stay about routines, and a one-off has its own states
- ✅ The scheduler's catch-up, retry and wrapper are used, not copied
- ❌ A second list and a second page for the owner to learn
- ❌ Two files use the same reader and writer, so a change to it has to suit both

## Pros and Cons of the Options

### A routine with a date-pinned cron that switches itself off after its first run

- ✅ No new list, page or API
- ❌ A crash or a failed write between the run and the switch-off repeats it a year later
- ❌ The routine stays in the list for good, and says nothing about whether it ran
- ❌ A one-off cannot be edited as a date and time, only as a cron

### A one-off kind inside `routines.json`

- ✅ One file and one page
- ❌ Every routine rule needs a case for the kind: next fire, pause, run now, the id, the sidebar section and the run grouping
- ❌ A routine's switch and its "Off" have no meaning for something that fires once

### A list of its own, `scheduled.json`, on the routines' check

- ✅ A lifecycle that fits: pending, then started, skipped or cancelled
- ✅ Reuses the check, the catch-up, the retry queue and the wrapper
- ❌ A second page and a second file

## Links

- [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md), whose scheduler this borrows
- [Name sessions from their first turn, with a small model, and keep titles that are given](20261027-name-sessions-from-their-first-turn.md), which keeps the given title
- [Scheduled sessions](../scheduled-sessions.md), the user guide
