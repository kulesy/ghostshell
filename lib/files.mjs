// The files a reply links to, opened for the page. A chat may open a path only if a reply or a thought in that chat links to it as
// written, and that list is the whole gate for reading: there is no folder to stay inside, so there is nothing for a `..` to climb out of.
// A save also takes the rules in whyReadOnly.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileTarget, linkedFiles } from '../public/md.mjs';
import { sniff } from './images.mjs';
import { itemsFromEntry, keepScans } from './transcripts.mjs';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
const HEAD_BYTES = 4096;
const CHUNK_BYTES = 64 * 1024;

// Only a line holding this is parsed, for the reason given above NEEDLES in lib/transcripts.mjs.
const NEEDLES = [Buffer.from('"type":"assistant"')];

// The page draws exactly the text of the assistant and thinking items with md, so those are the ones that link. It is sent thinking cut
// at `limit` characters, so the scan reads it cut there too, or a path across the cut would link on the page and be refused here.
function scanLine(scan, line, limit) {
  let e = null;
  try { e = JSON.parse(line); } catch {}
  if (!e) return;
  for (const item of itemsFromEntry(e, '', limit, 0)) {
    if (item.kind === 'assistant' || item.kind === 'thinking') for (const file of linkedFiles(item.text)) scan.paths.add(file);
  }
}

// A scan reads a transcript once and then only what is added to it, and what it finds depends on the limit, so each limit has its own.
const scanners = new Map();
function scannerFor(limit) {
  if (!scanners.has(limit)) scanners.set(limit, keepScans({ needles: NEEDLES, fresh: () => ({ paths: new Set() }), onLine: (scan, line) => scanLine(scan, line, limit) }));
  return scanners.get(limit);
}

// Whether a chat links to a path: in its saved replies and thoughts, as the page is sent them cut at `limit` characters, or in the reply
// it is writing now (`live`).
export function linksOf(t, live = '', limit) {
  const saved = t ? scannerFor(limit)(t).paths : new Set();
  const writing = linkedFiles(live);
  return file => saved.has(file) || writing.has(file);
}

const refuse = (status, message, extra) => Object.assign(new Error(message), { status, ...extra });

const expandHome = raw => (raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw);

function unreadable(e) {
  if (['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG'].includes(e.code)) return refuse(404, 'There is no file at that path.');
  if (['EACCES', 'EPERM'].includes(e.code)) return refuse(403, 'GhostShell cannot read that file.');
  if (['ENXIO', 'ENODEV', 'EOPNOTSUPP'].includes(e.code)) return refuse(415, 'GhostShell opens plain files only.');
  return e;
}

// NONBLOCK so a pipe with no writer cannot hold the server, and NOCTTY so a terminal device cannot become its terminal.
const OPEN = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY;

function plainFile(stat) {
  if (stat.isDirectory()) throw refuse(415, 'That is a folder, not a file.');
  if (!stat.isFile()) throw refuse(415, 'GhostShell opens plain files only.');
}

// The open file behind a linked path, as { handle, real, size, stat }. The caller closes the handle. Every call goes to the disk asynchronously,
// so a file that is only online in OneDrive or on a mount that has gone away holds up this request and not the server.
async function openLinked(raw, linked) {
  const target = typeof raw === 'string' ? fileTarget(raw) : null;
  if (!target || target.path !== raw) throw refuse(400, raw ? 'That is not a plain path to a file.' : 'Which file?');
  if (!linked(raw)) throw refuse(403, 'This chat does not link to that file.');
  let real;
  let handle;
  try {
    real = await fsp.realpath(expandHome(raw));
    // Looked at before it is opened, because opening a device such as a serial port can reset what is plugged into it.
    plainFile(await fsp.stat(real));
    handle = await fsp.open(real, OPEN);
  } catch (e) {
    throw unreadable(e);
  }
  try {
    const stat = await handle.stat();
    plainFile(stat);
    return { handle, real, size: stat.size, stat };
  } catch (e) {
    await handle.close();
    throw e;
  }
}

async function readAt(handle, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = length ? await handle.read(buf, 0, length, 0) : { bytesRead: 0 };
  return buf.subarray(0, bytesRead);
}

const MARKDOWN = /\.(?:md|markdown|mdx)$/i;

// A text file has no NUL and decodes as UTF-8. When the head ends mid-file, a character cut by it does not count against the file.
function decodes(head, cut) {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: cut });
    return true;
  } catch { return false; }
}

// What a file is, from its first bytes and its name. Capcom decides this and the browser is told, so a file never picks its own type.
// HTML and SVG are text here, so they are shown and sent as text and never run.
async function kindOf(handle, size, name) {
  const head = await readAt(handle, Math.min(size, HEAD_BYTES));
  const image = sniff(head);
  if (image) return { kind: 'image', type: image };
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', type: 'application/pdf' };
  if (decodes(head, size > HEAD_BYTES)) return { kind: MARKDOWN.test(name) ? 'markdown' : 'text', type: 'text/plain; charset=utf-8' };
  return { kind: 'binary', type: 'application/octet-stream' };
}

// The start of a long file is cut back to its last line, so a preview never ends half way along one. A BOM is left out of the text.
async function readText(handle, size) {
  const long = size > MAX_TEXT_BYTES;
  let buf = await readAt(handle, Math.min(size, MAX_TEXT_BYTES));
  const end = buf.lastIndexOf(0x0a);
  if (long && end !== -1) buf = buf.subarray(0, end + 1);
  return { buf, text: new TextDecoder().decode(buf, { stream: long }), ...(long && { truncated: true }) };
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Whether `dir` holds `file`, compared without case because a Mac's disk usually ignores it. Refusing a lookalike is the safe way to be wrong.
const inside = (dir, file) => {
  const rel = path.relative(dir.toLowerCase(), file.toLowerCase());
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

const canonical = p => { try { return fs.realpathSync.native(p); } catch { return p; } };

// The folders a save never reaches, as real paths: GhostShell's state, transcripts and Desktop folders and its own checkout.
export const frozenFolders = dirs => dirs.filter(Boolean).map(canonical);

// A sentence for the page when the file at the real path `at` may not be saved from the viewer, else ''. Everything in the home folder is
// editable apart from the places docs/adr/20261105-edit-linked-text-files.md names: dot names, Library and GhostShell's own folders.
function placeIsReadOnly(at, home, frozen) {
  const rel = path.relative(home, at);
  const parts = rel.split(path.sep);
  if (parts[0] === '..' || path.isAbsolute(rel)) return 'GhostShell edits only files inside your home folder.';
  // NOTE: [5 Nov 2026] EK - Index 0 is skipped so ~/.claude/worktrees stays read only, while a repo's own .claude/worktrees/<name> is ordinary work.
  const tree = parts.findIndex((p, i) => i > 0 && p === '.claude' && parts[i + 1] === 'worktrees' && parts.length > i + 3);
  const kept = tree === -1 ? parts : [...parts.slice(0, tree), ...parts.slice(tree + 3)];
  if (parts[0].toLowerCase() === 'library' || kept.some(p => p.startsWith('.'))) return 'Hidden files and folders and Library stay read only here, because they can run code or hold secrets.';
  if (frozen.some(dir => inside(dir, at) && !inside(path.join(dir, '.claude', 'worktrees'), at))) return 'GhostShell does not edit its own files or its sessions.';
  return '';
}

// A sentence for the page when the file may not be saved from the viewer, else ''. `buf` is the start of the file as far as it was read, and
// `raw` is the path as the chat linked it. The location rules judge the real path, and the linked one too when it is inside the home folder, in
// either spelling of it, so `~/.zshrc` stays read only when it is a link into a dotfiles folder.
async function whyReadOnly({ real: at, stat }, buf, frozen, raw) {
  const home = await fsp.realpath(os.homedir()).catch(() => null);
  let place = home ? placeIsReadOnly(at, home, frozen) : 'GhostShell edits only files inside your home folder.';
  if (!place && home) {
    const linked = path.normalize(expandHome(raw));
    const spelling = [os.homedir(), home].find(h => inside(h, linked));
    if (spelling) place = placeIsReadOnly(path.join(home, path.relative(spelling, linked)), home, frozen);
  }
  if (place) return place;
  if (stat.mode & 0o111) return 'This file can run as a program, so it stays read only here.';
  if (stat.uid !== process.getuid()) return 'You do not own this file.';
  const writable = await Promise.all([at, path.dirname(at)].map(p => fsp.access(p, fs.constants.W_OK).then(() => true, () => false)));
  if (!writable.every(Boolean)) return 'This file or its folder is read only on disk.';
  if (stat.nlink !== 1) return 'This file has more than one hard link, and a save would split them.';
  if (stat.size > MAX_TEXT_BYTES) return `This file is over ${MAX_TEXT_BYTES / 1024 ** 2} MB, so only the start is shown and it cannot be edited.`;
  if (!decodes(buf, false)) return 'This file is not plain UTF-8 text, so a save could damage it.';
  return '';
}

// What the page shows of a linked file. Throws an error with a `status` and a sentence for the page when it cannot be opened.
// `frozen` is frozenFolders(), the places a save never reaches. A text file carries its `version` and either `editable` or why it is `readOnly`.
export async function previewFile(raw, linked, frozen = []) {
  const file = await openLinked(raw, linked);
  try {
    const name = path.posix.basename(raw);
    const { kind, type } = await kindOf(file.handle, file.size, name);
    const preview = { name, path: raw, real: file.real, size: file.size, kind, type };
    if (file.size > MAX_FILE_BYTES) preview.tooLarge = true;
    else if (kind === 'text' || kind === 'markdown') {
      const { buf, ...read } = await readText(file.handle, file.size);
      const why = await whyReadOnly(file, buf, frozen, raw);
      Object.assign(preview, read, { version: sha256(buf) }, why ? { readOnly: why } : { editable: true });
    }
    return preview;
  } finally {
    await file.handle.close();
  }
}

// The line endings of the browser's text box are all \n, so a file that had others gets each unchanged line's own ending back, and a line that
// changed gets the file's most common one. A final newline is as the box has it.
export function keepEndings(before, edited) {
  if (!before.includes('\r')) return edited;
  const pieces = before.split(/(\r\n|\r|\n)/);
  const old = pieces.filter((_, i) => i % 2 === 0);
  const ends = pieces.filter((_, i) => i % 2 === 1);
  const now = edited.split('\n');
  const counts = new Map();
  for (const e of ends) counts.set(e, (counts.get(e) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  let head = 0;
  while (head < old.length && head < now.length && old[head] === now[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < now.length - head && old.at(-1 - tail) === now.at(-1 - tail)) tail++;
  const endingOf = j => (j < head ? ends[j] : j >= now.length - tail ? ends[j + old.length - now.length] : undefined) ?? usual;
  return now.map((line, j) => (j < now.length - 1 ? line + endingOf(j) : line)).join('');
}

// Every file being saved, by real path, so a second save of the same file while one runs is refused.
const writing = new Set();

// The sha256 of the whole file at `at` as it is on disk now, or null when it is over the limit a save reads.
async function hashNow(at) {
  let handle;
  try {
    handle = await fsp.open(at, OPEN);
    const { size } = await handle.stat();
    return size > MAX_TEXT_BYTES ? null : sha256(await readAt(handle, size));
  } catch (e) {
    throw unreadable(e);
  } finally {
    await handle?.close();
  }
}

function unwritable(e) {
  if (['EACCES', 'EPERM', 'EROFS'].includes(e.code)) return refuse(403, 'GhostShell cannot write to that file.');
  if (['ENOSPC', 'EDQUOT'].includes(e.code)) return refuse(507, 'The disk is full.');
  return e;
}

const CHANGED = 'This file changed on disk after you opened it, so nothing was saved.';

// Saves `text` over a linked file, but only if it still holds the bytes whose sha256 is `base`. The new file is written beside it and renamed over
// it, so a failure leaves the old one whole. Throws as previewFile does, with a 409 when the file changed. Returns the file's new preview.
export async function saveFile(raw, linked, { text, base }, frozen) {
  const file = await openLinked(raw, linked);
  let tmp = null;
  try {
    const { kind } = await kindOf(file.handle, file.size, path.posix.basename(raw));
    const whole = file.size > MAX_TEXT_BYTES ? Buffer.alloc(0) : await readAt(file.handle, file.size);
    const why = kind === 'text' || kind === 'markdown' ? await whyReadOnly(file, whole, frozen, raw) : 'GhostShell edits only text files.';
    if (why) throw refuse(403, why);
    if (sha256(whole) !== base) throw refuse(409, CHANGED, { changed: true });
    if (text.includes('\0')) throw refuse(400, 'The text has a NUL character, which a text file cannot hold.');
    const before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(whole).replace(/^\uFEFF/, '');
    const output = Buffer.concat([...(whole.subarray(0, 3).equals(BOM) ? [BOM] : []), Buffer.from(keepEndings(before, text))]);
    if (output.length > MAX_TEXT_BYTES) throw refuse(413, `That text is over ${MAX_TEXT_BYTES / 1024 ** 2} MB, which is more than GhostShell saves.`);
    if (writing.has(file.real)) throw refuse(409, 'This file is already being saved.');
    writing.add(file.real);
    try {
      tmp = path.join(path.dirname(file.real), `.${crypto.randomBytes(8).toString('hex')}.tmp`);
      // The copy keeps the file's mode, ACLs and attributes, and is then emptied and written.
      await fsp.copyFile(file.real, tmp, fs.constants.COPYFILE_EXCL);
      const out = await fsp.open(tmp, fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW);
      try {
        await out.write(output, 0, output.length, 0);
        await out.sync();
      } finally {
        await out.close();
      }
      if ((await hashNow(file.real)) !== base) throw refuse(409, CHANGED, { changed: true });
      await fsp.rename(tmp, file.real);
      tmp = null;
    } catch (e) {
      throw unwritable(e);
    } finally {
      writing.delete(file.real);
    }
    // NOTE: [5 Nov 2026] EK - Best effort, because the rename has happened and a folder that will not sync cannot undo it.
    const dir = await fsp.open(path.dirname(file.real), fs.constants.O_RDONLY).catch(() => null);
    await dir?.sync().catch(() => {});
    await dir?.close();
  } finally {
    await file.handle.close();
    if (tmp) await fsp.unlink(tmp).catch(() => {});
  }
  return previewFile(raw, linked, frozen);
}

// RFC 5987 keeps a name with any characters in it, and the quoted name is for a browser that reads only that.
function disposition(name, download) {
  const plainName = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${plainName}"; filename*=UTF-8''${encoded}`;
}

// The first `size` bytes of the file, which the response promised in its content-length. A file that has shrunk since fails the stream, so
// the response is cut short and the browser sees a broken download and not one that never finishes. Destroying the stream closes the handle.
function bytesOf(handle, size) {
  let at = 0;
  return new Readable({
    highWaterMark: CHUNK_BYTES,
    async read() {
      try {
        const buf = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, size - at));
        const { bytesRead } = await handle.read(buf, 0, buf.length, at);
        if (!bytesRead) throw new Error('The file got shorter while it was sent.');
        at += bytesRead;
        this.push(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
        if (at >= size) this.push(null);
      } catch (e) {
        this.destroy(e);
      }
    },
    destroy(error, done) {
      handle.close().then(() => done(error), () => done(error));
    },
  });
}

// The bytes of a linked file as { headers, stream }, the stream null for an empty file. The stream closes the file when it ends.
// Throws as previewFile does, and with a 413 for a file over MAX_FILE_BYTES.
export async function serveFile(raw, linked, download) {
  const file = await openLinked(raw, linked);
  let handed = false;
  try {
    if (file.size > MAX_FILE_BYTES) throw refuse(413, `That file is over ${MAX_FILE_BYTES / 1024 ** 2} MB, which is more than GhostShell sends.`);
    const name = path.posix.basename(raw);
    const { kind, type } = await kindOf(file.handle, file.size, name);
    const headers = {
      'content-type': type,
      'content-length': file.size,
      'content-disposition': disposition(name, download),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'same-origin',
      // NOTE: [23 Oct 2026] EK - A PDF goes without the sandbox because Chrome's PDF viewer refuses a sandboxed document. nosniff and
      // application/pdf keep it from being read as HTML, so keep both on this response whatever else changes.
      ...(kind !== 'pdf' && { 'content-security-policy': "sandbox; default-src 'none'" }),
    };
    if (!file.size) return { headers, stream: null };
    handed = true;
    return { headers, stream: bytesOf(file.handle, file.size) };
  } finally {
    if (!handed) await file.handle.close();
  }
}
