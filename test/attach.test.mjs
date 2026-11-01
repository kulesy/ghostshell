// Run with `npm test`. What the page does with a file that is picked, pasted or dropped: how a card is labelled, and where each file goes
// (an image to the message itself, anything else to the server), against a fake server and no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attach, attachedTo, attachments, checkUploads, detachFile, draftText, keepDrafts, NEW, pastedFiles, setDraftText, uploads } from '../public/ui/draft.js';
import { extension, glyph, kindLabel, metaLine, sizeLabel } from '../public/ui/files.js';

test('the kind on a card is the file\'s own type for the common ones and the capitalised extension for the rest', () => {
  const kinds = ['a.pdf', 'a.CSV', 'a.doc', 'a.docx', 'a.xls', 'a.xlsx', 'a.ppt', 'a.pptx', 'a.txt', 'a.md', 'a.json', 'a.zip', 'a.html', 'a.tar.gz', 'noext', '.gitignore', 'a.', '']
    .map(kindLabel);
  assert.deepEqual(kinds, ['PDF', 'CSV', 'Word', 'Word', 'Excel', 'Excel', 'PowerPoint', 'PowerPoint', 'Text', 'Markdown', 'JSON', 'ZIP', 'HTML', 'GZ', 'File', 'File', 'File', 'File']);
  assert.deepEqual(['a.toString', 'a.valueOf'].map(kindLabel), ['TOSTRING', 'VALUEOF'], 'an extension is not looked up as a property of the table');
});

test('the extension is the last plain one, as the server reads it', () => {
  assert.deepEqual(['a.PDF', 'a.tar.gz', 'a', '.bashrc', 'a.', 'a.b c', 'a.ab12', 'a.abcdefghijk', 'a\n.txt'].map(extension), ['pdf', 'gz', '', '', '', '', 'ab12', '', 'txt']);
});

test('the glyph is the extension in capitals cut to four, and FILE without one', () => {
  assert.deepEqual(['a.pdf', 'a.markdown', 'a.docx', 'a'].map(glyph), ['PDF', 'MARK', 'DOCX', 'FILE']);
});

test('a size is in bytes under 1 KB, whole KB under 1 MB, and MB with one decimal after that', () => {
  assert.deepEqual([0, 1, 1023, 1024, 1536, 1048575, 1048576, 1_258_291, 30 * 1024 * 1024].map(sizeLabel), ['0 B', '1 B', '1023 B', '1 KB', '2 KB', '1.0 MB', '1.0 MB', '1.2 MB', '30.0 MB']);
  assert.equal(sizeLabel(null), '');
  assert.equal(sizeLabel(undefined), '');
});

test('the line under the name says the kind and size, or that the file is still uploading', () => {
  assert.equal(metaLine({ name: 'report.pdf', size: 1_258_291 }), 'PDF · 1.2 MB');
  assert.equal(metaLine({ name: 'notes', size: 12 }), 'File · 12 B');
  assert.equal(metaLine({ name: 'gone.md', size: null }), 'Markdown');
  assert.equal(metaLine({ name: 'report.pdf', size: 5, uploading: true }), 'Uploading…');
});

const LIMITS = { maxBytes: 30 * 1024 * 1024, maxFiles: 10 };
const reply = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
const file = (name, type, size = 100) => ({ name, type, size });
// The draft the tests attach to, as the prompt box of the session `s1` would.
const S = 's1';
const mine = (key = S) => attachedTo(attachments.get(), key);
const reset = () => {
  attachments.set(s => Object.fromEntries(Object.keys(s).map(key => [key, undefined])));
  uploads.set({ limits: null });
};

// A fake server for one test. `upload(init)` answers each POST of a file, and `limits` is what GET api/uploads says, or null for a server that has no such route.
async function withServer({ limits = LIMITS, upload = async () => reply({}) } = {}, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    if (String(url) === 'api/uploads' && init?.method !== 'POST') return limits ? reply(limits) : reply({ error: 'Not found' }, 404);
    return upload(init, calls.filter(c => c[1]?.method === 'POST').length);
  };
  reset();
  const notices = [];
  try { await run({ calls, notices, notice: m => notices.push(m), posts: () => calls.filter(c => c[1]?.method === 'POST') }); } finally { globalThis.fetch = real; reset(); }
}
const saves = async init => { const name = decodeURIComponent(init.headers['x-file-name']); return reply({ id: `id-${name}`, name, type: 'text/plain', size: 100 }); };

test('a file that is not an image is uploaded with its name in a header and itself as the body, and its card is ready with an id once the server has it', async () => {
  await withServer({ upload: saves }, async ({ posts, notices, notice }) => {
    const pdf = file('Quarterly report é.pdf', 'application/pdf');
    await attach(S, [pdf], notice);
    assert.equal(posts().length, 1);
    const [url, init] = posts()[0];
    assert.equal(url, 'api/uploads');
    assert.equal(init.body, pdf);
    assert.equal(decodeURIComponent(init.headers['x-file-name']), pdf.name);
    assert.deepEqual(mine().files.map(({ key, abort, ...rest }) => rest), [{ id: `id-${pdf.name}`, name: pdf.name, size: 100, type: 'text/plain' }]);
    assert.deepEqual(notices, []);
  });
});

test('the card shows at once as uploading, and Send waits for it', async () => {
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  await withServer({ upload: () => held }, async ({ notice }) => {
    const sending = attach(S, [file('a.csv', 'text/csv')], notice);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(mine().files.map(f => [f.name, f.uploading === true]), [['a.csv', true]]);
    finish(reply({ id: 'x1', name: 'a.csv', type: 'text/csv', size: 100 }));
    await sending;
    assert.equal(mine().files[0].uploading, undefined);
    assert.equal(mine().files[0].id, 'x1');
  });
});

test('a refused upload drops its card and shows the server\'s words, and a network failure says which file', async () => {
  await withServer({ upload: async () => reply({ error: 'big.bin is over the 30 MB limit.' }, 413) }, async ({ notices, notice }) => {
    await attach(S, [file('big.bin', 'application/octet-stream')], notice);
    assert.deepEqual(mine().files, []);
    assert.deepEqual(notices, ['big.bin is over the 30 MB limit.']);
  });
  await withServer({ upload: async () => { throw new TypeError('Failed to fetch'); } }, async ({ notices, notice }) => {
    await attach(S, [file('a.txt', 'text/plain')], notice);
    assert.deepEqual(mine().files, []);
    assert.deepEqual(notices, ['a.txt could not be uploaded.']);
  });
});

test('a file over the server\'s size is refused by the page before anything is sent', async () => {
  await withServer({ upload: saves }, async ({ calls, notices, notice }) => {
    await attach(S, [file('huge.mov', 'video/quicktime', LIMITS.maxBytes + 1)], notice);
    assert.deepEqual(notices, ['huge.mov is over the 30 MB limit.']);
    assert.equal(calls.some(c => c[1]?.method === 'POST'), false);
    assert.deepEqual(mine().files, []);
  });
});

test('files past the server\'s limit are left out with one notice', async () => {
  await withServer({ limits: { maxBytes: LIMITS.maxBytes, maxFiles: 2 }, upload: saves }, async ({ posts, notices, notice }) => {
    await attach(S, [file('a.txt', 'text/plain'), file('b.txt', 'text/plain'), file('c.txt', 'text/plain')], notice);
    assert.equal(posts().length, 2);
    assert.deepEqual(notices, ['A message can hold up to 2 files.']);
    assert.deepEqual(mine().files.map(f => f.name), ['a.txt', 'b.txt']);
    await attach(S, [file('d.txt', 'text/plain')], notice);
    assert.equal(posts().length, 2, 'a full message takes no more');
    assert.deepEqual(notices.at(-1), 'A message can hold up to 2 files.');
  });
});

test('removing a card that is still uploading stops the upload and says nothing', async () => {
  let signal;
  await withServer({ upload: init => new Promise((_, reject) => { signal = init.signal; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) }, async ({ notices, notice }) => {
    const sending = attach(S, [file('a.txt', 'text/plain')], notice);
    await new Promise(resolve => setTimeout(resolve, 0));
    detachFile(S, mine().files[0].key);
    await sending;
    assert.equal(signal.aborted, true);
    assert.deepEqual(mine().files, []);
    assert.deepEqual(notices, []);
  });
});

test('an old server with no file route takes images only: a PDF gets the notice it always did and nothing is posted', async () => {
  await withServer({ limits: null }, async ({ calls, notices, notice }) => {
    await attach(S, [file('report.pdf', 'application/pdf')], notice);
    assert.deepEqual(notices, ['report.pdf is not a PNG, JPEG, GIF or WebP image.']);
    assert.deepEqual(mine().files, []);
    assert.equal(mine().preparing, 0);
    assert.equal(uploads.get().limits, null);
    assert.equal(calls.some(c => c[1]?.method === 'POST'), false);
  });
});

test('a server that gains the route is noticed the next time a file that is not an image arrives', async () => {
  await withServer({ limits: null, upload: saves }, async ({ notices, notice }) => {
    await checkUploads();
    assert.equal(uploads.get().limits, null);
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url) === 'api/uploads' && init?.method !== 'POST' ? reply(LIMITS) : real(url, init));
    await attach(S, [file('a.txt', 'text/plain')], notice);
    globalThis.fetch = real;
    assert.deepEqual(uploads.get().limits, LIMITS);
    assert.deepEqual(mine().files.map(f => f.name), ['a.txt']);
    assert.deepEqual(notices, []);
  });
});

test('an SVG is a file, not an image, and an image the browser cannot read goes up as the file it is', async () => {
  const real = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => { throw new Error('cannot decode'); };
  try {
    await withServer({ upload: saves }, async ({ posts, notices, notice }) => {
      await attach(S, [file('logo.svg', 'image/svg+xml'), file('photo.heic', 'image/heic')], notice);
      assert.deepEqual(posts().map(([, init]) => decodeURIComponent(init.headers['x-file-name'])).sort(), ['logo.svg', 'photo.heic']);
      assert.deepEqual(notices, []);
      assert.equal(mine().preparing, 0);
      assert.deepEqual(mine().images, []);
    });
    await withServer({ upload: saves }, async ({ posts, notices, notice }) => {
      await attach(S, [file('broken.png', 'image/png')], notice);
      assert.equal(posts().length, 0, 'one of the four image types that will not decode is still an error');
      assert.deepEqual(notices, ['broken.png could not be read as an image.']);
    });
  } finally {
    globalThis.createImageBitmap = real;
  }
});

test('a paste on an old server keeps only the images, as before files, and asks again in the background when anything else was pasted', async () => {
  await withServer({ limits: null }, async ({ calls }) => {
    const [png, pdf] = [file('a.png', 'image/png'), file('a.pdf', 'application/pdf')];
    assert.deepEqual(pastedFiles([pdf]), [], 'a pasted PDF is left to the browser, exactly as before');
    assert.deepEqual(pastedFiles([png, pdf]), [png]);
    assert.deepEqual(pastedFiles([png]), [png]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.filter(c => c[0] === 'api/uploads').length, 2, 'asked once for each paste that held a file that is not an image, and not for an image alone');
  });
});

test('a paste after the old server has been updated takes every file once the background ask has answered, and an updated server is not asked again', async () => {
  await withServer({ limits: null }, async ({ calls }) => {
    const pdf = file('a.pdf', 'application/pdf');
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url) === 'api/uploads' && init?.method !== 'POST' ? reply(LIMITS) : real(url, init));
    assert.deepEqual(pastedFiles([pdf]), [], 'the first paste still goes to the browser');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(uploads.get().limits, LIMITS);
    const asked = calls.length;
    const png = file('a.png', 'image/png');
    assert.deepEqual(pastedFiles([pdf, png]), [pdf, png], 'the next paste is taken whole');
    assert.equal(calls.length, asked, 'and asks nothing');
    globalThis.fetch = real;
  });
});

test('each session has its own text, and an empty box leaves no draft behind', () => {
  setDraftText('s1', 'for one');
  setDraftText('s2', 'for two');
  setDraftText(NEW, 'for a new session');
  assert.deepEqual(['s1', 's2', NEW, 's3'].map(draftText), ['for one', 'for two', 'for a new session', '']);
  setDraftText('s1', '');
  assert.equal(draftText('s1'), '');
  keepDrafts(new Set());
});

test('a file still uploading lands in the draft it was attached in, while another session takes its own', async () => {
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  await withServer({ upload: (init, n) => (n === 1 ? held : saves(init)) }, async ({ notice }) => {
    const sending = attach(S, [file('a.csv', 'text/csv')], notice);
    await new Promise(resolve => setTimeout(resolve, 0));
    await attach('s2', [file('b.txt', 'text/plain')], notice);
    finish(reply({ id: 'x1', name: 'a.csv', type: 'text/csv', size: 100 }));
    await sending;
    assert.deepEqual(mine().files.map(f => [f.id, f.uploading]), [['x1', undefined]]);
    assert.deepEqual(mine('s2').files.map(f => f.name), ['b.txt']);
    assert.deepEqual(mine(NEW).files, []);
  });
});

test('the drafts of sessions the list no longer holds are dropped, an upload in one is stopped, and the open chat and a new session keep theirs', async () => {
  let signal;
  await withServer({ upload: init => new Promise((_, reject) => { signal = init.signal; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) }, async ({ notices, notice }) => {
    for (const key of ['s1', 's2', 'open', NEW]) setDraftText(key, `text ${key}`);
    const sending = attach('s2', [file('a.txt', 'text/plain')], notice);
    await new Promise(resolve => setTimeout(resolve, 0));
    keepDrafts(new Set(['s1']), 'open');
    await sending;
    assert.equal(signal.aborted, true);
    assert.deepEqual(mine('s2').files, []);
    assert.deepEqual(notices, []);
    assert.deepEqual(['s1', 's2', 'open', NEW].map(draftText), ['text s1', '', 'text open', `text ${NEW}`]);
    keepDrafts(new Set());
    setDraftText(NEW, '');
  });
});
