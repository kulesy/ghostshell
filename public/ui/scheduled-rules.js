// What the Scheduled sessions page and Home's Scheduled section say and send, as rules that need no page, so node can test them. Times are the
// Mac's, as the server writes them, and the words for them are the Routines page's.
import { effortChoices, fireTime, modelChoices, retryWords } from './routine-rules.js';

// A server that cannot say has no scheduled sessions, so the page and the section stay out of sight.
export const supportsScheduled = ix => !!ix?.features?.scheduled;

// ---- where it lives ------------------------------------------------------------------------------

export const SCHEDULED_HASH = '#/scheduled';
export const NEW_SCHEDULED_HASH = '#/scheduled/new';

// `new` is the add form's address, so a session whose id is new is addressed by its escaped first letter.
export const scheduledHash = id => (id === 'new' ? '#/scheduled/%6Eew' : `${SCHEDULED_HASH}/${encodeURIComponent(id)}`);

// The routes of the page: the list, the add form (id null) and a session's form. Anything else under #/scheduled is the list.
export function scheduledRoute(hash) {
  if (hash === SCHEDULED_HASH) return { form: false, id: null };
  if (hash === NEW_SCHEDULED_HASH) return { form: true, id: null };
  if (!hash.startsWith(`${SCHEDULED_HASH}/`)) return null;
  try {
    const id = decodeURIComponent(hash.slice(SCHEDULED_HASH.length + 1));
    return /^[\w-]+$/.test(id) ? { form: true, id } : { form: false, id: null };
  } catch {
    return { form: false, id: null };
  }
}

// ---- the words -----------------------------------------------------------------------------------

// How long until a time, in a few words: "in 3 days", "in 5 h", "in 12 min", "in under a minute", or "due now" once it has passed.
export function untilWords(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor((at - now) / 60_000);
  if (at <= now) return 'due now';
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)} h`;
  const days = Math.floor(minutes / 1440);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

// What a row under its title says in Home: when a pending one starts, or why one that did not start is still here, with the tone to show
// it in. A queued retry says when the next try is, and a problem with the entry shows red.
export function noteOf(s, now = Date.now()) {
  if (s.status === 'skipped') return { text: s.lastError ? `Skipped: ${s.lastError}` : 'Skipped', tone: 'problem' };
  if (s.problem) return { text: s.problem, tone: 'problem' };
  if (s.retry) return { text: retryWords(s.retry, now), tone: 'warning' };
  return { text: `Starts ${fireTime(s.at, now)}`, tone: null };
}

// What the page says of an entry: the status, and when it starts in words with the date and time.
export function statusWords(s, now = Date.now()) {
  if (s.status === 'started') return 'Started';
  if (s.status === 'skipped') return 'Skipped';
  if (s.status === 'cancelled') return 'Cancelled';
  if (s.status !== 'pending') return 'Unknown status';
  return `Starts ${untilWords(s.at, now)}`;
}

// The sessions Home shows: those still to start, and those that were skipped, which stay with their reason until they are deleted. One that
// the server found a problem with stays too, such as a start that left no session. One that started is a session in the list now.
export const inSidebar = list => (list ?? []).filter(s => s.status === 'pending' || s.status === 'skipped' || !!s.problem);

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byTime = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || collator.compare(String(a.title ?? a.id ?? ''), String(b.title ?? b.id ?? ''));

// The page's order: what is still to start, soonest first, then the rest, latest first.
export const ordered = list => [...list.filter(s => s.status === 'pending').sort(byTime), ...list.filter(s => s.status !== 'pending').sort((a, b) => byTime(b, a))];

// Which menu items an entry in this state takes: only a pending one can start, change or be called off, and any can be deleted.
export const takes = s => ({ start: s.status === 'pending', edit: s.status === 'pending', cancel: s.status === 'pending' });

export const deleteDetail = s => (s.status === 'pending'
  ? 'It will not start.'
  : s.sessionId ? 'The session it started stays in the list.' : 'It is removed from this list.');

// ---- the form ------------------------------------------------------------------------------------

// The order the form shows its fields, so the first refused one is the one to focus.
export const FIELDS = ['title', 'at', 'cwd', 'model', 'effort', 'mode', 'group', 'prompt'];

const pad = n => String(n).padStart(2, '0');
const input = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A new session starts tomorrow at 09:00 until the owner picks a time.
export function newForm(home, now = Date.now()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return { title: '', at: input(d), cwd: home, model: '', effort: '', mode: '', group: '', prompt: '' };
}

// The date and time field takes the Mac's wall clock to the minute, as the server wrote it.
const atOf = iso => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso ?? '') ? iso.slice(0, 16) : '');

export const formOf = s => ({
  title: s.title ?? '', at: atOf(s.at), cwd: s.cwd ?? '', model: s.model ?? '', effort: s.effort ?? '', mode: s.mode ?? '', group: s.group ?? '', prompt: s.prompt ?? '',
});

const same = (a, b) => (a || null) === (b || null);

// What to send. A new session sends every field. An edit sends only what changed, so a folder that has since gone does not refuse a new
// title and a time that has passed is not checked again. `was` is the entry as loaded.
export function requestOf(form, was) {
  const all = { title: form.title.trim(), at: form.at, cwd: form.cwd.trim(), model: form.model || null, effort: form.effort || null, mode: form.mode || null, group: form.group || null, prompt: form.prompt };
  if (!was) return all;
  return {
    ...(all.title !== was.title && { title: all.title }),
    ...(all.at !== atOf(was.at) && { at: all.at }),
    ...(all.cwd !== was.cwd && { cwd: all.cwd }),
    ...(!same(all.model, was.model) && { model: all.model }),
    ...(!same(all.effort, was.effort) && { effort: all.effort }),
    ...(!same(all.mode, was.mode) && { mode: all.mode }),
    ...(!same(all.group, was.group) && { group: all.group }),
    ...(all.prompt.trim() !== (was.prompt ?? '').trim() && { prompt: all.prompt }),
  };
}

// The refused fields of a 400 in the form's order, and the first of them.
export function refusals(error) {
  const found = error?.data?.problems && typeof error.data.problems === 'object' ? error.data.problems : {};
  const fields = Object.fromEntries(FIELDS.filter(key => typeof found[key] === 'string' && found[key]).map(key => [key, found[key]]));
  return { fields, first: FIELDS.find(key => fields[key]) ?? null };
}

// The groups the form offers, none first. A group an entry names that has gone is kept as its own option, so the form does not quietly change it.
export function groupChoices(groups, current) {
  const options = [['', 'No group'], ...groups.map(g => [g.id, g.name])];
  if (current && !options.some(([id]) => id === current)) options.push([current, 'A group that has been deleted']);
  return options;
}

export { effortChoices, modelChoices };
