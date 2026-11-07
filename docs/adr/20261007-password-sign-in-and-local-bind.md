# Protect Capcom with a password, a local-only bind and a private network

- Status: Accepted, amended 2026-10-15, 2026-10-16 and 2026-11-07
- Deciders: Eli
- Date: 2026-10-07
- Tags: security, authentication, network, sub-path

## Context and Problem Statement

Anyone who signs in to Capcom can run commands on the Mac as the owner. Session transcripts can also hold tokens and other secrets. On 7 Oct the owner weighed three hardening steps: a separate address for Capcom, a second password prompt for Bypass, and a shorter sign-in.

Should Capcom add any of them before use?

## Decision Drivers

- Signing in is equivalent to a shell, so the password has to hold.
- Only the owner's own devices should reach Capcom.
- The owner wants to use Capcom from a phone.

## Considered Options

1. A password, a local bind and a private network, with no further hardening
2. Option 1 plus a separate address for Capcom
3. Option 1 plus a second password prompt for Bypass
4. Option 1 plus a shorter sign-in

## Decision Outcome

Chosen option: "A password, a local bind and a private network, with no further hardening", because only the owner's own devices can reach Capcom.

- Capcom stores the password only as a scrypt hash in the state folder (`lib/auth.mjs`).
- A browser that signs in gets a random token in a cookie that is `HttpOnly` and `SameSite=Lax`, good for 90 days after the browser last used Capcom and never past a year after it signed in.
- Ten wrong guesses within 15 minutes lock sign-in until the oldest of them is 15 minutes old.
- Capcom binds to 127.0.0.1. A reverse proxy or a private network the owner trusts carries phone access.
- It works under a sub-path such as `/chat`. The page uses relative URLs, a script in `index.html` adds the trailing slash, the proxy strips the prefix, and the cookie sets no `Path`, so it stays scoped to the sub-path.

**Amended 2026-10-15.** The owner's other local apps share Capcom's host name under other paths, and the owner kept that for clean addresses. A browser treats them as one site, so the same-origin check on writes and `SameSite` do not stop a script bug in one of them from acting through Capcom with the owner's cookie. The one neighbour that shows text from an outside service escapes it before display, checked in its code on 2026-10-15, so the risk is low. A separate port or host name would remove it.

**Amended 2026-10-16.** The owner asked for a sign-in that lasts, so it now runs for 90 days from the browser's last use and never past a year from the sign-in, where it used to run 30 days from signing in. Using a token pushes its expiry 90 days out, or to a year after it was made if that comes first, written at most once a day. The year is a cap because a token that was used often enough would otherwise never end. The page asks `renew` once a day, and the cookie is sent again with a `Max-Age` equal to the time the token has left. A reply that sets the cookie has to sit directly under the mount (`login`, `passkey-login`, `renew` and `logout`), never under `api/`, because the browser takes the cookie's path from the request that set it. Each token records when it was made, when it was last used and a device label from the User-Agent, and a token file in the old `{ token: expiry }` shape reads in without signing anyone out, keeps the end each token had, and follows the new limits from its first use, with its year counted from 30 days before that end. The cookie gets `Secure` when the request came over https. Capcom believes `X-Forwarded-Proto` for that only from a loopback peer, which a proxy on this Mac is, so a client that reaches Capcom directly cannot ask for a cookie that its own http page would then refuse to send back. Capcom listens on 127.0.0.1 only, so every peer passes that test today and it matters only if the bind ever widens. The same-origin check on writes takes its scheme from the same header and compares the whole origin, so a page on http cannot write to the https address or the reverse, and a proxy that ends https has to send the header or every write gets a 403. The cookie is `SameSite=Lax`. Strict made Chrome 155 withhold it from a navigation that another site started (a link click, a redirect or a script), so a signed-in browser that followed a link showed the sign-in page. Lax sends it on that navigation and still withholds it from a form or script request from another site. That is safe only while every GET stays read-only, apart from the caller's own sign-in renewal, and every write stays a POST behind the same-origin check, and `lib/auth.mjs` and `server.mjs` carry a note saying so. Passkeys are a second way in, see [Sign in with passkeys](20261016-passkeys-on-node-crypto.md). A new password signs every browser out and removes every passkey, because a stolen cookie can register one.

**Amended 2026-11-07.** The native Swift app signs in through the same `login` route and gets the same token with the same limits. It is not a browser, so `HttpOnly`, `Secure`, `SameSite` and the cookie's scope don't protect it. The app keeps the token in the Keychain, writes the `Cookie` header itself, refuses redirects, allows plain http only on loopback and sends `Origin` on every write. The server's sign-in code did not change. See [Replace the page with a native Swift app](20261107-native-swift-app-keeps-the-node-server.md).

### Consequences

- ✅ Only a device on the private network can reach Capcom, and sign-in still needs the password.
- ❌ A browser or app that has signed in stays signed in for 90 days after its last use, and for up to a year after it signed in, so a lost device keeps its access for that time or until the owner sets a new password, which signs every browser out and removes every passkey.
- ❌ Lax sends the cookie on a link from another website, so a GET that changed something would be open to a link on any page the owner visits. Every GET has to stay read-only and every write a POST behind the same-origin check.
- ❌ A proxy that ends https has to send `X-Forwarded-Proto: https` and the original `Host`, or every write, sign-in included, gets a 403.
- ❌ One wrong-guess count covers all clients, so a stranger's guesses can lock the owner out for up to 15 minutes.
- ❌ The shared host name leaves the neighbour risk above.

## Pros and Cons of the Options

### No further hardening

- ✅ Nothing extra to build or use
- ❌ Leans on the private network and the password alone

### A separate address

- ✅ Removes the neighbour risk
- ❌ Gives up the clean shared address

### A second prompt for Bypass

- ✅ Guards the mode that runs commands without asking
- ❌ More friction on the phone

### A shorter sign-in

- ✅ Limits how long a lost device stays signed in
- ❌ More frequent sign-ins

## Links

- [Public repository under MIT](20261013-public-repo-under-mit.md)
- [No dependencies, no build step](20261007-no-dependencies-no-build-step.md)
