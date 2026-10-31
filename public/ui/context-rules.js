// What the context meter says about the figure the server sends, which needs no page. A figure is { source, total, window, autoCompactAt }.
// Its source is 'process' when Claude counted it, and a full count adds the parts that fill the window, or 'transcript' when it was read
// from Claude's last reply. The window is null where Capcom has not seen the model's.
import { grouped, thousands, windowSize } from './format.js';

export const hasFigure = c => (c?.source === 'process' || c?.source === 'transcript') && Number.isFinite(c.total);

// The ring, the bar and every line of words, from one figure. `fill` and `tick` are shares of the window from 0 to 100, or null with no window.
// The ring stands alone on the button. With no window there is no ring, so the button shows `text` and its `label` has to contain it.
export function readout(c) {
  const known = !!c.window;
  const fill = known ? Math.min(100, (c.total / c.window) * 100) : null;
  const tick = known && c.autoCompactAt ? Math.min(100, (c.autoCompactAt / c.window) * 100) : null;
  // Under half a percent rounds to 0%, which would read as empty.
  const pct = known ? (c.total > 0 && fill < 0.5 ? '<1%' : `${Math.round(fill)}%`) : null;
  // The meter turns amber nine tenths of the way to the point Claude compacts, or to the end of the window where it does not.
  const limit = c.autoCompactAt ?? c.window;
  const exact = known ? `${grouped(c.total)} of ${grouped(c.window)} tokens, ${pct} used` : `${grouped(c.total)} tokens`;
  const size = known ? `${thousands(c.total)} of ${windowSize(c.window)} tokens` : `${thousands(c.total)} tokens`;
  const tip = `Context: ${known ? `${size}, ${pct} used` : size}`;
  return {
    fill,
    tick,
    pct,
    text: known ? null : thousands(c.total),
    severity: limit && c.total >= limit * 0.9 ? 'warning' : null,
    size,
    exact,
    tip,
    label: known ? `Context: ${exact}` : tip,
    line: known ? `${pct} used · ${tick === null ? 'auto-compact off' : `auto-compact at ${Math.round(tick)}%`}` : null,
  };
}

const share = (tokens, window) => (window ? `${((tokens / window) * 100).toFixed(1)}%` : '');

// The rows of the table: what fills the window, and then the free space and the autocompact buffer, which are the rest of it.
export function parts(c) {
  const row = (key, p) => ({ key, name: p.name, size: thousands(p.tokens), share: share(p.tokens, c.window) });
  return {
    used: c.categories.map(p => row(p.id, p)),
    rest: [c.free, c.buffer].filter(Boolean).map(p => row(p.name, p)),
  };
}

const SAME = ['source', 'compacted', 'total', 'window', 'autoCompactAt', 'model', 'at', 'categories', 'buffer', 'free'];
const SAME_COUNT = ['total', 'window', 'autoCompactAt'];

// The figure to keep once a reply arrives. A summary of the same total in the same window, with the same auto-compact point, keeps the
// parts the last full count gave, so the table does not go back to loading. A full count that did not come from the process leaves the
// process figure as it was. A reply that is not a figure at all, such as an error page, changes nothing, and one that says what is held
// already returns that same object.
export function mergeContext(held, reply, detail) {
  if (typeof reply?.source !== 'string') return held;
  const counted = reply.source === 'process';
  if (!counted && detail === 'full' && held?.source === 'process') return held;
  const keeps = counted && detail !== 'full' && held?.source === 'process' && held.categories && SAME_COUNT.every(k => held[k] === reply[k]);
  const next = keeps ? { ...reply, categories: held.categories, buffer: held.buffer, free: held.free } : reply;
  return held && SAME.every(k => held[k] === next[k]) ? held : next;
}

// The rows are the server's, in its order: { kind, group, percent, resetsAt, scope, severity }. A row is told apart by its `kind`, never by a label.

const capital = s => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

export function planLabel(row) {
  if (row.kind === 'session') return 'Current session';
  if (row.kind === 'weekly_all') return 'Weekly · All models';
  return [row.kind === 'weekly_scoped' ? 'Weekly' : capital(row.group), row.scope].filter(Boolean).join(' · ');
}

// A reset under a day away counts down. A later one gives the weekday and the clock, in the page's zone unless one is given.
export function planReset(resetsAt, now, timeZone) {
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  if (at <= now) return 'Resets now';
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `Resets in ${[hours && `${hours} hr`, rest && `${rest} min`].filter(Boolean).join(' ')}`;
  }
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(at);
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(at).replace(/\s?([AP])M$/, (_, m) => ` ${m.toLowerCase()}m`);
  return `Resets ${day} ${clock}`;
}

export function planRows(rows, now = Date.now(), timeZone) {
  return (rows ?? []).map((row, n) => {
    const reset = row.resetsAt ? planReset(row.resetsAt, now, timeZone) : null;
    return {
      key: `${row.kind}-${row.scope ?? ''}-${n}`,
      label: planLabel(row),
      percent: row.percent,
      severity: row.severity === 'normal' ? null : row.severity,
      reset,
      text: `${row.percent}% used${reset ? `, ${reset.charAt(0).toLowerCase()}${reset.slice(1)}` : ''}`,
    };
  });
}
