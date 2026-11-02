// What the Accounts pane and the banners about accounts say, as rules that need no page, so node can test them. Times are the page's own clock.
import { endWords, SOON } from './banner-rules.js';

export const supportsAccounts = ix => !!ix?.features?.accounts;

export const signInLine = a => (a.signedOut ? 'Signed out' : a.endsAt ? `Signed in until ${endWords(a.endsAt)}` : 'Signed in');

// A signed out account, or one whose sign-in ends within five days, gets a Sign in button.
export const needsSignIn = (a, now = Date.now()) => a.signedOut || (a.endsAt !== null && a.endsAt - now <= SOON);

export const planAsOf = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// The account a chat that ran out of usage can move to: the first one that is signed in, not out and not the active one.
export const switchTarget = list => list?.accounts?.find(a => !a.active && !a.signedOut && !a.out) ?? null;

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
