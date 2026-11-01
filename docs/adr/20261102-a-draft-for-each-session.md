# Keep a draft for each session, and let quotes follow you between chats

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-02
- Tags: prompt-box, drafts, quotes, attachments

## Context and Problem Statement

The prompt box held one unsent message for the whole page. Text, images and files typed or attached in one session went with you into the next chat you opened, and a `!` command was dropped on the way. The owner asked: "Can you make sure this input box message is isolated to the sessions they are typed into, so when you switch sessions it doesn't keep the message." Where does an unsent message live, and how long does it last?

## Decision Drivers

- A message written for one session should never land in another by accident.
- [Quoting](20261023-quote-selected-text.md) one session in another depends on the quote reaching the next chat.
- Typing must still redraw only the prompt box.
- A reload, or a phone dropping the tab, should not cost the owner what they typed.
- Drafts for sessions that are archived or gone should not pile up in the browser.

## Considered Options

1. A draft per session for text, images and files, with quotes kept for the whole page
2. A draft per session for everything, quotes included
3. Keep one draft, and clear it on every switch

## Decision Outcome

Chosen option: "A draft per session, with quotes kept for the whole page", because it keeps a message in the session it was written for and still lets a quote taken in one session be sent in another.

- **Keys.** `public/ui/draft.js` keys each draft by session id. The new session page has one draft of its own, `new`, for every group, as the page had one draft before for all of them. A group's or section's chat is a session and has its own.
- **Text.** It lives outside the components, as before, so typing redraws only the box. It is kept in localStorage under `capcom.drafts`, an object of session id to text, through the page's `local` helper, which swallows a storage error. A box left empty removes its entry, and Sign out empties them all, as the server's sign-out clears the cache.
- **Images and files.** They sit in the `attachments` store under the same key, for the page's life only. An image is a data URL and could fill the storage quota, and nobody has checked how long the server keeps an upload that was never sent. An upload or an image being prepared writes into the draft it was attached in, whichever chat is open when it finishes.
- **Quotes.** They sit in the `quoted` store, one for the page, and go into whichever chat sends next, as before. A quote already names its source session, so it reads correctly in any chat.
- **Sending.** A send clears that session's text and attachments and the quotes it took. A failed send puts them back into the same session's draft. A box that opened again while the send was out shows the text only the next time it opens.
- **Commands.** A `!` command now stays in its own session, so it can only run in the folder it was typed for. `carriedText`, which dropped a command on a switch, is gone.
- **Clean-up.** Once each page load, when the first list arrives from the server, the page drops the draft of any session the list does not hold, and stops an upload still running in it. The chat on screen keeps its draft. A later list can be the page's own guess, such as one drawn before the server accepts an archive or a move, so pruning against it could lose a draft the server then keeps. The list's ids include the chats of groups and of Home's sections (`listedIds` in `public/ui/tree.js`).
- **Typing ping.** A group's chat that opens with a saved draft sends no typing ping until the text changes, so a draft left there does not hold back the group's update.

### Consequences

- ✅ Switching chats leaves each message where it was typed, and coming back finds it.
- ✅ Text survives a reload and a phone dropping the tab.
- ✅ A quote can still carry text from one session to another.
- ❌ Images and files are lost on a reload, as they were before.
- ✅ An archive that is refused or undone keeps the session's draft.
- ❌ The list leaves out older sessions: past the newest 60 of each loose section, past the newest 12 runs of each routine, and terminal sessions past `otherDays`. Their drafts go on the next page load.
- ❌ An archived session's draft stays in the browser until the next page load.
- ❌ Two tabs on the same session share the stored text, and the last one to write wins on the next reload.

## Pros and Cons of the Options

### A draft per session, with quotes for the whole page

- ✅ No message reaches the wrong session, and quoting across sessions keeps working.
- ❌ A quote taken for one chat waits in every chat until it is sent or removed.

### A draft per session for everything

- ✅ The simplest rule to state.
- ❌ A quote taken in session A would stay in A, so sending it to B would mean switching and quoting again. That breaks the reason quotes exist.

### One draft, cleared on every switch

- ✅ The least code.
- ❌ Switching away to check something loses the message.

## Links

- [Quote selected text into the prompt box](20261023-quote-selected-text.md), amended by this record
- [Send pasted images as content blocks](20261015-images-in-the-prompt-box.md)
- [Attach any file by saving it and mentioning its path](20261023-attach-files-by-path.md)
