// Run with `npm test`. Each test starts the real server on a free port, with its own home and state folders, and talks to it
// over HTTP, so the cookie headers, the route order and the lockout are checked where they are wired together.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { writePassword } from '../lib/auth.mjs';
import { makeAuthenticator } from './authenticator.mjs';
import { as, CHROME, PASSWORD, request, ROOT, signIn, start, tokenIn } from './harness.mjs';

const DAY = 24 * 3600_000;
const COOKIE = /^capcom=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Max-Age=\d+$/;
const HTTPS = { 'x-forwarded-proto': 'https' };
const listUrl = origin => `/api/passkeys?origin=${encodeURIComponent(origin)}`;
const maxAge = cookie => Number(/; Max-Age=(\d+)/.exec(cookie)[1]);
const closeTo = (seconds, days) => Math.abs(seconds - days * 86400) <= 5;

const keyOf = token => `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
const tokenFile = s => JSON.parse(fs.readFileSync(s.tokens, 'utf8'));

function rewriteTokens(s, change) {
  const tokens = JSON.parse(fs.readFileSync(s.tokens, 'utf8'));
  change(tokens);
  fs.writeFileSync(s.tokens, JSON.stringify(tokens));
}

test('a password sign-in sets a 90 day cookie, adds Secure only behind an https proxy, and lands on the signed-in page', async () => {
  const s = await start();
  const wrong = await request(s, 'POST', '/login', { form: { password: 'not it' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.match(wrong.text, /That password did not match/);

  const plain = await signIn(s);
  assert.equal(plain.res.headers.location, './?signed-in');
  assert.match(plain.cookie, COOKIE);
  assert.ok(closeTo(maxAge(plain.cookie), 90), plain.cookie);

  const secure = (await signIn(s, HTTPS)).cookie;
  assert.match(secure, /; Secure$/);
  assert.ok(closeTo(maxAge(secure), 90), secure);
  assert.doesNotMatch((await signIn(s, { 'x-forwarded-proto': 'http' })).cookie, /Secure/);
});

test('a write must come from this host over the scheme it arrived on, on an http mount and behind a loopback https proxy', async () => {
  const s = await start();
  const here = `localhost:${s.port}`;
  const attempt = ({ host = here, origin, proto }) => request(s, 'POST', '/login', {
    form: { password: PASSWORD },
    headers: { 'user-agent': CHROME, host, ...(origin && { origin }), ...(proto && { 'x-forwarded-proto': proto }) },
  });
  const proxy = { host: 'capcom.example.test', proto: 'https' };
  const cases = [
    ['http, no Origin', {}, 303],
    ['http, same origin', { origin: `http://${here}` }, 303],
    ['http, an https Origin for the same host', { origin: `https://${here}` }, 403],
    ['http, another port', { origin: `http://localhost:${s.port + 1}` }, 403],
    ['http, another host', { origin: 'http://evil.example' }, 403],
    ['http, an opaque origin', { origin: 'null' }, 403],
    ['http, port 80 written out', { host: 'capcom.example.test', origin: 'http://capcom.example.test:80' }, 303],
    ['https proxy, no Origin', proxy, 303],
    ['https proxy, same origin', { ...proxy, origin: 'https://capcom.example.test' }, 303],
    ['https proxy, port 443 written out in the Origin', { ...proxy, origin: 'https://capcom.example.test:443' }, 303],
    ['https proxy, port 443 written out in the Host', { ...proxy, host: 'capcom.example.test:443', origin: 'https://capcom.example.test' }, 303],
    ['https proxy, an http Origin for the same host', { ...proxy, origin: 'http://capcom.example.test' }, 403],
    ['https proxy, an http Origin with port 80', { ...proxy, origin: 'http://capcom.example.test:80' }, 403],
    ['https proxy, another host', { ...proxy, origin: 'https://evil.example' }, 403],
    ['a proxy that says http, an https Origin', { ...proxy, proto: 'http', origin: 'https://capcom.example.test' }, 403],
  ];
  for (const [label, input, status] of cases) {
    const res = await attempt(input);
    assert.equal(res.status, status, label);
    if (status === 403) assert.equal(res.headers['set-cookie'], undefined, label);
    else assert.equal(/; Secure$/.test(res.headers['set-cookie'][0]), input.proto === 'https', label);
  }

  const hostless = await new Promise(resolve => {
    const socket = net.connect(s.port, '127.0.0.1', () => socket.write('POST /login HTTP/1.0\r\nOrigin: http://undefined\r\nContent-Length: 0\r\n\r\n'));
    let text = '';
    socket.on('data', chunk => { text += chunk; });
    socket.on('close', () => resolve(text));
  });
  assert.match(hostless, /^HTTP\/1\.[01] 403 /);

  const { token } = await signIn(s);
  const renew = origin => request(s, 'POST', '/renew', { headers: { ...as(token), origin }, json: {} });
  assert.equal((await renew(`http://${here}`)).status, 200);
  assert.equal((await renew(`https://${here}`)).status, 403);
});

test('a signed-out visitor gets the sign-in page and its scripts, and a 401 from everything else', async () => {
  const s = await start();
  const page = await request(s, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /id="password"/);
  for (const file of ['/login.js', '/ui/webauthn.js']) {
    const script = await request(s, 'GET', file);
    assert.equal(script.status, 200, file);
    assert.match(script.headers['content-type'], /javascript/, file);
  }
  for (const [method, url] of [['GET', '/api/sessions'], ['GET', '/api/sessions/sess-1/images'], ['GET', listUrl(s.origin)], ['POST', '/api/passkeys/options'], ['POST', '/api/passkeys/remove'], ['POST', '/renew']]) {
    assert.equal((await request(s, method, url, method === 'POST' ? { json: {} } : {})).status, 401, `${method} ${url}`);
  }
});

test('the icon font is served before sign-in, byte for byte, as font/woff2 with a weak tag made from its size and modified time', async () => {
  const s = await start();
  const file = path.join(ROOT, 'public', 'vendor', 'tabler-icons.woff2');
  const stat = fs.statSync(file);
  const font = await fetch(`http://127.0.0.1:${s.port}/vendor/tabler-icons.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('cache-control'), 'no-cache');
  assert.equal(font.headers.get('etag'), `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`);
  assert.ok(Buffer.from(await font.arrayBuffer()).equals(fs.readFileSync(file)));
});

test('the Geist fonts are served before sign-in, byte for byte, as font/woff2, because the sign-in page draws with them', async () => {
  const s = await start();
  for (const name of ['geist-latin', 'geist-latin-ext', 'geist-mono-latin', 'geist-mono-latin-ext']) {
    const font = await fetch(`http://127.0.0.1:${s.port}/vendor/${name}.woff2`);
    assert.equal(font.status, 200, name);
    assert.equal(font.headers.get('content-type'), 'font/woff2', name);
    assert.ok(Buffer.from(await font.arrayBuffer()).equals(fs.readFileSync(path.join(ROOT, 'public', 'vendor', `${name}.woff2`))), name);
  }
});

test('every file served from public/ carries a tag, and a request that sends it back gets a 304 with no body and the same tag and cache rule', async () => {
  const s = await start();
  const files = ['/app.js', '/app.css', '/ui/widget.js', '/vendor/preact.mjs', '/vendor/tabler-icons.min.css', '/vendor/tabler-icons.woff2', '/icon.png', '/favicon.png', '/manifest.webmanifest'];
  for (const file of files) {
    const first = await request(s, 'GET', file);
    assert.equal(first.status, 200, file);
    assert.match(first.headers.etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/, file);
    const again = await request(s, 'GET', file, { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(again.status, 304, file);
    assert.equal(again.text, '', file);
    assert.equal(again.headers.etag, first.headers.etag, file);
    assert.equal(again.headers['cache-control'], 'no-cache', file);
  }
});

test('a tag is matched the way a browser may write it: with or without W/, in a list, or as *, and a different tag or an empty one gets the file', async () => {
  const s = await start();
  const url = '/vendor/tabler-icons.woff2';
  const tag = (await request(s, 'GET', url)).headers.etag;
  const ask = value => request(s, 'GET', url, { headers: { 'if-none-match': value } });
  for (const [label, value] of [['the tag', tag], ['the tag without W/', tag.slice(2)], ['a list holding it', `W/"1-1", ${tag}`], ['any tag', '*']]) {
    assert.equal((await ask(value)).status, 304, label);
  }
  for (const [label, value] of [['another tag', 'W/"1-1"'], ['a list without it', 'W/"1-1", "2-2"'], ['an empty header', '']]) {
    assert.equal((await ask(value)).status, 200, label);
  }
});

test('the vendor license texts and notes are not served, signed in or out, because their names have no extension on the served list', async () => {
  const s = await start();
  const { token } = await signIn(s);
  for (const name of ['LICENSE-tabler-icons', 'LICENSE-preact', 'LICENSE-htm', 'LICENSE-geist', 'README.md']) {
    const out = await request(s, 'GET', `/vendor/${name}`);
    assert.match(out.text, /id="password"/, `${name} signed out is the sign-in page`);
    assert.equal(out.headers.etag, undefined, name);
    const signedIn = await request(s, 'GET', `/vendor/${name}`, { headers: as(token) });
    assert.equal(signedIn.status, 404, `${name} signed in`);
    assert.equal(signedIn.headers.etag, undefined, name);
  }
});

test('a picture a tool returned is served by its r ref to a signed-in browser and to nobody else', async () => {
  const s = await start();
  const folder = path.join(path.dirname(s.state), '.claude', 'projects', '-work');
  fs.mkdirSync(folder, { recursive: true });
  const bytes = 'plain bytes so the test can read them back as text';
  const result = { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(bytes).toString('base64') } }] };
  fs.writeFileSync(path.join(folder, 'sess-1.jsonl'), `${JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: [result] } })}\n`);
  const url = ref => `/api/sessions/sess-1/images/${ref}`;
  assert.equal((await request(s, 'GET', url('0.r0.u1'))).status, 401);
  const { token } = await signIn(s);
  const got = await request(s, 'GET', url('0.r0.u1'), { headers: as(token) });
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.equal(got.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(got.headers.vary, 'Cookie', 'a copy kept under one sign-in cookie must not be reused without it');
  assert.equal(got.text, bytes);
  for (const ref of ['0.r0.u2', '0.0.u1', '0.r1.u1']) assert.equal((await request(s, 'GET', url(ref), { headers: as(token) })).status, 404, ref);
});

test('the pictures of a whole chat are listed with refs and never bytes, only those before a byte offset when asked, and only to a signed-in browser', async () => {
  const s = await start();
  const folder = path.join(path.dirname(s.state), '.claude', 'projects', '-work');
  fs.mkdirSync(folder, { recursive: true });
  const picture = bytes => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(bytes).toString('base64') } });
  const entries = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'look at this' }, picture('the first picture, sent by the owner')] } },
    { type: 'assistant', uuid: 'a1', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] } },
    { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [picture('the second picture, from a tool')] }] } },
    { type: 'user', uuid: 'u3', message: { role: 'user', content: [picture('the third picture, sent after')] } },
  ];
  fs.writeFileSync(path.join(folder, 'sess-1.jsonl'), entries.map(e => `${JSON.stringify(e)}\n`).join(''));
  const at = [0];
  entries.forEach((e, n) => at.push(at[n] + Buffer.byteLength(`${JSON.stringify(e)}\n`)));
  const list = '/api/sessions/sess-1/images';

  for (const url of [list, `${list}?before=${at[2]}`, `${list}?before=nope`]) assert.equal((await request(s, 'GET', url)).status, 401, url);

  const { token } = await signIn(s);
  const all = await request(s, 'GET', list, { headers: as(token) });
  assert.equal(all.status, 200);
  assert.match(all.headers['content-type'], /application\/json/);
  assert.equal(all.headers['cache-control'], 'no-store');
  assert.deepEqual(all.body(), { items: [
    { kind: 'user', images: [{ ref: `${at[0]}.0.u1`, type: 'image/png' }] },
    { kind: 'tool', name: 'Read', images: [{ ref: `${at[2]}.r0.u2`, type: 'image/png' }] },
    { kind: 'user', images: [{ ref: `${at[3]}.0.u3`, type: 'image/png' }] },
  ] });
  for (const bytes of ['the first picture', 'the second picture', 'the third picture']) {
    assert.equal(all.text.includes(bytes), false, bytes);
    assert.equal(all.text.includes(Buffer.from(bytes).toString('base64').slice(0, 20)), false, bytes);
  }

  const refsBefore = async offset => (await request(s, 'GET', `${list}?before=${offset}`, { headers: as(token) })).body().items.flatMap(item => item.images.map(img => img.ref));
  assert.deepEqual(await refsBefore(at[3]), [`${at[0]}.0.u1`, `${at[2]}.r0.u2`], 'the call is on line 1, so the tool picture is before line 3 even though its result is on line 2');
  assert.deepEqual(await refsBefore(at[2]), [`${at[0]}.0.u1`, `${at[2]}.r0.u2`], 'a page that starts at the result has not seen the call, so that picture still counts as before');
  assert.deepEqual(await refsBefore(at[1]), [`${at[0]}.0.u1`]);
  assert.deepEqual(await refsBefore(0), []);
  assert.deepEqual(await refsBefore('00'), []);

  for (const bad of ['', 'nope', '-1', '1.5', '1e3', '0x10', ' 7', '7 ']) {
    const refused = await request(s, 'GET', `${list}?before=${encodeURIComponent(bad)}`, { headers: as(token) });
    assert.equal(refused.status, 400, JSON.stringify(bad));
    assert.match(refused.body().error, /byte offset/);
  }
  const unknown = await request(s, 'GET', '/api/sessions/no-such-chat/images', { headers: as(token) });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body().error, /No session/);

  const one = await request(s, 'GET', `${list}/${at[2]}.r0.u2`, { headers: as(token) });
  assert.equal(one.status, 200);
  assert.equal(one.headers['content-type'], 'image/png');
  assert.equal(one.text, 'the second picture, from a tool');
});

test('a null block in a transcript line costs only itself: the chat\'s messages still load, poll and page back, with the blocks beside it', async () => {
  const s = await start();
  const folder = path.join(path.dirname(s.state), '.claude', 'projects', '-work');
  fs.mkdirSync(folder, { recursive: true });
  const text = words => ({ type: 'text', text: words });
  const entries = [
    { type: 'user', cwd: '/work', message: { role: 'user', content: 'first' } },
    { type: 'user', message: { role: 'user', content: [null, text('second')] } },
    { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [null, text('third')] } },
    { type: 'user', message: { role: 'user', content: [null, { type: 'tool_result', tool_use_id: 'toolu_1', content: [null, text('fourth')] }] } },
    { type: 'user', message: { role: 'user', content: 'last' } },
  ];
  fs.writeFileSync(path.join(folder, 'sess-null-block.jsonl'), entries.map(e => `${JSON.stringify(e)}\n`).join(''));
  const startOf = n => entries.slice(0, n).reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)) + 1, 0);
  const { token } = await signIn(s);
  const messages = async (query, expected) => {
    const res = await request(s, 'GET', `/api/sessions/sess-null-block/messages${query}`, { headers: as(token) });
    assert.equal(res.status, 200, `${query || 'a first load'}: ${res.text}`);
    assert.deepEqual(res.body().items.map(i => (i.kind === 'result' ? i.output.trim() : i.text)), expected, query || 'a first load');
  };
  await messages('', ['first', 'second', 'third', 'fourth', 'last']);
  await messages(`?after=${startOf(1)}`, ['second', 'third', 'fourth', 'last']);
  await messages(`?before=${startOf(4)}`, ['first', 'second', 'third', 'fourth']);
});

test('a transcript whose first line is null does not stop the session list, which still shows it and the sessions beside it', async () => {
  const s = await start();
  const folder = path.join(path.dirname(s.state), '.claude', 'projects', '-work');
  fs.mkdirSync(folder, { recursive: true });
  const prompt = words => `${JSON.stringify({ type: 'user', cwd: '/work', message: { role: 'user', content: words } })}\n`;
  fs.writeFileSync(path.join(folder, 'sess-fine.jsonl'), prompt('A fine session'));
  fs.writeFileSync(path.join(folder, 'sess-null-first.jsonl'), `null\n${prompt('Behind a null line')}`);
  const { token } = await signIn(s);
  const list = await request(s, 'GET', '/api/sessions', { headers: as(token) });
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.body().other.map(r => r.title).sort(), ['A fine session', 'Behind a null line']);
  const opened = await request(s, 'GET', '/api/sessions/sess-null-first/messages', { headers: as(token) });
  assert.equal(opened.status, 200, opened.text);
  assert.deepEqual(opened.body().items.map(i => i.text), ['Behind a null line']);
});

test('a Desktop session\'s messages name its connectors from its own record and keep nothing else the record says of them, and the session list carries none of it', async () => {
  const mailbox = '0f8a1c2e-1111-4a2b-9c3d-123456789abc';
  const calendar = '6a1b2c3d-2222-4e5f-8a9b-0c1d2e3f4a5b';
  const notebook = '9e8d7c6b-3333-4a5b-8c4d-0a1b2c3d4e5f';
  const detail = { url: 'https://mail.example.test/mcp', tools: [{ name: 'find_thread', description: 'Look a thread up by its subject' }], instructions: 'Only read the mailbox of the person asking.' };
  const s = await start({
    sessions: [
      { id: 'sess-named', title: 'Named chat', remoteMcpServersConfig: [
        { uuid: mailbox, name: 'Mailbox', ...detail },
        { uuid: calendar, name: '  Calendar  ' },
        { uuid: '1a2b3c4d-4444-4a5b-8c6d-0e1f2a3b4c5d', name: '   ', ...detail },
        { uuid: '2b3c4d5e-5555-4a5b-8c6d-0e1f2a3b4c5d', ...detail },
        { uuid: '3c4d5e6f-6666-4a5b-8c6d-0e1f2a3b4c5d', name: 42 },
        { uuid: 'not-a-uuid', name: 'Odd one' },
        { name: 'No UUID' },
        null,
      ] },
      { id: 'sess-other', title: 'Other chat', remoteMcpServersConfig: [{ uuid: notebook, name: 'Notebook' }] },
      { id: 'sess-null', title: 'Null chat', remoteMcpServersConfig: null },
      { id: 'sess-bare', title: 'Bare chat' },
      { id: 'sess-terminal', title: 'Terminal chat', source: 'cli' },
    ],
  });
  const { token } = await signIn(s);
  const messages = async id => {
    const res = await request(s, 'GET', `/api/sessions/${id}/messages`, { headers: as(token) });
    assert.equal(res.status, 200, `${id}: ${res.text}`);
    return res;
  };

  const named = await messages('sess-named');
  assert.deepEqual(named.body().session.connectors, { [mailbox]: 'Mailbox', [calendar]: 'Calendar' });
  for (const kept of [detail.url, 'find_thread', detail.tools[0].description, detail.instructions]) assert.equal(named.text.includes(kept), false, kept);
  assert.deepEqual((await messages('sess-other')).body().session.connectors, { [notebook]: 'Notebook' }, 'each session has its own record\'s names');
  for (const id of ['sess-null', 'sess-bare', 'sess-terminal']) assert.deepEqual((await messages(id)).body().session.connectors, {}, id);

  for (const url of ['/api/sessions', '/api/sessions?archived=1']) {
    const list = await request(s, 'GET', url, { headers: as(token) });
    assert.equal(list.status, 200, url);
    assert.deepEqual(list.body().ungrouped.map(r => r.title).sort(), ['Bare chat', 'Named chat', 'Null chat', 'Other chat'], url);
    for (const leaked of [mailbox, calendar, notebook, 'Mailbox', 'Calendar', 'Notebook', 'connectors']) assert.equal(list.text.includes(leaked), false, `${url} carries ${leaked}`);
  }
});

test('a session on a Mac with no Desktop files gets no connector names, and its messages still load', async () => {
  const s = await start();
  const folder = path.join(path.dirname(s.state), '.claude', 'projects', '-work');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'sess-terminal.jsonl'), `${JSON.stringify({ type: 'user', cwd: '/work', message: { role: 'user', content: 'from a terminal' } })}\n`);
  const { token } = await signIn(s);
  const res = await request(s, 'GET', '/api/sessions/sess-terminal/messages', { headers: as(token) });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body().session.connectors, {});
  assert.deepEqual(res.body().items.map(i => i.text), ['from a terminal']);
});

test('a connector\'s name is cleaned as a message sender\'s name is: one line, no bidi or zero-width marks, and 60 characters at most', async () => {
  const flipped = '4d5e6f7a-7777-4a5b-8c6d-0e1f2a3b4c5d';
  const long = '5e6f7a8b-8888-4a5b-8c6d-0e1f2a3b4c5d';
  const s = await start({
    sessions: [{ id: 'sess-odd-names', title: 'Odd names', remoteMcpServersConfig: [
      { uuid: flipped, name: '‮liamg\nBox​' },
      { uuid: long, name: `Notes ${'x'.repeat(70)}` },
      { uuid: '6f7a8b9c-9999-4a5b-8c6d-0e1f2a3b4c5d', name: '​‮\n' },
    ] }],
  });
  const { token } = await signIn(s);
  const res = await request(s, 'GET', '/api/sessions/sess-odd-names/messages', { headers: as(token) });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body().session.connectors, { [flipped]: 'liamg Box', [long]: `Notes ${'x'.repeat(54)}...` }, 'and a name of marks alone is dropped');
});

test('renew sends the cookie again at most once a day, and pushes the expiry 90 days out', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const renew = headers => request(s, 'POST', '/renew', { headers: { ...as(token), ...headers }, json: {} });

  const fresh = await renew();
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers['set-cookie'], undefined);

  rewriteTokens(s, tokens => {
    tokens[keyOf(token)].used = new Date(Date.now() - 2 * DAY).toISOString();
    tokens[keyOf(token)].expires = new Date(Date.now() + 5 * DAY).toISOString();
  });
  const due = await renew();
  assert.equal(due.status, 200);
  assert.match(due.headers['set-cookie'][0], new RegExp(`^capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=\\d+$`));
  assert.ok(closeTo(maxAge(due.headers['set-cookie'][0]), 90), due.headers['set-cookie'][0]);
  const record = tokenFile(s)[keyOf(token)];
  assert.ok(Math.abs(Date.parse(record.expires) - Date.now() - 90 * DAY) < 60_000);
  assert.ok(Date.now() - Date.parse(record.used) < 60_000);

  assert.equal((await renew()).headers['set-cookie'], undefined);

  rewriteTokens(s, tokens => { tokens[keyOf(token)].used = new Date(Date.now() - 2 * DAY).toISOString(); });
  assert.match((await renew(HTTPS)).headers['set-cookie'][0], /; Max-Age=\d+; Secure$/);
});

test('renew stops pushing the expiry past 365 days after sign-in, and the cookie then lasts only what is left', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const made = Date.now() - 300 * DAY;
  rewriteTokens(s, tokens => {
    tokens[keyOf(token)].created = new Date(made).toISOString();
    tokens[keyOf(token)].used = new Date(Date.now() - 2 * DAY).toISOString();
    tokens[keyOf(token)].expires = new Date(Date.now() + 80 * DAY).toISOString();
  });
  const due = await request(s, 'POST', '/renew', { headers: as(token), json: {} });
  assert.equal(due.status, 200);
  assert.ok(closeTo(maxAge(due.headers['set-cookie'][0]), 65), due.headers['set-cookie'][0]);
  assert.equal(tokenFile(s)[keyOf(token)].expires, new Date(made + 365 * DAY).toISOString());
});

test('a value copied out of the token file does not sign in to the API', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const keys = Object.keys(tokenFile(s));
  assert.deepEqual(keys, [keyOf(token)]);
  assert.ok(!fs.readFileSync(s.tokens, 'utf8').includes(token));
  for (const copied of [keys[0], keys[0].slice('sha256:'.length)]) {
    assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(copied) })).status, 401, copied);
  }
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 200);
});

test('signing out clears the cookie, with Secure behind an https proxy, ends that session and has the browser drop its cache', async () => {
  const s = await start();
  const { token } = await signIn(s);
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 200);

  const out = await request(s, 'POST', '/logout', { headers: { ...as(token), ...HTTPS }, json: {} });
  assert.equal(out.status, 303);
  assert.equal(out.headers.location, './');
  assert.equal(out.headers['clear-site-data'], '"cache"');
  assert.equal(out.headers['set-cookie'][0], 'capcom=; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 401);
});

test('signing out from a tab whose sign-in a new password already ended still clears the cookie and the cache', async () => {
  const s = await start();
  const { token } = await signIn(s);
  rewriteTokens(s, tokens => { delete tokens[keyOf(token)]; });

  const out = await request(s, 'POST', '/logout', { headers: as(token), json: {} });
  assert.equal(out.status, 303);
  assert.equal(out.headers.location, './');
  assert.equal(out.headers['clear-site-data'], '"cache"');
  assert.equal(out.headers['set-cookie'][0], 'capcom=; HttpOnly; SameSite=Lax; Max-Age=0');
});

test('a token file in the old shape keeps its browsers signed in, and an expired token stays out', async () => {
  const s = await start();
  const live = 'a'.repeat(64);
  const expired = 'b'.repeat(64);
  fs.writeFileSync(s.tokens, JSON.stringify({ [live]: Date.now() + 5 * DAY, [expired]: Date.now() - DAY }));

  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(live) })).status, 200);
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(expired) })).status, 401);
  assert.ok(!fs.readFileSync(s.tokens, 'utf8').includes(live), 'the old raw tokens are hashed on disk');
  const record = tokenFile(s)[keyOf(live)];
  assert.ok(Math.abs(Date.parse(record.expires) - Date.now() - 90 * DAY) < 60_000);
  assert.ok(Date.parse(record.created) < Date.now());
  assert.equal(record.device, 'Chrome 141 on macOS');
});

test('a passkey is added by a signed-in browser and signs a signed-out one in', async () => {
  const s = await start();
  const a = makeAuthenticator();
  const { token } = await signIn(s);
  const ask = async (origin = s.origin) => (await request(s, 'POST', '/passkey-options', { json: { origin } })).body();
  const post = (body, headers) => request(s, 'POST', '/passkey-login', { json: body, headers: { 'user-agent': CHROME, ...headers } });

  assert.deepEqual((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).body(), { available: true, passkeys: [] });
  assert.equal((await request(s, 'GET', listUrl('https://elsewhere.example'), { headers: as(token) })).body().available, false);
  assert.deepEqual(await ask(), { options: null, why: '' });

  const options = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  assert.equal(options.rp.id, 'localhost');
  const added = await request(s, 'POST', '/api/passkeys', { headers: as(token), json: a.register({ challenge: options.challenge, origin: s.origin }) });
  assert.equal(added.status, 200);
  assert.equal(added.body().passkeys.length, 1);
  assert.equal(added.body().passkeys[0].device, 'Chrome 141 on macOS');
  assert.equal(fs.statSync(path.join(s.state, 'passkeys.json')).mode & 0o777, 0o600);

  const { options: signIn1 } = await ask();
  assert.equal(signIn1.rpId, 'localhost');
  assert.deepEqual(signIn1.allowCredentials, []);
  const assertion = a.assert({ challenge: signIn1.challenge, origin: s.origin, signCount: 1 });
  const good = await post(assertion);
  assert.equal(good.status, 200);
  assert.match(good.headers['set-cookie'][0], COOKIE);
  const fresh = tokenIn(good.headers['set-cookie'][0]);
  assert.notEqual(fresh, token);
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(fresh) })).status, 200);

  const replay = await post(assertion);
  assert.equal(replay.status, 401);
  assert.equal(replay.headers['set-cookie'], undefined);

  const { options: backwards } = await ask();
  assert.equal((await post(a.assert({ challenge: backwards.challenge, origin: s.origin, signCount: 1 }))).status, 401);

  const { options: forwards } = await ask();
  const proxied = await post(a.assert({ challenge: forwards.challenge, origin: s.origin, signCount: 2 }), HTTPS);
  assert.equal(proxied.status, 200);
  assert.match(proxied.headers['set-cookie'][0], /; Max-Age=\d+; Secure$/);
  assert.ok(closeTo(maxAge(proxied.headers['set-cookie'][0]), 90), proxied.headers['set-cookie'][0]);

  assert.deepEqual(await ask('https://elsewhere.example'), { options: null, why: 'Passkeys are not set up for this address.' });
  assert.equal((await request(s, 'POST', '/passkey-options', { form: { origin: s.origin } })).status, 400);
  assert.equal((await post({}, { origin: 'https://evil.example' })).status, 403);

  const used = (await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).body().passkeys;
  assert.equal(used.length, 1);
  assert.ok(used[0].used);
  const removed = await request(s, 'POST', '/api/passkeys/remove', { headers: as(token), json: { id: a.id } });
  assert.deepEqual(removed.body(), { passkeys: [] });
  assert.deepEqual(await ask(), { options: null, why: '' });
});

test('the localhost passkey origin works only on a request that arrived as localhost', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const a = makeAuthenticator();
  const asked = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  await request(s, 'POST', '/api/passkeys', { headers: as(token), json: a.register({ challenge: asked.challenge, origin: s.origin }) });

  const ask = headers => request(s, 'POST', '/passkey-options', { json: { origin: s.origin }, headers }).then(res => res.body());
  assert.ok((await ask({})).options);
  const refused = { options: null, why: 'Passkeys are not set up for this address.' };
  for (const headers of [{ 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-host': 'capcom.example.test' }, { forwarded: 'for=203.0.113.9' }, { host: `127.0.0.1:${s.port}` }, { host: 'capcom.example.test' }]) {
    assert.deepEqual(await ask(headers), refused, JSON.stringify(headers));
    const signedIn = { ...as(token), ...headers };
    assert.equal((await request(s, 'POST', '/api/passkeys/options', { headers: signedIn, json: { origin: s.origin } })).status, 400, JSON.stringify(headers));
    assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: signedIn })).body().available, false, JSON.stringify(headers));
  }
});

test('a new password ends every session and every passkey, so a passkey made with a stolen cookie cannot sign back in', async () => {
  const s = await start();
  const thief = makeAuthenticator();
  const { token } = await signIn(s);
  const asked = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  const added = await request(s, 'POST', '/api/passkeys', { headers: as(token), json: thief.register({ challenge: asked.challenge, origin: s.origin }) });
  assert.equal(added.body().passkeys.length, 1);
  const ask = () => request(s, 'POST', '/passkey-options', { json: { origin: s.origin } }).then(res => res.body());
  const { options } = await ask();
  assert.ok(options);

  writePassword(s.state, 'the password after the reset');

  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 401);
  const stale = await request(s, 'POST', '/passkey-login', { json: thief.assert({ challenge: options.challenge, origin: s.origin, signCount: 1 }) });
  assert.equal(stale.status, 401);
  assert.equal(stale.headers['set-cookie'], undefined);
  assert.deepEqual(await ask(), { options: null, why: '' });

  assert.equal((await request(s, 'POST', '/login', { form: { password: PASSWORD } })).status, 401);
  const fresh = await request(s, 'POST', '/login', { form: { password: 'the password after the reset' }, headers: { 'user-agent': CHROME } });
  assert.equal(fresh.status, 303);
  assert.deepEqual((await request(s, 'GET', listUrl(s.origin), { headers: as(tokenIn(fresh.headers['set-cookie'][0])) })).body().passkeys, []);
});

test('a passkey still arriving when the password is changed is refused rather than added afterwards', async () => {
  const s = await start();
  const thief = makeAuthenticator();
  const { token } = await signIn(s);
  const asked = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  const text = JSON.stringify(thief.register({ challenge: asked.challenge, origin: s.origin }));
  const half = Math.floor(text.length / 2);

  const held = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/passkeys', headers: { host: `localhost:${s.port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...as(token) } });
  const status = new Promise((resolve, reject) => {
    held.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    held.on('error', reject);
  });
  held.write(text.slice(0, half));
  await new Promise(resolve => setTimeout(resolve, 200));
  writePassword(s.state, 'the password after the reset');
  held.end(text.slice(half));

  assert.equal(await status, 401);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.state, 'passkeys.json'), 'utf8')).passkeys, []);
});

test('wrong passwords and refused passkeys count toward one lockout', async () => {
  const s = await start();
  for (let i = 0; i < 5; i++) assert.equal((await request(s, 'POST', '/login', { form: { password: 'nope' } })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await request(s, 'POST', '/passkey-login', { json: {} })).status, 401);
  assert.equal((await request(s, 'POST', '/passkey-login', { json: {} })).status, 429);

  const locked = await request(s, 'POST', '/login', { form: { password: PASSWORD } });
  assert.equal(locked.status, 401);
  assert.match(locked.text, /Too many tries/);
  assert.equal(locked.headers['set-cookie'], undefined);
});
