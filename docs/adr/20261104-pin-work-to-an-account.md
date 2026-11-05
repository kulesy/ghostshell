# Pin a session, group, project or routine to one Claude account

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-04
- Tags: accounts, cli, layout, routines, usage, banners

## Context and Problem Statement

[Switching accounts](20261102-switch-claude-accounts.md) moves all of GhostShell at once. One account is active, and each new `claude` process starts on it. Eli asked: "Can we make it so specific sessions, groups, routines, and projects can run on different subscriptions?"

The accounts already live side by side, each in its own config folder, and a session resumes under either. What is missing is a way to say that one piece of work belongs to one subscription, and to keep that promise when the other account is active or the pinned one signs out.

## Decision Drivers

- Anything without a pin follows the active account, as it does now.
- With one account, nothing new appears.
- GhostShell never runs pinned work on another subscription without saying so.
- A pin never cuts a running turn.
- GhostShell never reads, copies or logs a token.
- One rule decides the account, and every spawn path uses it.

## Considered Options

1. Pins in the existing stores, resolved by one pure rule when a process starts
2. A separate pins file, with its own writes and its own clean-up
3. Fall back to the active account when a pinned account signs out

## Decision Outcome

Chosen option: "Pins in the existing stores, resolved by one pure rule when a process starts", because a pin then moves, renames and disappears with the thing it belongs to, and a process start is already the one moment an account can change.

### Where a pin lives

- A session's pin is in `layout.json` under `accounts`, keyed by session id.
- A group's and a project's pin is an `account` field on that group or project in `layout.json`.
- A routine's pin is an `account` field in `routines.json`, set through the routine form with the other fields.

GhostShell writes all of them through the layout and routine stores. A pin holds an account id, never a name or an email.

### The rule

`lib/account-rule.mjs` takes plain data and returns the account a session should run on and where that came from. The order, most specific first:

1. The session's own pin.
2. The pin of the routine that started it.
3. The account its parent resolves to, for a sub session. The rule walks up the family with a guard against a loop. A parent that resolves to the active account counts as no answer, so the session's own group and project still apply.
4. The pin of its group.
5. The pin of its project, which is the project its group sits in.
6. The active account.

A routine has no group or project of its own, so a run reaches steps 4 and 5 only after someone moves it into a group. A group's own chat takes that group's pin. A section's chat follows the active account.

A pin to an id GhostShell does not know is returned as it stands. It never falls through to the next step, because that would run the work on an account nobody chose.

### Every spawn path

The runner asks for the account each time a process starts, so a new chat, a resume, a routine run, a chip, a sub session and a group's chat all pass through the rule. A new session has no id until the CLI names it, so `newSession` takes where the session will land (its group, parent, routine and pin), resolves the account first and hands it to the chat.

The title namer runs on the account of the chat it names. The folder probe for the / menu runs on the account of the session that asked. Its answer stays cached per folder, so two sessions in one folder on different accounts see one list.

Anyone setting a pin gets the same behaviour as a switch: GhostShell stops an idle process on the old account after 15 quiet seconds, and a process that is mid-turn, waiting on an approval or holding a background job keeps running until it can stop. A message sent to a chat mid-turn joins the running process. A chat idle on a background job keeps its old account until the job ends.

An added account's links and settings now refresh each time a process starts on that account, because a pinned account may never be switched to.

### When a pinned account is gone

A pinned account that is signed out, or an id GhostShell no longer lists, blocks the work. GhostShell starts no process, refuses the message with a 409 and leaves the text in the composer. The session shows a notice naming the account and where the pin came from, with a Sign in button, or a way to clear the pin when the account is gone. Until the first check of an account finishes, GhostShell treats it as signed in. An active account with no pin behaves as it did before this record.

Removing an account stays out of scope. An account disappears only when an unreadable `accounts.json` is moved aside.

A routine on a blocked account refuses to start. The refusal lands in `lastError` and the routine's problem line, the way a missing folder does, and GhostShell does not retry it. The next scheduled run checks again. A scheduled session whose group sits on a blocked account is refused the same way, and "Run now" on either answers 400 with the reason.

### Several accounts in use at once

- **Plan usage.** The reply of `POST api/sessions/<id>/plan` adds `account`, the name of the account the figures belong to, when more than one account is listed. With one account the reply is as it was. The popover heading then reads "Plan usage, Second". The same section on the Accounts page keeps "Plan usage", since each account already has its own card there.
- **The sign-in banner.** An account is in use when it is the active one, when a session, group, project or routine is pinned to it, or when a chat is running on it. `loginNow` takes that list from the server and shows one banner at a time. The order is a sign-in waiting on the Mac, then a signed-out account, then the soonest end date, with the active account first on a tie. When no account has anything to show, the answer is the active account's. The reply carries `account` (the name) and `accountId` when more than one account is listed. Only then does the banner say "Second is signed out" and "Second's sign-in ends in 3 days". With one account the words are the old ones. An account nothing uses gets no banner, however signed out it is.
- **The sign-in route.** `POST api/banners/sign-in` takes an optional body `{ account: <id> }`. No body, or no field, signs in the active account, as before. A value that is not a string answers 400, and an id GhostShell does not list answers 404. The strict origin check still comes first. The page sends the `accountId` of the banner it shows, so the press signs in the account the banner names.
- **Switch and continue.** Pressing it would move the session only when nothing pins it. When the row's `accountFrom` is not `active`, the chat shows the line "This session stays on Second because of a pin, so a switch won't move it. Change the pin to move it." in place of the button. The server agrees: `POST api/accounts/<id>/use` with `continue` answers 409 with the same words, before it switches anything, when the session is pinned elsewhere than to the account being switched to. A session pinned to that account is moved as before. The out-of-usage banner names the account that ran out.
- **The Accounts page.** Under an account with pins, a quiet line counts them, such as "Pinned: 2 sessions, 1 group", in the order sessions, groups, projects, routines. When more than one account is listed and any has a pin, the lead paragraph adds "A switch leaves pinned work on its account."

### Claude in Chrome

The extension signs in to one Claude account, so a session reaches Chrome only on that account. The pick states this limit in words. [The Chrome check](https://github.com/kulesy/ghostshell/pull/47) found a browser in the list is a reliable yes, and an empty list cannot separate Chrome on another account from Chrome closed. A warning therefore appears only when another account reports a browser and the pinned one does not.

[A survey](20261104-chrome-follows-the-account.md) asks every account when GhostShell starts and every 10 minutes after, with more than one account listed and Chrome set up. Where it proves that, the Account menu marks the account "No Chrome" and says which account Chrome is on, the routine form's account select reads "(no Chrome)" and an account with pins says "Chrome is on X, so these can't reach it." Every account stays selectable, and with one account none of this shows. Otherwise the static line stays.

### Who can do what

The pin routes sit behind the password and the strict origin check. So does `POST /api/new` when its body names an account or a group. They take an id for the target and an id for the account, and GhostShell checks both against its own lists. A pin to a signed-out account is refused, as a switch to one is. An agent in a chat gets no tool to set a pin. Its `move_session_to_group` tool can change a session's account by moving it into or out of a pinned group, so a move that changes the account gets an approval card that names the new account. So does a move that gains or drops a pin while the account stays the same, since a later switch would part the two, and a move of a session with sessions under it, since those can follow it or be relinked off a pin. Any other move, a rename and an archive stay card-free, and a move whose target cannot be worked out asks. The layout writes on the page that place a session keep the global origin check, which refuses a cross-site POST. The routes touch no token and return no email.

### Consequences

- ✅ One subscription can carry a group, a project or a routine while the other carries the rest.
- ✅ A pin follows its session, group, project or routine through moves and renames.
- ✅ Pinned work stops and says why before it runs on the wrong subscription.
- ❌ A blocked session needs a person to act. A scheduled run that hits a blocked account is lost, as any refused run is.
- ❌ Each process start on an added account copies the user settings, so a local MCP server or trust set only on that account is replaced sooner than it was.
- ❌ A session's pin outlives an archived session in `layout.json` until the session is gone.
- ❌ While `layout.json` cannot be read, GhostShell uses the pins from the last good read. A restart in that state has no pins to go on, so pinned work runs on the active account.
- ❌ The / menu's cache stays per folder, so it can show the other account's list.

### Out of scope

- An MCP tool to read or set a pin. The UI covers the need, and it keeps an agent from moving itself onto another subscription.
- Desktop's own sign-in, which the `claude://resume` hand-off still uses.
- Moving a running turn to another account.

## Pros and Cons of the Options

### Pins in the existing stores

- ✅ Existing writes, validation and clean-up carry the pins.
- ✅ The page already reads these stores.
- ❌ The layout gains a new top-level map.

### A separate pins file

- ✅ One place to read them all.
- ❌ It needs its own writes, and its own clean-up when a group or project goes.

### Fall back to the active account

- ✅ Work keeps running through a signed-out account.
- ❌ It spends a subscription nobody chose for that work, without saying so.

## Links

- Builds on [Keep two Claude accounts signed in and switch GhostShell between them](20261102-switch-claude-accounts.md), whose folders and switch behaviour a pin reuses
- Builds on [Show banners in the sidebar for Claude's sign-in ending and for merged changes waiting](20261102-banners-for-sign-in-and-updates.md), whose sign-in banner now covers each account in use
- Builds on [Show plan usage in the context popover from the CLI's own figures](20261031-plan-usage-from-the-cli.md), whose popover now follows the session's account
- Builds on [GhostShell is the only home for routines](20261025-ghostshell-is-the-only-home-for-routines.md), whose runs can now hold a pin
