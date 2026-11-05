// What the Accounts pane and the banners about accounts say, as rules that need no page, so node can test them. Times are the page's own clock.
import { endWords, SOON } from './banner-rules.js';
import { pinsOnStart } from './group-rules.js';
import { findRow } from './tree.js';

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

export const supportsPins = ix => !!ix?.features?.accountPins;

// A pick shows when the server pins and there is a choice to make, or when something is already pinned, so a single-account page is as it was.
export const offersPick = (ix, accounts, pinned) => supportsPins(ix) && (!!pinned || (accounts?.length ?? 0) > 1);

export const PICK_NOTE = 'Takes effect at the next start. A running turn keeps its account.';
export const CHROME_NOTE = 'Chrome works only on the account its extension is signed into.';

export const accountName = (accounts, id) => accounts?.find(a => a.id === id)?.name ?? '';

// The Account menu's items for something pinned to `pin` (an id, or none). `follows` says whom "Active account" runs as. `pick(id)` takes an id or null.
// A signed out account cannot be picked, but stays marked when it is the pin, and a pin to an account no longer listed shows as removed.
export function accountItems({ accounts, pin, follows, pick }) {
  const row = a => ({
    id: `account:${a.id}`,
    label: a.name,
    value: a.signedOut ? 'Signed out' : null,
    checked: a.id === pin,
    disabled: a.signedOut && a.id !== pin,
    run: a.id === pin ? undefined : () => pick(a.id),
  });
  return [
    { id: 'account:', label: 'Active account', value: follows || null, checked: !pin, run: pin ? () => pick(null) : undefined },
    ...(accounts ?? []).map(row),
    ...(pin && !accountName(accounts, pin) ? [{ id: `account:${pin}`, label: 'Removed account', checked: true }] : []),
    { separator: true },
    { note: PICK_NOTE },
    { note: CHROME_NOTE },
  ];
}

// The row of a chat in the index: a session wherever it sits, or a group's own chat, or null.
export const rowFor = (ix, id) => (id && ix ? findRow(ix, id) ?? (ix.groups ?? []).find(g => g.session?.id === id)?.session ?? null : null);

// The small label in a chat: the account it runs on, shown only when more than one is listed.
export const accountLabel = (accounts, id) => ((accounts?.length ?? 0) > 1 ? accountName(accounts, id) : '');

// The account a new session will run on, as /api/new works it out: its own pick, then the pin of the group it joins, then that group's project, then the active
// account. `group` counts only when the page sends it, which is for a group of the list and not for Pinned.
export function draftAccount({ ix, accounts, group, pick }) {
  if (pick) return { account: pick, from: 'session' };
  const held = group && !pinsOnStart(group) && supportsPins(ix) ? (ix.groups ?? []).find(g => g.id === group) : null;
  if (held?.account) return { account: held.account, from: 'group' };
  const project = held && (ix.projects ?? []).find(p => p.id === held.project)?.account;
  if (project) return { account: project, from: 'project' };
  return { account: accounts?.find(a => a.active)?.id ?? null, from: 'active' };
}

// Whom "Active account" runs as for a session row: nobody in particular when the session holds its own pin.
const rowFollows = (accounts, row) => (row.accountPin ? '' : accountName(accounts, row.account));

// What the composer shows for a chat: whether it offers the pick, the chat's own pin, the account it runs on (for the label), and whom "Active account" follows.
// `picked` is a draft's own pick and `group` the group it will start in. A group's own chat has a row for the label but no pick of its own.
export function chatAccount({ ix, accounts, draft, id, group, picked }) {
  if (draft) {
    const pin = picked ?? null;
    return {
      offered: !!accounts && offersPick(ix, accounts, !!pin),
      pin,
      shown: draftAccount({ ix, accounts, group, pick: pin }).account,
      follows: accountName(accounts, draftAccount({ ix, accounts, group, pick: null }).account),
    };
  }
  const row = findRow(ix, id);
  const pin = row?.accountPin ?? null;
  return { offered: !!accounts && !!row && offersPick(ix, accounts, !!pin), pin, shown: rowFor(ix, id)?.account ?? null, follows: row ? rowFollows(accounts, row) : '' };
}

// The Account item of a menu, or nothing when there is no choice to make or the accounts are not known yet. `follows` is for the first item's value.
export const accountMenu = ({ ix, accounts, pin, follows = '', pick, icon }) => (accounts && offersPick(ix, accounts, !!pin)
  ? [{ label: 'Account', ...(icon && { icon }), value: pin ? accountName(accounts, pin) || 'Removed' : null, items: accountItems({ accounts, pin, follows, pick }) }]
  : []);

// A session row's Account item, which follows nobody when the row holds its own pin.
export const rowAccountMenu = ({ ix, accounts, row, pick, icon }) => accountMenu({ ix, accounts, pin: row.accountPin, follows: accounts ? rowFollows(accounts, row) : '', pick, icon });

// The notice a chat shows: the refusal of a send while the list has not been read again since, otherwise what the chat's row says, and the status for a chat with no row.
export const blockedNow = ({ row, status, refused, fresh }) => (refused && fresh ? refused : row ? row.blocked ?? null : status?.blocked ?? null);

// What a blocked notice offers. `blocked` is the server's `{ reason, account, pin, message }`: `pin` names the session, group or project that holds the pin, and
// that is where it is cleared or changed. A routine's pin is edited in the routine form.
export function blockedPlan(blocked) {
  if (!blocked) return null;
  const at = blocked.pin && blocked.pin.kind !== 'routine' ? blocked.pin : null;
  return {
    message: blocked.message,
    signIn: blocked.reason === 'signed-out' ? blocked.account?.id : null,
    change: blocked.reason === 'signed-out' ? at : null,
    clear: blocked.reason === 'removed' ? at : null,
    routine: blocked.pin?.kind === 'routine' ? blocked.pin.id : null,
  };
}

// The options of the routine form's account select: Active account first, then each account. A signed out one cannot be picked unless it is the current
// value, and a value no account holds is kept as Removed account. Each is [value, text, disabled].
export function accountChoices(accounts, current) {
  const list = (accounts ?? []).map(a => [a.id, a.signedOut ? `${a.name} (signed out)` : a.name, !!a.signedOut && a.id !== current]);
  return [['', 'Active account', false], ...list, ...(current && !accountName(accounts, current) ? [[current, 'Removed account', false]] : [])];
}
