# Scheduled sessions

A scheduled session starts once, at a date and time you pick, with a prompt you write. Use one for a job that has a day, such as "look at the R&D doc on Monday morning". For something that repeats, use a [routine](routines.md).

## Where they live

GhostShell keeps them in `scheduled.json` in its state folder. It is a separate list from `routines.json`. GhostShell has to be running when one is due, which is what the launchd agent under [Always on](always-on.md) is for. Each entry has a status.

| Status | What it means |
| --- | --- |
| `pending` | Waiting for its time. Only a pending entry can be started now, edited or cancelled. |
| `started` | The session has started. The entry stays, with a link to the session, and never fires again. One that started and kept no session id shows "Started, but no session was recorded" in red, and stays in Home's Scheduled section. |
| `skipped` | It did not start, and says why. |
| `cancelled` | You called it off. The entry stays until you delete it. |

Any other status, such as one typed by hand with a slip in it, is a problem: the row says "Unknown status" in red, Home keeps it in the Scheduled section, and the server log says so once. The entry never starts.

## The Scheduled sessions page

Open the page from the calendar button on Home's Scheduled heading, the Scheduled link in the footer, a row's menu, or the Scheduled chip in Ctrl+K. Each row shows the title, when it starts in words with the date and time, the folder and the group. A started entry links to its session. A skipped one, or one that cannot start, says why in red. One whose start failed and is waiting to try again says when in amber.

Pending entries come first, soonest first, then the rest, latest first. Each pending row has Start now and a menu with Start now, Edit, Cancel and Delete. Any other row has Delete alone.

Schedule a session and Edit open the same form: title, date and time, folder, model, effort, permission mode, group and prompt. The time is in the Mac's time zone and starts as tomorrow at 09:00. The folder is a typed absolute path and starts as your home folder. The group is where the session goes when it starts, or none to leave it on Home. If GhostShell refuses a save, it saves nothing and shows each problem beside its field. A time that has passed is refused when you add an entry, and when you edit an entry's time. Saving other changes to an entry whose time has since passed is fine.

A new entry takes its id from its title, in lower case letters and digits joined by dashes, with `-2`, `-3` and so on when the id is taken. The id stays the same when you rename it.

Delete asks first. It removes the entry and keeps any session it started.

## In Home

Home has a Scheduled section above Routines, shown when there is something in it. It lists the pending entries, the skipped ones, and any entry with a problem, such as a start that kept no session. The Scheduled chip in Ctrl+K lists the same entries under the two actions. A pending row says "Starts" and the day and time under its title. A skipped row says why in red, and a pending row waiting to retry says when in amber. A row opens its edit form, or the page for a skipped one, and has the page's menu on its ... button and its right-click. Once an entry starts, its row leaves the section and the session is in the list as any other. A skipped entry stays until you delete it.

A scheduled row is not a session. It cannot be selected, archived or dragged, and the arrow keys walk onto it like any other row.

## When it starts

GhostShell checks every 30 seconds, on the same check as the routines, and once when it starts. An entry that is due starts a new session in its folder with its model, effort and permission mode. The session's title is the entry's title. The first message is the prompt inside a `<scheduled-task>` wrapper, with the note that the session is automated and nobody is there to answer. The wrapper is marked `once="true"`, and the preamble calls it "the prompt" and not "the task file". The chat shows it as a scheduled session with its own divider, and not as a run of a routine. A scheduled session is not handed to the Desktop app, even when that setting is on.

If the entry has a group, the session starts in it. If the group has since been deleted, the session starts on Home and the entry's `lastError` says so.

GhostShell marks an entry `started` before it starts the session, so a crash at that moment cannot start it twice. It also remembers, until it restarts, each entry it has started and the time it started it for. If a hand edit or an old copy of the file saves such an entry back as `pending`, the next check puts it back to `started` and does not start it again. Change the entry's time to start it again, or add a new entry.

A first start also waits for a free place. Routines and scheduled sessions share one limit of three automated sessions at once, so a due entry waits while three of them are working, and starts when one finishes.

## Missed times

If GhostShell was not running at the time, the entry starts as soon as GhostShell is up, provided it is under 12 hours late. An entry later than that is marked `skipped` with the reason, and it does not start.

## A start that fails

If the session cannot start, for example because the Claude CLI was being updated, GhostShell queues the entry and tries again. It keeps the queue in `scheduled.json` as `retry`, so it survives a restart. The wait after the first four failed tries is 1, 2, 5 and 10 minutes, and 15 minutes after every later one. The page and Home show when the next try is and what the last one said.

The retry stops when the session starts, or when the next try would come 12 hours or more after the entry's time, which marks the entry `skipped`. It also waits while a restart of GhostShell is under way, and while three automated sessions, routines and scheduled sessions together, are already working. Start now ignores the queue and the limit.

Only a start that fails is queued. A folder that does not exist, or a model, effort or mode GhostShell does not know, is a problem with the entry, so trying again would fail the same way. The entry is marked `skipped` with the reason.

## Start now, cancel and delete

Start now starts a pending entry at once, whatever its time. If the start fails, the entry stays pending and the page says why. Cancel keeps the entry as `cancelled`. Neither can be done to an entry that has started, so Edit, Cancel and Start now are refused for it with a 409.

## Adding one by hand

You can edit `scheduled.json` directly. The file is an object with a `scheduled` list. Each entry has these fields.

| Field | Required | What it takes | Default |
| --- | --- | --- | --- |
| `id` | Yes | Letters, digits, `_` and `-`, and not used by another entry. | None |
| `title` | No | The name of the session and of the row. | The id |
| `at` | Yes | When to start, as a date and time with the Mac's offset, such as `2026-11-02T09:00:00+10:00`. | None |
| `cwd` | Yes | The full path of an existing folder. | None |
| `prompt` | Yes | The text the session starts with. | None |
| `model` | No | A model name such as `claude-opus-5-5`, or `null`. | `null`, the model a new session in that folder gets |
| `effort` | No | `low`, `medium`, `high`, `xhigh` or `max`, or `null`. | `null` |
| `mode` | No | `manual`, `acceptEdits`, `plan`, `auto` or `bypassPermissions`, or `null`. | `null` |
| `group` | No | The id of a group, or `null` to start on Home. | `null` |
| `status` | No | `pending`, `started`, `skipped` or `cancelled`. Anything else is shown as a problem. | `pending` |
| `sessionId` | Filled in | The session it started. | `null` |
| `startedAt` | Filled in | When it started. | `null` |
| `lastError` | Filled in | Why it was skipped, or why the last try failed. | `null` |
| `retry` | Filled in | A start that failed and is queued, as `tries` and `nextAt`. | `null` |

GhostShell writes the file too, so open it again just before you edit, and save straight away. GhostShell reads it on every check, so a hand edit shows without a restart.

## API

- `GET api/sessions` lists `scheduled` in its `features`. A page that does not see it leaves out the Scheduled section, the footer link and the page.
- `GET api/scheduled` lists the entries, each with the name of its group, whether its session is running, and what is wrong with it if anything.
- `POST api/scheduled` adds one from `title`, `at`, `cwd`, `prompt`, `model`, `effort`, `mode` and `group`. A group is sent by id or by its name. A refusal is a 400 with a `problems` object keyed by field.
- `PATCH api/scheduled/<id>` changes the fields it is sent, refused the same way, and answers 409 once the entry is not pending.
- `POST api/scheduled/<id>/cancel` cancels a pending entry.
- `POST api/scheduled/<id>/start` starts a pending entry now and answers with the session's id.
- `DELETE api/scheduled/<id>` deletes an entry, and answers 409 while its session is starting.

The routes that change or start an entry take a request only from the GhostShell page itself, with an `Origin` header that matches. A script or `curl` without one gets a 403.

The reason a one-off is its own list and not a routine with a date in its schedule is in [the decision record](adr/20261030-a-one-off-is-its-own-list.md).
