// Claude Code saves every session, whoever started it, as one JSON line per event in
// <projectsDir>/<folder slug>/<session id>.jsonl. This module finds those files and turns byte ranges of
// them into display items, so a 100 MB session opens by reading only its tail.
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_TYPES } from './images.mjs';
import { bashFrom, capText, metaNotice, noticeFrom } from './notices.mjs';
import { fileItems, leadingMentions } from './uploads.mjs';
import { chromeTool } from '../public/ui/format.js';
import { titleText } from '../public/ui/quote-rules.js';

const files = new Map();
const heads = new Map();
let indexedAt = 0;

export function indexTranscripts(projectsDir, maxAgeMs = 4000) {
  if (Date.now() - indexedAt < maxAgeMs) return files;
  const seen = new Set();
  for (const dir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = path.join(projectsDir, dir.name);
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -6);
      try {
        const st = fs.statSync(path.join(folder, name));
        files.set(id, { id, file: path.join(folder, name), size: st.size, mtime: st.mtimeMs });
        seen.add(id);
      } catch {}
    }
  }
  for (const id of files.keys()) if (!seen.has(id)) files.delete(id);
  indexedAt = Date.now();
  return files;
}

export const transcriptFor = id => files.get(id) || null;

export function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, end - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  } finally { fs.closeSync(fd); }
}

// What a message of files alone is called, as a new session started with them is.
const fileTitle = files => (files?.length > 1 ? 'Files' : files?.[0]?.name || '');

// The first lines carry the folder, branch and opening prompt, which is all a session row needs.
// `uploads` is Capcom's uploads folder, so a first message of files alone is titled by the names the owner gave them.
export function readHead(t, uploads) {
  const known = heads.get(t.file);
  if (known) return known;
  const text = readRange(t.file, 0, Math.min(t.size, 64 * 1024)).toString('utf8');
  const head = { cwd: '', branch: '', title: '', routine: null };
  for (const line of text.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e) continue;
    if (!head.cwd && e.cwd) head.cwd = e.cwd;
    if (!head.branch && e.gitBranch && e.gitBranch !== 'HEAD') head.branch = e.gitBranch;
    if (e.type === 'custom-title' && e.customTitle) head.title = e.customTitle;
    if (!head.title && e.type === 'user' && !e.isMeta && !e.isSidechain) {
      const item = userItems(textOf(e.message?.content), undefined, uploads).find(i => i.kind !== 'bash');
      if (item?.kind === 'routine') { head.routine = item.name; head.title = item.name; }
      else if (item && item.kind !== 'system') head.title = (titleText(item.text || '') || fileTitle(item.files)).slice(0, 120);
    }
    if (head.cwd && head.title) break;
  }
  if (head.title) heads.set(t.file, head);
  return head;
}

// ---- turning lines into display items ----------------------------------------------------------

const stripReminders = s => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

const unwrapPasted = s => s.replace(/<\/?pasted_content(?:\s[^>]*)?>/g, '').trim();

export const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '');

// `uploads` is Capcom's uploads folder, where a mentioned file is one of its own. A message's leading mentions leave its text and
// become `files`, so a list row's title never reads @"/Users/...".
function userItem(raw, limit, uploads) {
  const text = unwrapPasted(stripReminders(raw));
  if (!text) return null;
  const notice = noticeFrom(text, limit);
  if (notice) return notice;
  const routine = text.match(/^<scheduled-task name="([^"]+)"/);
  if (routine) return { kind: 'routine', name: routine[1] };
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    if (cmd[1] === '/model' && args.trim()) return { kind: 'model', model: args.trim(), text: `/model ${args.trim()}` };
    return { kind: 'user', text: `${cmd[1].startsWith('/') ? '' : '/'}${cmd[1]} ${args}`.trim() };
  }
  if (/^<(local-command-stdout|local-command-stderr|command-message)>/.test(text)) return null;
  if (/^\[Request interrupted by user[^\]]*\]$/.test(text)) return { kind: 'divider', text: 'Stopped' };
  const { paths, text: typed } = leadingMentions(text);
  return { kind: 'user', text: typed, ...(paths.length && { files: fileItems(paths, uploads) }) };
}

// The items one user turn shows. Commands run with ! come first, each with its output, and the text after them is a message as usual:
// a result held for the next message arrives that way.
function userItems(raw, limit, uploads) {
  const shell = bashFrom(unwrapPasted(stripReminders(raw)), limit);
  if (!shell) {
    const item = userItem(raw, limit, uploads);
    return item ? [item] : [];
  }
  const rest = shell.rest && userItem(shell.rest, limit, uploads);
  return rest ? [...shell.items, rest] : shell.items;
}

const relative = (p, cwd) => (cwd && typeof p === 'string' && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p);

function chromeSummary(tool, input) {
  if (tool === 'navigate') return input.url || '';
  if (tool === 'computer') return [input.action, input.text, Array.isArray(input.coordinate) && `at ${input.coordinate.join(',')}`].filter(Boolean).join(' ');
  if (tool === 'javascript_tool') return String(input.text || '').split('\n')[0];
  if (tool === 'find') return input.query || '';
  if (tool === 'form_input') return `${input.ref || ''} = ${input.value ?? ''}`;
  return '';
}

export function toolSummary(name, input, cwd = '') {
  input ??= {};
  const first = Object.values(input).find(v => typeof v === 'string') || '';
  const chrome = chromeTool(name);
  if (chrome !== null) return chromeSummary(chrome, input) || String(first).replace(/\s+/g, ' ');
  if (/__(spawn_task|mark_chapter)$/.test(name || '')) return input.title || '';
  if (/__show_widget$/.test(name || '')) return input.title || '';
  if (name === 'mcp__capcom__start_group_session') return input.title || input.cwd || '';
  if (name === 'mcp__capcom__send_session') return [input.session_id && `to ${input.session_id}`, input.message].filter(Boolean).join(': ').replace(/\s+/g, ' ');
  switch (name) {
    case 'AskUserQuestion': return input.questions?.[0]?.question || '';
    case 'Bash': return input.command || '';
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return relative(input.file_path || input.notebook_path || '', cwd);
    case 'Grep': return `${input.pattern || ''}${input.path ? `  in ${relative(input.path, cwd)}` : ''}`;
    case 'Glob': return input.pattern || '';
    case 'WebFetch': return input.url || '';
    case 'WebSearch': return input.query || '';
    case 'Agent': case 'Task': return input.description || '';
    case 'Skill': return input.skill || '';
    case 'SendMessage': return [input.to && `to ${input.to}`, input.summary || input.message].filter(Boolean).join(': ').replace(/\s+/g, ' ');
    case 'ListAgents': return 'other sessions';
    case 'TodoWrite': return `${(input.todos || []).length} items`;
    default: return String(first).replace(/\s+/g, ' ');
  }
}

// An image the page can draw: base64 data in one of the four types Capcom accepts.
const isImage = b => b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string' && IMAGE_TYPES.includes(b.source.media_type);

// The text of a tool result. An image the page can draw is listed on the item instead, so only one it cannot draw leaves a mark.
function resultText(content, limit) {
  const parts = typeof content === 'string' ? [content] : (Array.isArray(content) ? content : []).flatMap(b => (b?.type === 'text' ? [b.text] : b?.type === 'image' ? (isImage(b) ? [] : ['[image]']) : ['']));
  return capText(parts.join('\n'), limit);
}

const imageBlocks = content => (Array.isArray(content) ? content.filter(b => b?.type === 'image') : []);

const DENIED = /doesn't want to proceed|was rejected|denied this|permission to use .* has been denied/i;

// NOTE: [16 Oct 2026] EK - A background task that ends mid-turn is saved as a queued_command with commandMode
// task-notification, not as a user entry (checked on CLI 2.1.301). Without it the result never shows.
const isQueuedPrompt = e => e.type === 'attachment' && e.attachment?.type === 'queued_command' && ['prompt', 'task-notification'].includes(e.attachment.commandMode);

// The content blocks of a message the user sent, as a typed message or as one queued while Claude was mid-turn.
function sentBlocks(e) {
  const c = e.type === 'user' ? e.message?.content : isQueuedPrompt(e) ? e.attachment.prompt : null;
  return Array.isArray(c) ? c : [];
}

const uuidOf = e => String(e.uuid || '').replace(/[^\w-]/g, '');

// A message the user sent as content blocks. Each image the page can draw becomes a ref on the item: the line's byte
// offset, the image's place among the message's images, and the entry's uuid, so a rewritten file never serves the wrong one.
function sentItem(blocks, e, at, offset, limit, uploads) {
  const texts = [];
  const images = [];
  for (const b of blocks) {
    if (b?.type === 'text') texts.push(b.text);
    else if (b?.type === 'image') {
      if (isImage(b)) images.push({ ref: `${offset}.${images.length}.${uuidOf(e)}`, type: b.source.media_type });
      else texts.push('[image]');
    }
  }
  const items = userItems(texts.join('\n'), limit, uploads);
  if (!items.length && images.length) items.push({ kind: 'user', text: '' });
  return items.map(item => ({ ...item, ...(item.kind === 'user' && images.length && { images }), at }));
}

// NOTE: [16 Oct 2026] EK - A message from another session is a meta user entry whose `origin` has kind peer, and the CLI's
// report on a message this session sent is a meta entry that starts with [Cross-session delivery notice]. One that arrives
// mid-turn is a queued_command attachment whose prompt is the bare <cross-session-message> tag (checked on CLI 2.1.301 and 2.1.302).
function metaItems(e, origin, text, limit) {
  const item = metaNotice(origin, text, limit);
  return item ? [{ ...item, at: e.timestamp || null }] : [];
}

export function itemsFromEntry(e, cwd, limit, offset, uploads) {
  if (e.isSidechain) return [];
  if (e.isMeta || e.origin?.kind === 'peer') return e.type === 'user' ? metaItems(e, e.origin, textOf(e.message?.content), limit) : [];
  if (e.isCompactSummary) return [{ kind: 'divider', text: 'Earlier conversation was summarised to save space' }];
  if (e.type === 'system' && e.subtype === 'compact_boundary') return [{ kind: 'divider', text: 'Conversation compacted' }];
  const at = e.timestamp || null;
  // NOTE: [14 Oct 2026] EK - A message sent while Claude is mid-turn is saved as a queued_command attachment, not a
  // user entry (checked on CLI 2.1.299). Without this the redirect never shows in the transcript.
  if (isQueuedPrompt(e)) {
    // NOTE: [17 Oct 2026] EK - A queued_command keeps isMeta and origin inside the attachment, and the CLI's delivery report
    // arrives this way too (checked on CLI 2.1.299 and 2.1.302). Read as a prompt, it would show as something the owner typed.
    const { isMeta, origin, prompt } = e.attachment;
    if (isMeta || origin?.kind === 'peer') return metaItems(e, origin, textOf(prompt), limit);
    if (typeof prompt === 'string') return userItems(prompt, limit, uploads).map(item => ({ ...item, at }));
    // With images the prompt is a list of content blocks, not a string (seen on CLI 2.1.300).
    return sentItem(sentBlocks(e), e, at, offset, limit, uploads);
  }
  if (e.type === 'user') {
    const c = e.message?.content;
    if (typeof c === 'string') return userItems(c, limit, uploads).map(item => ({ ...item, at }));
    const out = [];
    const sent = [];
    // Every image block of every result on the line takes a number, drawable or not, as readImage counts them.
    let counted = 0;
    for (const b of Array.isArray(c) ? c : []) {
      if (b?.type === 'tool_result') {
        const output = resultText(b.content, limit);
        const images = [];
        for (const img of imageBlocks(b.content)) {
          const n = counted++;
          if (isImage(img)) images.push({ ref: `${offset}.r${n}.${uuidOf(e)}`, type: img.source.media_type });
        }
        out.push({ kind: 'result', toolId: b.tool_use_id, status: b.is_error ? (DENIED.test(output) ? 'denied' : 'failed') : 'ok', output, ...(images.length && { images }) });
      } else sent.push(b);
    }
    out.unshift(...sentItem(sent, e, at, offset, limit, uploads));
    return out;
  }
  if (e.type === 'assistant') {
    const msgId = e.message?.id || e.uuid;
    const content = e.message?.content;
    return (Array.isArray(content) ? content : []).flatMap(b => {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) return [{ kind: 'assistant', msgId, text: b.text, at }];
      if (b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) return [{ kind: 'thinking', msgId, text: capText(b.thinking, limit), at }];
      // NOTE: [18 Oct 2026] EK - Send '' for a name that is not a string, here and in lib/work.mjs. The page's toolLabel throws on one.
      if (b?.type === 'tool_use') return [{ kind: 'tool', id: b.id, name: typeof b.name === 'string' ? b.name : '', summary: toolSummary(b.name, b.input, cwd), input: b.input, status: 'pending', at }];
      return [];
    });
  }
  return [];
}

// `base` is where `buf` starts in the file, so an item can say which line it came from.
function parseLines(buf, base, cwd, limit, uploads) {
  const items = [];
  for (let from = 0; from < buf.length;) {
    const nl = buf.indexOf(0x0a, from);
    const to = nl === -1 ? buf.length : nl;
    let e = null;
    try { if (to > from) e = JSON.parse(buf.toString('utf8', from, to)); } catch {}
    if (e) items.push(...itemsFromEntry(e, cwd, limit, base + from, uploads));
    from = to + 1;
  }
  return items;
}

// Items from the chunk that ends at `end`, starting on a line boundary. A line longer than the chunk grows it by reading the bytes before it,
// none twice, and never back past `floor`: a line that reaches `floor` with no start gives no items and says it starts at `floor`.
export function readBefore(t, end, chunk, cwd, limit, uploads, floor = 0) {
  const parts = [];
  let start = end;
  for (;;) {
    const from = Math.max(floor, start - chunk);
    parts.unshift(readRange(t.file, from, start));
    start = from;
    if (start === 0) return { items: parseLines(Buffer.concat(parts), 0, cwd, limit, uploads), start: 0, end };
    const nl = parts[0].indexOf(0x0a);
    if (nl !== -1 && (parts.length > 1 || nl < parts[0].length - 1)) {
      return { items: parseLines(Buffer.concat(parts).subarray(nl + 1), start + nl + 1, cwd, limit, uploads), start: start + nl + 1, end };
    }
    if (start === floor) return { items: [], start, end };
  }
}

// Items appended since `from`, stopping at the last complete line so a half-written one waits for the next read.
export function readAfter(t, from, cwd, limit, uploads) {
  const size = fs.statSync(t.file).size;
  if (size <= from) return { items: [], end: from };
  const buf = readRange(t.file, from, size);
  const last = buf.lastIndexOf(0x0a);
  if (last === -1) return { items: [], end: from };
  return { items: parseLines(buf.subarray(0, last + 1), from, cwd, limit, uploads), end: from + last + 1 };
}

// Where the last complete line ends; the tail read starts its window here. No byte is read twice, and none further back than `limit`
// from the end of the file: past it, a file with no line end gives 0, as one with no complete line does.
export function completeEnd(t, limit = Infinity) {
  const size = fs.statSync(t.file).size;
  const floor = Math.max(0, size - limit);
  let end = size;
  for (let back = 64 * 1024; end > floor; back *= 4) {
    const start = Math.max(floor, size - back);
    const last = readRange(t.file, start, end).lastIndexOf(0x0a);
    if (last !== -1) return start + last + 1;
    end = start;
  }
  return 0;
}

// ---- one image, for the page to draw ------------------------------------------------------------

const MAX_LINE = 64 * 1024 * 1024;

// The finished line that starts at `offset`, or null.
function readLine(file, offset) {
  const fd = fs.openSync(file, 'r');
  try {
    const parts = [];
    for (let at = offset; at - offset < MAX_LINE;) {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      const got = fs.readSync(fd, buf, 0, buf.length, at);
      if (!got) return null;
      const nl = buf.subarray(0, got).indexOf(0x0a);
      parts.push(buf.subarray(0, nl === -1 ? got : nl));
      if (nl !== -1) return Buffer.concat(parts);
      at += got;
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// The image blocks the tools returned on a user line, in the order itemsFromEntry numbers them.
const toolImages = e => (e.type === 'user' && Array.isArray(e.message?.content) ? e.message.content.flatMap(b => (b?.type === 'tool_result' ? imageBlocks(b.content) : [])) : []);

// The bytes and type of the image a ref on an item names, or null when the line is gone or that block cannot be drawn.
// NOTE: [17 Oct 2026] EK - server.mjs serves the image route immutable for a year, so a ref must name the same picture for ever.
// A tool's pictures count every image block, so IMAGE_TYPES cannot move them. A sent picture counts only IMAGE_TYPES, so
// adding a type there renumbers sent refs: see the note above IMAGE_TYPES in lib/images.mjs.
export function readImage(t, ref) {
  const m = /^(\d+)\.(r?)(\d+)\.([\w-]*)$/.exec(ref || '');
  if (!m || !Number.isSafeInteger(Number(m[1]))) return null;
  const line = readLine(t.file, Number(m[1]));
  let e = null;
  try { if (line) e = JSON.parse(line); } catch {}
  if (!e || uuidOf(e) !== m[4]) return null;
  const block = (m[2] ? toolImages(e) : sentBlocks(e).filter(isImage))[Number(m[3])];
  return isImage(block) ? { type: block.source.media_type, bytes: Buffer.from(block.source.data, 'base64') } : null;
}

// ---- every picture of a chat, for the viewer, and the scan that finds them ---------------------

const SCAN_CHUNK = 8 * 1024 * 1024;
const SCAN_TAIL = 64;
const SCANS_KEPT = 16;
// NOTE: [18 Oct 2026] EK - Only a line holding one of these is parsed, because the CLI writes lines with JSON.stringify, which
// never escapes these letters, so no tool call or picture is skipped (checked on CLI 2.1.302).
const NEEDLES = ['"tool_use"', '"image"'].map(s => Buffer.from(s));

// Results of calls that ran side by side can come back out of order, so a picture goes in by its seq.
// A second result for the same call replaces the first, as it does on the page.
function place(pictures, entry) {
  let n = pictures.length;
  while (n && pictures[n - 1].seq > entry.seq) n--;
  if (n && pictures[n - 1].seq === entry.seq) pictures[n - 1] = entry;
  else pictures.splice(n, 0, entry);
}

function scanLine(scan, line, offset) {
  let e = null;
  try { e = JSON.parse(line); } catch {}
  if (!e) return;
  for (const item of itemsFromEntry(e, '', 0, offset)) {
    const seq = scan.seq++;
    if (item.kind === 'tool') scan.tools.set(item.id, { seq, at: offset, name: item.name });
    else if (item.kind === 'result') {
      const tool = item.images && scan.tools.get(item.toolId);
      if (tool) place(scan.pictures, { seq: tool.seq, at: tool.at, item: { kind: 'tool', name: tool.name, images: item.images } });
    } else if (item.images) place(scan.pictures, { seq, at: offset, item: { kind: item.kind, images: item.images } });
  }
}

// `buf` is whole lines that start at byte `base` of the file. Each needle's next hit is kept, so none is searched for again on every line.
function scanBuffer(scan, buf, base, needles, onLine) {
  const next = needles.map(needle => buf.indexOf(needle));
  for (let from = 0; from < buf.length;) {
    const to = buf.indexOf(0x0a, from);
    next.forEach((at, n) => { if (at !== -1 && at < from) next[n] = buf.indexOf(needles[n], from); });
    if (next.some(at => at !== -1 && at < to)) onLine(scan, buf.toString('utf8', from, to), base + from);
    from = to + 1;
  }
}

// Reads from where the scan stopped to `to`, which ends a line, in chunks of whole lines. A line longer than the chunk grows it.
function scanRange(file, scan, to, needles, onLine) {
  const fd = fs.openSync(file, 'r');
  try {
    let size = SCAN_CHUNK;
    while (scan.end < to) {
      const buf = Buffer.allocUnsafe(Math.min(size, to - scan.end));
      if (fs.readSync(fd, buf, 0, buf.length, scan.end) < buf.length) throw new Error(`${file} is shorter than it was a moment ago.`);
      const whole = buf.lastIndexOf(0x0a) + 1;
      if (!whole) {
        if (buf.length === to - scan.end) throw new Error(`${file} has no end of line before byte ${to}.`);
        size *= 2;
        continue;
      }
      scanBuffer(scan, buf.subarray(0, whole), scan.end, needles, onLine);
      scan.tail = Buffer.concat([scan.tail, buf.subarray(Math.max(0, whole - SCAN_TAIL), whole)]).subarray(-SCAN_TAIL);
      scan.end += whole;
      size = SCAN_CHUNK;
    }
  } finally { fs.closeSync(fd); }
}

// A scan of a transcript kept per file, so the next call reads only what was added. `fresh()` gives what a scan holds besides where it
// has read to, and `onLine(scan, line, offset)` hears each line that holds one of the `needles`. A file that was rewritten is scanned
// again from the start, and one that throws is dropped, never reused half done.
export function keepScans({ needles, fresh, onLine }) {
  const scans = new Map();
  return t => {
    const to = completeEnd(t);
    let scan = scans.get(t.file);
    scans.delete(t.file);
    if (scan && (to < scan.end || !readRange(t.file, Math.max(0, scan.end - SCAN_TAIL), scan.end).equals(scan.tail))) scan = null;
    scan ||= { end: 0, tail: Buffer.alloc(0), ...fresh() };
    scanRange(t.file, scan, to, needles, onLine);
    scans.set(t.file, scan);
    if (scans.size > SCANS_KEPT) scans.delete(scans.keys().next().value);
    return scan;
  };
}

const imageScan = keepScans({ needles: NEEDLES, fresh: () => ({ seq: 0, tools: new Map(), pictures: [] }), onLine: scanLine });

// The pictures whose place in the thread is before byte `before`, as items for threadImages with refs and never bytes.
// NOTE: [18 Oct 2026] EK - Keep the order the page's thread draws pictures in, which is how absorb in public/ui/thread.js settles
// results: a tool's pictures sit at its call, and a result whose call was not seen first is left out. Change both together, or
// the viewer's count and its Previous button stop following the page.
export function listImages(t, before = Infinity) {
  return imageScan(t).pictures.filter(p => p.at < before).map(p => p.item);
}
