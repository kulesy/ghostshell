// The transcript as a list of display items. These are plain functions on plain data: items are never changed in
// place, so a row can tell by identity whether it needs to draw again.
import { isForm } from './ask-form-rules.js';
import { chromeTool, fullToolLabel, plural } from './format.js';
import { joinBash } from './terminal-rules.js';

let counter = 0;
const nextKey = () => `i${++counter}`;

function indexTools(list) {
  const at = new Map();
  list.forEach((i, n) => { if (i.kind === 'tool') at.set(i.id, n); });
  return at;
}

// A tool takes on what its result says. The pictures come across only when the result has some.
const settle = (tool, result) => ({ ...tool, status: result.status, output: result.output, ...(result.images && { images: result.images }) });

// Assistant text arrives one block per line, so consecutive blocks of one message are joined back up.
// A result whose tool sits in a chunk not loaded yet waits in `orphans` until that chunk arrives.
// NOTE: [18 Oct 2026] EK - A tool's pictures sit at the tool call's place, and a result whose call is not here yet adds none.
// listImages in lib/transcripts.mjs lists the viewer's earlier pictures in this order, so change the two together or its count drifts.
export function absorb({ items, orphans }, incoming) {
  const list = items.slice();
  const waiting = new Map(orphans);
  let toolAt = null;
  for (const item of incoming) {
    if (item.kind === 'result') {
      toolAt ||= indexTools(list);
      const at = toolAt.get(item.toolId);
      if (at !== undefined) list[at] = settle(list[at], item);
      // The results waiting on one id all go to one call, the last with that id before the loaded part, so they combine in order.
      else waiting.set(item.toolId, waiting.has(item.toolId) ? settle(waiting.get(item.toolId), item) : item);
      continue;
    }
    const last = list[list.length - 1];
    if (item.kind === 'assistant' && last?.kind === 'assistant' && last.msgId === item.msgId) {
      list[list.length - 1] = { ...last, text: `${last.text}\n\n${item.text}` };
      continue;
    }
    if (item.kind === 'tool') toolAt?.set(item.id, list.length);
    list.push({ ...item, key: nextKey() });
  }
  return { items: list, orphans: waiting };
}

// Older items go in front. The results still waiting come after them in the file, so they are absorbed after them and settle
// the last call with their id, as a read of the whole file does. A message cut in two by the chunk boundary is joined again.
export function prepend({ items, orphans }, incoming) {
  const { items: list, orphans: waiting } = absorb(absorb({ items: [], orphans: new Map() }, incoming), orphans.values());
  const seam = list[list.length - 1];
  if (seam?.kind === 'assistant' && items[0]?.kind === 'assistant' && items[0].msgId === seam.msgId) {
    list[list.length - 1] = { ...seam, text: `${seam.text}\n\n${items[0].text}` };
    return { items: [...list, ...items.slice(1)], orphans: waiting };
  }
  return { items: [...list, ...items], orphans: waiting };
}

// ---- grouped tool calls: Desktop's Normal view says what a run did instead of listing each call -----------

const EDITS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const KIND_OF = { Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', Bash: 'run', WebSearch: 'web', WebFetch: 'fetch', Agent: 'agent', Task: 'agent', Skill: 'skill', TodoWrite: 'todo', SendMessage: 'message', ListAgents: 'peers' };
const KINDS = {
  read: n => `read ${plural(n, 'file')}`,
  search: n => `searched ${plural(n, 'time')}`,
  run: n => `ran ${plural(n, 'command')}`,
  edit: n => `edited ${plural(n, 'file')}`,
  web: n => `searched the web ${plural(n, 'time')}`,
  fetch: n => `fetched ${plural(n, 'page')}`,
  agent: n => `started ${plural(n, 'agent')}`,
  skill: n => `used ${plural(n, 'skill')}`,
  todo: () => 'updated the to-do list',
  message: n => `sent ${plural(n, 'message')}`,
  peers: () => 'looked up other sessions',
  chrome: n => `used Chrome ${plural(n, 'time')}`,
  other: n => `used ${plural(n, 'tool')}`,
};
const DOING = { read: 'Reading', search: 'Searching', run: 'Running', edit: 'Editing', web: 'Searching the web', fetch: 'Fetching', agent: 'Running an agent', skill: 'Using a skill', todo: 'Updating the to-do list', message: 'Sending a message', peers: 'Looking up other sessions', chrome: 'Using Chrome', other: 'Using' };
const toolKind = name => (EDITS.includes(name) ? 'edit' : KIND_OF[name] || (chromeTool(name) !== null ? 'chrome' : 'other'));

// What Claude is doing, from the live snapshot: the tool being run with what it works on, else thinking or writing. A running group's title is made from it.
export function activity(work, names) {
  const tools = work?.tools || [];
  if (tools.length > 1) return { doing: `Running ${plural(tools.length, 'tool')}`, detail: [...new Set(tools.map(t => fullToolLabel(t.name, names)))].join(', ') };
  if (tools.length) {
    const [t] = tools;
    const kind = toolKind(t.name);
    return { doing: DOING[kind], detail: kind === 'other' ? [fullToolLabel(t.name, names), t.summary].filter(Boolean).join(': ') : t.summary };
  }
  return { doing: work?.thinking ? 'Thinking' : work?.writing ? 'Writing' : 'Working', detail: '' };
}

// The words for one tool on the status line. Kinds that read better with an object get one, so a file or a command is not named twice.
const OBJECT = { read: 'a file', run: 'a command', edit: 'a file', fetch: 'a page' };

// The phrase after the time and tokens on the status line: what Claude is doing, without the detail a row can carry.
export function doingNow(work, names) {
  const tools = work?.tools || [];
  if (tools.length > 1) return `Running ${plural(tools.length, 'tool')}`;
  if (!tools.length) return work?.thinking ? 'Thinking' : work?.writing ? 'Writing' : 'Working';
  const kind = toolKind(tools[0].name);
  return (kind === 'other' ? ['Using', fullToolLabel(tools[0].name, names)] : [DOING[kind], OBJECT[kind]]).filter(Boolean).join(' ');
}

// What a running group says it is doing: the call still waiting for its result, else the last call. A call with nothing to say about
// what it works on reads as the status line says it, so a bare verb never stands alone.
export function step(rows, names) {
  const tools = rows.filter(r => r.kind === 'tool');
  const tool = [...tools].reverse().find(t => t.status === 'pending') || tools[tools.length - 1];
  if (!tool) return '';
  const { doing, detail } = activity({ tools: [tool] }, names);
  return detail ? `${doing} ${detail}` : doingNow({ tools: [tool] }, names);
}

// When the group began, from its first row that has a time, or null when none has.
export function groupStart(rows) {
  for (const r of rows) {
    const at = Date.parse(r.at);
    if (!Number.isNaN(at)) return at;
  }
  return null;
}

const splitLines = text => (text ? text.replace(/\n$/, '').split('\n') : []);

// The unchanged head and tail are trimmed, so changing one line inside a long block counts as one line.
export function lineDelta(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [b.length - head - tail, a.length - head - tail];
}

// Write and NotebookEdit carry no old text, so they count as added lines only.
function linesChanged(t) {
  const i = t.input || {};
  if (t.name === 'Edit') return lineDelta(i.old_string, i.new_string);
  if (t.name === 'MultiEdit') return (i.edits || []).reduce(([add, del], e) => { const [a, d] = lineDelta(e.old_string, e.new_string); return [add + a, del + d]; }, [0, 0]);
  return [splitLines(t.name === 'Write' ? i.content : i.new_source).length, 0];
}

// What a run of tool calls and thoughts did: the sentence, the changed-line counts, and whether any call is running or failed.
export function summarize(rows) {
  const kinds = new Map();
  let thoughts = 0;
  let added = 0;
  let removed = 0;
  let edited = false;
  const tally = { pending: 0, failed: 0, denied: 0 };
  for (const t of rows) {
    if (t.kind === 'thinking') { thoughts++; continue; }
    const kind = toolKind(t.name);
    if (!kinds.has(kind)) kinds.set(kind, new Set());
    kinds.get(kind).add(kind === 'read' || kind === 'edit' ? t.input?.file_path || t.input?.notebook_path || t.id : t.id);
    if (t.status in tally) tally[t.status]++;
    if (kind === 'edit') {
      edited = true;
      if (t.status === 'pending' || t.status === 'ok') { const [a, d] = linesChanged(t); added += a; removed += d; }
    }
  }
  const phrase = [thoughts && 'thought', ...[...kinds].map(([kind, set]) => KINDS[kind](set.size))].filter(Boolean).join(', ');
  return {
    title: phrase[0].toUpperCase() + phrase.slice(1),
    edited,
    added,
    removed,
    note: tally.pending ? 'running' : [tally.failed && `${tally.failed} failed`, tally.denied && `${tally.denied} denied`].filter(Boolean).join(', '),
    status: tally.pending ? 'pending' : tally.failed || tally.denied ? 'failed' : 'ok',
  };
}

// Chips, chapters, widgets, forms and questions render as themselves and end a run; every other tool call joins it, and so does thinking.
// A form that failed or was denied has nothing to draw, so it joins the run like any other failed call.
export function groupable(i) {
  if (i.kind === 'thinking') return true;
  if (i.kind !== 'tool' || i.name === 'AskUserQuestion' || /__(spawn_task|dismiss_task|mark_chapter)$/.test(i.name)) return false;
  if (isForm(i)) return i.status === 'failed' || i.status === 'denied';
  return !(/__show_widget$/.test(i.name) && i.input?.widget_code);
}

// A run holding a tool call folds into one group row, with the thinking between the calls inside it.
// Thinking with no call beside it stays a row of its own.
export function display(items) {
  const out = [];
  let run = [];
  const close = () => {
    if (run.some(i => i.kind === 'tool')) out.push({ kind: 'group', rows: run, key: `g${run[0].key}` });
    else out.push(...run);
    run = [];
  };
  for (const i of joinBash(items)) {
    if (groupable(i)) run.push(i);
    else { close(); out.push(i); }
  }
  close();
  return out;
}
