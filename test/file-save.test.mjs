// Run with `npm test`. Saving a text file that a reply links to, over HTTP against the real server and in process for the failures: which places
// can be saved and which stay read only, the checks of the route, and what the write does to the file's bytes, mode and line endings. Every
// file is a temp file under the test server's own home.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keepEndings, MAX_TEXT_BYTES, saveFile } from '../lib/files.mjs';
import { as, request, signIn, start } from './harness.mjs';

const entry = (type, content) => ({ type, uuid: `e${Math.random().toString(36).slice(2)}`, message: { id: `m${Math.random().toString(36).slice(2)}`, role: type, content } });
const said = text => entry('assistant', [{ type: 'text', text }]);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

let fixture = null;

// One server and one chat. `put` writes a file under the home folder and has the chat link to it, so the tests differ only in where a file is.
function setup() {
  fixture ||= (async () => {
    const s = await start();
    const folder = path.join(s.home, '.claude', 'projects', '-work');
    fs.mkdirSync(folder, { recursive: true });
    const transcript = path.join(folder, 'sess-1.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify(said('Starting'))}\n`);
    const { token } = await signIn(s);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-outside-'));
    const link = file => fs.appendFileSync(transcript, `${JSON.stringify(said(`[a file](<${file}>)`))}\n`);
    let n = 0;
    const put = (rel, content = 'one\ntwo\n', { mode } = {}) => {
      const file = path.join(s.home, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      if (mode !== undefined) fs.chmodSync(file, mode);
      link(file);
      return file;
    };
    const fresh = (name, content, options) => put(`work-${++n}/${name}`, content, options);
    return { s, token, put, fresh, link, outside, transcript };
  })();
  return fixture;
}

const headersOf = (token, s) => ({ ...as(token), origin: s.origin });
const previewOf = async file => { const { s, token } = await setup(); return request(s, 'GET', `/api/sessions/sess-1/preview?path=${encodeURIComponent(file)}`, { headers: as(token) }); };
const save = async (file, text, base, { headers, json } = {}) => {
  const { s, token } = await setup();
  return request(s, 'POST', '/api/sessions/sess-1/save', { headers: headers ?? headersOf(token, s), json: json ?? { path: file, text, base } });
};
// Saves `text` over the file as the viewer would, from the version it shows now.
const saveNow = async (file, text) => save(file, text, (await previewOf(file)).body().version);

test('a text file in an ordinary folder is editable, and a save changes it on disk and answers with the new preview', async () => {
  const { fresh } = await setup();
  const file = fresh('note.txt', 'one\ntwo\n');
  const before = (await previewOf(file)).body();
  assert.equal(before.editable, true);
  assert.equal(before.readOnly, undefined);
  assert.equal(before.version, sha('one\ntwo\n'));
  const res = await save(file, 'one\nthree\n', before.version);
  assert.equal(res.status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\nthree\n');
  assert.equal(res.body().text, 'one\nthree\n');
  assert.equal(res.body().version, sha('one\nthree\n'));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['note.txt'], 'no temporary file is left');
});

test('a path the chat does not link to is refused, and so is one that resolves out of bounds through a link', async () => {
  const { s, fresh, link, outside } = await setup();
  const file = path.join(s.home, 'work-unlinked.txt');
  fs.writeFileSync(file, 'never linked\n');
  const res = await save(file, 'changed', sha('never linked\n'));
  assert.equal(res.status, 403);
  assert.equal(fs.readFileSync(file, 'utf8'), 'never linked\n');

  const target = path.join(outside, 'target.txt');
  fs.writeFileSync(target, 'outside\n');
  const dir = path.dirname(fresh('anchor.txt'));
  const out = path.join(dir, 'out.txt');
  fs.symlinkSync(target, out);
  link(out);
  const preview = (await previewOf(out)).body();
  assert.equal(typeof preview.readOnly, 'string');
  assert.equal(preview.editable, undefined);
  assert.equal((await save(out, 'changed', preview.version)).status, 403);
  assert.equal(fs.readFileSync(target, 'utf8'), 'outside\n');

  const zshrc = path.join(s.home, '.zshrc');
  fs.writeFileSync(zshrc, 'export A=1\n');
  const inward = path.join(dir, 'profile.txt');
  fs.symlinkSync(zshrc, inward);
  link(inward);
  assert.equal((await save(inward, 'export A=2\n', sha('export A=1\n'))).status, 403, 'a link into a dot file is judged by where it ends');
  assert.equal(fs.readFileSync(zshrc, 'utf8'), 'export A=1\n');
});

test('a dot file that is a link into a folder of ordinary files stays read only, while the folder\'s own file is editable', async () => {
  const { s, fresh, link, outside: fixtureOutside } = await setup();
  const real = path.join(s.home, 'dotfiles', 'bashrc');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, 'alias a=b\n');
  const dot = path.join(s.home, '.bashrc');
  fs.symlinkSync(real, dot);
  link(dot);
  link(real);
  const shown = (await previewOf(dot)).body();
  assert.equal(shown.editable, undefined);
  assert.match(shown.readOnly, /Hidden files/);
  const res = await save(dot, 'alias a=c\n', sha('alias a=b\n'));
  assert.equal(res.status, 403);
  assert.equal(fs.readFileSync(real, 'utf8'), 'alias a=b\n');
  assert.equal(fs.lstatSync(dot).isSymbolicLink(), true);

  assert.equal((await previewOf(real)).body().editable, true, 'linked by its plain path it is ordinary');
  assert.equal((await save(real, 'alias a=d\n', sha('alias a=b\n'))).status, 200);
  assert.equal(fs.readFileSync(real, 'utf8'), 'alias a=d\n');

  // A path outside the home folder that ends inside it is judged on where it ends.
  const target = fresh('inward.txt', 'inside\n');
  const outside = path.join(fixtureOutside, 'inward-link.txt');
  fs.symlinkSync(target, outside);
  link(outside);
  assert.equal((await previewOf(outside)).body().editable, true);
  assert.equal((await saveNow(outside, 'edited\n')).status, 200);
  assert.equal(fs.readFileSync(target, 'utf8'), 'edited\n');
});

test('the places that run code, hold secrets or belong to GhostShell stay read only, and the save is refused with the bytes unchanged', async () => {
  const { s, put, link, outside } = await setup();
  const outsideFile = path.join(outside, 'plain.txt');
  fs.writeFileSync(outsideFile, 'outside the home folder\n');
  link(outsideFile);
  const spots = {
    '.ssh/config': put('.ssh/config'),
    '.zshrc': put('.zshrc'),
    '.claude/settings.json': put('.claude/settings.json', '{}\n'),
    '.config/capcom/x': put('.config/capcom/x'),
    'Library/LaunchAgents/x.plist': put('Library/LaunchAgents/x.plist'),
    'a file outside home': outsideFile,
    "a repo's .git/config": put('Projects/app/.git/config'),
    "a repo's .claude/settings.json": put('Projects/app/.claude/settings.json', '{}\n'),
    'a dot file in a project': put('Projects/app/.gitignore'),
    '~/.claude/worktrees/x/a.md': put('.claude/worktrees/x/a.md'),
    "a worktree's own .git": put('Projects/app/.claude/worktrees/x/.git', 'gitdir: elsewhere\n'),
    "a worktree's .claude/settings.json": put('Projects/app/.claude/worktrees/x/.claude/settings.json', '{}\n'),
    "GhostShell's state folder": put('state/notes.txt'),
    "a worktree that is nested in another": put('Projects/app/.claude/worktrees/x/.claude/worktrees/y/a.md'),
  };
  for (const [what, file] of Object.entries(spots)) {
    const bytes = fs.readFileSync(file);
    const preview = (await previewOf(file)).body();
    assert.equal(preview.editable, undefined, `${what} is not offered for editing`);
    assert.match(preview.readOnly, /\S/, `${what} says why`);
    const res = await save(file, 'changed\n', sha(bytes));
    assert.equal(res.status, 403, what);
    assert.deepEqual(fs.readFileSync(file), bytes, `${what} is unchanged`);
  }
  void s;
});

test("a repo's own worktree is ordinary work, inside GhostShell's folders too, and a save reaches its files", async () => {
  const { s, put } = await setup();
  for (const rel of ['Projects/app/.claude/worktrees/x/src/a.md', 'Projects/app/.claude/worktrees/x/a.md', 'state/.claude/worktrees/x/a.md']) {
    const file = put(rel, 'text\n');
    assert.equal((await previewOf(file)).body().editable, true, rel);
    assert.equal((await saveNow(file, 'edited\n')).status, 200, rel);
    assert.equal(fs.readFileSync(file, 'utf8'), 'edited\n');
  }
  void s;
});

test('a file with a second hard link, an unwritable file and a file in an unwritable folder stay read only', async () => {
  const { fresh, link } = await setup();
  const file = fresh('linked.txt', 'shared\n');
  const twin = path.join(path.dirname(file), 'twin.txt');
  fs.linkSync(file, twin);
  link(twin);
  for (const f of [file, twin]) {
    assert.match((await previewOf(f)).body().readOnly, /hard link/);
    assert.equal((await save(f, 'changed\n', sha('shared\n'))).status, 403);
  }
  assert.equal(fs.readFileSync(twin, 'utf8'), 'shared\n');

  const locked = fresh('locked.txt', 'locked\n', { mode: 0o444 });
  assert.match((await previewOf(locked)).body().readOnly, /read only/);
  assert.equal((await save(locked, 'changed\n', sha('locked\n'))).status, 403);
  assert.equal(fs.readFileSync(locked, 'utf8'), 'locked\n');

  const caged = fresh('caged.txt', 'caged\n');
  fs.chmodSync(path.dirname(caged), 0o555);
  try {
    assert.match((await previewOf(caged)).body().readOnly, /read only/);
    assert.equal((await save(caged, 'changed\n', sha('caged\n'))).status, 403);
    assert.equal(fs.readFileSync(caged, 'utf8'), 'caged\n');
  } finally {
    fs.chmodSync(path.dirname(caged), 0o755);
  }
});

test('a long file, invalid UTF-8 and a NUL past the first 4 KB are not editable, though they open', async () => {
  const { fresh } = await setup();
  const head = 'a'.repeat(5000);
  const cases = {
    long: Buffer.from('x'.repeat(99).concat('\n').repeat(11_000)),
    'invalid UTF-8': Buffer.concat([Buffer.from(head), Buffer.from([0xff, 0xfe]), Buffer.from('tail\n')]),
    NUL: Buffer.concat([Buffer.from(head), Buffer.from([0]), Buffer.from('tail\n')]),
  };
  for (const [what, bytes] of Object.entries(cases)) {
    const file = fresh('odd.txt', bytes);
    const res = await previewOf(file);
    const preview = res.body();
    if (what === 'NUL') assert.equal(preview.kind, 'text', 'it opens as text, because only the first 4 KB are looked at');
    assert.equal(preview.editable, undefined, what);
    assert.match(preview.readOnly, /\S/, what);
    assert.equal((await save(file, 'changed\n', preview.version)).status, 403, what);
    assert.deepEqual(fs.readFileSync(file), bytes, what);
  }
});

test('a file changed on disk since it was opened answers 409 and writes nothing', async () => {
  const { fresh } = await setup();
  const file = fresh('race.txt', 'mine\n');
  const { version } = (await previewOf(file)).body();
  fs.writeFileSync(file, 'theirs\n');
  const res = await save(file, 'my edit\n', version);
  assert.equal(res.status, 409);
  assert.match(res.body().error, /changed on disk/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'theirs\n');
});

test('a save over 1 MB answers 413 and a deleted file 404, and the deleted file is not made again', async () => {
  const { fresh } = await setup();
  const file = fresh('big.txt', 'small\n');
  const { version } = (await previewOf(file)).body();
  const res = await save(file, 'x'.repeat(MAX_TEXT_BYTES + 1), version);
  assert.equal(res.status, 413);
  assert.equal(fs.readFileSync(file, 'utf8'), 'small\n');
  fs.unlinkSync(file);
  assert.equal((await save(file, 'back again\n', version)).status, 404);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), []);
});

test('the route needs a sign-in, this host\'s Origin, no cross-site fetch, a JSON body and the right shape', async () => {
  const { s, token, fresh } = await setup();
  const file = fresh('route.txt', 'start\n');
  const base = sha('start\n');
  const json = { path: file, text: 'changed\n', base };
  const own = headersOf(token, s);
  const refused = async (headers, expected, options = {}) => {
    const res = await request(s, 'POST', '/api/sessions/sess-1/save', { headers, json, ...options });
    assert.equal(res.status, expected, JSON.stringify(headers));
    assert.equal(fs.readFileSync(file, 'utf8'), 'start\n');
    return res;
  };
  await refused({}, 401);
  await refused({ origin: s.origin }, 401);
  await refused({ ...as(token), origin: 'https://evil.example' }, 403);
  await refused(as(token), 403);
  await refused({ ...as(token), origin: 'null' }, 403);
  await refused({ ...own, 'sec-fetch-site': 'cross-site' }, 403);
  await refused(own, 415, { json: undefined, form: { path: file, text: 'changed\n', base } });
  assert.equal((await request(s, 'GET', '/api/sessions/sess-1/save', { headers: own })).headers.allow, 'POST');
  assert.equal((await request(s, 'GET', '/api/sessions/sess-1/save', { headers: own })).status, 405);
  for (const bad of [{}, { path: file }, { path: file, text: 1, base }, { path: file, text: 'x', base: null }, []]) {
    const res = await request(s, 'POST', '/api/sessions/sess-1/save', { headers: own, json: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  const nope = await request(s, 'POST', '/api/sessions/missing/save', { headers: own, json });
  assert.equal(nope.status, 404);
  assert.equal((await request(s, 'POST', '/api/sessions/sess-1/save', { headers: own, json: { ...json, text: 'a\0b' } })).status, 400, 'a NUL in the text');
  assert.equal(fs.readFileSync(file, 'utf8'), 'start\n');
  const ok = await request(s, 'POST', '/api/sessions/sess-1/save', { headers: own, json });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.headers['x-content-type-options'], ok.headers['cross-origin-resource-policy']], ['nosniff', 'same-origin']);
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed\n');
});

test('a save keeps the mode of the file', async () => {
  const { fresh } = await setup();
  for (const mode of [0o640, 0o755]) {
    const file = fresh('mode.txt', 'before\n', { mode });
    assert.equal((await saveNow(file, 'after\n')).status, 200);
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    assert.equal(fs.readFileSync(file, 'utf8'), 'after\n');
  }
});

test('a save keeps the file\'s line endings, its byte order mark and a missing final newline', async () => {
  const { fresh } = await setup();
  const cases = [
    ['CRLF', 'one\r\ntwo\r\nthree\r\n', 'one\ntwo changed\nthree\n', 'one\r\ntwo changed\r\nthree\r\n'],
    ['CRLF with a new line', 'one\r\ntwo\r\n', 'one\nnew\ntwo\n', 'one\r\nnew\r\ntwo\r\n'],
    ['mixed', 'a\r\nb\nc\r\nd\r\n', 'a\nb\nC\nd\n', 'a\r\nb\nC\r\nd\r\n'],
    ['lone CR', 'a\rb\rc\r', 'a\nB\nc\n', 'a\rB\rc\r'],
    ['no final newline', 'one\r\ntwo', 'one\r\ntwo changed'.replace('\r', ''), 'one\r\ntwo changed'],
    ['LF only', 'one\ntwo\n', 'one\ntwo\nthree\n', 'one\ntwo\nthree\n'],
    ['final newline added', 'one\r\ntwo', 'one\ntwo\n', 'one\r\ntwo\r\n'],
  ];
  for (const [what, was, edited, expected] of cases) {
    const file = fresh('ends.txt', was);
    assert.equal((await saveNow(file, edited)).status, 200, what);
    assert.equal(fs.readFileSync(file, 'utf8'), expected, what);
  }
  const bom = fresh('bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo\r\nworld\r\n')]));
  const shown = (await previewOf(bom)).body();
  assert.equal(shown.text.includes('﻿'), false, 'the text box never shows the mark');
  assert.equal((await saveNow(bom, 'héllo\nthere\n')).status, 200);
  assert.deepEqual(fs.readFileSync(bom), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo\r\nthere\r\n')]));
});

test('keepEndings gives an unchanged line its own ending and a changed one the usual', () => {
  assert.equal(keepEndings('a\nb\n', 'a\nB\n'), 'a\nB\n');
  assert.equal(keepEndings('a\r\nb\r\nc\n', 'a\nb\nx\ny\nc\n'), 'a\r\nb\r\nx\r\ny\r\nc\n');
  assert.equal(keepEndings('a\r\nb\r\n', ''), '');
  assert.equal(keepEndings('a\r\nb\r\n', 'a'), 'a');
  assert.equal(keepEndings('', 'x\ny'), 'x\ny');
});

test('two saves of one file at once leave one winner', async () => {
  const { fresh } = await setup();
  const file = fresh('twice.txt', 'start\n');
  const { version } = (await previewOf(file)).body();
  const results = await Promise.all([save(file, 'first\n', version), save(file, 'second\n', version)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.findIndex(r => r.status === 200);
  assert.equal(fs.readFileSync(file, 'utf8'), ['first\n', 'second\n'][winner]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['twice.txt']);
});

test('a write that fails leaves the original whole and no temporary file', async () => {
  const { s, fresh } = await setup();
  const home = process.env.HOME;
  process.env.HOME = s.home;
  const { rename, copyFile } = fsp;
  const linked = () => true;
  try {
    const file = fresh('keep.txt', 'original\n');
    const dir = path.dirname(file);
    const base = sha('original\n');

    fsp.rename = async () => { throw Object.assign(new Error('disk trouble'), { code: 'EIO' }); };
    await assert.rejects(saveFile(file, linked, { text: 'new\n', base }), /disk trouble/);
    fsp.rename = rename;
    assert.equal(fs.readFileSync(file, 'utf8'), 'original\n');
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);

    fsp.rename = async () => { throw Object.assign(new Error('read only'), { code: 'EROFS' }); };
    await assert.rejects(saveFile(file, linked, { text: 'new\n', base }), { status: 403 });
    fsp.rename = rename;
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);

    // Someone else's write lands after the copy is made and before the rename.
    fsp.copyFile = async (...args) => { await copyFile(...args); fs.writeFileSync(file, 'theirs\n'); };
    await assert.rejects(saveFile(file, linked, { text: 'new\n', base }), { status: 409 });
    fsp.copyFile = copyFile;
    assert.equal(fs.readFileSync(file, 'utf8'), 'theirs\n');
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);

    const done = await saveFile(file, linked, { text: 'new\n', base: sha('theirs\n') });
    assert.equal(done.version, sha('new\n'));
  } finally {
    fsp.rename = rename;
    fsp.copyFile = copyFile;
    process.env.HOME = home;
  }
});
