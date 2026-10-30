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

Chosen option: "A list of its own, `scheduled.json`, on the routines' check", because a one-off has a lifecycle a routine does not, and a list of its own keeps that lifecycle out of the routine rules while the policy that must not drift is shared.

- **The store.** `scheduled.json` holds a `scheduled` list. Each entry has an id taken from its title, `at`, `cwd`, `prompt`, `model`, `effort`, `mode`, an optional `group`, and a `status` of `pending`, `started`, `skipped` or `cancelled`, with `sessionId`, `startedAt`, `lastError` and `retry`. It is written atomically and read again at each check, as `routines.json` is. Both files use one shared reader and writer, `makeListFile` in `lib/routines.mjs`.
- **One check.** The 30 second check that runs the routines also runs `scheduled.tick()`. An entry is marked `started` before its session is started, so a crash between the two cannot start it twice.
- **What is shared.** Code both lists call: `makeListFile` (the atomic store), `nextTry` (the retry backoff, its count and the 12 hour give-up), `readCommonFields` and `refusedFields` with `COMMON_NAMES` (the title, folder, model, effort and mode checks), `makeNotes` (log each complaint once), the catch-up limit of 12 hours and the `<scheduled-task>` wrapper. Both lists also count against one limit of three automated sessions at once: each scheduler is given a callback that counts the other's running sessions, and a due entry waits when the two add up to three.
- **What is parallel.** The scheduler loops are separate: `makeScheduler` in `lib/routines.mjs` and `makeScheduledSessions` in `lib/scheduled.mjs`, each with its own due check, launch, queued retry and reaping. They differ in what they decide (a cron fire against a single date and a status), so one loop would need a case for the kind at most steps. A change to the shape of the retry or the catch-up has to be made in both; the shared helpers keep the numbers and the field rules from drifting. The group is resolved with `groupNamed` from `lib/layout-tools.mjs`, and its refusal becomes the `group` problem.
- **Failure handling.** A start that throws is queued as `retry`. A refusal, such as a folder that is gone, marks the entry `skipped`, because trying again would fail the same way. GhostShell remembers, until it restarts, each id it has started with the `at` it started for. A file that says `pending` for that id and `at` is an older copy saved over it, and is put back to `started`. An entry with a status outside the four, or `started` with no session, is shown as a problem and logged once.
- **The wrapper.** The first message uses the `<scheduled-task>` tag, with `once="true"` and a preamble that says "the prompt" and not "the task file". The transcript reader gives a wrapper marked `once` its own kind, `scheduled`, so the session is not a run of a routine, has its own divider ("Started by the <name> scheduled session") and its own line in a summary. Wrappers saved before this, with no mark, are still read as routine runs. Started by GhostShell, a one-off is never handed to the Desktop app.
- **Its title and group.** The session takes the entry's title, which the titler records as the owner's. If the entry names a group, the session is put there with the same layout call the chips use. A group that has been deleted leaves the session on Home, and `lastError` says so.
- **The page and Home.** A Scheduled sessions page, modelled on Routines, lists the entries and adds, edits, cancels, starts and deletes them. Home shows the pending and skipped ones in a Scheduled section. A started one leaves the section, because it is a session by then.
- **The API.** `api/scheduled` with the same origin check, auth and 400 `problems` shape as routines. `GET api/sessions` says `scheduled: true` in its features.
- **Out of scope.** An MCP tool for a session to schedule one, anything recurring, and prompt files.

### Consequences

- ✅ A one-off cannot repeat, because it has no schedule to repeat on
- ✅ The Routines page and section stay about routines, and a one-off has its own states
- ✅ The retry numbers, the field checks and the wrapper are shared code, and the three-at-once limit is one limit
- ❌ A second list and a second page for the owner to learn
- ❌ Two files use the same reader and writer, so a change to it has to suit both
- ❌ The two scheduler loops are parallel, so a change to how a start is launched or reaped is made twice

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
- ✅ Reuses the check, the shared retry and field helpers and the wrapper
- ❌ A second page and a second file

## Links

- [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md), whose scheduler this borrows
- [Name sessions from their first turn, with a small model, and keep titles that are given](20261027-name-sessions-from-their-first-turn.md), which keeps the given title
- [Scheduled sessions](../scheduled-sessions.md), the user guide
