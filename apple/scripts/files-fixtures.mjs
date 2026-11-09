// A stub server for the file screenshots. It answers sign-in, the session list and one chat whose replies link a markdown file, a text file, a PDF, two
// audio clips, a binary file, a picture and a file that is not there, and whose messages carry pictures. The preview, file, save and images routes
// answer from bytes built here, so no binary fixture is kept in git.
import crypto from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';

const NOW = Date.now();
const iso = minutesAgo => new Date(NOW - minutesAgo * 60_000).toISOString();
const ROOT = '/work/example';
const JSON_HEAD = { 'Content-Type': 'application/json' };

// MARK: Bytes

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
// A picture with a colour of its own, a diagonal sweep and `n` white blocks along the top, so each one can be told apart in a screenshot.
function png(width, height, n) {
  const hue = (n * 67) % 360;
  const colour = (h, l) => { const a = 0.55 * Math.min(l, 1 - l); const f = k => { const t = (k + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1)))); }; return [f(0), f(8), f(4)]; };
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const inBlocks = y > 14 && y < 44 && x > 14 && x < 14 + n * 40 && ((x - 14) % 40) < 30;
      const [r, g, b] = inBlocks ? [255, 255, 255] : colour(hue, 0.3 + 0.4 * ((x + y) / (width + height)));
      rows.set([r, g, b], row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds, hertz) {
  const rate = 8000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hertz * i) / rate) * 9000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
function pdf() {
  const content = 'BT /F1 28 Tf 40 110 Td (Release checklist) Tj ET';
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 220]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// MARK: Files the chat links

const NOTES = `# Upload notes

The upload test fails about one run in five.

## What we know

- The helper does not wait for the \`ready\` event.
- A second run can read the first run's file.
- The retry stops after one attempt.

## The plan

1. Wait for \`ready\` before the first request.
2. Retry up to five times, then fail the test.
3. Clear the temp folder after each run.

See [the retry docs](https://example.com/docs/retries) and [the server](${ROOT}/src/server.js:42).

> The retry count is a guess.
`;
const SERVER = Array.from({ length: 80 }, (_, i) => (i + 1 === 42 ? 'const RETRIES = 5;' : i % 9 === 0 ? '' : `// line ${i + 1} of the upload server`)).join('\n') + '\n';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function makeFiles() {
  const archive = Buffer.alloc(2048);
  for (let i = 0; i < archive.length; i++) archive[i] = (i * 31 + 7) & 0xff;
  const text = (name, body, type, kind, extra) => ({ name, kind, type, bytes: Buffer.from(body), text: body, ...extra });
  return {
    [`${ROOT}/NOTES.md`]: text('NOTES.md', NOTES, 'text/markdown', 'markdown', { editable: true }),
    [`${ROOT}/src/server.js`]: text('server.js', SERVER, 'text/javascript', 'text', { readOnly: 'GhostShell does not edit its own files or its sessions.' }),
    [`${ROOT}/report.pdf`]: { name: 'report.pdf', kind: 'pdf', type: 'application/pdf', bytes: pdf() },
    [`${ROOT}/audio/intro.wav`]: { name: 'intro.wav', kind: 'audio', type: 'audio/wav', bytes: wav(2, 440) },
    [`${ROOT}/audio/outro.wav`]: { name: 'outro.wav', kind: 'audio', type: 'audio/wav', bytes: wav(3, 660) },
    [`${ROOT}/archive.zip`]: { name: 'archive.zip', kind: 'binary', type: 'application/zip', bytes: archive },
    [`${ROOT}/diagram.png`]: { name: 'diagram.png', kind: 'image', type: 'image/png', bytes: png(900, 560, 3) },
  };
}

function previewOf(path, file) {
  const preview = { name: file.name, path, real: path, size: file.bytes.length, kind: file.kind, type: file.type };
  if (file.text !== undefined) {
    Object.assign(preview, { text: file.text, truncated: false, version: sha(file.text) }, file.editable ? { editable: true } : { readOnly: file.readOnly });
  }
  return preview;
}

// MARK: The chat

const REFS = { user: ['100.0.ab', '100.1.ab'], tool: ['300.r0.t1', '300.r1.t1', '300.r2.t1', '300.r3.t1', '300.r4.t1'] };
const TOOL = 'mcp__browser__screenshot';

function items() {
  const reply = `I read the notes and the code. These are the files:

- Notes: [NOTES.md:14](${ROOT}/NOTES.md:14)
- The server: [server.js:42](${ROOT}/src/server.js:42)
- The checklist: [report.pdf](${ROOT}/report.pdf)
- A short intro: [intro.wav](${ROOT}/audio/intro.wav)
- A longer outro: [outro.wav](${ROOT}/audio/outro.wav)
- The bundle: [archive.zip](${ROOT}/archive.zip)
- The diagram: [diagram.png](${ROOT}/diagram.png)
- An old log: [gone.txt](${ROOT}/gone.txt)`;
  return [
    { kind: 'user', text: 'Here are two screenshots and the spec. Can you read them against the notes?', at: iso(20),
      images: REFS.user.map(ref => ({ ref, type: 'image/png' })), files: [{ name: 'spec.pdf', type: 'application/pdf', size: 48211, path: `${ROOT}/spec.pdf` }] },
    { kind: 'assistant', msgId: 'm1', text: reply, at: iso(18) },
    { kind: 'tool', id: 't1', name: TOOL, summary: 'Take screenshots', input: {}, status: 'pending', at: iso(15) },
    { kind: 'result', toolId: 't1', status: 'ok', output: 'Took 5 screenshots.', images: REFS.tool.map(ref => ({ ref, type: 'image/png' })) },
    { kind: 'assistant', msgId: 'm2', text: 'All five match the notes.', at: iso(10) },
  ];
}

const imageList = () => ({ items: [
  { kind: 'user', images: REFS.user.map(ref => ({ ref, type: 'image/png' })) },
  { kind: 'tool', id: 't1', name: TOOL, summary: 'Take screenshots', input: {}, status: 'ok', images: REFS.tool.map(ref => ({ ref, type: 'image/png' })) },
] });

export async function startFilesStub() {
  const files = makeFiles();
  const chat = items();
  const rows = [{ id: 'files', title: 'Read the notes against the screenshots', dot: null, state: 'idle', sortAt: Date.now() }];
  const pictures = new Map([...REFS.user, ...REFS.tool].map((ref, i) => [ref, png(i % 2 ? 1600 : 900, i % 2 ? 1000 : 560, i + 1)]));
  const send = (res, status, body, type = 'application/json') => res.writeHead(status, { 'Content-Type': type }).end(body);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    req.on('data', piece => { body += piece; });
    req.on('end', () => {
      if (url.pathname === '/login') return void res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
      if (url.pathname === '/api/sessions') return void send(res, 200, JSON.stringify({ ungrouped: rows }));
      const m = /^\/api\/sessions\/files\/([a-z]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (!m) return void send(res, 404, '{}');
      const [, action, ref] = m;
      if (action === 'messages') {
        return void send(res, 200, JSON.stringify({ items: chat, start: 0, end: chat.length * 100, hasEarlier: false, reset: false, fileLinks: true, terminal: false,
          session: { id: 'files', title: rows[0].title, cwd: ROOT, branch: 'main', connectors: {} } }));
      }
      if (action === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        return void res.write(`event: status\ndata: ${JSON.stringify({ state: 'idle', running: true, model: 'claude-sonnet-5-5', mode: 'default', live: '' })}\n\n`);
      }
      if (action === 'images' && !ref) return void send(res, 200, JSON.stringify(imageList()));
      if (action === 'images') return void (pictures.has(ref) ? send(res, 200, pictures.get(ref), 'image/png') : send(res, 404, '{"error":"No such image."}'));
      const wanted = url.searchParams.get('path');
      if (action === 'save') {
        const { path: target, text, base } = JSON.parse(body || '{}');
        const file = files[target];
        if (!file?.editable) return void send(res, 403, JSON.stringify({ error: 'GhostShell does not edit that file.' }));
        if (base !== sha(file.text)) return void send(res, 409, JSON.stringify({ error: 'This file changed on disk after you opened it, so nothing was saved.', changed: true }));
        Object.assign(file, { text, bytes: Buffer.from(text) });
        return void send(res, 200, JSON.stringify(previewOf(target, file)));
      }
      if (action !== 'preview' && action !== 'file') return void send(res, 404, '{}');
      if (!wanted?.startsWith(ROOT)) return void send(res, 403, JSON.stringify({ error: 'This chat does not link to that file.' }));
      const file = files[wanted];
      if (!file) return void send(res, 404, JSON.stringify({ error: 'There is no file at that path.' }));
      if (action === 'preview') return void send(res, 200, JSON.stringify(previewOf(wanted, file)));
      send(res, 200, file.bytes, file.type);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    address: `http://localhost:${server.address().port}`,
    rows,
    // Changes a file on disk behind the app's back, so its next save meets a 409.
    touch(target) {
      const file = files[target];
      file.text += '\nChanged on disk by another program.\n';
      file.bytes = Buffer.from(file.text);
    },
    stop: () => { server.closeAllConnections(); server.close(); },
  };
}
