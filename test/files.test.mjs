// Run with `npm test`. The files a reply links to, over HTTP against the real server: a file opens only if the chat's own replies or thoughts
// link to it as written, and what opens is shown as text or bytes and never as a page that can run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { linksOf, MAX_FILE_BYTES, MAX_TEXT_BYTES, previewFile, serveFile } from '../lib/files.mjs';
import { as, request, ROOT, signIn, start } from './harness.mjs';

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const TEXT_TYPE = 'text/plain; charset=utf-8';
const SANDBOX = "sandbox; default-src 'none'";

const entry = (type, content, extra = {}) => ({ type, uuid: `e${Math.random().toString(36).slice(2)}`, message: { id: `m${Math.random().toString(36).slice(2)}`, role: type, content }, ...extra });
const said = text => entry('assistant', [{ type: 'text', text }]);
const thought = thinking => entry('assistant', [{ type: 'thinking', thinking }]);
const asked = text => entry('user', text);
const lines = entries => entries.map(e => `${JSON.stringify(e)}\n`).join('');

// How many characters of a thought the page is sent, which config.json sets and config.local.json can change.
const CUT = ['config.json', 'config.local.json'].reduce((n, name) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')).outputChars ?? n; } catch { return n; }
}, undefined);

// What a response must carry so a browser does not read the JSON about a file as anything else.
const guarded = res => assert.deepEqual([res.headers['x-content-type-options'], res.headers['cross-origin-resource-policy']], ['nosniff', 'same-origin']);

// Every file handle opened through fs/promises while this runs, to see which are closed again.
async function watchOpens(run) {
  const handles = [];
  const open = fsp.open;
  fsp.open = async (...args) => { const handle = await open.apply(fsp, args); handles.push(handle); return handle; };
  try { await run(handles); } finally { fsp.open = open; }
  return handles;
}

// The server's bytes, which the test harness's own request would decode as text.
function bytes(s, token, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: s.port, path: url, headers: { host: `localhost:${s.port}`, ...as(token) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

let fixture = null;

// One server and one chat, whose replies link to every file below, shared by the tests. They run one at a time.
function setup() {
  fixture ||= (async () => {
    const s = await start();
    const dir = fs.mkdtempSync(path.join(s.home, 'linked-'));
    const at = name => path.join(dir, name);
    const write = (name, content) => fs.writeFileSync(at(name), content);
    write('note.txt', 'line one\nline two\nline three\n');
    write('doc.md', '# Heading\n\nSome *words*.\n');
    write('pic.png', PNG);
    write('doc.pdf', '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    write('blob.bin', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0xff, 0xfe, 0, 1, 2, 3]));
    write('page.html', '<!doctype html><script>alert(1)</script><h1>hi</h1>');
    write('pic.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    write('with space.txt', 'spaced\n');
    write('target.txt', 'the target of a link\n');
    write('long.txt', 'x'.repeat(99).concat('\n').repeat(15_000));
    write('empty.txt', '');
    write('secret.txt', 'never linked\n');
    write('user-only.txt', 'only the user linked this\n');
    write('in-tool.txt', 'only a tool result linked this\n');
    write('fenced.txt', 'only a code block names this\n');
    write('naïve café.txt', 'a name with letters outside ASCII\n');
    write('locked.txt', 'cannot be read\n');
    write('pct file.txt', 'linked with the space written as %20\n');
    write('before-cut.txt', 'linked early in a thought\n');
    write('past-cut.txt', 'linked after the page stops reading a thought\n');
    write('across-cut.txt', 'linked across the end of what a thought is cut to\n');
    write('reply-past-cut.txt', 'linked late in a reply, which is not cut\n');
    fs.chmodSync(at('locked.txt'), 0o000);
    fs.mkdirSync(at('folder'));
    fs.symlinkSync(at('target.txt'), at('link.txt'));
    fs.symlinkSync(at('nowhere.txt'), at('dangling.txt'));
    fs.symlinkSync(at('folder'), at('to-folder'));
    fs.symlinkSync(at('loop-b'), at('loop-a'));
    fs.symlinkSync(at('loop-a'), at('loop-b'));
    execFileSync('mkfifo', [at('pipe')]);
    const big = fs.openSync(at('big.bin'), 'w');
    fs.ftruncateSync(big, MAX_FILE_BYTES + 1);
    fs.closeSync(big);
    fs.mkdirSync(path.join(s.home, 'notes'));
    fs.writeFileSync(path.join(s.home, 'notes', 'n.md'), 'from the home folder\n');

    const folder = path.join(s.home, '.claude', 'projects', '-work');
    fs.mkdirSync(folder, { recursive: true });
    const transcript = path.join(folder, 'sess-1.jsonl');
    const link = (label, name) => `[${label}](<${at(name)}>)`;
    fs.writeFileSync(transcript, lines([
      asked(`Look at [theirs](<${at('user-only.txt')}>)`),
      said(['Here they are:', ...['note.txt', 'doc.md', 'pic.png', 'doc.pdf', 'blob.bin', 'page.html', 'pic.svg', 'with space.txt', 'long.txt', 'empty.txt', 'naïve café.txt', 'locked.txt', 'folder', 'link.txt', 'dangling.txt', 'to-folder', 'loop-a', 'pipe', 'big.bin', 'missing.txt'].map(name => `- ${link(name, name)}`)].join('\n')),
      said(`And [the home one](~/notes/n.md) and [line two](<${at('note.txt')}:2>)\n\n\`\`\`\n${at('fenced.txt')}\n\`\`\``),
      said(`And [an escaped one](${at('pct file.txt').replaceAll(' ', '%20')})`),
      thought(`I should look at ${link('my thought', 'target.txt')}`),
      thought(`${link('early', 'before-cut.txt')} ${'x'.repeat(CUT)} ${link('late', 'past-cut.txt')}`),
      thought(`${'x'.repeat(CUT - 10)}${link('straddling', 'across-cut.txt')}`),
      said(`${'x'.repeat(CUT)} ${link('late in a reply', 'reply-past-cut.txt')} and [the null device](</dev/null>)`),
      entry('user', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `[a result](<${at('in-tool.txt')}>)` }]),
    ]));
    const { token } = await signIn(s);
    return { s, token, dir, at, transcript, link };
  })();
  return fixture;
}

const get = async (url, headers) => { const { s, token } = await setup(); return request(s, 'GET', url, { headers: headers ?? as(token) }); };
const previewOf = async file => get(`/api/sessions/sess-1/preview?path=${encodeURIComponent(file)}`);
const fileOf = async (file, extra = '') => { const { s, token } = await setup(); return bytes(s, token, `/api/sessions/sess-1/file?path=${encodeURIComponent(file)}${extra}`); };
const errorOf = res => res.body().error;

test('a signed-out browser is refused both routes, and the messages say the routes exist once it signs in', async () => {
  const { s, token, at } = await setup();
  const url = what => `/api/sessions/sess-1/${what}?path=${encodeURIComponent(at('note.txt'))}`;
  assert.equal((await request(s, 'GET', url('preview'))).status, 401);
  assert.equal((await request(s, 'GET', url('file'))).status, 401);
  const messages = await request(s, 'GET', '/api/sessions/sess-1/messages', { headers: as(token) });
  assert.equal(messages.status, 200);
  assert.equal(messages.body().fileLinks, true);
});

test('a path nothing in the chat links to is refused for both routes, however it is written, and even when the file is there', async () => {
  const { at } = await setup();
  const unlinked = [
    ['a file that exists and is not named at all', at('secret.txt')],
    ['one the user linked, which is not the chat\'s own text', at('user-only.txt')],
    ['one a tool result linked', at('in-tool.txt')],
    ['one only a code block names', at('fenced.txt')],
  ];
  for (const [what, file] of unlinked) {
    const preview = await previewOf(file);
    const served = await fileOf(file);
    assert.equal(preview.status, 403, what);
    assert.equal(served.status, 403, what);
    guarded(preview);
    guarded(served);
    assert.equal(served.body.toString().includes('never linked'), false, what);
  }
  assert.match(errorOf(await previewOf(at('secret.txt'))), /does not link to that file/);
});

test('a path that is not a plain path to a file is refused before anything is read', async () => {
  const { at } = await setup();
  const refused = [
    ['no path at all', ''],
    ['a relative path', 'note.txt'],
    ['a path with ..', `${at('folder')}/../note.txt`],
    ['a path with a line on it', `${at('note.txt')}:2`],
    ['a root', '/'],
    ['a trailing slash', `${at('folder')}/`],
    ['a file URL', `file://${at('note.txt')}`],
  ];
  const { s, token } = await setup();
  for (const [what, file] of refused) {
    for (const what2 of ['preview', 'file']) {
      const res = await request(s, 'GET', `/api/sessions/sess-1/${what2}?path=${encodeURIComponent(file)}`, { headers: as(token) });
      assert.equal(res.status, 400, `${what} ${what2}`);
      guarded(res);
    }
  }
  const none = await request(s, 'GET', '/api/sessions/sess-1/preview', { headers: as(token) });
  assert.equal(none.status, 400);
  assert.equal(errorOf(none), 'Which file?');
  guarded(none);
  const nobody = await request(s, 'GET', '/api/sessions/no-such-chat/preview?path=%2Fx', { headers: as(token) });
  assert.equal(nobody.status, 404);
  guarded(nobody);
});

test('a linked text file is read as text, and the preview names it, sizes it and says what kind it is', async () => {
  const { at } = await setup();
  const res = await previewOf(at('note.txt'));
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  guarded(res);
  const preview = res.body();
  assert.deepEqual({ ...preview, real: undefined }, { name: 'note.txt', path: at('note.txt'), real: undefined, size: 29, kind: 'text', type: TEXT_TYPE, text: 'line one\nline two\nline three\n', version: sha256('line one\nline two\nline three\n'), editable: true });
  assert.equal(preview.real, fs.realpathSync(at('note.txt')));
  assert.equal(preview.truncated, undefined);
});

test('a link with a line on it opens the file by its path, a thought can link a file, and a path with spaces or letters outside ASCII works', async () => {
  const { at } = await setup();
  assert.equal((await previewOf(at('note.txt'))).status, 200, 'linked as note.txt:2, and note.txt is the file');
  assert.equal((await previewOf(at('target.txt'))).body().text, 'the target of a link\n', 'linked only by a thought');
  assert.equal((await previewOf(at('with space.txt'))).body().text, 'spaced\n');
  assert.equal((await previewOf(at('naïve café.txt'))).body().text, 'a name with letters outside ASCII\n');
});

test('a link written with %20 for a space opens the file by its decoded path, which is the path the page asks for', async () => {
  const { at } = await setup();
  const res = await previewOf(at('pct file.txt'));
  assert.equal(res.status, 200);
  assert.deepEqual([res.body().name, res.body().path, res.body().text], ['pct file.txt', at('pct file.txt'), 'linked with the space written as %20\n']);
  assert.equal((await fileOf(at('pct file.txt'))).status, 200);
  assert.equal((await previewOf(at('pct file.txt').replaceAll(' ', '%20'))).status, 403, 'the escaped spelling is not a path the chat links to');
});

test('each kind of file is told apart by its bytes and its name', async () => {
  const { at } = await setup();
  const kinds = {};
  for (const name of ['note.txt', 'doc.md', 'pic.png', 'doc.pdf', 'blob.bin', 'page.html', 'pic.svg', 'empty.txt']) {
    const p = (await previewOf(at(name))).body();
    kinds[name] = [p.kind, p.type];
  }
  assert.deepEqual(kinds, {
    'note.txt': ['text', TEXT_TYPE],
    'doc.md': ['markdown', TEXT_TYPE],
    'pic.png': ['image', 'image/png'],
    'doc.pdf': ['pdf', 'application/pdf'],
    'blob.bin': ['binary', 'application/octet-stream'],
    'page.html': ['text', TEXT_TYPE],
    'pic.svg': ['text', TEXT_TYPE],
    'empty.txt': ['text', TEXT_TYPE],
  });
  assert.equal((await previewOf(at('empty.txt'))).body().text, '');
  assert.equal((await previewOf(at('pic.png'))).body().text, undefined, 'a picture is not sent as text');
  assert.equal((await previewOf(at('blob.bin'))).body().text, undefined);
});

test('a long text file is cut back to its last whole line within a megabyte, and says it was cut', async () => {
  const { at } = await setup();
  const preview = (await previewOf(at('long.txt'))).body();
  assert.equal(preview.size, 15_000 * 100);
  assert.equal(preview.truncated, true);
  assert.ok(Buffer.byteLength(preview.text) <= MAX_TEXT_BYTES);
  assert.ok(Buffer.byteLength(preview.text) > MAX_TEXT_BYTES - 100);
  assert.equal(preview.text.endsWith('x\n'), true);
  assert.equal(preview.text.length % 100, 0);
});

test('a file over the limit is described and never sent, a folder, a pipe and a missing file are refused, and a pipe does not hold the server', { timeout: 20_000 }, async () => {
  const { at } = await setup();
  const big = await previewOf(at('big.bin'));
  assert.equal(big.status, 200);
  assert.deepEqual([big.body().kind, big.body().tooLarge, big.body().size, big.body().text], ['binary', true, MAX_FILE_BYTES + 1, undefined]);
  const served = await fileOf(at('big.bin'));
  assert.equal(served.status, 413);
  assert.match(JSON.parse(served.body).error, /20 MB/);
  guarded(served);

  const folder = await previewOf(at('folder'));
  assert.equal(folder.status, 415);
  assert.equal(errorOf(folder), 'That is a folder, not a file.');
  guarded(folder);
  assert.equal((await fileOf(at('folder'))).status, 415);
  assert.equal((await previewOf(at('to-folder'))).status, 415, 'a link to a folder is a folder');

  const started = Date.now();
  const pipe = await previewOf(at('pipe'));
  assert.equal(pipe.status, 415);
  assert.equal(errorOf(pipe), 'GhostShell opens plain files only.');
  assert.equal((await fileOf(at('pipe'))).status, 415);
  assert.ok(Date.now() - started < 5000, 'both answered at once');
  assert.equal((await previewOf(at('empty.txt'))).status, 200, 'and the server still answers');

  const missing = await previewOf(at('missing.txt'));
  assert.equal(missing.status, 404);
  assert.equal(errorOf(missing), 'There is no file at that path.');
  guarded(missing);
  assert.equal((await previewOf(at('dangling.txt'))).status, 404, 'a link to nothing');
  assert.equal((await previewOf(at('loop-a'))).status, 404, 'links that lead round to themselves');
});

test('a file the server cannot read is refused with the reason', { skip: process.getuid?.() === 0 && 'root reads everything' }, async () => {
  const { at } = await setup();
  const res = await previewOf(at('locked.txt'));
  assert.equal(res.status, 403);
  assert.equal(errorOf(res), 'GhostShell cannot read that file.');
});

test('a linked symlink is served from what it points at, and the preview says where that is', async () => {
  const { at } = await setup();
  const res = await previewOf(at('link.txt'));
  assert.equal(res.status, 200);
  assert.equal(res.body().text, 'the target of a link\n');
  assert.equal(res.body().name, 'link.txt');
  assert.equal(res.body().real, fs.realpathSync(at('target.txt')));
  assert.equal((await fileOf(at('link.txt'))).body.toString(), 'the target of a link\n');
});

test('a path that starts with ~/ is the signed-in Mac user\'s home folder', async () => {
  const { s } = await setup();
  const res = await previewOf('~/notes/n.md');
  assert.equal(res.status, 200);
  assert.deepEqual([res.body().kind, res.body().text, res.body().path, res.body().real], ['markdown', 'from the home folder\n', '~/notes/n.md', fs.realpathSync(path.join(s.home, 'notes', 'n.md'))]);
  assert.equal((await fileOf('~/notes/n.md')).body.toString(), 'from the home folder\n');
  assert.equal((await previewOf('~/notes/other.md')).status, 403, 'a different path under home is not linked');
});

test('the bytes of a file go out with the type Capcom decided and the headers that keep them from running', async () => {
  const { at } = await setup();
  const text = await fileOf(at('note.txt'));
  assert.equal(text.status, 200);
  assert.equal(text.body.toString(), 'line one\nline two\nline three\n');
  assert.deepEqual({
    type: text.headers['content-type'], length: text.headers['content-length'], sniff: text.headers['x-content-type-options'], csp: text.headers['content-security-policy'],
    corp: text.headers['cross-origin-resource-policy'], cache: text.headers['cache-control'], disposition: text.headers['content-disposition'],
  }, {
    type: TEXT_TYPE, length: '29', sniff: 'nosniff', csp: SANDBOX, corp: 'same-origin', cache: 'no-store', disposition: 'inline; filename="note.txt"; filename*=UTF-8\'\'note.txt',
  });

  for (const name of ['page.html', 'pic.svg', 'blob.bin']) {
    const res = await fileOf(at(name));
    assert.equal(res.headers['content-type'], name === 'blob.bin' ? 'application/octet-stream' : TEXT_TYPE, name);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', name);
    assert.equal(res.headers['content-security-policy'], SANDBOX, name);
    assert.equal(res.body.equals(fs.readFileSync(at(name))), true, name);
  }

  const png = await fileOf(at('pic.png'));
  assert.equal(png.headers['content-type'], 'image/png');
  assert.equal(png.body.equals(PNG), true);

  const pdf = await fileOf(at('doc.pdf'));
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.headers['x-content-type-options'], 'nosniff');
  assert.equal(pdf.headers['content-security-policy'], undefined, 'Chrome\'s PDF viewer refuses a sandboxed document');
  assert.equal(pdf.headers['cross-origin-resource-policy'], 'same-origin');

  const empty = await fileOf(at('empty.txt'));
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.headers['content-length'], empty.body.length], ['0', 0]);
  assert.equal((await fileOf(at('long.txt'))).body.length, 1_500_000, 'a long file is sent whole');
});

test('a download is an attachment, and a name with letters outside ASCII is sent in both forms', async () => {
  const { at } = await setup();
  const plain = await fileOf(at('note.txt'), '&download=1');
  assert.equal(plain.headers['content-disposition'], 'attachment; filename="note.txt"; filename*=UTF-8\'\'note.txt');
  const odd = await fileOf(at('naïve café.txt'));
  assert.equal(odd.headers['content-disposition'], 'inline; filename="na_ve caf_.txt"; filename*=UTF-8\'\'na%C3%AFve%20caf%C3%A9.txt');
  assert.equal(odd.body.toString(), 'a name with letters outside ASCII\n');
});

test('a link a reply gains after the first read opens, so the scan follows the transcript as it grows', async () => {
  const { at, transcript } = await setup();
  assert.equal((await previewOf(at('secret.txt'))).status, 403);
  fs.appendFileSync(transcript, lines([said(`Now [the secret](<${at('secret.txt')}>)`)]));
  const res = await previewOf(at('secret.txt'));
  assert.equal(res.status, 200);
  assert.equal(res.body().text, 'never linked\n');
});

test('the reply a chat is writing now can be opened before it is saved, and a chat with nothing saved opens nothing else', () => {
  const linked = linksOf(null, 'Here is [one](</tmp/live one.txt:4>) and /tmp/two.txt, but not `ls /tmp/three.txt`.', CUT);
  assert.deepEqual(['/tmp/live one.txt', '/tmp/two.txt', '/tmp/three.txt', '/tmp/live one.txt:4'].map(linked), [true, true, false, false]);
  assert.equal(linksOf(null, '', CUT)('/tmp/two.txt'), false);
});

test('a thought is read cut where the page is sent it cut, so a file linked past that point is refused, and a reply is not cut', async () => {
  const { at } = await setup();
  assert.equal((await previewOf(at('before-cut.txt'))).status, 200, 'linked early in a thought');
  for (const name of ['past-cut.txt', 'across-cut.txt']) {
    assert.equal((await previewOf(at(name))).status, 403, `${name} is in text the page never receives`);
    assert.equal((await fileOf(at(name))).status, 403, name);
  }
  assert.equal((await previewOf(at('reply-past-cut.txt'))).status, 200, 'a reply is sent whole');
});

test('linksOf reads a thought cut at the limit it is given, a reply whole, and keeps a scan for each limit', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-links-')), 't.jsonl');
  fs.writeFileSync(file, lines([thought('see /tmp/abc/def.txt now'), said(`then ${'x'.repeat(50)} /tmp/reply/after.txt`)]));
  const t = { file };
  const paths = ['/tmp/abc', '/tmp/abc/def.txt', '/tmp/reply/after.txt'];
  const cut = linksOf(t, '', 12);
  assert.deepEqual(paths.map(cut), [true, false, true], 'the thought ends at "see /tmp/abc"');
  assert.deepEqual(paths.map(linksOf(t, '', 1000)), [false, true, true], 'a limit past the thought reads all of it');
  assert.deepEqual(paths.map(linksOf(t, '', 12)), [true, false, true], 'and the first limit is as it was');
  assert.deepEqual(paths.map(linksOf(t)), [false, true, true], 'no limit reads it all');
  fs.appendFileSync(file, lines([thought('and /tmp/more/later.txt')]));
  assert.deepEqual(['/tmp/more/later.txt', '/tmp/more'].map(linksOf(t, '', 1000)), [true, false], 'a scan follows the file as it grows');
  assert.deepEqual(['/tmp/more/later.txt', '/tmp/more'].map(linksOf(t, '', 12)), [false, false], 'the thought is cut before the path, so it is still not linked');
});

test('a device is refused as not a plain file without being opened, since opening a serial port can reset the board on it', async () => {
  const opened = await watchOpens(async () => {
    for (const device of ['/dev/null', '/dev/zero']) {
      await assert.rejects(previewFile(device, () => true), { status: 415, message: 'GhostShell opens plain files only.' }, device);
      await assert.rejects(serveFile(device, () => true, false), { status: 415, message: 'GhostShell opens plain files only.' }, device);
    }
  });
  assert.equal(opened.length, 0);
  const { at } = await setup();
  await watchOpens(async () => assert.equal((await previewFile(at('note.txt'), () => true)).kind, 'text'));
  const res = await previewOf('/dev/null');
  assert.equal(res.status, 415, 'and over HTTP, for a chat that links to it');
  assert.equal(errorOf(res), 'GhostShell opens plain files only.');
  assert.equal((await fileOf('/dev/null')).status, 415);
});

test('every file opened is closed again, whether it was previewed, refused, empty, sent whole, cut short or dropped before a read', async () => {
  const { at } = await setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-closed-'));
  const make = (name, size) => { const file = path.join(dir, name); fs.writeFileSync(file, Buffer.alloc(size, 0x61)); return file; };
  const whole = make('whole.txt', 200 * 1024);
  const empty = make('empty.txt', 0);
  const huge = path.join(dir, 'huge.bin');
  fs.closeSync(fs.openSync(huge, 'w'));
  fs.truncateSync(huge, MAX_FILE_BYTES + 1);
  const all = () => true;
  const drain = async stream => { for await (const chunk of stream) void chunk; };

  const handles = await watchOpens(async () => {
    await previewFile(at('note.txt'), all);
    await previewFile(at('pic.png'), all);
    await previewFile(huge, all);
    await assert.rejects(serveFile(huge, all, false), { status: 413 });
    assert.equal((await serveFile(empty, all, false)).stream, null);
    await drain((await serveFile(whole, all, false)).stream);
    const dropped = (await serveFile(whole, all, false)).stream;
    dropped.destroy();
    await once(dropped, 'close');
    const halfway = (await serveFile(whole, all, false)).stream;
    await halfway[Symbol.asyncIterator]().next();
    halfway.destroy();
    await once(halfway, 'close');
  });
  assert.equal(handles.length, 8);
  assert.deepEqual(handles.map(h => h.fd), Array(8).fill(-1));
});

test('a file that shrinks while it is sent fails the stream, so the response is cut short and the browser does not wait on a length it will never get', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-shrinks-')), 'shrinks.bin');
  fs.writeFileSync(file, Buffer.alloc(300 * 1024, 0x62));
  let got = 0;
  let handle = null;
  await watchOpens(async handles => {
    const { headers, stream } = await serveFile(file, () => true, false);
    handle = handles[0];
    assert.equal(headers['content-length'], 300 * 1024);
    const sink = new Writable({
      write(chunk, encoding, done) {
        if (!got) fs.truncateSync(file, 10);
        got += chunk.length;
        done();
      },
    });
    await assert.rejects(pipeline(stream, sink), /got shorter/);
  });
  assert.ok(got < 300 * 1024, 'it stopped short of the length it promised');
  assert.equal(handle.fd, -1, 'and the file was closed');
});
