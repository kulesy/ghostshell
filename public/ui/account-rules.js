// What the Accounts pane and the banners about accounts say, as rules that need no page, so node can test them. Times are the page's own clock.
import { endWords, SOON } from './banner-rules.js';

export const supportsAccounts = ix => !!ix?.features?.accounts;

export const signInLine = a => (a.signedOut ? 'Signed out' : a.endsAt ? `Signed in until ${endWords(a.endsAt)}` : 'Signed in');

// A signed out account, or one whose sign-in ends within five days, gets a Sign in button.
export const needsSignIn = (a, now = Date.now()) => a.signedOut || (a.endsAt !== null && a.endsAt - now <= SOON);

export const planAsOf = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const sameAccountWords = (a, list) => {
  const other = list.accounts.find(x => x.id === a.sameAs);
  return other ? `This is the same Claude account as ${other.name}. The browser approved the sign-in page with the account it already had. Sign in again and approve it with a different account.` : '';
};

export const waitingWords = a => `Approve the sign-in page in the browser on the Mac, with the Claude account you want for ${a.name}.`;

// The sidebar banner for an active account that is out of usage and has another to go to, or null.
export function outBanner(accounts) {
  const out = accounts?.out;
  if (!out) return null;
  return {
    id: 'banner-out',
    tone: 'warning',
    title: `${out.name} is out of usage`,
    text: out.text,
    to: out.to,
    label: `Switch to ${out.to.name}`,
  };
}

// The notice that GhostShell switched by itself, or null.
export function autoBanner(accounts) {
  const auto = accounts?.auto;
  if (!auto?.from || !auto.to) return null;
  return {
    id: 'banner-auto',
    tone: null,
    title: `Switched to ${auto.to.name}`,
    text: `${auto.from.name} ran out of usage, so new messages now go to ${auto.to.name}.`,
  };
}

// The banner that Chrome's Claude extension is not on the account just switched to, or null while the check runs or when there is nothing to say.
// `on` is the account Chrome is on, when it is known.
export function chromeBanner(chrome) {
  if (!chrome?.state) return null;
  const { to, on, email, opened } = chrome;
  const elsewhere = chrome.state === 'elsewhere';
  const who = email || `the ${to.name} account`;
  return {
    id: 'banner-chrome',
    tone: elsewhere ? 'warning' : null,
    title: elsewhere ? `Chrome is still on ${on.name}` : `Check Chrome is on ${to.name}`,
    text: elsewhere
      ? `Chats on ${to.name} can't use Chrome until the Claude extension is on ${to.name} too.`
      : `Chrome may be closed, or on another account. Chats on ${to.name} reach Chrome only when the Claude extension is on ${to.name} too.`,
    steps: elsewhere ? ['Press Log out in the settings.', `Log in with ${who}, picking it on the sign-in page.`] : ['Open the settings. If Chrome was only closed, this banner clears.', `If it stays, press Log out, then log in with ${who}.`],
    warning: "Logging out deletes the extension's saved shortcuts and scheduled tasks.",
    label: 'Open in Chrome on the Mac',
    progress: opened ? `Opened on the Mac. This clears once Chrome is on ${to.name}.` : '',
  };
}
