# Attach pull requests and issues to a session, and show their status in its header

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-27
- Tags: sessions, pull-requests, issues, github, gh, header, sub-sessions

## Context and Problem Statement

A session's card on the Sub sessions tab shows the status of its main pull request, found in its transcript ([ADR](20261026-show-pull-request-status-on-session-cards.md)). That covers one pull request per session, only on a parent's card, and no issues. The owner raises PBIs (GitHub issues) in sessions and often works one PBI and several pull requests in one session. He asked: "can PRs and PBIs be attached to sessions so its easy to see the status on them?"

Which pull requests and issues belong to a session, how does the owner add or remove one, where is it kept, and where does its status show?

## Decision Drivers

- Status should be visible where the owner already looks: the open session's header first, and a parent's card on the Sub sessions tab.
- What GhostShell finds on its own should need no work from the owner, and he must be able to correct it both ways.
- Reading goes through the one `gh` reader in `lib/pulls.mjs`, with its cache and limits. No token, no shell, no new dependency.
- An address is untrusted text until it matches the plain GitHub form, for pull requests and issues alike.
- GhostShell's own per-session state lives in its state folder, never in Desktop's records.
- The page must keep working against a server without the change.

## Considered Options

1. A list per session of found and added items, kept in `links.json`, shown as badges in the header and on the card
2. A Links tab in the side panel, beside Sub sessions and Terminal
3. Find everything in the transcript and offer no way to add or remove

## Decision Outcome

Chosen option: "A list per session of found and added items, kept in `links.json`, shown as badges in the header and on the card", because the header is in sight the whole time a session is open, so its status needs no click, and the owner can fix what was found in the same place.

- **What a session's list holds.** Found items first, then the ones the owner added, in the order he added them, each address once without regard to case. Found items are the session's main pull request, by the rule the card already uses, and the issues the session made or edited: a tool result whose last line is one bare issue address and that holds no other, as `gh issue create` and `gh issue edit` print. A mention of an issue in prose does not count, since sessions cite issues they do not work on. The newest 3 such issues count, so a sweep that edits dozens shows 3 and the owner adds any other.
- **Adding and removing.** The owner pastes a pull request or issue address into the header. A pasted address with a tail GitHub adds (`/files`, `#issuecomment-…`, a query) is cut back to the plain form first. Removing an added item drops it. Removing a found item hides it, so a later scan does not bring it back, and adding it again unhides it. A session holds at most 20 added items.
- **Where it is kept.** `links.json` in the state folder, `{ <session id>: { added: [url], hidden: [url] } }`, read on every request and read again and merged on every write, as `picks.json` is. `POST api/links` with `{ id, url, attached }` adds or removes one item, behind the same sign-in and same-origin check as the other writes. A group's or section's own session is refused, as other layout edits refuse it.
- **Reading issues.** `lib/pulls.mjs` reads an issue with one call, `gh issue view <url> --json state,stateReason,title`, through the same queue, cache and limits as a pull request. A pull request read also asks for `title`. `public/ui/pull-url.js` holds the issue address beside the pull request address, so the server and page share one test.
- **The answer.** `GET api/pulls` keeps its route and shape. Each item now carries `kind` (`pull` or `issue`) and `attached` (true when the owner added it). An added item that cannot be read still comes back, with state `unknown`, so the owner can see it and remove it. A found item that cannot be read is left out, as now. `GET api/sessions` carries `features.attachLinks`, and the page offers no add or remove without it.
- **Finding issues cheaply.** The transcript is read once in full, the newest 2 MB, and after that only the bytes added since, so a working session costs a short read per ask rather than a full one.
- **Header.** Under the folder and branch line, one badge per item: a pull request or issue glyph, `repo#n`, and a short status word. The badge links to the address, and its tooltip and accessible name carry the title, the full address and, for a pull request, the full sentence the card would show. A remove button sits in each badge, and a trailing add button opens an inline field for the address. Errors show as a toast, as a rename's do. No dialog.
- **Status words.** A pull request's word comes from the same `statusOf` that writes the card's sentence, so the two cannot disagree: Merged, Closed, Review asked, Ready to merge, Changes asked, Conflicts, Comments, Checks failing, Checks running, Approved, In review, Draft, or Open. An issue reads Open, Done (closed as completed) or Not planned. `unknown` reads Can't read. Tone and word carry the status together, never colour alone.
- **Sub sessions card.** The card's one line speaks of the first pull request in the list that waits on the owner, or else the first pull request. The session's other items show under it as the same badges without remove buttons. A session waits on the owner when any pull request in its list does, by the existing `needsOwner`. Issues never put a session in the owner's court.
- **Sidebar.** No change. A row already carries a title, a dot and a time, and asking `gh` for every row in the sidebar would cost calls for sessions the owner is not looking at.

### Consequences

- ✅ The owner sees every pull request and PBI of the open session, with live status, without leaving it.
- ✅ A session's own `gh pr create` and `gh issue create` attach their results with no step from him.
- ✅ An item he added stays visible even when `gh` cannot read it, so it never vanishes in silence.
- ✅ One reader, one cache and one address test serve pull requests and issues.
- ❌ An issue a session only mentions, or edits through the web, is not found. He adds it.
- ❌ More items per session mean more `gh` calls: one per issue and two per pull request every 2 minutes while a page asks.
- ❌ The sidebar shows nothing, so a session's status is visible only once it is open or under a parent's card.
- ❌ A hidden item stays in `links.json` after its session is archived. The file grows by a few bytes per session and is never pruned.

## Pros and Cons of the Options

### A list per session of found and added items, kept in `links.json`, shown as badges in the header and on the card

- ✅ Status in sight with no click, and the fix is beside it.
- ❌ The header gets busier, and on a phone the badges wrap onto more lines.

### A Links tab in the side panel, beside Sub sessions and Terminal

- ✅ Room for full addresses and the card's full sentence.
- ❌ The status is a click away, which is the trip the owner asked to stop making.

### Find everything in the transcript and offer no way to add or remove

- ✅ No new state and no write route.
- ❌ A wrong find cannot be corrected, and a PBI raised outside the session can never show.

## Links

- [Show pull request status on session cards, read from the gh CLI on the server](20261026-show-pull-request-status-on-session-cards.md), whose reader, cache, route and card this extends
- [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md), whose badge the header uses
