// Run with `npm test`. Naming sessions over HTTP against the real server and a fake CLI that answers a title ask: a typed session is named when
// its first turn ends, a chip's title is kept with no ask, and a title the owner sets while the turn runs is not replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { as, cliCalls, request, signIn, start, until as waitFor } from './harness.mjs';

const until = (check, ms = 20_000) => waitFor(check, ms);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const titles = s => { try { return JSON.parse(fs.readFileSync(s.layout, 'utf8')).titles ?? {}; } catch { return {}; } };
const rowTitle = async (s, token, id) => {
  const ix = (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
  return [...ix.pinned, ...ix.started, ...ix.ungrouped, ...ix.other].find(r => r.id === id)?.title;
};
const asks = s => cliCalls(s).filter(c => c.titled !== undefined);
const FAKE_TITLE = 'Fake - generated title';

async function ready(mac) {
  const s = await start({ claude: true, autoTitle: true, ...mac });
  return { s, ...(await signIn(s)) };
}

test('a session typed in the page takes the title the model gives when its first turn ends', async () => {
  const { s, token } = await ready();
  const made = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' });
  assert.equal(made.status, 200, made.text);
  const id = made.body().id;
  assert.equal(await rowTitle(s, token, id), 'begin a session');
  assert.deepEqual(titles(s), {});
  assert.equal((await post(s, token, `/api/sessions/${id}/send`, { text: 'finish the turn' })).status, 200);
  await until(() => titles(s)[id]);
  assert.equal(titles(s)[id], FAKE_TITLE);
  assert.equal(await rowTitle(s, token, id), FAKE_TITLE);
  assert.equal(asks(s).length, 1);
  assert.equal(asks(s)[0].titled, 'First message:\nbegin a session');
  const [{ started }] = cliCalls(s).filter(c => c.started && c.started.includes('--no-session-persistence'));
  assert.equal(started[started.indexOf('--model') + 1], 'claude-haiku-5-5');
  assert.equal(started[started.indexOf('--effort') + 1], 'low');
  assert.equal(started[started.indexOf('--tools') + 1], '');
  assert.equal(started.includes('--setting-sources'), true);
  assert.equal(started.includes('--bare'), false);
});

test('a chip keeps its own title at once and the model is never asked', async () => {
  const { s, token } = await ready({ chips: [{ toolUseId: 'toolu_a', sessionId: 'loose', title: 'Chip title', prompt: 'begin a session', cwd: undefined }] });
  const res = await post(s, token, '/api/chips/start', { sessionId: 'loose', toolUseId: 'toolu_a', title: 'Chip title', prompt: 'begin a session', cwd: s.home, confirmCwd: s.home });
  assert.equal(res.status, 200, res.text);
  const id = res.body().id;
  assert.equal(titles(s)[id], 'Chip title');
  assert.equal(await rowTitle(s, token, id), 'Chip title');
  await post(s, token, `/api/sessions/${id}/send`, { text: 'finish the turn' });
  await wait(600);
  assert.equal(asks(s).length, 0);
  assert.equal(titles(s)[id], 'Chip title');
});

test('a title the owner sets while the first turn runs is kept, and the model is not asked', async () => {
  const { s, token } = await ready();
  const id = (await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).body().id;
  assert.equal((await post(s, token, '/api/layout/rename', { id, title: 'My own name' })).status, 200);
  await post(s, token, `/api/sessions/${id}/send`, { text: 'finish the turn' });
  await wait(600);
  assert.equal(titles(s)[id], 'My own name');
  assert.equal(await rowTitle(s, token, id), 'My own name');
  assert.equal(asks(s).length, 0);
});

test('a server with naming off names nothing', async () => {
  const off = await start({ claude: true });
  const { token } = await signIn(off);
  const id = (await post(off, token, '/api/new', { cwd: off.home, text: 'begin a session' })).body().id;
  await post(off, token, `/api/sessions/${id}/send`, { text: 'finish the turn' });
  await wait(600);
  assert.deepEqual(titles(off), {});
  assert.equal(asks(off).length, 0);
});
