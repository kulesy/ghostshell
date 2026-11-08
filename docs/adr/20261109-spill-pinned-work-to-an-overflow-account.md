# Let a pin name an overflow account that takes its work while the pinned one is out of usage

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-09
- Tags: accounts, cli, layout, usage

Technical Story: https://github.com/kulesy/ghostshell/issues/99

## Context and Problem Statement

[A pin](20261104-pin-work-to-an-account.md) keeps work on one account. Only a signed-out or unlisted account blocks it, so a pinned session whose account runs out of usage stays on the spent account and stops. The owner wants a smaller account to carry as many reviews as it can, with the rest carrying on on the main account: "Maybe we could just make it so as many reviews as it can and fall back to main".

The pin record rejected falling back by itself, because it "spends a subscription nobody chose for that work, without saying so". How does a pin name a second account, when does work move to it and back, and how does the owner see that it moved?

## Decision Drivers

- A pin without an overflow behaves as it does now.
- The owner chooses the overflow on the pin, and a spilled session says so.
- A spill never cuts a running turn on an account that still has usage.
- One rule still decides the account, and every spawn path uses it.
- GhostShell never reads, copies or logs a token.

## Considered Options

1. Spill on the out-of-usage mark, and carry on by itself
2. Spill on the mark, and wait for the owner to press Continue
3. Spill earlier, once the pinned account passes a weekly percentage

## Decision Outcome

Chosen option: "Spill on the out-of-usage mark, and carry on by itself", because the mark is the one signal GhostShell already has, it uses every bit of the pinned account, and an unattended review finishes instead of sitting stopped. Eli chose all three parts on 2026-11-09.

### Where the overflow lives

An overflow sits beside the pin it belongs to, in `layout.json`:

- A session's overflow is in `overflow`, keyed by session id, next to `accounts`.
- A group's and a project's overflow is an `overflow` field on that group or project.

Both hold an account id. `POST api/layout/account` takes an optional `overflow` with the pin: an id sets it, null clears it, and a body without the field keeps the one there. Clearing the pin clears its overflow. An overflow equal to the pin is refused with 400, and a pin changed to the overflow's account drops the overflow. An unknown id answers 404, and a signed-out one 409, as for the pin itself.

The Account submenu of a session, group or project shows the overflow choices under the pinned account, as "If Second runs out" with each other account and "Stay on Second". They appear only when more than one account is listed and the item holds its own pin.

Routines keep a pin without an overflow. A routine's run that lands in a pinned group follows that group's overflow.

### The rule

`accountFor` in `lib/account-rule.mjs` also returns the `overflow` of the holder whose pin it chose, so a sub session that follows its parent, or a session that follows its group or project, takes that holder's overflow. A second pure function, `spillOf`, takes that result and answers the account to run on:

- No overflow, or a result from the active account: the result as it stands.
- The pinned account is out of usage, and the overflow is listed, signed in and not out: the overflow, with `spilled` naming the pinned account.
- Anything else: the pinned account. Work on two spent accounts stays on its pin.

The server applies `spillOf` in the one place it resolves a process's account, so a new chat, a resume, a routine run, a chip, a sub session and a group's chat all spill alike. The rows the page draws use the same two steps, so a row never names a different account from the one its process runs on.

A signed-out pinned account still blocks, overflow or not. Sign-out is not running out, and the pin record's reason for blocking stands.

### When it spills

The trigger is the out-of-usage mark that `markUsage` already records, which the CLI's words set when a turn ends on a spent limit. Every limit the CLI reports counts, the 5-hour one included.

When a turn ends out of usage, the CLI has already ended it. If that session now resolves to its overflow, GhostShell stops its idle process and sends "Continue." on the overflow account, the way Switch and continue does. A session that resolves back to the account that ran out, or to an account that is out too, gets no message, so two spent accounts cannot pass a session back and forth.

Other chats on the spent account are left alone. A chat mid-turn finishes its turn there, and if it runs out it spills the same way. An idle chat moves at its next message, through the stop that a pin change already uses.

### When it goes back

The out mark used to count for an hour. It now lasts until the reset of the limit that ran out. When the mark lands, GhostShell asks the chat that ran out for its plan figures, and the mark keeps the latest reset among the limits at 100% that cover every model. Without an answer, or with no limit at 100%, the mark keeps its hour. A clean turn on the account clears the mark, as before.

Once the mark ends, the rule answers the pinned account again, and each process starts there. Nothing running is stopped: an idle process on the overflow moves at the session's next message, and a turn on the overflow finishes there. If the pinned account is still spent after a fallback hour, the next turn runs out at once and spills again.

The longer mark also counts for the out-of-usage banner and for automatic switching, since both read the same mark.

### What a spill costs

A session that moves pays for its whole context again on the new account, once, as a fresh cache. The prompt cache lasts minutes, so a session moved after it has been idle for longer than that pays nothing extra. A session cut mid-review pays the most, which is the price of carrying on by itself.

### How the session shows it

A row that spilled carries `accountSpill`, the id of the pinned account it left, next to `account`, which names the overflow. The chat then shows the line "Second is out of usage, so this session runs on Main until Second resets." in the place of the pin's line. The rows of a single-account station carry no new field.

### Claude in Chrome

The extension reaches only one account, and GhostShell cannot tell which sessions need it. A session spills anyway. When [the Chrome survey](20261104-chrome-follows-the-account.md) proves Chrome is on another account than the overflow, the spill line adds "Chrome is on Second, so it can't reach Chrome." The overflow choices in the menu carry "(no Chrome)" by the same rule as the account picks.

### Who can do what

The overflow rides the pin route, so it keeps the password, the strict origin check and the account checks. An agent in a chat still gets no tool to set a pin or an overflow. `move_session_to_group` already shows an approval card when a move changes a session's account or gains or drops a pin. A move that gains, drops or changes an overflow gets that card too, naming the overflow, since a later spill would run the session on it. The card compares pins and overflows, not the spilled account of the moment.

### Consequences

- ✅ A smaller account carries pinned work until it runs out, and the rest carries on without anyone pressing a button.
- ✅ A spill is opt-in on each pin and shows on the session that spilled.
- ❌ A spill spends the overflow subscription unattended once the owner has opted in.
- ❌ A session cut mid-turn pays for its context again on the overflow.
- ❌ The marks live in memory. After a restart, pinned work starts on the pinned account, runs out once and spills again.
- ❌ The reset comes from the CLI's `get_usage` request, which is not a published contract. If it moves, the mark keeps its hour and work tries the pinned account each hour.
- ❌ The Mac app still sets a pin without an overflow. It keeps the overflow the page set.

### Out of scope

- An overflow on a routine's own pin.
- Spilling when the pinned account signs out.
- A chain of overflows, or spilling when the overflow runs out too.
- Moving a running turn.

## Pros and Cons of the Options

### Spill on the mark, and carry on by itself

- ✅ An unattended review finishes.
- ✅ No polling, and the whole pinned account is spent first.
- ❌ It spends the overflow without a press, once opted in.

### Spill on the mark, and wait for a press

- ✅ Nothing spends the overflow until the owner says so.
- ❌ An overnight review sits stopped until morning.

### Spill on a weekly percentage

- ✅ Fewer reviews start on a nearly spent account.
- ❌ GhostShell would need to poll each pinned account through a running chat.
- ❌ It leaves the tail of the smaller account unspent, and a running review can still run out.

## Links

- Builds on [Pin a session, group, project or routine to one Claude account](20261104-pin-work-to-an-account.md), whose rule now spills
- Builds on [Keep two Claude accounts signed in and switch GhostShell between them](20261102-switch-claude-accounts.md), whose out-of-usage mark now lasts until the reset
- Builds on [Show plan usage in the context popover from the CLI's own figures](20261031-plan-usage-from-the-cli.md), whose figures give the reset
