# Show a badge after each pull request and issue link in a reply, with a card of its details

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-27
- Tags: transcript, pull-requests, issues, github, gh, badge, hover-card

## Context and Problem Statement

Claude's replies link to pull requests and issues all the time, often as the full address. To learn whether one merged, failed its checks or was closed as not planned, the owner leaves GhostShell for GitHub. He asked for these links to be previewable: the title, the state (open, draft, merged, closed), and for a pull request its review and checks.

The [session card decision](20261026-show-pull-request-status-on-session-cards.md) already reads pull request status from `gh` on the server. Where in a reply should the status show, and how does an issue get read?

## Decision Drivers

- The transcript is prose. A preview must not push the text apart or bury the link it describes.
- It has to work on a phone, where nothing hovers.
- The page cannot call GitHub, and GhostShell holds no token, as on the session cards.
- One reader for pull requests and issues, shared with the session cards and with the branch that attaches pull requests and issues to sessions.
- A title from GitHub is untrusted text and must never become markup.
- A page served by a server without the change keeps working, with no badges and no errors.

## Considered Options

1. A badge after the link with the state, and a card with the details on hover or on a tap of the badge
2. A hover card on the link alone
3. A line or card under the paragraph for each link

## Decision Outcome

Chosen option: "A badge after the link with the state, and a card with the details on hover or on a tap of the badge", because the state is what the owner scans for, and a badge shows it in the line without a pointer. The title and the review and check facts are longer, so they wait in a card.

- **Badge.** shadcn's outline badge, right after the link, with a mark and one word: Open, Draft, Merged or Closed for a pull request, and Open, Closed, Not planned or Duplicate for an issue. The mark takes the tone the session cards use. An open link is plain, because amber means the owner has to act. A link GhostShell has no answer for gets no badge, so nothing reads as loading or broken.
- **Card.** One card for the page, in shadcn's hover card style. It shows the title, the repository and number, the state, and for a pull request its review, its checks and the next step from `statusOf` in `public/ui/pull-rules.js`, the same line the session cards show. With a mouse it opens 700ms after the pointer reaches the link or the badge, and closes 300ms after it leaves both, as Radix's hover card does. A click or tap on the badge, or Enter or Space, opens it and keeps it open. Escape puts the focus back on the badge. A press outside, a resize or the badge scrolling out of sight closes it. The card follows its badge while a reply streams.
- **Reading.** `public/ui/pull-url.js` holds the issue address beside the pull request one, in the same plain `https://github.com/<owner>/<repo>/issues/<n>` form. `lib/pulls.mjs` reads an issue with `gh issue view --json title,state,stateReason`, and a pull request now also returns its title. Both kinds share the cache, the 4 `gh` processes and the queue limit. `gh issue view` answers an issues address that is really a merged pull request with `MERGED`, and GhostShell drops that answer.
- **Route.** `GET api/links?url=<address>&url=<address>` takes at most 40 addresses and refuses anything that is not a pull request or issue address. It answers `{ links: { <url>: Link }, settling }` and leaves out what `gh` cannot read. `GET api/sessions` carries `features.linkStatus`, and a page without it draws nothing.
- **Page.** `public/md.mjs` stays as it is, because the server runs it too. `public/ui/links.js` puts the badges into the drawn replies and watches the transcript, so a reply drawn again gets its badges back. It waits 400ms for a streaming reply to hold still, then asks for the links whose answer is missing, unfinished or older than 60 seconds. A quote leaves the badge out, because a quote already drops buttons.

### Consequences

- ✅ The owner sees whether a linked pull request merged, or an issue closed, without leaving the chat, on a phone too.
- ✅ The session cards and the links share one reader and one set of status words.
- ✅ A title shows as text, whatever it holds.
- ❌ Each pull request costs up to 3 `gh` calls every 2 minutes while a chat that links it is open, on top of the session cards' calls.
- ❌ An open or closed pull request reached through an issues address shows as an issue, because `gh` gives no field that tells them apart.
- ❌ Links in the Sub sessions tab's replies and in the file viewer get no badge.
- ❌ A badge appears after the text has drawn, so the line moves a little when it lands.

## Pros and Cons of the Options

### A badge after the link, and a card on hover or tap

- ✅ The state reads at a glance, and the details are one tap away.
- ❌ It adds a button to the reply's text.

### A hover card on the link alone

- ✅ Leaves the text as it is, and asks GitHub only for the links the owner points at.
- ❌ Shows nothing on a phone, and nothing without a pointer.

### A line or card under the paragraph

- ✅ Room for the title and every fact.
- ❌ A reply that links five pull requests grows five cards, and the link sits apart from what describes it.
