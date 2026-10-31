# Show plan usage in the context popover from the CLI's own figures

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-31
- Tags: ui, cli, prompt box, context, usage, plan limits

## Context and Problem Statement

Claude Code's /usage shows how much of the plan's limits are used: the current session's limit and the weekly limits, each with a percent and a reset time. On 31 Oct 2026 Eli asked to see the same in the context popover that opens from the context meter, so a chat shows how close the account is to a limit.

The figures belong to the account, not to a chat. Where should they come from, so that they match what /usage shows, without adding a turn to a session and without touching anything that is not Capcom's own?

## Decision Drivers

- The figures should match the CLI's own, including which limits apply and what they are called.
- Asking must not write to a session.
- Capcom should not hard-code which limits exist. A plan can have a session limit, a weekly limit, and weekly limits for one model.
- Nothing private should be read. Capcom should only use what a CLI it already runs will say.

## Considered Options

1. Ask a running CLI process with the `get_usage` control request, with `skip_behaviors` set
2. Read the `rate_limit_event` messages the CLI streams
3. Read Claude Desktop's files, or call claude.ai with the browser's cookies

## Decision Outcome

Chosen option: "Ask a running CLI process with the `get_usage` control request", because it gives the server's own rows, in the server's order, and runs no turn.

- **The request.** The CLI answers `{"subtype": "get_usage", "skip_behaviors": true}` with `rate_limits.limits`, an array of rows. Each row has a `kind` (`session`, `weekly_all`, `weekly_scoped`), a `group`, a `percent` from 0 to 100, `resets_at` or null, a `scope` that can name a model or a surface, a `severity` and `is_active`. The CLI's own schema says the client renders the rows as sent: which meters apply, their labels, severity and order are the server's. `skip_behaviors` skips a scan of every local transcript from the last 7 days, so Capcom always sends it. `rate_limits` is null when the CLI could not fetch the limits, and `limits` is null or empty when there are none. Checked on CLI 2.1.316 on a Max plan, where the weekly rows came back and no session row did, because no five-hour window was active.
- **The route.** `POST api/sessions/<id>/plan` with no body needed. The plan is the account's, so the server asks that chat's process first and then up to two other chats Capcom runs, keeping the first answer. It never starts a process. The answer is `{ "limits": [...] }`, or `{ "limits": null }` when no process answers or no row is usable. It is a POST so that Capcom's same-origin check covers it, as it does the context route.
- **Shaping.** The server keeps each row's order and drops a row with no kind, group or finite percent. It clamps the percent to 0 to 100 and turns a reset that is not a date into no reset. A severity it does not know is normal.
- **The popover.** The popover asks for the limits once each time it opens, and not again if the ask fails. Under the table of parts a "Plan usage" heading is followed by a row for each limit: its label, its percent, a bar that reuses the context bar, and the reset in words. A kind decides the label (Current session, Weekly · All models, Weekly · and the model's name), and a kind the page does not know takes its group and scope. A reset under 24 hours away counts down ("Resets in 3 hr 20 min"). A later one gives the weekday and the clock in the page's zone ("Resets Wed 12:59 pm"). A warning row turns the bar amber and a critical one turns it red. With no rows the section is not drawn.

### Consequences

- ✅ The popover shows the CLI's own limits, so it follows a plan that gains or loses a limit with no change in Capcom.
- ✅ Asking adds nothing to a session and runs no model turn.
- ❌ `get_usage` is not a published contract. The Agent SDK wraps it as `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`. If the reply changes, the section hides and the rest of the popover is as it was.
- ❌ With no chat running there is no figure, because Capcom starts no process to ask.
- ❌ The figures are as fresh as the CLI's, and the popover shows them as of its opening.

## Pros and Cons of the Options

### Ask a running CLI process with the `get_usage` control request

- ✅ The server's own rows, labels and order, for any plan.
- ❌ Relies on a control request the CLI marks experimental.

### Read the `rate_limit_event` messages

- ✅ A documented stream message.
- ❌ It carries only the window that limited the last request, from response headers, and only after a turn. On CLI 2.1.316 it showed the seven-day limit alone, with no scoped rows and no session limit.

### Read Claude Desktop's files, or call claude.ai with the browser's cookies

- ✅ Could be fresh with no chat running.
- ❌ Reads another app's private files, or uses a signed-in session Capcom was not given. Both are off limits.

## Links

- Builds on [Show a chat's context usage from the CLI's own count](20261022-context-usage-from-the-cli.md), whose popover holds the section and whose route this one follows
- Builds on [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose process answers the request
