# Show pull request status on session cards, read from the gh CLI on the server

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-26
- Tags: sessions, sub-sessions, pull-requests, github, gh, side-panel, caching

## Context and Problem Statement

A session often ends with a pull request. The owner runs many sessions at once, and a card on the Sub sessions tab says what a session last said, not what became of its pull request. To learn that a review was asked of him, a check failed or a pull request is ready to merge, he opens GitHub for each one.

He asked for the live status of the pull requests a session works on to show on its card, and for a session whose pull request waits on him to count as waiting on him. Where does the status come from, who asks GitHub, how often, and what counts as waiting on the owner?

## Decision Drivers

- GitHub credentials stay on the Mac. GhostShell must not store a token of its own.
- The page cannot call GitHub, and a phone or a second browser must see the same answer as the desktop.
- Many sessions open at once must not become a burst of GitHub calls or of processes on the Mac.
- A session names its pull requests in prose, so what it names is untrusted text. It must never reach a shell, and only a real `github.com/<owner>/<repo>/pull/<n>` address may be asked about or linked.
- The header button, the pill and the sections must count a waiting pull request the way they count any other wait, so no second rule appears.
- The page keeps working against a server without the change, and nothing in the repo may name the owner's repos or logins.
- No new dependency and no build step.

## Considered Options

1. Run the `gh` CLI on the server, cache its answers, and have the page ask the server
2. Store a GitHub token in GhostShell and call the API from the server
3. Have the page call GitHub itself
4. Take status from webhooks or GitHub notifications

## Decision Outcome

Chosen option: "Run the `gh` CLI on the server, cache its answers, and have the page ask the server", because `gh` is already signed in on the Mac, so GhostShell holds no secret, and one server cache serves every device.

- **Finding the pull requests.** `lib/pulls.mjs` reads a session's transcript, newest message first, and takes the addresses it names, up to 5. An assistant or user message counts for every address in it. A tool result counts only when its last line is one bare address and it holds no other, as `gh pr create` prints, so a listing of pull requests does not make the session claim them all. An address counts only when it matches `https://github.com/<owner>/<repo>/pull/<n>` exactly. The same test guards the page, which never links to anything else.
- **Asking `gh`.** Two calls for each pull request: `gh pr view` for its state, review, checks and mergeability, and `gh api graphql` for its unresolved review threads. One more call, `gh api user`, finds the viewer's login, so the page can tell the owner's pull requests from a review asked of him. Every call is a fixed argument list with the address as one argument, never a shell string.
- **Caching and limits.** An answer is kept 2 minutes, a failed read 1 minute, and the login 1 hour. At most 4 `gh` processes run at once, and a read of one pull request (2 or 3 calls) waits only while fewer than 40 others do. While a pull request is read again, the card keeps its last answer. A pull request that is out for answer is asked once, however many sessions name it.
- **Route.** `GET api/pulls?ids=a,b,c` is behind the same sign-in as the other routes and answers `{ pulls: { <id>: Pull[] }, settling }`. It waits at most 8 seconds. If reads are still out, it answers what it has with `settling: true`. `GET api/sessions` carries `features.pullStatus`, and the page treats a list without it as a server that cannot say.
- **Page.** `public/ui/pulls.js` asks for the live sessions the header button counts, the 120 most recent at most, in batches of 60, only while the page is in sight. It asks again for a session whose answer is missing, was read at another stamp, is older than 60 seconds, or came back `settling` (after 4 seconds). A failed request keeps what the page has. The header button mounts this once, so its mark is right with the panel closed.
- **Card.** Each pull request shows as up to 3 facts, most urgent first, and its full address as a link: Needs your review, Changes requested, Has conflicts, Has N unresolved comments, Checks failing, Checks running, Ready to merge, Approved, Waiting for review, Open, Draft, Merged, Closed. A merged or closed pull request shows that alone. Tone and wording carry the status, never colour alone. A session with several pull requests lists the most urgent first.
- **What waits on the owner.** A pull request puts its session in the owner's court when a review is asked of him, or it is his and ready to merge, or it is his with changes requested, conflicts, unresolved comments or failing checks while the session is idle. A working session is on its own failing checks and comments, so those do not count while it works. `withPulls` in `public/ui/sub-panel-rules.js` gives such a session the awaiting mark in the page's copy of its row. The pill, the sections, the summary line, the header button and its mark, and a folded family all count it with no new rule. Nothing outside the page changes: the `list_sub_sessions` and `read_sub_session` tools, the sidebar's marks and the group header count by state alone and do not see a pull request.

### Consequences

- ✅ GhostShell stores no token, and `gh` keeps the sign-in it already has.
- ✅ One cache serves every device, and a tab opened again within 2 minutes costs no `gh` call.
- ✅ Ten pull requests cost 20 `gh` calls and 1 login call, never more than 4 at once.
- ✅ The owner sees from the header that a review waits on him, with no trip to GitHub.
- ✅ A server without the change shows the tab as it was.
- ❌ Status is up to 2 minutes old on the server and up to 60 seconds more on the page.
- ❌ A pull request a session does not name in its transcript is not found, and one it names by a different address form is not either.
- ❌ The tools, the sidebar and the group header do not count a waiting pull request, so a count in the header button can differ from the sidebar's.
- ❌ Ten pull requests read every 2 minutes is 600 GitHub calls an hour. GitHub's documented limit of 5,000 an hour for GraphQL was not checked against the owner's account, and the `pr view` calls count against it too.
- ❌ A machine with no `gh`, or one signed out, shows no status, and a card says nothing of why.
- ❌ Checked with a fake `gh` in tests, plus one real public pull request through the real `gh` (a merged one, 3 calls). Not checked on a private repo, on a review asked of a team, on a real phone or in Safari.

## Pros and Cons of the Options

### Run the `gh` CLI on the server, cache its answers, and have the page ask the server

- ✅ No secret in GhostShell, and the sign-in is the owner's own.
- ✅ One cache and one concurrency limit for every device.
- ❌ It needs `gh` installed and signed in, and a process starts for each call.

### Store a GitHub token in GhostShell and call the API from the server

- ✅ No process to start, and one call can read many pull requests.
- ❌ GhostShell would hold a long-lived secret, which it holds nowhere else.
- ❌ It needs a way to enter, rotate and revoke the token.

### Have the page call GitHub itself

- ✅ No server work.
- ❌ The page has no token and must not be given one.
- ❌ Every device would ask GitHub on its own and share no cache.

### Take status from webhooks or GitHub notifications

- ✅ Changes arrive when they happen, with no polling.
- ❌ A Mac behind a tailnet has no address GitHub can reach, and notifications do not say which session a pull request belongs to.

## Links

- [Roll a session's sub session status up to every parent, from the transcripts, with no model calls](20261023-roll-sub-session-status-up.md), whose cards, pill, counts and header button this extends
- [Give each group a session of its own, with the group's status drawn above its chat](20261023-a-session-for-each-group.md), whose chat shows the same cards
