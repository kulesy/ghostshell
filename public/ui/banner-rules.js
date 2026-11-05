// What the sidebar banners say and when they poll, as rules that need no page, so node can test them. Times are the page's own clock.

export const supportsBanners = ix => !!ix?.features?.banners;

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
export const LISTED = 5;
export const SOON = 5 * 86_400_000;

// "Fri 6 Nov, 09:36".
export function endWords(ms) {
  const d = new Date(ms);
  return `${SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Calendar days from today to the day of `ms`, in the page's zone.
export function daysLeft(ms, now = Date.now()) {
  const midnight = t => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((midnight(ms) - midnight(now)) / 86_400_000);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The sign-in banner for the server's `login`, or null when there is none to show. `action` is the one button, which is busy while
// the CLI waits on the Mac, since the approval cannot move to the phone.
export function loginBanner(login, now = Date.now()) {
  if (!login?.visible) return null;
  const waiting = login.stage === 'waiting';
  const view = {
    id: 'banner-login',
    action: { label: waiting ? 'Waiting for the Mac' : 'Sign in on the Mac', busy: waiting },
    progress: waiting ? 'Approve the sign-in page in the browser on the Mac.' : '',
    problem: login.stage === 'failed' ? login.problem : '',
  };
  // `account` is set once the server lists more than one, and then the words name the account.
  const { account } = login;
  if (login.signedOut) {
    return account
      ? { ...view, tone: 'warning', title: `${account} is signed out`, text: `Chats and routines on ${account} fail until you sign in again.` }
      : { ...view, tone: 'warning', title: 'Claude is signed out', text: 'Every chat and routine fails until you sign in again.' };
  }
  const days = daysLeft(login.endsAt, now);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return {
    ...view,
    tone: null,
    title: `${account ? `${account}'s` : "Claude's"} sign-in ends ${when}`,
    text: `It ends on ${endWords(login.endsAt)}. Chats and routines stop until you sign in again. Signing in now starts a fresh four weeks.`,
  };
}

// The update banner for the server's `update`, or null. `changes` is the first few pull requests and `more` how many are left out.
export function updateBanner(update) {
  if (!update?.show) return null;
  const pulled = update.kind === 'pulled';
  const stage = update.stage;
  const shown = (update.changes ?? []).slice(0, LISTED);
  const label = pulled ? 'Restart' : update.restart ? 'Update and restart' : 'Update';
  const progress = stage === 'updating' ? 'Updating.'
    : stage === 'restarting' ? (update.busy > 0 ? `Restarting once ${plural(update.busy, 'running chat', 'running chats')} ${update.busy === 1 ? 'finishes' : 'finish'}.` : 'Restarting now.')
      : update.blocked;
  return {
    id: 'banner-update',
    tone: null,
    title: pulled ? 'Pulled, waiting for a restart' : `${plural(update.count, 'merged change', 'merged changes')} ${update.count === 1 ? 'is' : 'are'} waiting`,
    text: pulled || update.restart ? `${pulled ? 'Restarting' : 'Updating restarts'} GhostShell once no chat is running.` : 'These change only the page, so updating needs no restart.',
    changes: shown,
    more: Math.max(0, update.count - shown.length),
    action: { label: stage === 'updating' ? 'Updating' : stage === 'restarting' ? 'Restarting' : label, busy: stage !== 'idle', blocked: stage === 'idle' && !!update.blocked },
    force: update.force ? { label: 'Force restart', variant: 'outline' } : null,
    progress,
    problem: update.problem ?? '',
  };
}

// What the Force restart question says under its title: what the restart will cut, and the two things a plain update would have waited for.
export function forceQuestion(update) {
  const cut = update.busy > 0 ? `${plural(update.busy, 'running chat', 'running chats')} will be cut.` : 'No chat is running, so none will be cut.';
  const pull = update.kind === 'update' ? ` The ${plural(update.count, 'merged change', 'merged changes')} will be pulled first.` : '';
  const quiet = update.blocked ? ' This goes ahead inside the quiet window, which holds restarts until 09:45 on weekdays.' : '';
  return `${cut}${pull}${quiet}`;
}

export const FAST_MS = 2000;
export const SLOW_MS = 15_000;

// Faster while a sign-in waits on the Mac, a restart is under way or the Chrome check runs, so the banner clears or appears soon.
export const pollMs = banners => (banners?.login?.stage === 'waiting' || ['updating', 'restarting'].includes(banners?.update?.stage) || banners?.chrome?.checking ? FAST_MS : SLOW_MS);

// The server is down for a moment while it restarts, so a failed read keeps the banner and says only that it is restarting.
export function keptWhileRestarting(banners) {
  return banners?.update?.stage === 'restarting' ? { ...banners, update: { ...banners.update, busy: 0, force: false } } : banners;
}
