# Chat

The prompt box and the menus around it, and what the thread shows while Claude works.

## The prompt box

The prompt box follows Desktop's. It is one row: a + on the left attaches files (see [attachments](attachments.md)), the text sits in the middle and the send button on the right. As you type more lines the text grows to 40% of the window's height and then scrolls, with the + and send level with its last line.

The permission mode (Manual, Accept edits, Plan, Auto, Bypass permissions) sits under the box as plain text and opens its list when you click it.

## Quotes

Select text anywhere in a chat's messages, tool output and code blocks included, and a Quote button shows beside the selection. Click it, or press Ctrl+' or Cmd+', and the text goes into the prompt box as a quote, with the cursor at the end of your text. On a phone the button sits above the prompt box, clear of the phone's own selection menu.

Quotes stack above the text, cut to two lines, each with a cross to take it off. They stay in the draft as you move between chats, so you can quote one session in another, and a quote from another session names it.

Claude gets each quote as a markdown blockquote ahead of your text, and a quote from another session as `From the session "<title>":` and then the blockquote. The chat draws them as quotes above your message, cut to three lines, and a click opens a longer one. Quotes alone are a message. A slash command or a `!` command goes alone and leaves them in the box. [The decision record](adr/20261023-quote-selected-text.md) says why a quote travels as text.

## Model, effort and fast mode

One button on the right names the model, `Fast` when fast mode is on, and the effort, and opens a menu like Desktop's.

- **Models.** Opus 5.5, Fable 5.1, Sonnet 5.5 and Haiku 5.5 come first, and the keys 1 to 4 pick them while the focus is in that list. More models holds Opus 5.5 (1M) and every other model the CLI lists.
- **Effort.** Effort opens Low, Medium, High, Extra and Max, with a warning on Max.
- **Fast mode.** When the model takes fast mode, the menu also has an Enable fast mode switch. Fast mode is off until you switch it on for a session. `Fast` shows off while a chat's process starts, until Claude accepts fast mode, and a chat with no process shows what you picked. A refusal turns it off for that session.

A change applies from Claude's next request, even mid-turn. GhostShell remembers it for that session in `picks.json` in its state folder, so it survives the idle stop and a restart.

## Skills and slash commands

Type / at the start of the prompt box and a list of the skills and slash commands that chat can run opens above it, filtered by name and alias as you type.

### Using the list

The arrow keys move, Enter or Tab picks, a click or tap picks, and Esc closes the list without stopping a running chat. Picking writes `/name ` into the box and shows the command's argument hint in grey after it, and sending runs it as a terminal would.

While the list is open Enter picks, so a command typed in full takes a second Enter to send. After Esc, Enter sends what you typed, and a message that starts with / but matches nothing, such as a path, sends as typed.

### Where the list comes from

The list is the CLI's own. A running chat uses the one its process gave when it started. A new session, or a chat with no process yet, gets it from a short `claude -p` run in its folder that sends no message, starts no MCP servers, runs no hooks and writes no session. GhostShell keeps a folder's list for 2 minutes.

`/clear` is left out, because the CLI answers it with a new session that GhostShell's chat would not follow. [The decision record](adr/20261022-slash-menu-from-the-cli.md) says why the list comes from the CLI.

## The context ring

A ring at the right end of the row under the prompt box, where Desktop puts its own, shows how full the chat's context window is. It turns amber when the chat is 90% of the way to auto-compact, and its tooltip gives the tokens used and the percent. Press it to see the tokens used out of the window, where auto-compact starts, and what fills the context, largest first, as Claude Code's /context lists it.

On a narrow phone the permission mode's name shortens to keep that row on one line.

### Where the figures come from

While GhostShell runs the chat, the figures come from the CLI's own count, which runs no model turn and writes nothing to the session. A chat with no process shows the total from its session file instead, as of Claude's last reply, with no parts.

The window and the auto-compact point come from the CLI. GhostShell keeps them per model in `windows.json` in its state folder, so a chat with no process shows its window once GhostShell has run a chat set to that model. [The decision record](adr/20261022-context-usage-from-the-cli.md) says where each figure comes from.

## Stop and redirect

While Claude works and the box is empty, Send turns into Stop, and Esc stops too. A message sent while Claude works redirects it without stopping it: Claude reads the message once the running tool finishes and adjusts before its next step.

## Live work

While Claude works, its thinking streams into a Thinking block above the status line. The block folds into a Thought row when the thought ends, and a tap opens it again. Each tool call shows as soon as it starts.

### The status line

The status line sits under the last row, as in Desktop. Three lamps light in turn, then come the time the turn has run, the output tokens of the replies Claude has finished and what it is doing, as in "2m 26s · 804 tokens · Thinking" or "2m 26s · 804 tokens · Running a command". The token count moves when a reply ends, not while one is written, because the CLI reports an exact count only then.

### The live row

The last group of tool calls in a running turn is a live row. Four lamps turn where its chevron sits, its title is the step Claude is on, such as "Running npm test" or "Reading lib/runner.mjs", and its own timer counts from the group's first row.

When the step changes, the old text fades out as the new text fades in, and the last step fades into the group's summary when the turn ends. With reduced motion on, the lamps stay lit and the text changes at once.

### Thinking text

A headless CLI redacts its thinking, so GhostShell asks it for summaries when the process starts, and the CLI saves them in the transcript. If the CLI sends no thinking text, no block appears and the status line says "Thinking" after the timer. A thinking block saved with no text shows nothing, and a turn stopped mid-thought keeps none of it, because the CLI saves a block only when it ends. Checked on CLI 2.1.301 with Haiku 5.5.

### Chats that Desktop or a terminal runs

A chat that Desktop or a terminal runs shows the same line and row, and its header lamp reads working. Those apps send GhostShell no stream, so GhostShell reads the chat's transcript. It counts the chat as working while all three hold:

- The transcript ends inside a turn.
- GhostShell's own headless CLI did not write that turn.
- The transcript or one of the chat's agents' files changed in the last 10 minutes.

The time and tokens move when a step is saved. Such a chat has no thinking text.

It reads as running while Desktop waits for an approval, because a call that waits for one looks the same in the transcript as a call that runs. It also reads as running for up to 10 minutes after an app quits in the middle of a turn.

A prompt from another app, or one that comes more than 10 minutes after the turn's last entry, starts a new turn, so the next prompt does not join a turn that never ended. A command you run with `!` in a terminal neither starts a turn nor ends one, because Claude does not reply to it.

## Tool calls

Tool calls are collapsed into one row for each run between Claude's messages, such as "Read 3 files, ran 2 commands, edited 1 file" with a `+12 -1` count of changed lines. Tap a row to see every call. A thought among the calls folds into the row, as in "Thought, ran 2 commands".

### Subagents

A chat that has started helpers with the Agent tool gets a Subagents tab in its side panel, between Sub sessions and Terminal. It lists each helper with its type, state and latest action, and opens one to its recent steps and reply. The header's Subagents button opens the tab and has a dot while a helper is running. [Session list](session-list.md#subagents) has the detail.

### Pictures from tools

A call that returned pictures to Claude, such as a screenshot, shows them as thumbnails under its row, and under the group's row while the group is folded, so they need no tap to see. A row shows up to four. When there are more, the fourth thumbnail is dimmed with a count such as "+7" for the pictures that have no thumbnail of their own, and a click on it opens the viewer at that picture. Each thumbnail opens the [viewer](attachments.md#the-image-viewer).

A picture a tool returned in a form the page cannot draw still shows as "[image]" in the call's output.

### MCP tool names

A call to an MCP tool shows its server first, as in "Chrome computer" or "Gmail search threads", and GhostShell labels its thumbnails with where they came from, such as "Image from Chrome". Desktop's app tools show as "Desktop".

Some older Desktop chats name Chrome's server `Claude_in_Chrome`, where the CLI says `claude-in-chrome`. GhostShell reads both as Chrome, in tool rows and in group titles such as "Used Chrome 3 times".

Desktop names a claude.ai connector by an id. In a Desktop session a connector shows by the name that session's Desktop record gives it, or as "connector" when the record has none.

### Messages to other chats

A message to another chat reads "to name: summary" and counts as "sent 2 messages", and a look at the other chats reads "looked up other sessions". A send asks for approval only when a permission rule makes the CLI ask, and the approval card then shows who it goes to and the message.

## Group and section chats

A group has a chat of its own, and so does each built-in section of the list: Routines, Pinned, Started here, Ungrouped and Terminal and other. Its header says "Group session" or "Section session", a group's chat title has a pencil that renames the group (a section's has none), and its Sub sessions tab shows the sessions it covers. It is a normal chat otherwise, with the same prompt box and approvals. [Tools](tools.md#group-and-section-sessions) says what it can reach and start.

## Notices

The CLI saves some of its own messages as user turns: a background task that finished, failed or was stopped, a line from a monitor, a message from another session or a subagent, and the CLI's report on a message this chat sent to another session. GhostShell shows each as a compact notice instead of a message from you.

A notice has a lamp (green when a task finished or a message was delivered, amber while a message waits for approval, red when a task failed or a message was not delivered, grey otherwise), a title such as "Background task finished", and a line saying what happened. The task ids, the output file, the CLI's note and any text meant for Claude alone sit behind a Details toggle.

Only known kinds of message become notices, so text you type that mentions a tag stays your message. A command you ran with `!` is not a notice. It shows as a command block with its output, as in [Terminal](terminal.md#commands-typed-in-the-prompt-box).

## Messages between chats

Chats message each other with the CLI's `SendMessage` tool and find each other with `ListAgents`. The CLI delivers a message when the sender and the receiving chat are in the same kind of permission mode, both bypassing permission prompts or both asking. An idle chat then starts a turn to answer it.

GhostShell shows the message as a notice titled "Message from" and the sender's name, with the sender's address and mode behind Details. A report from one of this chat's own subagents is titled "Message from a subagent". The name and the address are claims the sender makes, so they label a message and do not prove who sent it.

A chat can also message any other session with `send_session`. A message to its parent, its sub sessions or its siblings goes straight away, and any other waits for you to approve its card. The session reads it as a turn and the chat shows it as a notice titled "Message from" and the sender's name, followed by "(your parent session)", "(your ancestor session)" or "(another session)", with the sender's id and name behind Details. See [the tool](tools.md#sub-sessions). A chat that finds its target archived can ask you to unarchive it ([the tools](tools.md#finding-and-changing-sessions)).

A chat that GhostShell stopped after 30 idle minutes has nothing listening and receives no messages from other chats until it starts again. A parent's message starts it.

## Held messages

The CLI holds a message instead of delivering it in these cases:

- The two kinds of permission mode differ.
- The sender does not say which kind it is in and this chat bypasses permission prompts.
- A few other reasons apply, such as the `crossSessionInbound` setting being `hold`.

### The cards

A held message shows above the reply box as a card with an amber lamp. The card names the sender and gives the reason, and one line under the amber cards says Claude has seen none of it. Several messages from one sender for the same reason share one card and a count, and a card that takes another message moves to the bottom, where the newest sits. The box scrolls to its foot when the cards change, so the newest card is in view on a phone.

When the CLI gives up on a message, a grey card says why. It stays until you press Dismiss or reload the page, and it is still there when you come back to the chat from another one. GhostShell remembers up to 100 undelivered messages for each chat, and the oldest go first.

### Cards are live only

The CLI saves nothing about a held message, so GhostShell learns that a hold ended only while the chat is open. A page opened later shows the messages still held and none that ended. The amber cards go when the chat's process ends, and when a new process starts after you stopped the chat.

## Approving a held message

You cannot approve a held message from GhostShell. A terminal session shows its owner an approval dialog, which the CLI's code calls `peer_inbound_approval`. A chat run as GhostShell runs it was not sent that dialog when checked on CLI 2.1.302, even after it declared it could show one. It gets only a note that a message is held, and the CLI answers a made-up approval request with "Unsupported control request subtype".

The CLI waits 5 minutes for an approval by default (its `dialogExpiry` setting, which the `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` environment variable overrides), and then drops the message.

Two things release a held message sooner:

- Change the chat's permission mode to the sender's kind.
- Set `crossSessionInbound` to `accept`, which releases every held message and accepts the later ones.

GhostShell does neither for you, because a message from another session is untrusted input. [The decision record](adr/20261016-peer-messages-between-chats.md) says what approving one message would need from the CLI.
