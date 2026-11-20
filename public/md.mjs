// A small Markdown renderer for Claude's replies. Everything is escaped first, so a reply can never
// inject markup; only http and https links survive, and paths to files on this Mac when the caller can open them.

import { commandLines, runnableBlock } from './ui/terminal-rules.js';

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A path is plain when it starts with `~/` or `/` and every segment after that is named: none empty, none `.` or `..`, no trailing slash.
const plain = path => /^(?:~\/|\/)/.test(path) && !/[\u0000-\u001f\u007f]/.test(path)
  && path.replace(/^(?:~\/|\/)/, '').split('/').every(seg => seg && seg !== '.' && seg !== '..');

const LINE = /^(.*?):([1-9]\d{0,6})(?::\d{1,7})?$/;

// Where a link or a path in the text points, as { path, line }, or null when it is not a plain path. A `:12` or `:12:3` on the end sets
// the line and is not part of the path, and a file URL becomes the absolute path it names. `encoded` says the path is written as a link
// target is, with %20 for a space; a file URL is always read so. A decoded path that ends in :12 is refused, or it would read as a line.
export function fileTarget(raw, encoded = false) {
  if (typeof raw !== 'string') return null;
  const at = LINE.exec(raw);
  let path = at ? at[1] : raw;
  const url = path.startsWith('file://');
  if (url) path = path.slice(7).replace(/^localhost(?=\/)/, '');
  if (url || encoded) {
    try { path = decodeURIComponent(path); } catch { return null; }
    if (url && !path.startsWith('/')) return null;
    if (LINE.test(path)) return null;
  }
  return plain(path) ? { path, line: at ? Number(at[2]) : null } : null;
}

// Prose and code spans link only a path that starts where a file can be, so route-like text such as /api/sessions stays text.
const ROOTED = /(?:~\/|file:\/\/|\/(?:Users|private|tmp|var|opt|etc|Volumes|Applications|Library|System|usr|home)\/)[^\s<>()*`\u0000]+/.source;
const BARE = new RegExp(`(^|[\\s(*])(${ROOTED})`, 'g');
const WHOLE = new RegExp(`^${ROOTED}$`);
const TRAILING = '.,;:!?\'"';

// A link's text and its target are cut at these lengths, so a line of unclosed brackets cannot make each one scan to the end of the line.
const MAX_TEXT = 1000;
const MAX_PATH = 4096;
const HTTP_LINK = new RegExp(`\\[([^\\]\\n]{1,${MAX_TEXT}})\\]\\((https?:\\/\\/[^\\s)]{1,${MAX_PATH}})\\)`, 'g');
const IMAGE = new RegExp(`!\\[([^\\]\\n]{0,${MAX_TEXT}})\\]\\((?:<([^>\\n]{1,${MAX_PATH}})>|([^\\s)]{1,${MAX_PATH}}))\\)`, 'g');
const PICTURE = /\.(?:png|jpe?g|gif|webp)$/i;
const FILE_LINK = new RegExp(`\\[([^\\]\\n]{1,${MAX_TEXT}})\\]\\((?:<([^>\\n]{1,${MAX_PATH}})>|([^\\s)]{1,${MAX_PATH}}))\\)`, 'g');
const OTHER_LINK = new RegExp(`\\[([^\\]\\n]{1,${MAX_TEXT}})\\]\\(([^\\s)]{1,${MAX_PATH}})\\)`, 'g');

// Code spans and links are set aside before emphasis runs, so an underscore in a URL stays a URL. `file(path, line)`, if given,
// returns the address that opens a file, or null; a path it returns null for is drawn as if there were no `file`.
function inline(src, file) {
  const kept = [];
  const spans = new Map();
  const keep = html => `\u0000${kept.push(html) - 1}\u0000`;
  const link = (text, url) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`);
  const opener = (run, encoded) => {
    const target = file && fileTarget(run, encoded);
    const href = target && file(target.path, target.line);
    return href ? `<a class="file-link" href="${esc(href)}" target="_blank" rel="noopener" data-file="${esc(target.path)}"${target.line === null ? '' : ` data-line="${target.line}"`}>` : null;
  };
  const s = esc(src
    .replace(/`([^`\n]+)`/g, (_, c) => { spans.set(kept.length, c); return keep(`<code>${esc(c)}</code>`); })
    // A picture is drawn only for a local file the page can open. An http image stays a link, since loading a URL a model wrote
    // lets a reply carry data out in its query string.
    .replace(IMAGE, (_, alt, angled, bare) => {
      const raw = angled ?? bare;
      const target = !/^https?:\/\//.test(raw) && file && fileTarget(raw, true);
      const href = target && target.line === null && PICTURE.test(target.path) ? file(target.path, null) : null;
      const text = alt || (target ? target.path.split('/').pop() : raw).replace(/[[\]]/g, '');
      if (!href) return `[${text}](${angled === undefined ? raw : `<${angled}>`})`;
      const name = text.replace(/\u0000(\d+)\u0000/g, (_, i) => spans.get(Number(i)) ?? '');
      return keep(`<button type="button" class="md-image" data-md-image="${esc(href)}" data-path="${esc(target.path)}"><img loading="lazy" src="${esc(href)}" alt="${esc(name)}"></button>`);
    })
    .replace(HTTP_LINK, (_, t, u) => link(t, u))
    .replace(FILE_LINK, (m, t, angled, bare) => {
      const open = opener(angled ?? bare, true);
      return open ? keep(`${open}${esc(t).replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i])}</a>`) : m;
    })
    .replace(OTHER_LINK, (_, t, u) => keep(`<code title="${esc(u)}">${esc(t)}</code>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, pre, u) => pre + link(u, u))
    .replace(BARE, (m, pre, run) => {
      let end = run.length;
      while (end > 0 && TRAILING.includes(run[end - 1])) end--;
      const shown = run.slice(0, end);
      const open = opener(shown);
      return open ? pre + keep(`${open}${esc(shown)}</a>`) + run.slice(shown.length) : m;
    }))
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // A code span that is a whole path links here, at the top level, so one inside a link's text is not linked a second time.
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const c = spans.get(Number(i));
    const open = c !== undefined && WHOLE.test(c) ? opener(c) : null;
    return open ? `${open}${kept[i]}</a>` : kept[i];
  });
}

const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

const ITEM = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;

function list(lines, i, file) {
  const first = lines[i].match(ITEM);
  const indent = first[1].length;
  const ordered = !!first[3];
  // An item of this list at this depth, or one nested under it. A bullet after a number starts a new list.
  const belongs = m => m && (m[1].length > indent || (m[1].length === indent && !!m[3] === ordered));
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    // Blank lines between items keep the list going, so "1." then a gap then "2." stays one list.
    if (!l.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && belongs(lines[j].match(ITEM))) { i = j; continue; }
      break;
    }
    const m = l.match(ITEM);
    if (m && m[1].length === indent && !!m[3] === ordered) { items.push([m[4]]); i++; continue; }
    if (m && m[1].length > indent) { const sub = list(lines, i, file); items[items.length - 1].push(sub.html); i = sub.i; continue; }
    if (!m && /^\s+/.test(l) && items.length) { items[items.length - 1][0] += ' ' + l.trim(); i++; continue; }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const start = ordered && Number(first[3]) !== 1 ? ` start="${Number(first[3])}"` : '';
  return { html: `<${tag}${start}>${items.map(([t, ...rest]) => `<li>${inline(t, file)}${rest.join('')}</li>`).join('')}</${tag}>`, i };
}

// A console block's code with each command, and the lines a backslash joins to it, in a span. The spans only mark text, so the block's
// textContent is its text as written, which Copy and Run read.
function consoleCode(lang, text) {
  const ranges = commandLines(lang, text);
  if (!ranges.length) return esc(text);
  const lines = text.split('\n');
  let html = '';
  let at = 0;
  for (const { from, to } of ranges) {
    if (from > at) html += `${esc(lines.slice(at, from).join('\n'))}\n`;
    html += `<span class="cmd">${esc(lines.slice(from, to + 1).join('\n'))}</span>${to < lines.length - 1 ? '\n' : ''}`;
    at = to + 1;
  }
  return at < lines.length ? html + esc(lines.slice(at).join('\n')) : html;
}

// Copy always, and Run when the block is a command. Both only draw: the page decides whether Run shows, and reads the command again
// from the block's own text when it is clicked.
function codeBlock(lang, text) {
  const tool = (kind, label, tip, extra = '') => `<button type="button" class="btn" data-variant="ghost" data-size="xs" data-code="${kind}" aria-label="${label}" data-tip="${tip}"${extra}>${kind === 'copy' ? 'Copy' : 'Run'}</button>`;
  const block = runnableBlock(lang, text);
  const run = !block ? ''
    : block.hidden ? tool('run', 'Run in terminal, unavailable because the block holds hidden characters', 'This block holds hidden characters, so it cannot be run', ' aria-disabled="true"')
    : tool('run', 'Run in terminal', 'Run in terminal');
  const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
  return `<div class="code-block"><div class="code-head">${label}<span class="code-tools">${tool('copy', 'Copy code', 'Copy')}${run}</span></div>`
    + `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${consoleCode(lang, text)}</code></pre></div>`;
}

export function md(src, file) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(l => inline(l, file)).join('<br>')}</p>`); para = []; } };
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    const fence = l.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(codeBlock(fence[2], body.join('\n')));
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${Math.min(h[1].length + 2, 6)}>${inline(h[2], file)}</h${Math.min(h[1].length + 2, 6)}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) { flush(); const r = list(lines, i, file); out.push(r.html); i = r.i; continue; }
    if (/^\s*>/.test(l)) {
      flush();
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${md(body.join('\n'), file)}</blockquote>`);
      continue;
    }
    if (isTableRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c, file)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, file)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l);
    i++;
  }
  flush();
  return out.join('');
}

// The paths md would link in `src`, found by running it, so the server can never disagree with the page.
export function linkedFiles(src) {
  const found = new Set();
  md(src, path => { found.add(path); return null; });
  return found;
}

export { esc };
