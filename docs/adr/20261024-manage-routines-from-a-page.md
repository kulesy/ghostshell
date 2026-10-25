# Manage routines from a page, and keep the prompts GhostShell writes in its own folder

- Status: Accepted, partly superseded by [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md)
- Deciders: Eli
- Date: 2026-10-24
- Tags: routines, scheduler, prompt-files, api, security

## Context and Problem Statement

GhostShell runs the owner's routines itself, as the [routines decision](20261015-capcom-runs-routines-itself.md) set out. Until now the owner could only switch a routine on or off and run it now. Adding a routine, changing its schedule or prompt, or deleting it meant a new export from Desktop or a hand edit of `routines.json`, and the session list showed a routine only once it had run. The owner asked for a Routines page that lists every routine and adds, edits, pauses, deletes and runs them. Where does a prompt that GhostShell writes live, what does an edit do to a schedule and a run in progress, and how are the new writes guarded?

## Decision Drivers

- Desktop's prompt files under `~/.claude/scheduled-tasks` stay read-only. Desktop may still run some of the routines, and the owner treats those files as Desktop's.
- None of the routines may run twice, and an edit must never repeat or cut short a run.
- A routine sends drafts, types into Chrome and posts to GitHub, so a write to a routine needs a stronger guard than the global same-origin check.
- A page that goes live before the server restarts has to keep working with the old server.
- No dependency and no build step, and it has to work on a phone.

## Considered Options

1. Keep each prompt GhostShell writes in a file of its own in GhostShell's state folder, and copy a Desktop prompt there on its first edit
2. Write the edit into Desktop's `SKILL.md`
3. Keep the prompt text inside `routines.json`

## Decision Outcome

Chosen option: "Keep each prompt GhostShell writes in a file of its own in GhostShell's state folder", because it leaves Desktop's files untouched, keeps the scheduler's one way of reading a prompt (a file read afresh at each run), and keeps `routines.json` small enough to edit by hand.

- **The page.** `#/routines` lists every routine from `GET api/routines`, sorted by title, including routines that have never run. A row shows the title, the schedule in words with the cron beside it, the next fire time, the last run as a link to its session, a switch, Run now and a menu. A routine that cannot run says why in red, and one still on in Desktop says in amber that both apps would run it. The page opens from a button on Home's Routines heading, the footer, a routine's row menu and the Routines chip in Ctrl+K. A routine's row on Home has Run now, Pause or Resume, Edit and Delete in its right-click and ... menus.
- **The form.** One form adds and edits, at `#/routines/new` and `#/routines/<id>`: title, schedule, jitter, folder (a typed absolute path, the home folder for a new one), model, effort, permission mode, prompt and the switch. The model, effort and mode choices are the prompt box's. The schedule shows in words with its next three fire times, from `GET api/schedule`, a moment after the typing stops. A half-typed schedule is an ordinary answer there, so that route answers 200 with the problem rather than an error. The server checks every field with the same rules it uses before a run, and a refusal is a 400 with a `problems` map by field. The form puts each problem beside its field, moves the focus to the first, and nothing is saved.
- **Ids.** A new routine's id comes from its title: lower case letters and digits joined by single dashes, accents dropped, at most 40 characters, and `routine` when nothing is left. GhostShell adds `-2`, `-3` and so on while the id belongs to a routine, a prompt file already in the folder, a Desktop task folder under `~/.claude/scheduled-tasks`, or runs still in the session list, and `new` is kept for the add form's route. Runs group under a routine by id, so a new routine never takes over a deleted one's runs or a Desktop routine's. The id matches the routes' `^[\w-]+$` and never changes, so a rename keeps it.
- **Prompt files.** A new routine's prompt is `routines/<id>.md` in the state folder, plain text with no frontmatter, folder mode 0700 and file 0600, written to a temporary file and renamed. The first edit of a seeded routine's prompt writes the new text there and points the routine's `file` at it. An edit that leaves the prompt as it was writes nothing, so a rename does not copy a prompt. GhostShell refuses to write a prompt anywhere but that folder. `GET api/routines/<id>/prompt` gives the text, the file it is read from and where a change would be saved, and the form says which file that is.
- **Schedules and runs.** A change of schedule or jitter on a routine that is on counts from the save, as switching on does, so a fire time earlier in the day does not run at once. Every other change applies from the next run. A run in progress keeps the prompt and settings it started with. A new routine starts on unless the form switches it off, and counts from the save.
- **Deleting.** Delete asks first. It takes the routine out of `routines.json` and keeps its prompt file and the sessions it ran. GhostShell refuses with a 409 while the routine's run is working or waiting for an answer.
- **Routes.** `POST api/routines` adds, `PATCH api/routines/<id>` changes the fields it is sent, and `DELETE api/routines/<id>` deletes. Each goes through the same store as the scheduler, which reads `routines.json` afresh and writes it atomically.
- **Guards.** The global same-origin check now covers every method that is not GET or HEAD, where it covered POST alone. Every write to a routine, including the existing run and enabled routes, also needs an `Origin` header that matches the host, with `Sec-Fetch-Site` absent or `same-origin`, as the terminal routes do. A request with no `Origin`, such as plain `curl`, gets a 403.
- **Old servers.** `GET api/sessions` says `routineEdits: true` in its features. A page served by a server without it shows the list, the switch and Run now, and hides New routine, Edit and Delete.

### Consequences

- ✅ The owner adds, edits, pauses, deletes and runs routines without an export or a hand edit.
- ✅ Desktop's prompt files stay as Desktop wrote them, and a routine Desktop still runs keeps Desktop's prompt until the owner changes it here.
- ✅ A schedule edit cannot fire a missed time at once, and an edit cannot repeat a run.
- ✅ A new page on an old server loses nothing it had.
- ❌ After its first edit here, a seeded routine's prompt lives in two files. A later change to Desktop's `SKILL.md` does not reach GhostShell, and the form says which file it reads.
- ❌ A deleted routine leaves its prompt file behind, and the next routine with the same title gets a numbered id. Nothing cleans the folder up.
- ❌ A script that called the run or enabled routes without an `Origin` header now gets a 403.
- ❌ The folder is a typed path with no picker, so a typo shows only as a problem beside the field.

## Pros and Cons of the Options

### Keep each prompt GhostShell writes in a file of its own

- ✅ Desktop's files are never written, and the scheduler reads every prompt the same way
- ✅ A prompt can be edited by hand in any editor, as Desktop's can
- ❌ A seeded routine's prompt splits from Desktop's on its first edit

### Write the edit into Desktop's `SKILL.md`

- ✅ One file per routine, shared by both apps
- ❌ It writes into Desktop's folder, which the owner keeps read-only, and changes a routine Desktop may still run
- ❌ Nowhere to put a routine that Desktop never had

### Keep the prompt text inside `routines.json`

- ✅ One file holds everything about a routine
- ❌ Long prompts make `routines.json` hard to edit by hand, and the scheduler would read prompts two ways

## Links

- [Capcom runs routines itself, from Desktop's prompt files](20261015-capcom-runs-routines-itself.md), which this extends
- [Routines](../routines.md), the user guide
