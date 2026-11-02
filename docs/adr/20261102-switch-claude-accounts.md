# Keep two Claude accounts signed in and switch GhostShell between them

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-02
- Tags: login, accounts, cli, routines, usage, banners

## Context and Problem Statement

Every chat and routine GhostShell runs is a headless `claude` process, and all of them share the CLI's one claude.ai sign-in. On 2 Nov 2026 Eli took out a second Claude subscription, so that when one account runs out of usage the work can go on under the other. He asked: "Can we make that setup seamless in GhostShell to switch accounts?"

Switching by hand means `claude auth logout`, then `claude auth login` and a browser approval, every time. A chat already running keeps its old account until its process restarts. Claude Desktop's own sessions use Desktop's sign-in, so they are out of scope.

How can both accounts stay signed in at once, so that a switch is one click with no browser step, without GhostShell ever handling a token?

## Decision Drivers

- Each account is signed in once, then a switch needs no browser and no logout.
- GhostShell never reads, copies, logs or sends a token. The page never sees one.
- A session started under one account resumes under the other.
- No chat is cut mid-turn by a switch, and no background job is killed by one.
- The first account, and the owner's own terminal `claude`, keep working as they do now.
- No dependency and no build step.

## Considered Options

1. One CLI config folder per account, chosen with `CLAUDE_CONFIG_DIR`
2. Save each account's keychain entry and swap it into the CLI's entry
3. Keep the default config folder and pick only the keychain entry with `CLAUDE_SECURESTORAGE_CONFIG_DIR`

## Decision Outcome

Chosen option: "One CLI config folder per account", because the CLI already keeps a separate sign-in for each config folder and maintains it itself, so GhostShell only chooses a folder and never touches a token.

### How the CLI keeps a sign-in per folder

Checked on CLI 2.1.316 by reading its code and by `claude auth status --json` against empty temporary folders:

- With `CLAUDE_CONFIG_DIR` unset or empty, the login is the keychain entry `Claude Code-credentials`. With it set, the entry is `Claude Code-credentials-` and the first 8 hex digits of the SHA-256 of the folder exactly as given, NFC-normalised, with no `~` expansion, no realpath and no trimming. A trailing slash, or `/tmp` against `/private/tmp`, is a different entry. The keychain account is `$USER`.
- A folder with no entry of its own is signed out. The CLI does not fall back to the default entry and copies nothing.
- `claude auth login` with the variable set writes the tokens to that folder's entry and the account's email and organisation to that folder's `.claude.json`. A refresh writes back to the same entry, under that folder's own lock, so each folder maintains its own sign-in.
- `projects/`, `settings.json`, `skills/`, `agents/`, `commands/`, `plugins/`, `hooks/`, `CLAUDE.md` and the rest are read from the folder. The global config, normally `~/.claude.json`, becomes `.claude.json` inside the folder.
- A resume looks for `<folder>/projects/<folder name of the cwd>/<id>.jsonl` with plain reads, so a `projects` symlink to the shared transcripts resumes a session made under either account. Transcripts are appended in place.

### The accounts

- **The first account** is the sign-in the CLI already has, with `CLAUDE_CONFIG_DIR` left as the server found it. Nothing about it moves, so the owner's terminal `claude` and every existing chat are unaffected. It is called Main until renamed.
- **An added account** gets the folder `accounts/<id>` in GhostShell's state folder, mode 0700, stored in `accounts.json` as an absolute path and always passed as that same string, so its keychain entry never changes name.
- **What is shared.** The folder holds a symlink to every entry of the first account's folder (`~/.claude`) except the ones that belong to one login: `.claude.json`, `.credentials.json`, `sessions`, `session-env`, `shell-snapshots`, `statsig`, `cache`, `backups`, `daemon`, `jobs`, `teams`, `policy-limits.json`, `remote-settings.json`, `history.jsonl`, `debug`, `telemetry`, `stats-cache.json`, `mcp-needs-auth-cache.json`, and every name that starts with a dot, which covers the CLI's lock files. Transcripts, settings, skills, agents, commands, hooks, plugins, plans and `CLAUDE.md` are therefore one set for both accounts. The links are checked again on every switch to the account and at start, so an entry added to `~/.claude` later is linked too. A real file where a link would go is left alone.
- **The account's own `.claude.json`** holds its email, organisation and the caches the CLI keeps per login, so it is never linked. The user settings in it are copied over from the first account's `.claude.json` when the account is added and on every switch to it: `mcpServers`, `projects`, `hasCompletedOnboarding`, `githubRepoPaths` and the Claude in Chrome keys. Without them a chat on the account would lose the owner's MCP servers. The copy is made under the CLI's own lock for that file (the folder `.claude.json.lock`) and skipped if the CLI holds it, written to a temporary file and renamed, with mode 0600. It holds MCP settings, which can carry API keys, so it is never logged and never sent to the page. It holds no Claude token.
- **Who is signed in.** `claude auth status --json` runs for each account with the clean environment of [the sign-in banners](20261102-banners-for-sign-in-and-updates.md) plus that account's `CLAUDE_CONFIG_DIR`. GhostShell keeps `loggedIn`, `email` and `subscriptionType` to show, and `orgId` only in memory to compare, and drops the rest. Two accounts with the same email and organisation are marked as the same Claude account, which is what happens when the browser approves the sign-in page with the account it already had.
- **When the sign-in ends.** The end date is read as the banners ADR reads it, from the account's own keychain entry, whose name GhostShell works out by the rule above. The `NOTE` at that rule says it is the CLI's private naming. If the CLI changes it, the date is missing and the account falls back to the CLI's own `loggedIn`.

### Adding and signing in

The Accounts page (`#/accounts`, linked from the sidebar's footer) adds an account by name. GhostShell makes its folder and starts `claude auth login --claudeai` for it, exactly as the sign-in banner does, so the owner approves one page in the browser on the Mac. The page says to approve it with the account wanted, since the browser approves with whichever claude.ai account it is signed in to. One sign-in runs at a time across all accounts. An account that is signed out or ending within five days has a Sign in button on the page. The sidebar's sign-in banner follows the active account and names it when there is more than one.

### Switching

- **One click.** Making an account active writes `accounts.json`, refreshes that account's links and settings, and from then on every new `claude` process GhostShell starts gets its environment: new chats, routine runs, a group's chat, the title namer and the folder probe for the / menu. Nothing else in a spawn changes. Switching to a signed-out account is refused with a reason.
- **Running chats.** Each chat remembers the account its process started under. A switch stops at once every chat process on another account that is idle, has no approval waiting and no background job. Its next message starts a fresh process, which resumes the session on the new account. A chat that is mid-turn, or waiting on an approval, finishes on its old account and is stopped the moment it goes idle. A chat with a background job keeps its process until the job ends, because stopping the CLI kills the job. A message sent to a chat mid-turn joins the running process, as now. The Accounts page lists the chats still running on each account.
- **Plan usage per account.** The context popover asks only chats on the same account as the chat it opened from, so it never shows the other account's limits. The Accounts page asks up to two running chats on each account, keeps the last answer for each in memory with its time, and shows it as of then. An account with no running chat shows its last answer, or none. No process is started to ask, as the plan usage ADR decided.

### Running out of usage

- **Seeing it.** The CLI reports a spent plan limit as an assistant message with `error: "rate_limit"` whose text starts with one of its own limit phrases, such as "You've hit your limit". An overloaded or transient 429 also says `rate_limit` with other words, so only the limit phrases count. A turn that ends that way marks its account out of usage, with the CLI's words and the time. A later turn on that account that ends without an error clears the mark.
- **Offering the switch.** When the active account is out and another account is signed in and not out, the sidebar shows a banner with the CLI's words and a button to switch. In the chat whose turn failed, the error notice carries a button, "Switch to Second and continue", which switches and sends "Continue." to that chat, now on the other account. A routine run that failed is not run again. Its next run uses the new account.
- **Switching by itself is a setting, off by default.** With it on, the first out-of-usage mark on the active account switches to another signed-in account that is not out, and a banner says so until dismissed. It is safe enough to offer because the mark comes only from the CLI's own limit wording, because it never switches to an account that is out or signed out (so two spent accounts cannot flip back and forth), and because it only moves what starts next and never resends anything into a chat, where a repeated step could repeat a side effect. It stays off by default because it spends the second subscription without asking, and an owner whose limit resets within the hour may rather wait.

### Consequences

- ✅ Both accounts stay signed in. A switch is one click and no browser.
- ✅ GhostShell never reads, copies or stores a Claude token. Each folder's sign-in is the CLI's own and refreshes itself.
- ✅ Sessions resume under either account, since the transcripts are one folder.
- ✅ No switch cuts a turn or kills a background job.
- ❌ The added account's folder relies on the CLI's private layout and keychain naming, checked on CLI 2.1.316. If either moves, the account shows as signed out, or loses a shared entry, until GhostShell follows.
- ❌ The CLI refuses to write user settings through a symlink, so a change a chat on an added account makes to `~/.claude/settings.json` (such as a `/config` edit) fails there. Changes to a project's own settings are unaffected.
- ❌ An added account's `.claude.json` is a copy of the user settings, refreshed only on a switch to it, so a change to an MCP server shows there after the next switch.
- ❌ Each account keeps its own prompt history (`history.jsonl`), so the CLI's up-arrow history in a terminal started with the account's folder differs.
- ❌ A sign-in still needs the Mac, as with the banner.

### Out of scope

- Desktop's own sessions and sign-in.
- Removing an account. An account added by mistake can be signed in again under another claude.ai account.
- Re-running a routine that failed out of usage.

## Pros and Cons of the Options

### One CLI config folder per account

- ✅ Uses the CLI's own per-folder sign-in, so no token is ever handled.
- ✅ Each account's email, organisation and caches stay its own.
- ❌ Shared entries are symlinks, and the user settings in `.claude.json` are copied.

### Save each account's keychain entry and swap it in

- ✅ One config folder, nothing to share.
- ❌ GhostShell would read, store and write secrets.
- ❌ A running CLI refreshes and writes its tokens back over a swapped entry, and a rotated refresh token makes the saved copy useless.

### Pick only the keychain entry with `CLAUDE_SECURESTORAGE_CONFIG_DIR`

- ✅ Nothing to link or copy: one config folder, two keychain entries.
- ❌ The variable is undocumented and internal to the CLI.
- ❌ Both accounts would share one `.claude.json`, so the email, organisation and per-login caches of the last account to refresh would be shown for both, including in the owner's terminal `claude`.

## Links

- Builds on [Show banners in the sidebar for Claude's sign-in ending and for merged changes waiting](20261102-banners-for-sign-in-and-updates.md), whose sign-in, clean environment and end date each account reuses
- Builds on [Show plan usage in the context popover from the CLI's own figures](20261031-plan-usage-from-the-cli.md), whose figures are now kept per account
- Builds on [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose processes take the active account's folder
- Builds on [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md), whose runs start on the active account
