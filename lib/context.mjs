// How full a chat's context window is, for the meter in the composer. A chat Capcom runs is counted by its own CLI. Any other
// chat is read from its transcript, where the last reply's usage is the size of the context at that point. Nothing here writes a transcript.
import fs from 'node:fs';
import path from 'node:path';
import { readRange } from './transcripts.mjs';

const count = n => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null);
const positive = n => count(n) || null;

// A full reply adds the parts that fill the window, largest first, and keeps the autocompact buffer and the free space apart.
// Parts the CLI loads on demand (kind deferred) are not in the window yet, so they are left out.
export function shapeUsage(raw, detail) {
  const total = count(raw?.totalTokens);
  if (total === null) return null;
  const figure = {
    total,
    window: positive(raw.maxTokens),
    autoCompactAt: raw.isAutoCompactEnabled === false ? null : positive(raw.autoCompactThreshold),
    model: typeof raw.model === 'string' ? raw.model : null,
  };
  if (detail !== 'full') return figure;
  const parts = (Array.isArray(raw.categories) ? raw.categories : [])
    .filter(c => c && typeof c.name === 'string' && count(c.tokens) !== null)
    .map(c => ({ id: typeof c.id === 'string' ? c.id : c.name, name: c.name, tokens: count(c.tokens), kind: c.kind }));
  const apart = kind => {
    const found = parts.find(c => c.kind === kind);
    return found ? { name: found.name, tokens: found.tokens } : null;
  };
  return {
    ...figure,
    categories: parts.filter(c => c.kind === 'used' && c.tokens > 0).map(({ id, name, tokens }) => ({ id, name, tokens })).sort((a, b) => b.tokens - a.tokens),
    buffer: apart('buffer'),
    free: apart('free'),
  };
}

const SEVERITIES = ['normal', 'warning', 'critical'];
const named = x => (typeof x?.display_name === 'string' && x.display_name.trim() ? x.display_name.trim() : null);

// The server's usage rows, kept in its order. A row without a kind, a group or a percent is dropped, and a reset that is not a date is no reset.
// Null when no row is usable, so the page hides the section.
export function shapePlan(rows) {
  const shaped = (Array.isArray(rows) ? rows : []).flatMap(r => {
    if (!r || typeof r.kind !== 'string' || !r.kind || typeof r.group !== 'string' || !r.group) return [];
    if (typeof r.percent !== 'number' || !Number.isFinite(r.percent)) return [];
    const resetsAt = typeof r.resets_at === 'string' && Number.isFinite(Date.parse(r.resets_at)) ? new Date(r.resets_at).toISOString() : null;
    const scope = [named(r.scope?.model), named(r.scope?.surface)].filter(Boolean).join(' · ') || null;
    return [{ kind: r.kind, group: r.group, percent: Math.min(100, Math.max(0, Math.round(r.percent))), resetsAt, scope, severity: SEVERITIES.includes(r.severity) ? r.severity : 'normal' }];
  });
  return shaped.length ? shaped : null;
}

const CHUNK = 128 * 1024;
const CHUNK_MAX = 8 * 1024 * 1024;
const REACH = 16 * 1024 * 1024;
const NEEDLES = ['"usage"', 'compact_boundary'].map(s => Buffer.from(s));

// Only a line that mentions a needle is parsed, so a tool result of several megabytes costs a search and not a parse.
function replyIn(line) {
  if (!NEEDLES.some(needle => line.includes(needle))) return null;
  let e = null;
  try { e = JSON.parse(line.toString('utf8')); } catch {}
  if (e?.type === 'system' && e.subtype === 'compact_boundary') return { compacted: true };
  const usage = e?.type === 'assistant' && !e.isSidechain && e.message?.model !== '<synthetic>' ? e.message?.usage : null;
  if (!usage || typeof usage.input_tokens !== 'number') return null;
  const total = (count(usage.input_tokens) ?? 0) + (count(usage.cache_creation_input_tokens) ?? 0) + (count(usage.cache_read_input_tokens) ?? 0);
  if (!total) return null;
  return { total, model: typeof e.message.model === 'string' ? e.message.model : null, at: typeof e.timestamp === 'string' ? e.timestamp : null };
}

const newlineBefore = (buf, at) => (at > 0 ? buf.lastIndexOf(0x0a, at - 1) : -1);

// The size of the context at Claude's last reply, which is its input plus both cache counts and not its output. It is read from the end
// of the transcript. A compaction after that reply gives { compacted: true }, and null means the last 16 MB hold neither.
// NOTE: [22 Oct 2026] EK - The usage fields and the compact_boundary entry belong to the CLI's transcript, which is not a published
// contract; checked on CLI 2.1.307. If they move, a chat that Capcom is not running shows no meter.
export function lastReply(file, { chunk = CHUNK, reach = REACH } = {}) {
  const size = fs.statSync(file).size;
  const floor = Math.max(0, size - reach);
  let end = size;
  let held = Buffer.alloc(0);
  while (end > floor) {
    const start = Math.max(floor, end - chunk);
    const buf = Buffer.concat([readRange(file, start, end), held]);
    let top = buf.length;
    for (let nl = newlineBefore(buf, top); nl !== -1; nl = newlineBefore(buf, top)) {
      const found = replyIn(buf.subarray(nl + 1, top));
      if (found) return found;
      top = nl;
    }
    if (start === 0) return replyIn(buf.subarray(0, top));
    held = buf.subarray(0, top);
    end = start;
    chunk = Math.min(chunk * 4, CHUNK_MAX);
  }
  return null;
}

const windowOf = value => {
  const size = positive(value?.window);
  return size ? { window: size, autoCompactAt: positive(value.autoCompactAt) } : null;
};

// The window and auto-compact point each model was last seen with, so a chat that Capcom is not running can still say how full it is.
// NOTE: [22 Oct 2026] EK - A window is learned only under a model the chat was explicitly set to, [1m] included, from a count that
// came back while the chat was still on it. A key is never answered from its [1m] or plain twin, which have different windows.
export function makeWindows(stateDir, { warn = console.error } = {}) {
  const file = path.join(stateDir, 'windows.json');
  const known = new Map();
  try {
    for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')) ?? {})) {
      const seen = windowOf(value);
      if (seen) known.set(key, seen);
    }
  } catch {}

  return {
    get: key => (key ? known.get(key) ?? null : null),
    learn(key, figure) {
      const seen = key && windowOf(figure);
      const was = known.get(key);
      if (!seen || (was?.window === seen.window && was.autoCompactAt === seen.autoCompactAt)) return;
      known.set(key, seen);
      try {
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(Object.fromEntries(known), null, 2)}\n`);
        fs.renameSync(temp, file);
      } catch (e) {
        warn(`Could not save the context windows: ${e.message}`);
      }
    },
  };
}

// What the page gets for a chat with no process: the last reply's total, with the window only while it can still be right.
export function transcriptFigure(found, seen) {
  const fits = !!seen && found.total <= seen.window;
  return { source: 'transcript', total: found.total, model: found.model, at: found.at, window: fits ? seen.window : null, autoCompactAt: fits ? seen.autoCompactAt : null };
}
