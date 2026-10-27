# Show messages between chats by sender, and show a held message with no way to approve it

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-16
- Tags: peer-messages, cross-session, notices, approvals, stream-json

## Context and Problem Statement

Chats that Capcom runs can message each other. Claude Code gives each chat a `SendMessage` tool to send a message and a `ListAgents` tool to find the others. Capcom showed none of this well. The CLI saves a message from another chat, and its report on one this chat sent, as meta user turns, and the transcript reader skipped both. A message the CLI held left only a system message that the runner ignored. A send showed as a row of raw tool input.

The CLI holds a message when the sender and the receiving chat are in different permission classes (one bypasses permission prompts and the other asks), and for a few other reasons. A held message waits for the receiver's owner to approve it, and a terminal session asks. Capcom runs every chat headless. How should it show these messages, and can it let the owner approve a held one?

## Decision Drivers

- A message from another chat is untrusted input. The owner has to see who sent it, and nothing may approve it for them.
- A hold the owner cannot act on must not look as if they can.
- Loading a session and following it live have to give the same result.
- The sender chooses its name, its address and its text, so all three have to be escaped.
- The CLI's behaviour here is unpublished, so the code should rest on what was checked.

## Considered Options

1. Show holds and deliveries as the CLI reports them, and offer no approval
2. Offer Allow, which sets `crossSessionInbound` to `accept` for the chat
3. Offer Allow, which switches the chat's permission mode to the sender's
4. Offer Allow and Deny, which answer the CLI's approval dialog

## Decision Outcome

Chosen option: "Show holds and deliveries as the CLI reports them, and offer no approval", because the CLI gives a headless chat no way to approve one message, and the two routes that release a hold change the chat's policy for later messages on the word of an untrusted one. The change adds no route, no write and no approval.

- **What the CLI does.** A message goes through when the sender and the receiving chat are in the same permission class, and an idle receiver starts a turn to answer it. When the classes differ the CLI parks the message and writes a `peer_message_hold` system message with the state `held`, a cause, the sender's address and name, and an id the sender chose. The cause is `mode-mismatch`, `no-mode-asserted` (the sender names no mode and the receiver bypasses prompts), `bypass-default`, `mode-unknown` or one of four `crossSessionInbound` settings. The message carries neither the text nor the sender's mode. A hold then ends as `released` (delivered), or as `dropped` with an outcome: `expired` (nobody approved before the deadline), `refused`, `dropped` (the CLI's rate limit, repeat check or queue cap discarded it) or `discarded` (the chat ended first). The deadline is 5 minutes by default, set by the `dialogExpiry` setting (`60s`, `5m`, `10m` or `never`) or the `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` environment variable. With the default a held message was dropped 300 seconds after it was held, and with `dialogExpiry` set to `60s` after 60 seconds.
- **No approval for a headless host.** Four made-up approval requests (`approve_peer_message`, `peer_message_decision`, `resolve_peer_hold` and `release_peer_message`) each got "Unsupported control request subtype". The CLI's code has an approval dialog for this, `peer_inbound_approval`, which a terminal session raises for `mode-mismatch` and `no-mode-asserted` only. A chat that declared that kind in `initialize.supportedDialogKinds` was not sent it: the hold arrived and no `request_user_dialog` followed in 45 seconds. The CLI says the same in its own words, in the note it sends the sender: a terminal session asks for approval, but the desktop app and non-interactive sessions cannot ask, so the message expires unless the modes come to match.
- **Two routes release a hold, and Capcom takes neither.** A `set_permission_mode` request to the sender's class released the held message, which was then delivered. An `apply_flag_settings` request that sets `crossSessionInbound` to `accept` released every held message. Both change the chat for every later message too.
- **Stream.** `lib/runner.mjs` turns `peer_message_hold` into `hold` and `hold-ended` events and keeps the current holds in `status().holds`, which the process exit clears, and so does starting a new process after a stop, because the old process's exit is ignored by then. A frame with no `message_uuid` is ignored, since its own `uuid` is new on every frame and could never match the frame that ends the hold. The sender's name is cleaned by `label()` in `lib/notices.mjs` and cut to 60 characters, and the id is cut to 100.
- **Cards.** `public/ui/holds.js` draws a held message as a card above the reply box, with an amber lamp. It names the sender and gives the reason in words. One line after the amber cards, shown while any shows, says Claude has seen none of it and the CLI gives Capcom no way to approve a held message. A hold that ends `dropped` becomes a grey card that stays until the owner presses Dismiss. A `released` hold leaves silently, because the delivery shows in the thread. Messages from one sender for the same reason share a card and a count. A card sits where its newest message is, so one that has just taken another message is the last to be left out. At most three cards of each kind show with a line counting the rest, and the area scrolls inside 40% of the screen height. It scrolls to its foot whenever the cards change, because the newest card sits at the foot and a phone's 40% would cut it off. Ended cards live in the page only. A pane is built again whenever the owner opens another chat, so `public/ui/session.js` keeps up to 100 undelivered messages for each chat in a map outside it, and the cards survive a switch and go on Dismiss or a reload.
- **Delivered.** `lib/notices.mjs` draws a message from another chat as a notice titled "Message from" and the sender's name, with the text as its line and the sender's address, name and mode behind Details. It arrives in two shapes: a meta user entry whose `origin` has kind `peer` when the receiver is idle, and a `queued_command` attachment, with `isMeta` and the `origin` inside it, whose prompt is the bare `<cross-session-message>` tag when the receiver is mid-turn. Both go through `itemsFromEntry`, so a load and the live update agree. A queued attachment is read as a meta turn when it has `isMeta` or a peer `origin`, and not for any `origin`, because a background task's notice carries the origin `task-notification` and a typed message `human`. The `origin` holds the sender and the text and `metaNotice` believes it. A message a host injected (`hostInjected`, seen on CLI 2.1.284, 2.1.295 and 2.1.299) has neither the text nor the name in its `origin`, so those come from the tag round it, which gives the name as `name=` where the CLI's own form says `from-name=`. A hand-back from this chat's own subagent (an `origin` with `handback`, seen on 2.1.281 to 2.1.295) is titled "Message from a subagent", as its `<agent-message>` tag is.
- **Reports.** The CLI writes `[Cross-session delivery notice] ...` entries on the sender's side, as a meta user entry or, when the sender is mid-turn, as a meta `queued_command` attachment (seen on CLI 2.1.299 and 2.1.302). They become notices with a lamp for the state: amber for held, green for delivered, red for expired, refused or dropped, grey for denied.
- **Sender's calls.** A `SendMessage` row reads "to name: summary", a `ListAgents` row reads "other sessions", and a group says "sent 2 messages" or "looked up other sessions". A send asks for approval only when a permission rule makes the CLI ask, and the card then has the title "Claude wants to message another session" with To and Message fields.
- **Escaping.** Names, addresses and text reach the page as text through its templates. `label()` also turns line breaks, bidirectional marks and zero-width characters in a name or address into spaces.
- **Checked** with Haiku 5.5 in throwaway headless chats. On CLI 2.1.301: the hold and its causes, the parity rule, an idle receiver starting a turn, delivery while mid-turn, the delivery reports, the four refused requests and the two releases. On 2.1.302, after an update: the hold, the four refused requests, the release by mode, the dialog that was never sent, the deadline and the mid-turn delivery. The `ListAgents` row was checked on a synthetic transcript only.
- **Amended 2026-10-27, messages from a session.** A turn on stdin whose text is a `<cross-session-message>` tag is taken by the CLI as a peer message and held with the cause `no-mode-asserted`, then dropped at stdin close (CLI 2.1.310, checked with Haiku 5.5). So `send_session` wraps its text in `<session-message from="..." from-name="...">`, which the CLI passes through as a normal turn (checked with Haiku 5.5 on a bare CLI process for this name, which answered the message and held nothing), and `lib/notices.mjs` draws it as the same "Message from" notice. The tool reaches any session on the Mac, not only the ones below the sender, and the owner approves each send. The held frame carries a `uuid` and no `message_uuid`, so the runner's `hold()` ignores it and the card never shows. That gap was left as it is. See [Roll a session's sub session status up to every parent](20261023-roll-sub-session-status-up.md).
- **What approving would need.** The CLI would send a headless host that declared `peer_inbound_approval` the `request_user_dialog` it already raises in a terminal session, with the sender, the cause and the text in its payload. Capcom would then draw Allow and Deny on the card, post the click through the same-origin check, and answer with `{behavior: 'completed', result: {behavior: 'approve'}}` or `deny`, as the CLI's schemas describe it (read from the schemas, not exercised). It would declare the kind then and not before, and each Allow would be the owner's click on one message.

### Consequences

- ✅ The owner sees who sent a message, why it is held and that Claude has not seen it, and a delivered message reads as a notice that names the sender.
- ✅ Nothing in Capcom can approve a message, so an untrusted message cannot approve itself and a stray click cannot let one in.
- ❌ A held message cannot be approved from Capcom. It is dropped when the deadline passes, unless the owner changes the chat's mode to the sender's class first, and the sender has to send it again.
- ❌ The code leans on behaviour the CLI does not document: the hold message, the `origin` of a peer entry, the queued attachment, the delivery reports and the dialog it withholds. Recheck them after a CLI update.
- ❌ A sender's name and address are claims in its message. They label a message and prove nothing about who sent it.
- ❌ Cards are live only. The CLI saves nothing about a hold, so a page opened later shows the messages still held and none that ended, and a hold that ends while the owner is in another chat leaves no grey card.
- ❌ A chat Capcom stopped after 30 idle minutes has no socket, so it receives no messages until it starts again.

## Pros and Cons of the Options

### Show holds and deliveries as the CLI reports them, and offer no approval

- ✅ Nothing in Capcom can let an untrusted message in
- ✅ The card says only what is true: who sent it, why it is held, and that it cannot be approved here
- ❌ A held message is lost unless the owner changes the chat's mode in time

### Allow sets `crossSessionInbound` to `accept`

- ✅ One click releases the message
- ❌ It releases every held message, so it is not per message
- ❌ It accepts every later message too, on the word of one

### Allow switches the chat's permission mode to the sender's

- ✅ `set_permission_mode` is a request the CLI supports
- ❌ Moving a chat to bypass permissions to receive one message grants far more than the message needs
- ❌ It releases every message held for that reason, not one

### Allow and Deny answer the CLI's approval dialog

- ✅ It approves one message at a time, as a terminal does
- ❌ A headless chat is never sent the dialog, so nothing could answer it

## Links

- Amends [Show the CLI's own user turns as compact notices](20261016-notices-for-cli-written-user-turns.md), which now reads a peer message by its `origin` and the CLI's delivery reports
- Relates to [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), which is why there is no terminal to ask
