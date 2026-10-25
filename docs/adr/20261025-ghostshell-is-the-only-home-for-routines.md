# GhostShell is the only home for routines

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-25
- Tags: routines, scheduler, prompt-files, claude-desktop

## Context and Problem Statement

The [15 Oct 2026 decision](20261015-capcom-runs-routines-itself.md) had GhostShell run the owner's routines beside Claude Desktop. GhostShell read each prompt from Desktop's own file, `~/.claude/scheduled-tasks/<id>/SKILL.md`, and never wrote under that folder. It copied the schedules once, from an export of Desktop's list, with every routine switched off. The owner then switched the routines over one at a time, off in Desktop and on in GhostShell. `routines.json` kept a flag for each routine, `enabledInDesktop`, and the page warned when both apps would run one. [The Routines page decision](20261024-manage-routines-from-a-page.md) added a page to add, edit and delete routines, with the prompts GhostShell writes kept in its own `routines/` folder.

The switch-over is finished, and the owner no longer uses Desktop's list. The sharing machinery has nothing left to guard, and it still shapes the code and the page. A routine with no runs is missing from the sidebar, because Home's Routines section is built from sessions. A prompt that lives in a repo or a notes folder has to be copied into GhostShell's folder to be used. What is GhostShell's job now that it is the only home, and where may a prompt live?

## Decision Drivers

- Desktop's list is retired, so nothing in GhostShell should ask whether Desktop runs a routine.
- GhostShell must never write a file it did not make. The owner's prompt files stay the owner's.
- A prompt the owner already keeps somewhere should not need copying to be used.
- Every routine must be visible on Home, whether or not it has run.
- The page has to keep working against a server that does not have the change, and on a phone.
- No dependency and no build step.

## Considered Options

1. Keep sharing with Desktop and the seed path
2. GhostShell only, and copy every prompt into its own folder
3. GhostShell only, and let a prompt stay at any full path

## Decision Outcome

Chosen option: "GhostShell only, and let a prompt stay at any full path", because it retires the sharing code without moving or rewriting a single prompt the owner already has, and it keeps the rule that GhostShell reads every prompt afresh at each run.

- **Sharing is gone.** `enabledInDesktop` and `seededAt` are no longer fields. A `routines.json` that still has them loads, and GhostShell drops them at its next write. `bin/seed-routines.mjs` and `npm run seed-routines` are deleted. The page no longer warns that both apps would run a routine.
- **A prompt is GhostShell's own text or a file.** `POST api/routines` and `PATCH api/routines/<id>` take either `prompt`, which GhostShell keeps in `routines/<id>.md` in its state folder, or `file`, the full path of an existing file anywhere on the Mac, never both. GhostShell reads a file at each run and never writes it. It refuses a path that is not full, holds a double quote or a line break, cannot be read, is a folder, or is inside GhostShell's own prompt folder, which is edited as its own text. A refusal is a 400 with `problems.file`.
- **Edits move a routine only when asked.** Sending `file` points the routine at that file and leaves GhostShell's copy on disk. Sending `prompt` for a routine that is on a file elsewhere always writes GhostShell's own copy and moves the routine onto it, even when the text is unchanged, so the outside file is never touched. Sending `prompt` for a routine already on its own text writes only if the text changed. `GET api/routines/<id>/prompt` gives `file`, `text` and `ours`.
- **The form offers both.** The Prompt field is a choice between "GhostShell's own text" and "A prompt file". A new routine starts on its own text. An existing routine opens on the kind it uses, and one on a file elsewhere shows its path and says the file is edited outside GhostShell. Switching it to own text fills the box with the file's current text, and the file stays as it is. `GET api/sessions` says `routineFiles: true` in its features, and a page that does not see it shows the text box alone.
- **A routine with no runs shows on Home.** Home's Routines section draws a row for every routine that has no row anywhere in the list, after the routines that have runs. A routine whose only run is pinned or in a group has a row, so it is not drawn twice. The row opens the routine and has the same menu as a run's row. It says "Hasn't run yet", "Last run" and how long ago when its runs were archived, "Couldn't start" and how long ago when its last try failed, or "Off" when the routine is paused. The section's count includes these rows.
- **Ids.** Desktop's task folder no longer holds an id. A new routine's id is taken only by another routine, a prompt file in GhostShell's folder, or runs still in the session list.

### Consequences

- ✅ One list holds every routine, and nothing in GhostShell refers to Desktop's list.
- ✅ A prompt can stay in a repo or a notes folder, with its history and its editor, and GhostShell never changes it.
- ✅ A routine that has never run, or whose runs were archived, is on Home and can be run, paused, edited or deleted from there.
- ✅ A page on an older server loses nothing it had.
- ❌ The existing routines keep pointing at their old prompt files under `~/.claude/scheduled-tasks`. GhostShell reads those and still never writes them, so editing one of those prompts happens in an editor. Switching a routine to GhostShell's own text on the page copies its prompt into GhostShell's folder and leaves the old file as it was.
- ❌ GhostShell no longer knows whether Desktop runs a routine, so a routine switched on in both apps would run twice with no warning. The owner has stopped using Desktop's list, which is what makes this acceptable.
- ❌ The page reads any file path the signed-in owner types, and a run sends its text to Claude. The owner already has a terminal on the same sign-in, so this adds no new reach, and it is still a path anyone with that sign-in can use.
- ❌ A routine whose file moves or is deleted shows a problem on its row and stops running until the path is fixed or the file is back.
- ❌ Home reads the routines when the page loads, every 15 seconds and when the tab is shown again. A routine added by hand to `routines.json` appears in the sidebar within about 15 seconds.

## Pros and Cons of the Options

### Keep sharing with Desktop and the seed path

- ✅ Nothing to change, and Desktop's schedules could still be imported
- ❌ The flag, the warning and the seed script guard a switch-over that is finished
- ❌ A routine with no runs stays out of the sidebar, and the owner cannot point a routine at a prompt kept elsewhere

### GhostShell only, and copy every prompt into its own folder

- ✅ Every prompt is in one folder that GhostShell owns, so a moved file cannot stop a routine
- ❌ It copies the owner's prompts, and the copy and the original drift apart
- ❌ A prompt kept in a repo loses its history and its editor

### GhostShell only, and let a prompt stay at any full path

- ✅ No prompt moves, and GhostShell writes only what it made
- ✅ The form still offers GhostShell's own text for a routine that needs no file elsewhere
- ❌ A prompt can be moved or deleted from under a routine, and the page reads any path it is given

## Links

- [Capcom runs routines itself, from Desktop's prompt files](20261015-capcom-runs-routines-itself.md), whose sharing with Desktop this retires
- [Manage routines from a page, and keep the prompts GhostShell writes in its own folder](20261024-manage-routines-from-a-page.md), whose form and routes this extends
- [Run terminal commands on pipes with no PTY, and run `!` commands in GhostShell](20261023-terminal-without-a-pty.md), the terminal that the same sign-in already reaches
- [Routines](../routines.md), the user guide
