# Capcom runs routines itself, from Desktop's prompt files

- Status: Accepted, partly superseded by [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md), amended 2026-10-29
- Deciders: Eli
- Date: 2026-10-15
- Tags: routines, scheduler, claude-desktop, launchd

## Context and Problem Statement

Claude Desktop runs the owner's routines, but only while it is open. Each routine's prompt is a file that Desktop keeps, `~/.claude/scheduled-tasks/<id>/SKILL.md`. Desktop holds the schedule itself, in an internal file that has each cron and last run but not the jitter. It fires a routine at the cron time plus a fixed jitter for that routine, so `30 7 * * 1-5` with 737 seconds of jitter runs at 07:42:17.

The [only-client decision](20261015-capcom-is-the-only-client.md) left routines as the last reason to keep Desktop open. The owner asked for Capcom to run them. Who runs the routines, and how does Capcom learn their schedules?

## Decision Drivers

- Desktop should not have to stay open for anything.
- The routines were written against Desktop's wording. The first message of a run is Desktop's `<scheduled-task>` wrapper, so Capcom has to send the same text.
- Routines send drafts, type into Chrome and post to GitHub, so none may run twice, least of all while the owner switches them over from Desktop one at a time.
- A run missed while Capcom was stopped should happen once, and only if it is still useful.
- Capcom already starts headless sessions, lists them, shows their approvals and runs always on under launchd.
- Capcom has no npm dependencies.

## Considered Options

1. Keep Desktop open and let it run the routines
2. One launchd job per routine
3. Capcom's own scheduler, in the server process

## Decision Outcome

Chosen option: "Capcom's own scheduler", because it needs neither Desktop nor a second place to start, watch and answer a run, and it starts a run the way Capcom starts any session.

- The prompts stay Desktop's files. Capcom reads `SKILL.md` afresh at each run, never writes under `~/.claude/scheduled-tasks`, drops the frontmatter and sends the body inside Desktop's wrapper. **Amended 2026-10-24:** a routine added on the Routines page, or one whose prompt is changed there, reads its prompt from Capcom's own `routines/<id>.md`, as [the Routines page decision](20261024-manage-routines-from-a-page.md) sets out. Desktop's files are still never written. Desktop's sentence of instructions in that wrapper contains an em dash, and Capcom keeps it. On 15 Oct 2026 the wrapper matched the recorded first message of all 73 runs of eight routines made since each file was last edited. That check covers the text of the message and not the flags or the environment Desktop starts the CLI with.
- The schedules are copied once, from an export of Desktop's list, as the layout was, and not read live from Desktop's file. `routines.json` in Capcom's state folder holds each routine's id, title, cron, jitter, prompt file, folder, model, effort and permission mode, whether it is switched on in Capcom, whether Desktop has it on, and when it last ran. `npm run seed-routines` fills it from the export with every routine off. Running it again adds new routines and leaves the others as they are.
- The owner switches routines over one at a time: off in Desktop, then on in Capcom with `POST api/routines/<id>/enabled`. Switching on counts the schedule from that moment, so a fire time earlier in the day is not run on top of Desktop's own run.
- A fire time is the cron in the Mac's local time, which Capcom follows if the zone changes, plus the routine's jitter. Capcom checks every 30 seconds, and once at start. A routine that is due starts a session through the same function as a new chat, in its folder with its mode, model and effort, titled with the routine's title. Such a session is never handed to Desktop. The list groups it under Routines by routine id, beside Desktop's runs of the same routine.
- If Capcom was not running at a fire time, the latest missed fire runs once as soon as it is up, provided it is under 12 hours late. A later one is skipped and logged. Several missed fires make one run.
- A fire that comes while the routine's previous run is still working, or waiting for an approval, is skipped and logged, not held over. A run now is refused in the same case.
- The attempt is written to `routines.json` before the session starts, and the next fire is worked out from it. A restart cannot repeat a run, and a failed start is recorded and retried, as the amendment below sets out.
- `GET api/routines` lists the routines with their next fire. `POST api/routines/<id>/run` runs one now, and `POST api/routines/<id>/enabled` switches one on or off.

**Amended 2026-10-29.** The owner asked that a routine that could not start be queued to try again, since a start that failed while the CLI was being updated lost the whole run until the next fire.

- A start that throws queues its fire. `routines.json` keeps one queued fire for each routine, as `retry` with the fire, the tries so far and the time of the next try, and the error stays in `lastError`.
- The wait after the first four failed tries is 1, 2, 5 and 10 minutes, and 15 minutes after each later one.
- The retry stops in three ways: the run starts, the fire is 12 hours old (it is then recorded as skipped), or the routine's next scheduled fire comes due and takes over.
- Only a failed start queues. A routine refused for a bad schedule, prompt file or folder does not, because trying again would fail the same way.
- A retry waits while the restart helper's `restart.lock` is held by a live restart, so a retry does not start a run that the restart is about to cut short. It also waits while a run of the routine is working or starting, so a routine never has two runs, and for a free place under the limit of 3.
- A fire skipped because the previous run is still working stays a plain skip. The owner chose this, because the run still working already covers that work and queueing the fire would run the routine twice back to back.
- A failed Run now leaves a queued fire queued, and a Run now that starts clears it. Switching a routine off, on, or changing its schedule drops the queue.

### Consequences

- ✅ Desktop need not be open for routines, once the owner has switched them over.
- ✅ A run shows in Capcom as it happens, with its approvals and a reply box, beside Desktop's earlier runs.
- ✅ No new dependency, and nothing written to Desktop's files.
- ❌ Capcom has to be running at a fire time. A fire missed by 12 hours or more is skipped.
- ❌ Desktop's schedules are not read live. A routine added or rescheduled in Desktop reaches Capcom through a new export and a hand edit of `routines.json`. **Amended 2026-10-24:** the owner can now add, reschedule and delete a routine on Capcom's Routines page instead.
- ❌ A routine switched on in both apps, or two Capcoms sharing one state folder, run it twice. A test instance needs its own `CAPCOM_STATE`.
- ❌ A run is a headless CLI session in launchd's environment, whose `PATH` is shorter than a terminal's, so the first run of each routine needs watching.
- ❌ Restarting Capcom can cut a run in progress short, and Capcom does not start it again. A plain stop of the server let the CLI finish its turn, but launchd's own restart was not tried.
- ❌ A run that waits for an approval keeps its routine from running again until someone answers. **Amended 2026-10-16:** the owner chose to have such a run stopped and replaced when its routine is next due.
- ❌ `routines.json` is edited by hand as well as by Capcom. A file with a routine that has no id, or an id twice, stops every routine until it is fixed. An editor that saves an old copy puts back an old record, though Capcom keeps its own note of what it started, so the same fire is not run twice.
- ❌ Desktop's own log shows three things Capcom does not copy: it holds back a fourth concurrent scheduled run (its limit was 3), it waits while the Mac is offline, and it waits 60 seconds after a wake. A routine that fires while offline starts anyway, and may fail. **Amended 2026-10-16:** the owner chose to copy the limit of 3, which Capcom now applies, with a run waiting for an answer not counted. The offline wait and the wake delay are still not copied, because a caffeinate agent keeps the Mac awake.

## Pros and Cons of the Options

### Keep Desktop open and let it run the routines

- ✅ Nothing to build, and it is Desktop's exact behaviour
- ❌ Desktop has to stay open on a Mac that is otherwise used through Capcom

### One launchd job per routine

One plist per routine, ten in all, each starting `claude -p` with the wrapped prompt.

- ✅ launchd fires a job when Capcom is down, and runs a calendar job missed during sleep once on waking, as its documentation says
- ❌ A run is outside Capcom, with no live view, no approval cards and nothing to stop it, and Capcom cannot tell whether it is working
- ❌ `StartCalendarInterval` has no ranges or steps, so `1-5` becomes five entries, and it has no jitter
- ❌ Each routine is a plist to write, install and remove, and the schedule lives in two places

### Capcom's own scheduler

- ✅ One process starts, lists, watches and answers every run, and a switch-over is one call per routine
- ✅ cron plus jitter reproduces Desktop's fire times. In the nine days to 15 Oct, 30 of 35 runs of four weekday routines began 38 to 61 seconds after it, which is Desktop's own start-up time. The other five began earlier or later.
- ❌ Capcom has to be up at fire time, and a bug in it can stop every routine at once

## Links

- [Capcom is the only client](20261015-capcom-is-the-only-client.md), which listed routines as the last piece of work
- [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), which took the same seed-once approach to Desktop's groups
- [Headless Claude CLI per chat](20261006-headless-claude-cli-per-chat.md), the process a routine run uses
