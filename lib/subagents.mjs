// The helpers a session started with the Agent tool, read from the folder the CLI writes beside its transcript: one jsonl and one
// meta file for each. A file can be 30 MB, so only its head (when it began) and its tail (where it stands) are read, and a file whose
// size and time have not moved costs a stat. The live stream ignores a helper's own messages, which is why the folder is read.
import fs from 'node:fs';
import path from 'node:path';
import { completeEnd, readRange, textOf } from './transcripts.mjs';
import { linesBack, STALE_MS } from './outside.mjs';
import { actionOf, howOf, orderAgents, replyOf, stateOf, stepsOf } from './subagent-rules.mjs';

const AGENT_FILE = /^agent-([\w-]+)\.jsonl$/;
const HEAD_FIRST = 64 * 1024;
const HEAD_MAX = 512 * 1024;
const TAIL_CHUNK = 256 * 1024;
const TAIL_MAX = 8 * 1024 * 1024;
const LISTED = 50;
export const STEPS = 40;
export const REPLY_CHARS = 4000;

const real = model => (typeof model === 'string' && model && model !== 'inherit' && model !== '<synthetic>' ? model : '');
const firstLine = text => String(text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '';
const parse = text => { try { return JSON.parse(text); } catch { return null; } };

// When the agent began, the model of its first reply, its folder and the start of its prompt, from the first lines. The window widens
// only while something is missing, and a prompt longer than the cap leaves a field empty.
function readHead(f) {
  const found = { startedAt: null, model: '', cwd: '', prompt: '' };
  for (let size = HEAD_FIRST; ; size *= 2) {
    const upto = Math.min(f.size, size, HEAD_MAX);
    for (const line of readRange(f.file, 0, upto).toString('utf8').split('\n')) {
      const e = parse(line);
      if (!e) continue;
      const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
      if (found.startedAt === null && !Number.isNaN(at)) found.startedAt = at;
      if (!found.cwd && typeof e.cwd === 'string') found.cwd = e.cwd;
      if (e.type === 'assistant' && !found.model) found.model = real(e.message?.model);
      if (e.type === 'user' && !found.prompt && e.message) found.prompt = firstLine(textOf(e.message.content));
    }
    if (found.startedAt !== null && found.model) return found;
    if (upto >= HEAD_MAX) return found;
    if (upto >= f.size) return found.startedAt === null ? null : found;
  }
}

// Reads back from the last finished line and stops once `want` steps are in. A half-written last line waits for the next read.
// `last` is how the newest entry that says anything leaves the agent.
function readTail(f, cwd, want) {
  const out = { last: null, steps: [], model: '', reply: '' };
  const end = completeEnd({ file: f.file }, TAIL_MAX);
  for (const line of linesBack(f.file, end, Math.max(0, end - TAIL_MAX), TAIL_CHUNK)) {
    const e = parse(line.toString('utf8'));
    if (!e) continue;
    const how = howOf(e);
    if (how) out.last ??= how;
    if (e.type === 'assistant') {
      out.model ||= real(e.message?.model);
      out.reply ||= replyOf(e);
      out.steps.unshift(...stepsOf(e, cwd));
    }
    if (out.last && out.steps.length >= want) break;
  }
  out.steps = out.steps.slice(-want);
  return out;
}

export function createSubagents({ now = Date.now, staleMs = STALE_MS, keep = 512, limit = LISTED } = {}) {
  const seen = new Map();

  // Reads re-add the file, so the first in the map is the one read longest ago.
  function remember(file, entry) {
    seen.delete(file);
    seen.set(file, entry);
    while (seen.size > keep) seen.delete(seen.keys().next().value);
  }

  function filesOf(t) {
    const dir = path.join(path.dirname(t.file), t.id, 'subagents');
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const found = [];
    for (const name of names) {
      const id = AGENT_FILE.exec(name)?.[1];
      if (!id) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        if (st.isFile()) found.push({ id, file: path.join(dir, name), meta: path.join(dir, `agent-${id}.meta.json`), size: st.size, mtime: st.mtimeMs, born: st.birthtimeMs });
      } catch {}
    }
    return found.sort((a, b) => b.mtime - a.mtime);
  }

  const metaOf = f => {
    let st = null;
    try { st = fs.statSync(f.meta); } catch {}
    return { stamp: st ? `${st.mtimeMs}:${st.size}` : '', read: () => {
      const meta = st ? parse(fs.readFileSync(f.meta, 'utf8')) : null;
      return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    } };
  };

  // What a file says, kept until its size, time or meta file changes. The state is worked out from it on each read, since it depends on the clock.
  function factsOf(f) {
    const known = seen.get(f.file);
    const meta = metaOf(f);
    if (known && known.size === f.size && known.mtime === f.mtime && known.stamp === meta.stamp) {
      remember(f.file, known);
      return known;
    }
    const head = known?.head ?? readHead(f);
    let tail = { last: null, steps: [], model: '' };
    if (f.size > 0) tail = readTail(f, head?.cwd ?? '', 1);
    const entry = { size: f.size, mtime: f.mtime, stamp: meta.stamp, meta: meta.read(), head, tail };
    remember(f.file, entry);
    return entry;
  }

  function describe(f, { meta, head, tail }) {
    const state = stateOf({ finished: meta.finished === true, how: tail.last?.how, quiet: now() - f.mtime >= staleMs });
    return {
      id: f.id,
      type: typeof meta.agentType === 'string' ? meta.agentType : '',
      description: typeof meta.description === 'string' && meta.description ? meta.description : head?.prompt ?? '',
      model: real(meta.model) || head?.model || tail.model,
      state,
      startedAt: head?.startedAt ?? Math.round(f.born),
      endedAt: state === 'running' ? null : tail.last?.at ?? Math.round(f.mtime),
      action: actionOf(tail.steps.at(-1)),
    };
  }

  // A helper of a helper has a parent, and is left out of the list.
  const nested = facts => typeof facts.meta.parentAgentId === 'string';

  // The newest helpers of the chat, running ones first. Nothing is read of a chat with no folder beyond the one failed look.
  function read(t) {
    if (!t?.file || !t.id) return [];
    const out = [];
    let looked = 0;
    for (const f of filesOf(t)) {
      if (out.length >= limit || looked >= limit * 4) break;
      looked++;
      try {
        const facts = factsOf(f);
        if (!nested(facts)) out.push(describe(f, facts));
      } catch {}
    }
    return orderAgents(out);
  }

  // The last steps of one helper and its reply, or null when the folder has no such helper. The id has to be one the folder lists, so
  // no path of the caller's is ever opened.
  function detail(t, agentId) {
    if (!t?.file || !t.id || typeof agentId !== 'string') return null;
    const f = filesOf(t).find(x => x.id === agentId);
    if (!f) return null;
    try {
      const facts = factsOf(f);
      const item = describe(f, facts);
      const tail = f.size > 0 ? readTail(f, facts.head?.cwd ?? '', STEPS) : { steps: [], reply: '' };
      const reply = item.state === 'done' || item.state === 'failed' ? tail.reply.slice(0, REPLY_CHARS) : '';
      return { ...item, steps: tail.steps, reply };
    } catch { return null; }
  }

  return { read, detail };
}
