# Remind the owner to move Chrome's extension after an account switch

- Status: Accepted
- Deciders: Eli
- Date: 2026-11-04
- Tags: accounts, chrome, banners

Technical Story: follows [Keep two Claude accounts signed in and switch GhostShell between them](20261102-switch-claude-accounts.md).

## Context and Problem Statement

The Claude in Chrome extension is signed in to one claude.ai account at a time, and a session reaches only the browsers signed in to its own account. Switching accounts in GhostShell leaves Chrome behind, and chats on the new account find no browser with nothing to say why. A second Chrome profile is ruled out, because one profile holds all the owner's sign-ins. How does GhostShell tell the owner, and how few steps can the move take?

## Decision Drivers

- GhostShell never signs the extension in and never handles a credential. The owner does the logout and the login.
- Logging out of the extension deletes its saved shortcuts and scheduled tasks, so the owner must read that before pressing.
- A wrong "Chrome is fine" costs more than a needless reminder.
- A page read runs no CLI work, as for the other banners.

## Considered Options

1. Ask the CLI which browsers each account reaches, and open the extension's settings through its own link.
2. Show the same reminder on every switch, with no check.
3. Read the extension's storage in Chrome's profile to learn its account.

## Decision Outcome

Chosen option: 1, with option 2's wording as its fallback, because it stays quiet when Chrome is already right and says something useful when it cannot tell.

### The check

`claude --claude-in-chrome-mcp` is the CLI's stdio MCP server. It finds its own sign-in from `CLAUDE_CONFIG_DIR`, so GhostShell starts it with the account's folder, calls `list_connected_browsers` once and kills it. That takes about 2 seconds, runs no model turn and keeps only a yes or no: no device name or id. A signed-out folder answers in plain text after 10 seconds, so the limit is 15 seconds, and anything that is not a list counts as no answer.

An empty list alone means little, because Chrome may be closed or its extension asleep. Comparing accounts gives the answer, so every switch (by hand, from a chat, or automatic) checks every account at once:

| The new account | Another account | Banner |
| --- | --- | --- |
| Sees a browser on this Mac | Any | None |
| Does not | Sees one | Warning that names the account Chrome is on |
| Does not | Does not, or no answer | Softer reminder to check Chrome |

The check says which GhostShell account reaches the browser. It does not read which account the extension holds. A browser counts when `onThisComputer` is true, or `isLocal` when that field is missing, and `isLocal` only says the operating system matches.

While a banner stands, the server checks the new account again every 15 seconds, for 10 minutes from the switch or the last press of the Open button, and clears the banner once it sees a browser. After that the banner stays until it is dismissed or the next switch. All of this is in memory, so a restart forgets it. An owner whose shared `.claude.json` shows no sign of Claude in Chrome gets no check and no banner.

### Opening the settings

The extension catches `https://clau.de/chrome/permissions`, opens its own options page and closes the tab. The CLI's `/chrome` uses the same link. A web page cannot link to a `chrome-extension://` address, so this link is the only route. POST `api/accounts/chrome-open` runs `open -a "Google Chrome"` with it on the Mac, so a press from the phone or Safari still lands in Chrome. Log out sits in that page's left column. The login page after a logout offers an account picker, and the banner names the account to pick by its email.

When `open` fails, the banner refuses with the steps in words. If the link moves, or Chrome's last used profile has no extension, the press lands on claude.ai and the banner's steps still hold.

### The banner

It uses the same `Banner` as the sign-in and restart banners, and the logout warning is in both forms. The sidebar shows it everywhere except the Accounts page. There the pane shows it instead, because a phone hides the sidebar on that page and the switch happens there.

The named form sends the owner to Log out. The unsure form asks them to open the settings first, because Chrome may only be closed, and a needless logout would cost the shortcuts and scheduled tasks.

### Consequences

- ✅ Most switches take one press, a logout and a login, and the banner clears by itself.
- ✅ No token, email or device name passes through the check.
- ❌ `--claude-in-chrome-mcp` and the link are both private to the CLI and the extension. If the flag moves, every check gives no answer and the softer reminder shows on every switch.
- ❌ Two organizations under one user have not been tried. The extension's connection is keyed by user, so a mismatch of organization alone may read as fine.
- ❌ Each check while the banner stands starts a CLI process.

## Pros and Cons of the Options

### Show the same reminder on every switch

- ✅ No undocumented flag.
- ❌ It nags when Chrome is already right, and the owner learns to dismiss it.

### Read the extension's storage

- ✅ It would name the exact account.
- ❌ That storage holds the extension's tokens, and GhostShell must never touch one.

## Links

- Builds on [Keep two Claude accounts signed in and switch GhostShell between them](20261102-switch-claude-accounts.md)
- Builds on [Show banners in the sidebar for Claude's sign-in ending and for merged changes waiting](20261102-banners-for-sign-in-and-updates.md)
- Builds on [Turn Claude in Chrome on by default in every chat and mode, as Desktop does](20261015-claude-in-chrome-on-by-default.md)
- [Use Claude Code with Chrome](https://code.claude.com/docs/en/chrome)
