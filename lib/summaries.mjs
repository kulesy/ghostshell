// The latest thing a session said, as a line and in full, read from the end of its transcript. No model is asked, so a summary costs a
// read of the file and nothing else.
import fs from 'node:fs';
import { completeEnd, readBefore } from './transcripts.mjs';

const LINE_CHARS = 160;
const REPLY_CHARS = 4000;
const FIRST_CHUNK = 64 * 1024;
const READ_LIMIT = 2 * 1024 * 1024;
// The most a tool result or note keeps while the end of the file is read, since only the text of a reply is wanted.
const ITEM_CHARS = 200;

const BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// One line of markdown as the plain text it reads as. A code span is set aside first, so what is inside it is never read as markup.
function plain(source) {
  const code = [];
  let line = source.replace(/(`+)(.+?)\1/g, (_, __, inner) => `\u0000${code.push(inner.trim()) - 1}\u0000`);
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) return '';
  if (/^\s*\|.*\|\s*$/.test(line)) line = line.trim().slice(1, -1).split('|').map(cell => cell.trim()).filter(Boolean).join(', ');
  line = line
    .replace(/^\s*>[>\s]*/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])(?:\s+(?:\[[ xX]\]\s+)?|$)/, '')
    .replace(/^\s{0,3}#{1,6}(?:\s+|$)/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\w)__(.+?)__(?!\w)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
    .replace(/(?<!\w)_(\S(?:.*?\S)?)_(?!\w)/g, '$1');
  return line.replace(/\u0000(\d+)\u0000/g, (_, n) => code[n]).replace(/\s+/g, ' ').trim();
}

// The lines of a reply outside its fenced code blocks. A block closes at a fence of the same mark and at least as long, or at the end.
function proseLines(text) {
  const prose = [];
  let open = null;
  for (const line of text.split(BREAK)) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && !fence[2].trim()) open = null;
    } else if (fence) open = fence[1];
    else prose.push(line);
  }
  return prose;
}

// The first sentence of a reply as plain text: a code block is skipped, a heading or a list item reads as its words, and a sentence ends
// at . ! or ? before a space, or at a line break. A longer one is cut to `max` characters with an ellipsis.
export function firstSentence(text, max = LINE_CHARS) {
  if (typeof text !== 'string') return '';
  const line = proseLines(text).map(plain).find(Boolean);
  if (!line) return '';
  return clip(/^(.*?[.!?]["')\]]*)(?=\s|$)/.exec(line)?.[1] ?? line, max);
}

const OFFER = /\b(?:want me to|shall I|should I|would you like|do you want|let me know|say the word|if you want|if you'd like)\b/i;

// What a reply asks of its reader, as plain text: the last sentence, among the last three lines of prose, that ends in a question mark or
// carries an offer ("want me to", "let me know"). Empty when none does. A longer one is cut to `max` characters with an ellipsis.
export function closingAsk(text, max = LINE_CHARS) {
  if (typeof text !== 'string') return '';
  const lines = [];
  for (const prose of proseLines(text).reverse()) {
    const line = plain(prose);
    if (line) lines.push(line);
    if (lines.length === 3) break;
  }
  for (const line of lines) {
    const sentences = line.match(/.*?[.!?]["')\]]*(?=\s|$)|.+$/g) ?? [];
    const found = sentences.map(sentence => sentence.trim()).findLast(sentence => sentence && (/\?["')\]]*$/.test(sentence) || OFFER.test(sentence)));
    if (found) return clip(found, max);
  }
  return '';
}

// The newest assistant message with text in it, read backwards from the last whole line in chunks that double. No more than the read limit
// is read, so a line longer than it ends the search with nothing found.
export function latestReply(t, cwd) {
  const end = completeEnd(t, READ_LIMIT);
  const floor = Math.max(0, end - READ_LIMIT);
  let start = end;
  for (let chunk = FIRST_CHUNK; start > floor; chunk *= 2) {
    const got = readBefore(t, start, chunk, cwd, ITEM_CHARS, undefined, floor);
    const reply = got.items.findLast(item => item.kind === 'assistant' && item.text.trim());
    if (reply) return { text: reply.text.trim(), at: reply.at };
    start = got.start;
  }
  return null;
}

// Summaries kept per session id until the transcript's size or modified time changes. The transcript index can be seconds behind, so the
// file itself is asked. The oldest summaries go first once more than `max` are kept.
export function makeSummaries({ transcriptFor, max = 500 }) {
  const kept = new Map();
  return {
    // { line, ask, reply, at } for the session's latest reply, with empty text and a null `at` while it has none, or null when it has no readable transcript.
    get(id, cwd = '') {
      const t = transcriptFor(id);
      if (!t) return null;
      try {
        const { size, mtimeMs } = fs.statSync(t.file);
        const known = kept.get(id);
        if (known?.file === t.file && known.size === size && known.mtimeMs === mtimeMs) return known.summary;
        const found = latestReply(t, cwd);
        const at = Date.parse(found?.at);
        const summary = Object.freeze({ line: found ? firstSentence(found.text) : '', ask: found ? closingAsk(found.text) : '', reply: found ? clip(found.text, REPLY_CHARS) : '', at: Number.isFinite(at) ? at : null });
        kept.delete(id);
        kept.set(id, { file: t.file, size, mtimeMs, summary });
        while (kept.size > max) kept.delete(kept.keys().next().value);
        return summary;
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`Could not summarise ${id}: ${err.message}`);
        return null;
      }
    },
  };
}
