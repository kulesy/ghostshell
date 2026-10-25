# Routines

GhostShell runs your routines on their schedules, so nothing else has to stay open for them. A routine is a prompt and a schedule.

## Where routines live

GhostShell keeps its routines in `routines.json` in its state folder. It is the only list, and GhostShell has to be running when a routine is due, which is what the launchd agent under [Always on](always-on.md) is for. Each run is a session, and it shows in the session list as a [routine row](session-list.md#routine-rows). A routine that has no runs yet shows there too, with "Hasn't run yet" under its title.

## The prompt

A routine's prompt is one of two kinds.

- **GhostShell's own text.** GhostShell keeps it in `routines/<id>.md` in the state folder, and you edit it on the Routines page.
- **A prompt file.** Any file at a full path on the Mac. GhostShell reads it at each run and never writes it, so you edit it in an editor.

Either way, a run drops any frontmatter at the top of the file and sends the rest inside a `<scheduled-task>` wrapper. The wrapper names the routine and the file, and opens with a short note that the run is automated and nobody is there to answer.

## The Routines page

The Routines page lists every routine, including those that have never run. Open it from the calendar button on Home's Routines heading, the Routines link in the footer, a routine's row menu, or the Routines chip in Ctrl+K. Each row shows the title, the schedule in words with the cron beside it, the next fire time and the last run, which opens its session. A routine that cannot run says why in red.

Each row has a switch, Run now, and a menu with Edit and Delete. A routine's row on Home has Run now, Pause or Resume, Edit and Delete in its right-click and ... menus. A routine with no runs has the same menus there. Its row says "Hasn't run yet", "Last run" and how long ago if its runs were archived, or "Off" when it is paused.

### Adding and editing

New routine and Edit open the same form: title, schedule, jitter, folder, model, effort, permission mode, prompt and the switch. The folder is a typed absolute path, and a new routine starts in your home folder. As you type a schedule, the form shows it in words with its next three fire times. If GhostShell refuses a save, it saves nothing and shows each problem beside its field.

The Prompt field is a choice between GhostShell's own text and a prompt file.

- A new routine starts on GhostShell's own text. Choose A prompt file and type the full path of the file. GhostShell checks that the path is full, that the file exists and can be read, that it is not a folder, and that it is not one of GhostShell's own prompt files.
- A routine opens on the kind it uses. One on a file elsewhere shows the path, and says the file is edited outside GhostShell.
- Switching a routine on a file to GhostShell's own text fills the box with the file's current text. The first save writes it to `routines/<id>.md` and points the routine there. The file stays as it was.
- Switching a routine on GhostShell's own text to a file points it at the file. GhostShell's copy stays in its folder.
- Saving a routine on a file with a new title, schedule or any other field leaves the file and its path alone.

A new routine takes its id from its title, in lower case letters and digits joined by dashes, at most 40 characters, with `-2`, `-3` and so on added when a routine, a prompt file in GhostShell's folder or past runs already use the id, or when the id would be `new`, which is the address of the add form. The id stays the same when you rename the routine. A new routine is on unless you switch it off in the form, and counts its schedule from the save.

A change of schedule or jitter on a routine that is on counts from the save, as switching on does. Any other change applies from the next run, and a run in progress keeps what it started with.

### Deleting

Delete asks first. It takes the routine out of `routines.json`, and keeps its prompt file and the sessions it ran. GhostShell refuses to delete a routine while its run is working or waiting for an answer.

A page that loads before the server has restarted onto this version shows the list, the switch and Run now, and leaves out New routine, Edit and Delete. One that loads before the server knows about prompt files shows the text box alone.

## Adding a routine by hand

You can add a routine by editing `routines.json`. The file is an object with a `routines` list. Each entry has these fields.

| Field | Required | What it takes | Default |
| --- | --- | --- | --- |
| `id` | Yes | Letters, digits, `_` and `-`, and not used by another routine. It never changes, and a routine's runs group under it. | None |
| `title` | No | The name shown in the list. | The id |
| `cron` | Yes | Five fields in the Mac's time: minute, hour, day of the month, month and day of the week. | None |
| `jitterSeconds` | No | A whole number of seconds from 0 to 86399, added to every fire time. | 0 |
| `file` | Yes | The full path of the prompt file, starting with `/`. It cannot hold a double quote or a line break. | None |
| `cwd` | Yes | The full path of an existing folder, which each run starts in. | None |
| `model` | No | A model name such as `claude-opus-5-5`, or `null`. | `null`, the model a new session in that folder gets |
| `effort` | No | `low`, `medium`, `high`, `xhigh` or `max`, or `null`. | `null`, the effort a new session in that folder gets |
| `mode` | No | `manual`, `acceptEdits`, `plan`, `auto` or `bypassPermissions`, or `null`. | `null`, the mode a new session in that folder gets |
| `enabled` | No | `true` or `false`. Anything else counts as off, and the Routines page says so. | `false` |
| `armedAt` | Filled in | When the schedule counts from: the moment the routine was switched on, then each run or skipped fire. Empty while it is off. | `null` |
| `lastRunAt` | Filled in | When the last run started or was tried. | `null` |
| `lastSessionId` | Filled in | The session of the last run. | `null` |
| `lastError` | Filled in | Why the last run did not start. | `null` |
| `skipped` | Filled in | The last fire that GhostShell passed over, as `fireAt`, `at` and `reason`. | `null` |

GhostShell fills in the last five. Leave them out of a new entry.

A full entry, with a prompt file that GhostShell reads and never writes:

```json
{
  "routines": [
    {
      "id": "daily-scrum",
      "title": "Daily scrum",
      "cron": "30 7 * * 1-5",
      "jitterSeconds": 737,
      "file": "/Users/you/prompts/daily-scrum.md",
      "cwd": "/Users/you/projects/board",
      "model": null,
      "effort": "high",
      "mode": "plan",
      "enabled": true
    }
  ]
}
```

- GhostShell writes `routines.json` too, so open it again just before you edit, and save straight away.
- GhostShell reads the file on every check, so a hand edit shows without a restart.
- A routine with `enabled` true and no `armedAt` counts from the next check, so a fire time earlier in the day does not run at once.
- A `file` that is a relative path, or that holds a double quote, shows as a problem on the Routines page, and the routine never runs.
- An old file that still has `enabledInDesktop` on a routine, or `seededAt` at the top, loads without trouble. GhostShell drops both at its next write.

## When it fires

The schedule is a five-field cron in the Mac's time zone, which GhostShell follows if it changes, with the routine's jitter added as a fixed offset: `30 7 * * 1-5` with 737 seconds of jitter fires at 07:42:17. GhostShell checks every 30 seconds, and once when it starts.

A routine that is due starts a new session in its folder with its permission mode, model and effort. The first message is the text of the prompt file after any frontmatter, inside the `<scheduled-task>` wrapper. GhostShell reads the file again at each run, so an edit applies from the next run.

## Missed runs

If GhostShell was not running at a fire time, the latest missed fire runs once as soon as GhostShell is up, provided it is under 12 hours late. GhostShell skips a later one and logs it. However many fires were missed, that is at most one run.

## One at a time

GhostShell skips and logs a fire that comes while the routine's previous run is still working. It does not hold the fire over until the run ends. GhostShell stops a previous run that is only waiting for an answer, and the new run starts in its place.

## Three at once

At most three routines run at the same time, so fewer of them fight over one Chrome. A fourth that comes due waits for a free place, and starts as soon as one frees up. A run waiting for an answer does not take a place. Run now ignores the limit.

## Restarts

`routines.json` records when each routine was switched on and last ran, and GhostShell works out the next fire from that. A restart does not repeat a run, and GhostShell catches up a run that came due while it was down, as in [missed runs](#missed-runs). A restart can cut a run in progress short, and GhostShell does not start that run again. GhostShell records a run that cannot start in `lastError`, and it waits for the routine's next fire.

## A wrong file

GhostShell runs nothing in any of these cases:

- `routines.json` cannot be read.
- A routine has no id.
- An id appears twice, which is what a copied entry with its id left alone looks like.

`GET api/routines` says which, and GhostShell logs it once on stderr. An `enabled` that is not `true` or `false` counts as off.

A routine whose prompt file has moved, been deleted or cannot be read stops running, and the Routines page shows the problem on its row. The other routines carry on. Point the routine at the file's new place, or restore the file, and it runs again from its next fire.

## API

- `GET api/sessions` lists `routineEdits` and `routineFiles` in its `features`. A page that does not see them leaves out the editing, or the choice of a prompt file.
- `GET api/routines` lists the routines with their next fire time, whether each is running, and what is wrong with it if anything.
- `POST api/routines/<id>/run` runs one now, switched on or not, and answers 409 while its previous run is working.
- `POST api/routines/<id>/enabled` takes `{ "enabled": true }` or `false`.
- `POST api/routines` adds one from `title`, `cron`, `jitterSeconds`, `cwd`, `model`, `effort`, `mode`, `enabled`, and either `prompt` (GhostShell's own text) or `file` (the full path of an existing file), never both. A refusal is a 400 with a `problems` object keyed by field, `file` included.
- `PATCH api/routines/<id>` changes the fields it is sent, refused the same way. Sending `file` points the routine at that file. Sending `prompt` on a routine on a file elsewhere writes GhostShell's own copy and moves the routine onto it, even when the text is the file's own. Sending `prompt` on a routine already on GhostShell's own text writes only if the text changed.
- `DELETE api/routines/<id>` deletes one, and answers 409 while its run is working.
- `GET api/routines/<id>/prompt` gives `file` (where it is read from), `text`, and `ours`, which is true when the file is GhostShell's own copy. It adds `error` when the file cannot be read.
- `GET api/schedule?cron=&jitter=` gives the next three fire times of a schedule, or the problem with it.

The routes that change or run a routine take a request only from the GhostShell page itself, with an `Origin` header that matches. A script or `curl` without one gets a 403.

## Logs

Every run, skip and switch is a line on stdout, and every run that fails to start is a line on stderr. Under launchd those are `out.log` and `err.log` in `~/Library/Logs/capcom/`.
