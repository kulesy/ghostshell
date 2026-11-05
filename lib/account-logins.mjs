// What GhostShell knows about each Claude account at run time: its sign-in, who it is, when it ran out of usage and its last plan usage, and the rules for
// moving to another. The parts that touch the machine are passed in so a test can use fakes. See docs/adr/20261102-switch-claude-accounts.md.
import { makeLogin } from './login.mjs';

export const OUT_MS = 60 * 60_000;
export const INFO_MS = 10 * 60_000;
export const RESTARTING = 'GhostShell is about to restart, so sign in once it is back.';
export const SIGN_IN_WAITING = 'Another sign-in is waiting on the Mac.';

const brief = a => a && { id: a.id, name: a.name };

export function makeAccountLogins({ accounts, authInfo, readLoginEnd, startSignIn, retireOtherAccounts, inUse = () => [], afterSwitch = () => {}, restarting = () => false, now = Date.now }) {
  const book = new Map();
  let switched = null;

  function entryOf(account) {
    let e = book.get(account.id);
    if (e) return e;
    const extra = () => accounts.loginEnvOf(accounts.find(account.id));
    e = { info: null, infoAt: -Infinity, out: null, plan: null, checked: false };
    // The CLI's answer also gives the email and plan. orgId is kept only to tell that two accounts are the same one. infoAt moves on a failed check too, so it is not retried at once.
    e.ask = async () => {
      const got = await authInfo({ extra: extra() });
      e.infoAt = now();
      if (got) e.info = got.loggedIn ? { email: got.email, planType: got.subscriptionType, orgId: got.orgId } : null;
      return got ? got.loggedIn : null;
    };
    e.login = makeLogin({ readEnd: () => readLoginEnd({ service: accounts.serviceOf(accounts.find(account.id)) }), authStatus: e.ask, startSignIn: () => startSignIn({ extra: extra() }), now });
    book.set(account.id, e);
    return e;
  }
  const eachEntry = () => accounts.list().map(account => ({ account, e: entryOf(account) }));
  const activeEntry = () => entryOf(accounts.active);
  const signedOut = ({ e }) => e.login.state().signedOut;
  const signInWaiting = () => eachEntry().some(({ e }) => e.login.state().stage === 'waiting');

  // A mark counts for an hour, since no turn runs on an account after a switch away from it to clear the mark.
  const outOf = e => (e.out && now() - e.out.at < OUT_MS ? e.out : null);
  const sameAs = (x, y) => x.account.id !== y.account.id && !signedOut(x) && !signedOut(y) && !!x.e.info?.orgId && !!x.e.info.email
    && y.e.info?.orgId === x.e.info.orgId && y.e.info.email === x.e.info.email;
  // Signed in as far as a first check can tell, and not out of usage.
  const usable = x => x.e.checked && !signedOut(x) && !outOf(x.e);
  // Another account of the same Claude account as the active one would give the same spent limit.
  const spareAccount = () => {
    const list = eachEntry();
    const active = list.find(x => x.account.id === accounts.active.id);
    return list.find(x => x !== active && usable(x) && !sameAs(x, active))?.account ?? null;
  };

  // Moves new processes to another account, and stops the idle chats that are on the old one. The rest stop as they go idle.
  function switchTo(account) {
    accounts.prepare(account);
    accounts.setActive(account.id);
    retireOtherAccounts();
    afterSwitch(account);
  }

  // With the setting on, the first out-of-usage mark on the active account switches to another signed-in account that is not out. A mark counts for an hour,
  // so two spent accounts switch at most once an hour each, and nothing is resent.
  function autoSwitch(from) {
    const to = spareAccount();
    if (!accounts.autoSwitch || !to || accounts.active.id !== from) return;
    switchTo(to);
    switched = { from, to: to.id, at: now() };
  }

  async function refresh(account) {
    const e = entryOf(account);
    try {
      await e.login.refresh();
      if (now() - e.infoAt > INFO_MS) await e.ask();
    } finally {
      e.checked = true;
    }
  }

  return {
    refresh,
    refreshAll: () => Promise.all(accounts.list().map(refresh)).catch(() => {}),
    authFailed(id) {
      const account = accounts.find(id);
      if (account) entryOf(account).login.authFailed().catch(() => {});
    },
    stopAll: () => eachEntry().forEach(({ e }) => e.login.stop()),
    state: account => entryOf(account).login.state(),
    // Whether a first check has finished. Until then an account counts as signed in.
    checked: account => entryOf(account).checked,
    waiting: signInWaiting,
    spareAccount,
    switchTo,
    // The CLI ended a turn on this account out of usage, with its words, or cleanly (no text).
    markUsage(id, text) {
      const account = accounts.find(id);
      if (!account) return;
      entryOf(account).out = text ? { text, at: now() } : null;
      if (text) autoSwitch(id);
    },
    keepPlan(id, plan) {
      const account = accounts.find(id);
      if (account) entryOf(account).plan = plan;
    },
    seen() { switched = null; },
    // The reason no sign-in can start, or an empty string. One runs at a time across all accounts, and one that is waiting may be pressed again.
    blocked(account = null) {
      if (restarting()) return RESTARTING;
      return signInWaiting() && !(account && entryOf(account).login.state().stage === 'waiting') ? SIGN_IN_WAITING : '';
    },
    // Refuses with the reason, or starts the sign-in.
    signIn(account) {
      const why = this.blocked(account);
      if (why) return why;
      accounts.prepare(account);
      entryOf(account).login.signIn();
      return '';
    },
    banner() {
      const spare = spareAccount();
      const out = outOf(activeEntry());
      return { count: accounts.list().length, out: out && spare ? { ...out, name: accounts.active.name, to: brief(spare) } : null, auto: switched && { at: switched.at, from: brief(accounts.find(switched.from)), to: brief(accounts.find(switched.to)) } };
    },
    // The sign-in banner covers the active account and each account in use (`inUse` gives their ids). One shows at a time: a sign-in waiting on the Mac, then a signed out
    // account, then the one ending soonest, the active account winning a tie. With none to show it answers the active account's state. It names the account once there is more than one.
    loginNow() {
      const used = [...new Set([accounts.active.id, ...inUse()])].map(id => accounts.find(id)).filter(Boolean).map(account => ({ account, state: entryOf(account).login.state() }));
      const rank = ({ state }) => (state.stage === 'waiting' ? 0 : state.signedOut ? 1 : 2);
      const end = ({ state }) => state.endsAt ?? Number.MAX_SAFE_INTEGER;
      const { account, state } = used.filter(x => x.state.visible).sort((x, y) => rank(x) - rank(y) || end(x) - end(y))[0] ?? used[0];
      return { ...state, ...(accounts.list().length > 1 && { account: account.name, accountId: account.id }) };
    },
    // Each account as the Accounts page shows it, from what was last worked out. The email and plan come from the CLI's own answer, asked on the timer.
    view: () => {
      const list = eachEntry();
      return list.map(x => {
        const { visible, ...login } = x.e.login.state();
        return {
          id: x.account.id, name: x.account.name, ...login,
          email: x.e.info?.email ?? null, planType: x.e.info?.planType ?? null,
          sameAs: list.find(y => sameAs(x, y))?.account.id ?? null,
          out: outOf(x.e), plan: x.e.plan,
        };
      });
    },
  };
}
