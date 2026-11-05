# Edit a linked text file in the viewer, and keep the places that run code or hold secrets read only

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-05
- Tags: files, security, viewer

Technical Story: https://github.com/kulesy/ghostshell/issues/55

## Context and Problem Statement

The file viewer only reads. The owner asked: "we need to be able to edit text files inside ghostshell". Today the gate in `lib/files.mjs` protects reads, and a read that goes wrong shows the owner something. A save writes to the owner's disk from a page reachable over the tailnet, and a reply's text decides what a chat links to. Which files may the owner save from the viewer, and what keeps a save safe?

Scope is the files a chat links to, which is all the viewer opens. Browsing to any other file stays out of scope.

## Threat Model

**Who can do what.**

- A reply can link any path. It can link `~/.zshrc`, `~/.ssh/config`, `~/.claude/settings.json` or `~/.config/capcom/auth.json`, whether Claude meant to or a page it read told it to. A link needs no permission from anyone.
- A reply cannot write. Only the text the owner has in the box reaches the disk, and only when the owner presses Save.
- A page on another site can send a request to GhostShell from the owner's browser, and the sign-in cookie is SameSite=Lax.
- A widget runs code Claude wrote, in a frame with `sandbox="allow-scripts"`. Its origin is `null`.
- A file GhostShell serves runs under `sandbox` in its CSP, so it also has the origin `null`. A PDF goes without the sandbox, and its viewer has no way to send a request as the page.
- A session runs with the owner's own rights, so its Bash can already write any file the owner can. The save route gives a session nothing new, and a session holds no cookie, so the route refuses it.
- Someone at a signed-in browser is the owner. The terminal already runs commands for them, so this decision does not try to stop them.

**What counts as a failure.**

- A request that did not come from the signed-in owner's own page writes anything.
- A save lands somewhere that runs code on its own, holds a secret or holds GhostShell's sign-in, even when the owner pressed Save, because a reply can talk the owner into pasting a line.
- A save destroys data: a half-written file, a cut-off long file, bytes that were never shown, changed permissions, changed line endings, or someone else's newer change.
- The owner's unsaved text disappears without warning.

## Decision Drivers

- A list of known bad names always misses one. Almost everything on a Mac that runs code or holds a secret hides behind a dot name, `Library` or an execute bit, so a rule on that shape covers a new tool's files too.
- Most links in a chat point into the project it works on, which is what the owner wants to change.
- Many sessions work in a worktree at `<repo>/.claude/worktrees/<name>`, so a rule against dot folders must not refuse those.
- The server decides. The page's Edit button is a convenience and guards nothing.
- The repo adds no dependencies without a reason. See [Build Capcom on Node's standard library](20261007-no-dependencies-no-build-step.md).

## Considered Options

1. Allow the home folder, except dot names, `Library`, GhostShell's folders and files that can run
2. Allow any linked text file, and refuse a list of sensitive paths
3. Allow only files inside the chat's own working folder
4. Allow any linked text file, with no location check

## Decision Outcome

Chosen option: "Allow the home folder, except dot names, `Library`, GhostShell's folders and files that can run", because it covers the files the owner edits. A new dot folder is read only with no change to GhostShell, and a new place with a plain name is editable.

**What the owner can edit.** A file can be saved only when all of these hold. `lib/files.mjs` checks them on the real path, after it resolves symlinks and `..`. It also checks the location rules on the path as linked, so `~/.zshrc` stays read only when it is a symlink into a dotfiles folder.

1. A reply or a thought in the chat links it, as for a read.
2. It sits inside the owner's home folder.
3. It is UTF-8 text with no NUL byte, checked across the whole file, and at most 1 MB. Those limits mean the box holds the whole file and nothing else.
4. It is a plain file the owner owns and can write, with one hard link.
5. It has no execute bit.

**What stays read only, and why.**

| Location | Why |
| --- | --- |
| Anything outside the home folder, such as `/etc`, `/usr`, `/opt`, `/Applications` and `/tmp` | System and shared places, and no project of the owner's lives there. |
| Any folder or file below the home folder whose name starts with a dot | Covers `.zshrc` and the other shell profiles, `.ssh`, `.aws`, `.gnupg`, `.claude`, `.config`, `.env`, and `.git` with its hooks and config. These files run on their own or hold secrets. A dot name inside a project also counts, so a project's `.claude/settings.json` and `.github/workflows` stay read only. |
| `~/Library` | `LaunchAgents` runs what it holds, and the folder also holds keychains and app data. |
| Any file with an execute bit | launchd and shells run it with the owner's rights, and the scripts in `~/bin` and the home folder are the ones launchd starts. |
| GhostShell's state folder, its transcripts folder and Desktop's folder, wherever `config.json` puts them | They hold the sign-in, the layout and the chats. |
| GhostShell's own checkout | The server runs from it, and a change there would stop the next update. |
| Binary files, pictures, PDFs and files over 1 MB | GhostShell does not show the whole file as text, so a save would destroy what the owner cannot see. |
| Files with invalid UTF-8 or a NUL after the first bytes | The viewer shows them with replacement characters, so a save would corrupt them. |
| Files the owner cannot write or does not own, and files with a second hard link | A rename would replace a file the owner locked, change its owner or split the link. |

One exception: the `.claude/worktrees/<name>` folders inside a repo count as ordinary work. The rules still apply to what sits inside the worktree, so its own `.git` or `.claude/settings.json` stays read only. The exception holds inside GhostShell's checkout too, because the server does not run from a worktree. It does not hold in `~/.claude`, the top-level dot folder.

**The route.** `POST api/sessions/<id>/save` takes `{ path, text, base }` and follows the terminal's rules. It needs this host's Origin with no cross-site Sec-Fetch-Site, which refuses the `null` origin of a widget or a served file. It needs a JSON content type, which a form cannot send, and it checks the sign-in again once the body has arrived. No MCP tool calls it.

**The write.**

- `base` is the SHA-256 of the bytes the viewer loaded, sent in the preview as `version`. A save reads the file again, and a different hash answers 409 and writes nothing.
- GhostShell copies the file to a temporary name beside it, which keeps its permissions, and on macOS its attributes. It writes and syncs that copy, compares the hash once more, then renames it over the real path. A failed write leaves the original as it was and removes the temporary file. A hard link never receives the write, because the rename replaces the name and not the file behind it.
- A second save of a file while one runs gets a 409.
- A browser's text box turns every line ending into `\n`. The server puts each unchanged line's own ending back and gives new lines the file's most common ending. It keeps a byte order mark and adds no final newline.

**Unsaved text.** The page keeps each draft in localStorage by chat and path, so reloading, a phone dropping the tab, a sign-in that expires, a switch of chats and a link to another file all keep it. Opening that file again brings the draft back and says so. Cancel asks before it throws changes away, and Sign out empties the drafts as it does the prompt box's. If the browser has no room for a copy, the viewer says so and the page warns before it unloads.

**On a conflict** GhostShell says the file changed, keeps the text on screen and offers a copy of it and a link to the new version. There is no way to overwrite from the viewer: the owner cancels, reopens the file and pastes.

**No dependency.** A plain text area does the job. An editor library would add highlighting, which nobody asked for, and a large package in a repo that has one vendored front end library.

### Consequences

- ✅ The owner can change a line in a project file from a phone.
- ✅ A new sensitive dot folder is read only from the day it appears, with no change to GhostShell. A new place with a plain name is editable.
- ❌ The owner cannot edit a skill, a memory file, a hook or a shell profile in the viewer. Those run with the owner's rights, and a reply can link them, so the owner uses the terminal or asks Claude.
- ❌ Dot files inside a project, such as `.gitignore` and `.env.example`, are read only too.
- ❌ `package.json` and a script with no execute bit stay editable, because they are what the owner comes to change. A script with an execute bit is read only, so the owner uses the terminal for it. A file in a dotfiles folder linked by its plain path is editable too. Only the owner's own text reaches them.
- ❌ Two cases are accepted. A file an interpreter runs with no execute bit, such as a server a LaunchAgent starts with `node`, is editable. So is a `CLAUDE.md` in a project, which a session reads as instructions.
- ❌ Files in `~/Library/CloudStorage`, where OneDrive keeps its folder, are read only, as are projects outside the home folder.
- ❌ Text in the box has no line numbers or highlighting.
- ❌ The gap between the last hash check and the rename is short but real, so a writer outside GhostShell that lands in it loses its change.
- ❌ A draft left unfinished stays in the browser until the owner reopens the file, cancels or signs out.
- ❌ File drafts share the browser's storage with the prompt drafts and are never pruned, so a full store can also stop prompt drafts from saving.

## Pros and Cons of the Options

### Allow the home folder, except dot names, `Library`, GhostShell's folders and files that can run

- ✅ A new dot folder is read only with no change to GhostShell.
- ✅ One rule covers shell profiles, keys, Claude's config, git hooks and CI files.
- ❌ It refuses some harmless files, such as `.gitignore`.
- ❌ A sensitive file with a plain name, outside `Library` and with no execute bit, is editable.

### Allow any linked text file, and refuse a list of sensitive paths

- ✅ More files can be edited.
- ❌ One missing name makes that file writable, and new tools add new names.

### Allow only files inside the chat's own working folder

- ✅ Each chat stays in its own project.
- ❌ A chat started in the home folder would still reach `~/.zshrc`, so it needs the dot rule anyway.
- ❌ A group's session works in GhostShell's state folder, and a session can start inside `~/.claude`.
- ❌ It refuses a linked file in the owner's other projects, with no threat to justify that.

### Allow any linked text file, with no location check

- ✅ The simplest rule.
- ❌ A reply could walk the owner into saving a line in `~/.zshrc` or a hook, which then runs as the owner.

## Links

- [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md)
- [Draw widgets the way Desktop does, in a frame that cannot reach Capcom](20261019-widgets-render-like-desktop.md)
- [Keep a draft for each session](20261102-a-draft-for-each-session.md)
