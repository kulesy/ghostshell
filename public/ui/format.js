// Small text helpers with no DOM and no imports, so lib/transcripts.mjs shares them with the page.
// The caller passes the home folder where one is needed.

export const tilde = (path, home) => (home ? String(path).replace(home, '~') : String(path));

export function folderName(cwd, home) {
  cwd = cwd || '';
  const wt = cwd.match(/\/([^/]+)\/\.claude\/worktrees\/[^/]+/);
  if (wt) return wt[1];
  if (cwd === home) return '';
  return tilde(cwd, home).split('/').filter(Boolean).slice(-2).join('/');
}

const clock = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// A day before today in words: Yesterday, a weekday within the last six days, else the date.
function pastDay(d, today, date = { day: 'numeric', month: 'short' }) {
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (today - d < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], date);
}

export function when(ms) {
  const t = typeof ms === 'number' ? ms : Date.parse(ms);
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} min`;
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? clock(d) : pastDay(d, today);
}

// When a message was sent, as a clock time with the day added once it is not today. A message stays on screen, so unlike `when` this
// holds no "5 min" that goes stale. It reads the page's own clock and only the day can change, which `useToday` draws again for.
export function sentAt(at, now = Date.now()) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return clock(d);
  const date = d.getFullYear() === today.getFullYear() ? undefined : { day: 'numeric', month: 'short', year: 'numeric' };
  return `${pastDay(d, today, date)}, ${clock(d)}`;
}

// How long until the next local midnight, from the calendar rather than 24 hours, because a day that changes the clocks is not 24 hours long.
export function untilMidnight(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) - d;
}

export const STATE_LABEL = { working: 'working', waiting: 'needs you', active: 'active', idle: '' };

// What a row's mark says in words where the row already says its state. A running mark keeps the state label.
export const DOT_LABEL = { awaiting: 'Needs input', error: 'Failed', ready: 'Unread' };

export function modelLabel(m = '') {
  const long = /\[1m\]$/i.test(m) ? ' (1M)' : '';
  const named = m.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/i);
  if (named) return `${named[1][0].toUpperCase()}${named[1].slice(1)} ${named[2]}${named[3] ? `.${named[3]}` : ''}${long}`;
  const alias = m.match(/^(opus|sonnet|haiku|fable)(\[1m\])?$/i);
  if (alias) return `${alias[1][0].toUpperCase()}${alias[1].slice(1)}${long}`;
  return m;
}

export const settingsLine = s => [modelLabel(s?.shownModel || s?.model || ''), s?.effort && `${s.effort} effort`].filter(Boolean).join(', ');

export const toolLabel = name => (chromeTool(name) ?? name.replace(/^mcp__.+__/, '')).replace(/_/g, ' ');

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CONNECTOR = 'connector';
// claude-in-chrome is the CLI's id for the Chrome extension's server, and Claude_in_Chrome the one some older Desktop chats used.
// It is matched from the front, as lib/runner.mjs and the CLI's ask rule match it, so a Chrome tool whose name holds __ stays Chrome's.
const CHROME = /^mcp__claude[-_]in[-_]chrome__/i;
// Split at the last __, because a server's name can hold one, as in mcp__PowerPoint__By_Anthropic___add_slide.
const serverId = name => /^mcp__(.+)__/.exec(name)?.[1] ?? '';
// `names` is a session's connectors as the server sends them, UUID to name. Only an own entry counts.
const connectorName = (id, names) => (names && Object.hasOwn(names, id) ? names[id] : '');

// A Chrome tool's own name within its server, such as 'navigate', or null for any other tool or a name that is not a string.
export function chromeTool(name) {
  const server = typeof name === 'string' ? CHROME.exec(name) : null;
  return server ? name.slice(server[0].length) : null;
}

// The MCP server a tool comes from as the page names it, or '' for a built-in tool or Capcom's own. Desktop names a claude.ai
// connector by a UUID, which `names` resolves, else "connector". The CLI starts its name with claude_ai_, Desktop's apps with ccd_.
export function serverLabel(name, names) {
  if (chromeTool(name) !== null) return 'Chrome';
  const id = serverId(name);
  if (/^ccd_/.test(id)) return 'Desktop';
  if (id === 'capcom') return '';
  if (UUID.test(id)) return connectorName(id, names) || CONNECTOR;
  return id.replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ').trim();
}

// Where a tool's output came from, worded for a sentence: its server, else the built-in tool itself.
export function toolSource(name, names) {
  const id = serverId(name);
  if (UUID.test(id)) return connectorName(id, names) || `a ${CONNECTOR}`;
  return serverLabel(name) || toolLabel(name);
}

export const fullToolLabel = (name, names) => [serverLabel(name, names), toolLabel(name)].filter(Boolean).join(' ');

// Text is shown as an HTML parser would show it: CR and CRLF become LF, and one LF right after <pre> is dropped.
export const lf = text => String(text ?? '').replace(/\r\n?/g, '\n');
export const pre = text => lf(text).replace(/^\n/, '');

export const clip = (text, lines = 40) => {
  const all = lf(text).split('\n');
  return all.length > lines ? `${all.slice(0, lines).join('\n')}\n... ${all.length - lines} more lines` : all.join('\n');
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// A timer waits this long past the whole second, so one that fires on time reads the new second and not the one just gone.
const TICK_SLACK_MS = 5;

// How long until the time since `since` next reaches a whole second, which is when `duration(now - since)` can change. It is never zero,
// so a clock is drawn each second even before a start that has not come yet, and clocks counting from one start change together.
export function tickIn(now, since) {
  const elapsed = now - since;
  return (Math.floor(elapsed / 1000) + 1) * 1000 - elapsed + TICK_SLACK_MS;
}

export function tokenCount(n) {
  if (n < 1000) return String(n);
  return n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(n / 1000)}k`;
}

// The context meter's tokens, always in thousands to one decimal: 14300 is 14.3k and 500 is 0.5k.
export const thousands = n => `${(n / 1000).toFixed(1)}k`;

// A window is a round figure, so it drops a zero decimal: 300000 is 300k and 1000000 is 1M.
export function windowSize(n) {
  const tenths = Math.round(n / 100);
  return tenths >= 10_000 ? `${+(tenths / 10_000).toFixed(1)}M` : `${tenths / 10}k`;
}

export const grouped = n => n.toLocaleString('en-US');

// A file's size in the unit that keeps it short: 1 byte, 900 bytes, 1.5 KB, 12 KB, 3.4 MB.
export function fileSize(n) {
  if (n < 1024) return plural(n, 'byte');
  const kb = n / 1024;
  if (Math.round(kb) < 1024) return `${+kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${+mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export const preview = text => String(text).replace(/[*`]+/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 160);

const HOLD_CAUSES = {
  'mode-mismatch': 'The sender and this chat are in different kinds of permission mode (one bypasses permission prompts and the other asks).',
  'no-mode-asserted': 'The sender did not say which permission mode it is in, and this chat bypasses permission prompts.',
  'bypass-default': 'This chat is not prompting for permissions, and the CLI holds messages from other sessions by default in that case.',
  'mode-unknown': 'The CLI could not tell which permission mode this chat is in.',
  'explicit-setting': 'Your Claude Code setting "crossSessionInbound" is "hold".',
  'managed-setting': `Your organization's managed settings set "crossSessionInbound" to "hold".`,
  'repo-setting': `This project's settings set "crossSessionInbound" to "hold".`,
  'invalid-setting': 'A Claude Code settings file has a "crossSessionInbound" value the CLI does not recognise, so it holds every message.',
};
const HOLD_ENDS = {
  expired: 'Nobody approved in time, so none of it reached Claude.',
  refused: 'The CLI began refusing messages from other sessions before anyone approved.',
  dropped: 'Let through by the CLI, then discarded (a rate limit, a repeat or a full queue).',
  discarded: 'This chat ended before anyone approved.',
};

// Why the CLI holds a message from another session, and how a hold ends without the message arriving.
export const holdCause = cause => (Object.hasOwn(HOLD_CAUSES, cause) ? HOLD_CAUSES[cause] : 'The CLI gave a reason GhostShell does not know.');
export const holdEnd = outcome => (Object.hasOwn(HOLD_ENDS, outcome) ? HOLD_ENDS[outcome] : 'The CLI ended the hold without delivering.');

// One group per sender and reason, placed by its newest message; the newest `shown` are returned, and `hidden` counts the messages in the rest.
export function groupHolds(list, whyOf, shown) {
  const by = new Map();
  for (const h of list) {
    const key = `${h.from}\n${whyOf(h)}`;
    const ids = [...(by.get(key)?.ids || []), h.id];
    by.delete(key);
    by.set(key, { key, from: h.from, why: whyOf(h), ids });
  }
  const groups = [...by.values()].slice(-shown);
  return { groups, hidden: list.length - groups.reduce((n, g) => n + g.ids.length, 0) };
}
