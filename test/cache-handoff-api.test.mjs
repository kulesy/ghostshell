// Run with `npm test`. A session that has sat idle for most of an hour is asked for a handoff, and the owner's next message starts a fresh session from it, over the real
// server, a fake CLI and a fake Mac. The instance divides its tick by 600 with CAPCOM_CACHE_HANDOFF_SCALE, and the minutes a reply must be old are written into the transcript.
// The rules have their own tests in cache-handoff.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, request, signIn, start, until as waitFor } from './harness.mjs';

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '1c2d3e4f-5061-4b7c-9d8e-0f1a2b3c4d5e';
const until = (check, ms = 20_000) => waitFor(check, ms);
const asked = s => cliCalls(s).filter(c => typeof c.user === 'string' && c.user.includes('Write the handoff to'));
const handoffFile = s => path.join(s.home, '.claude', 'handoffs', `${ID}.md`);
const log = s => { const f = path.join(s.state, 'cache-handoffs.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const events = s => log(s).map(e => e.event);
const stored = s => JSON.parse(fs.readFileSync(path.join(s.state, 'cache-handoffs.json'), 'utf8'));

async function ready({ session, handoffs = { [ID]: 52 }, env, flags = {}, extra = [] } = {}) {
  const s = await start({
    sessions: [{ id: ID, title: 'Fix it', ago: 52, reply: { ago: 52 }, ...session }, ...extra], claude: true, handoffs,
    env: { CAPCOM_CACHE_HANDOFF_SCALE: '600', ...env },
  });
  for (const [name, text] of Object.entries(flags)) fs.writeFileSync(path.join(s.home, name), text);
  return { s, ...(await signIn(s)) };
}
// A session Capcom started is listed under `started`, and one the owner archived only in the archive.
const rowOf = async (s, token, id) => {
  const ix = (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
  const archive = (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
  return [...ix.pinned, ...ix.ungrouped, ...ix.started, ...ix.other, ...ix.groups.flatMap(g => g.sessions), ...archive].flatMap(r => [r, ...(r.children ?? [])]).find(r => r.id === id);
};
const send = (s, token, id, json) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json });
const goesCold = async s => { await until(() => events(s).includes('written')); };

test('an idle session due for it is asked once to write its handoff, which is saved where the ask says and quietly', async () => {
  const { s, token } = await ready();
  await until(() => asked(s).length === 1);
  await goesCold(s);
  assert.ok(fs.statSync(handoffFile(s)).size > 0);
  assert.match(asked(s)[0].user, /^<session-message from="ghostshell"/);
  assert.equal(asked(s)[0].user.includes(handoffFile(s)), true);
  const row = await rowOf(s, token, ID);
  assert.equal(row.cold, true);
  assert.equal(row.dot ?? null, null, 'no unread mark or banner for the ask');
  assert.equal(stored(s)[ID].state, 'cold');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(asked(s).length, 1, 'one ask for an idle stretch');
  assert.deepEqual(events(s), ['ask', 'written']);
  assert.equal((await request(s, 'GET', '/api/sessions', { headers: as(token) })).body().features.cacheHandoff, true);
});

test('the ask leaves the session where it was in the list', async () => {
  const { s, token } = await ready({ extra: [{ id: OTHER, title: 'Other', ago: 30 }] });
  const before = await rowOf(s, token, ID);
  await goesCold(s);
  const after = await rowOf(s, token, ID);
  assert.equal(after.lastActivityAt, before.lastActivityAt);
  assert.equal(after.sortAt ?? before.sortAt, before.sortAt);
});

test('a session on a 5 minute cache, under the size or compacted is never asked', async () => {
  for (const session of [{ reply: { ago: 52, window: '5m' } }, { reply: { ago: 52, total: 1000 } }, { reply: { ago: 52, compacted: true } }]) {
    const { s } = await ready({ session });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(asked(s).length, 0, JSON.stringify(session));
    assert.deepEqual(events(s), []);
  }
});

test('a reply from 49 minutes ago is not asked yet, and one from 58 is too late', async () => {
  for (const ago of [49, 58]) {
    const { s } = await ready({ session: { reply: { ago }, ago }, handoffs: { [ID]: ago } });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(asked(s).length, 0, `${ago}`);
  }
});

test('a session whose handoff was not written is failed, and says why in the log', async () => {
  for (const [flag, reason] of [['handoff-skip', 'the file is not there'], ['handoff-empty', 'the file is empty'], ['handoff-error', 'the turn ended with an error']]) {
    const { s, token } = await ready({ flags: { [flag]: '' } });
    await until(() => events(s).includes('failed'));
    assert.equal(log(s).find(e => e.event === 'failed').reason, reason);
    assert.equal((await rowOf(s, token, ID)).cold ?? false, false);
    assert.equal(stored(s)[ID].state, 'failed');
  }
});

test('a message to the session while the ask is out voids it', async () => {
  const { s, token } = await ready({ flags: { 'handoff-write': '' } });
  await until(() => asked(s).length === 1);
  fs.rmSync(path.join(s.home, 'handoff-write'));
  assert.equal((await send(s, token, ID, { text: 'hello' })).status, 200);
  await until(() => events(s).includes('cleared'));
  assert.match(log(s).find(e => e.event === 'cleared').reason, /void/);
  assert.equal(stored(s)[ID], undefined);
});

test('the ask\'s Write is allowed for its own file, and any other tool call in its turn is refused without a card', async () => {
  const own = await ready({ flags: { 'handoff-write': '' } });
  await until(() => cliCalls(own.s).some(c => c.requestId === 'perm-handoff' && c.response === 'allow'));
  const other = await ready({ flags: { 'handoff-write': path.join('/', 'tmp', 'elsewhere.md') } });
  await until(() => cliCalls(other.s).some(c => c.requestId === 'perm-handoff' && c.response === 'deny'));
  const answered = await request(other.s, 'POST', `/api/sessions/${ID}/approve`, { headers: as(other.token), json: { requestId: 'perm-handoff', decision: 'deny' } });
  assert.notEqual(answered.status, 200, 'no card was waiting');
});

test('a restart while the ask is out fails it, and a saved handoff survives a restart', async () => {
  const { s: first } = await ready({ handoffs: { [ID]: { endedAt: Date.now() - 52 * 60_000, state: 'asking', askedAt: Date.now() - 1000, path: '/x' } } });
  assert.equal(stored(first)[ID].state, 'failed');
  assert.deepEqual(events(first), ['failed']);
  const { s, token } = await ready({ handoffs: { [ID]: { endedAt: Date.now() - 52 * 60_000, state: 'cold', askedAt: Date.now() - 2000, coldAt: Date.now() - 1000, path: '/x' } } });
  assert.equal((await rowOf(s, token, ID)).cold, true);
});

test('a message from a client that does not ask for a handover goes to the session, clears the handoff and is logged', async () => {
  const { s, token } = await ready();
  await goesCold(s);
  assert.equal((await send(s, token, ID, { text: 'Carry on' })).status, 200);
  await until(() => events(s).includes('cleared'));
  assert.equal((await rowOf(s, token, ID)).cold ?? false, false);
  assert.ok(log(s).some(e => e.event === 'not-moved' && /did not ask/.test(e.reason)));
  assert.equal(cliCalls(s).filter(c => typeof c.user === 'string' && c.user.includes('You carry on')).length, 0);
});

test('a slash command stays in the session it is for', async () => {
  const { s, token } = await ready();
  await goesCold(s);
  const res = await send(s, token, ID, { text: '/context', handover: true });
  assert.equal(res.body().movedTo, undefined);
  assert.ok(log(s).some(e => e.event === 'not-moved' && /slash/.test(e.reason)));
});

test('with a handover the next message starts a fresh session from the handoff, in the earlier one\'s place, and the earlier one points at it', async () => {
  const { s, token } = await ready({ flags: { 'handoff-text': 'Next: ship the thing.\n' } });
  await goesCold(s);
  const res = await send(s, token, ID, { text: 'Carry on', handover: true });
  assert.equal(res.status, 200);
  const to = res.body().movedTo;
  assert.equal(typeof to, 'string');
  assert.notEqual(to, ID);
  const seed = cliCalls(s).find(c => typeof c.user === 'string' && c.user.includes('You carry on the work of session'));
  assert.ok(seed.user.includes('Next: ship the thing.'));
  assert.ok(seed.user.includes(`session ${ID}`));
  assert.ok(seed.user.endsWith('Carry on'));
  await until(async () => (await rowOf(s, token, to))?.continues === ID);
  const fresh = await rowOf(s, token, to);
  assert.equal(fresh.title, 'Fix it');
  const old = await rowOf(s, token, ID);
  assert.equal(old.continuedIn, to);
  assert.equal(old.archived, true);
  assert.equal(old.cold ?? false, false);
  const line = log(s).find(e => e.event === 'returned');
  assert.deepEqual([line.from, line.to], [ID, to]);
  assert.equal(events(s).filter(e => e === 'returned').length, 1);
});

test('a handoff too long to put in the seed is read from its file instead', async () => {
  const { s, token } = await ready({ flags: { 'handoff-text': `${'x'.repeat(70 * 1024)}\n` } });
  await goesCold(s);
  const res = await send(s, token, ID, { text: 'Carry on', handover: true });
  assert.equal(typeof res.body().movedTo, 'string');
  const seed = cliCalls(s).find(c => typeof c.user === 'string' && c.user.includes('You carry on the work of session'));
  assert.ok(seed.user.includes('Read it first.'));
  assert.equal(seed.user.includes('xxxxxxxxxx'), false);
});

test('two messages at once start one session, and the second is told the first is under way or goes where the work moved', async () => {
  const { s, token } = await ready();
  await goesCold(s);
  const [a, b] = await Promise.all([send(s, token, ID, { text: 'one', handover: true }), send(s, token, ID, { text: 'two', handover: true })]);
  const started = [a, b].filter(r => r.status === 200 && r.body().movedTo);
  assert.equal(started.length, 1);
  assert.equal(cliCalls(s).filter(c => typeof c.user === 'string' && c.user.includes('You carry on the work of session')).length, 1);
});

test('an archived session does not hand over', async () => {
  const { s, token } = await ready();
  await goesCold(s);
  await request(s, 'POST', '/api/layout/archive', { headers: as(token), json: { id: ID, archived: true } });
  const res = await send(s, token, ID, { text: 'Carry on', handover: true });
  assert.equal(res.body().movedTo, undefined);
});

test('a session that was handed over refuses a message sent to it by another session and names where the work went', async () => {
  const { s, token } = await ready({ extra: [{ id: OTHER, title: 'Other', ago: 3 }] });
  await goesCold(s);
  const to = (await send(s, token, ID, { text: 'Carry on', handover: true })).body().movedTo;
  const res = await send(s, token, OTHER, { text: `call send_session ${JSON.stringify({ session_id: ID, message: 'hello' })}` });
  assert.equal(res.status, 200);
  await until(() => cliCalls(s).some(c => c.mcp));
  const told = JSON.stringify(cliCalls(s).filter(c => c.mcp));
  assert.match(told, /handed over/);
  assert.ok(told.includes(to));
});
