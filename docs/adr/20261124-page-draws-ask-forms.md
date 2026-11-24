# Let the page draw Claude's ask forms from questions sent as data

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-24
- Tags: forms, tools, mcp, widgets, security

Technical Story: https://github.com/kulesy/ghostshell/issues/3

## Context and Problem Statement

Claude sometimes needs several answers at once: a choice, a short text, a date, a number. Asking in prose means the owner types a long reply and Claude parses it. Desktop shows a form for this. Who draws the form in GhostShell, and how do the answers get back to Claude?

## What was already covered

- `AskUserQuestion` already asks single and multiple choice questions, each with a box for an own answer. It is a permission request, so it blocks the turn, and its answer is the tool result. It has no text-only, date or slider question.
- A widget can draw any controls and send text with `sendPrompt`, but each send needs the owner's click inside the frame and nothing in the page knows which questions were asked or whether the form was answered.
- File questions are out of scope here. They need uploads and are a later change.

## Decision Drivers

- The page must read the questions as data, so it can validate them, label every control for a screen reader and show the form again as answered after a reload.
- Code Claude wrote must not be able to press Send answers or Skip.
- The widget frame must stay `sandbox="allow-scripts"` with no same-origin.
- The answers should reach Claude as the owner's next message, so the turn ends and nothing waits on a card.
- The tool description and schema go with every request, so they stay short.

## Considered Options

1. The page draws the form from questions sent as data (`show_form`)
2. A widget's frame draws the form
3. Extend `AskUserQuestion` with the new question types

## Decision Outcome

Chosen option: "The page draws the form from questions sent as data", because the page reads the questions itself, the send buttons are the page's own so no widget code can press them, and the frame needs no new power.

How it works:

- **The tool.** `show_form` takes a title and one to ten questions. A question is a `choice`, `choices`, `text`, `date` or `slider`. Choices have two to ten options with distinct labels, and each also gets a box for an own answer. A date takes `min` and `max` as `YYYY-MM-DD`. A slider takes `min`, `max` and optionally `step`, `start` and `unit`. `lib/forms.mjs` checks every field, drops the ones it does not know and answers a bad call with an error that names the question and what to fix, so the model can try again.
- **The record.** A good call is stored in `forms.json` under the call's tool use id, with the session, the title, the questions and a status of `open`. `GET /api/sessions/:id/forms` lists a session's records. The result tells the model to end its turn.
- **The page.** The transcript row for `show_form` draws a card from the record and ignores the call's own input. A call with no record draws as an ordinary tool row. The card reuses the question card's classes. It has no `<form>` element, so Enter never sends, and its buttons act only on a click the browser made for the owner.
- **Sending once.** The send action takes `form: { id, skipped }`. The server finds the record, refuses an unknown one or another session's (404) and a settled one (409, with the record), and then claims it with nothing waiting between the claim and the send. A send that throws puts the record back to open. The card then shows as answered or skipped on every device and after a reload.
- **The message.** The owner's next message lists each question with its answer, or says they skipped the form. They can also reply in their own words.
- **The frame.** Nothing changes in it. A widget on the same page that posts a `form` or `prompt` message naming a form settles nothing, because the page settles a form only through its own buttons.

### Consequences

- ✅ One form can ask choice, text, date and slider questions, and the answers arrive as one message.
- ✅ The sandbox and the rule that a frame's message counts only from that widget's own window are unchanged.
- ✅ A form can be answered once, from any device, and shows how it ended.
- ❌ Claude never sees the form after it draws, only the message that answers it.
- ❌ The Mac app has no card for it yet, so it shows the call as an ordinary tool row. The gap is in `docs/parity.md`.
- ❌ A form the owner never answers stays open, and an edited one holds back the page's automatic reload until it is sent or skipped.

## Pros and Cons of the Options

### The page draws the form from questions sent as data

- ✅ The questions are data the page and the server both check.
- ✅ The buttons are the page's, so widget code cannot press them.
- ❌ Each new question type is a change to the page, not just to the tool.

### A widget's frame draws the form

- ✅ Claude could draw any control it likes.
- ❌ The page cannot tell a form from any other widget, so it cannot check the questions, mark the form answered or label the controls.
- ❌ Sending would rely on `sendPrompt`, which is a click inside the frame, so a script that clicks its own button sends the form.

### Extend `AskUserQuestion` with the new question types

- ✅ One tool for every question.
- ❌ It is a permission request, so the turn waits and the answer is a tool result, not the owner's next message.
- ❌ The CLI owns its schema, so GhostShell cannot add types to it.

## Links

- [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md), amended 2026-11-24
- [Draw widgets the way Desktop does, in a frame that cannot reach Capcom](20261019-widgets-render-like-desktop.md)
