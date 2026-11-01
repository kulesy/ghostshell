# Quote selected text into the prompt box, and send each quote as a blockquote

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-23
- Tags: prompt-box, transcript, selection, quotes, phone

## Context and Problem Statement

The owner asked: "Can you make it so I can reference text in a session by selecting it." To point Claude at one sentence of a long reply, he had to copy it, paste it into the prompt box and mark it as a quote by hand. How does a selection get into the next message so Claude knows which text he means, and what does the CLI receive?

## Decision Drivers

- The CLI takes plain text, and sending a quote should need no server change, so a page newer than its server keeps working.
- Claude has to tell the quote apart from the question about it.
- A quote should behave like an attachment: easy to see, easy to take off, and kept with the draft.
- The owner quotes one session in another, so a quote has to say where it came from.
- It has to work on a phone, where iOS and Android draw their own menu beside a selection.

## Considered Options

1. Keep quotes in the draft beside the images and files, and write each into the message as a markdown blockquote ahead of the text
2. Write `> ` lines straight into the prompt box's text
3. Send quotes as a field of their own, and have the server build the prompt

## Decision Outcome

Chosen option: "Keep quotes in the draft and write each as a blockquote ahead of the text", because Claude reads a blockquote as quoted text with no instructions, the server sends it as it sends any text, and the box can show each quote as a card that comes off in one click.

- **Taking the text.** Only a selection whose range lies inside the open chat's transcript counts. The page copies the selected nodes, drops buttons, code block headers, screen-reader text and anything hidden from screen readers, so a code block's Copy and Run and its language label stay out, and reads the copy's `innerText` so the lines between blocks survive. The text then gets LF line ends, plain spaces, no trailing spaces and at most one blank line in a row.
- **The button.** With a mouse, a Quote button shows beside the selection once the drag ends, below its last line or above its first when there is no room below, and scrolls with the text. On a touch screen it docks above the prompt box instead, clear of the system's menu. Ctrl+' or Cmd+' does the same as the button, a key Capcom did not use. Either one clears the selection and puts the cursor at the end of the box's text.
- **The draft.** Quotes sit in the draft store beside the images and files, so they follow the draft from chat to chat as its text does. The same words from the same session go in once. A quote is drawn above the text, cut to two lines, with the attachments' cross, and one taken from another session names it.
- **Sending.** Each quote becomes `> ` lines, with an empty line written as `>`, and a quote from a session other than the one the message goes to is preceded by `From the session "<title>":`, or `From another session:` when it has no title. Quotes are separated by a blank line, then a blank line, then the typed text. Quotes alone are a message, and a failed send puts them back.
- **Commands.** The CLI runs a slash command only when the message opens with it, so a slash command goes alone and leaves the quotes in the draft, as a `!` command does. The page and the server read a slash command with the same `isSlashCommand`, which moved from `lib/uploads.mjs` to `public/ui/command-rules.js`.
- **Reading.** A user message that opens with that shape draws its quotes above the bubble, muted, cut to three lines and opened by a click. The rest of the message draws as before.
- **Titles.** Where GhostShell names a session from its first message, `titleText` takes the text after the quotes, or the first quote when nothing follows, so a session started with a quote is not titled `From the session`. The server reads it from `public/ui/quote-rules.js`, so it takes effect when the server restarts.

**Amended 2026-11-02.** Text, images and files now stay in the session they were typed or attached in, and only quotes follow you to the next chat. Quotes moved from the draft store to a store of their own, `quoted`. See [Keep a draft for each session](20261102-a-draft-for-each-session.md).

### Consequences

- ✅ The server and the CLI see plain text, and a page served by a server that has not restarted quotes the same way.
- ✅ Claude, Desktop and a terminal resume of the session all see the quote as ordinary markdown.
- ✅ The owner can quote one session while writing in another.
- ❌ A skill cannot take a quote as its argument, because a slash command goes without the quotes.
- ❌ A message the owner types with leading `>` lines draws as quotes too, and so does one sent from Desktop or a terminal.
- ❌ The page knows a quote's source by its title only, so Claude gets no session id to look the session up.

## Pros and Cons of the Options

### Quotes in the draft, sent as blockquotes

- ✅ Sending needs no server change, and the transcript holds what Claude saw.
- ✅ Each quote is a card that comes off in one click.
- ❌ The page has to read the shape back to draw a sent message's quotes.

### `> ` lines in the prompt box's text

- ✅ The least code.
- ❌ A long quote fills the box and pushes the question out of view, and taking one off means editing its lines.
- ❌ The sent message shows raw `>` marks in the chat.

### A field of its own, built into the prompt by the server

- ✅ The server could add the source session's id.
- ❌ It needs a server change and a restart, and a page newer than its server would lose the quotes.

## Links

- [Match Desktop's flow for the prompt box](20261014-desktop-like-prompt-box-flow.md)
- [Attach any file by saving it and mentioning its path](20261023-attach-files-by-path.md)
