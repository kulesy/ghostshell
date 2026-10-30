// Run with `npm test`. The scheduled session routes over HTTP against the real server and a fake CLI, with their own state folder under a
// temporary home, so nothing here reads or writes the real state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { wrapOneOff } from '../lib/scheduled.mjs';
import { localIso } from '../lib/routines.mjs';
import { as, cliCalls, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const GROUPS = [{ id: 'cg-work', name: 'Work' }, { id: 'cg-home', name: 'Home chores' }];
// Each start spawns a fake CLI, which a busy machine can be slow to launch.
const until = (check, ms = 20_000) => waitFor(check, ms);
const HOUR = 3600_000;
const soon = (hours = 24) => localIso(Date.now() + hours * HOUR);

async function open(mine) {
  const s = await start({ groups: GROUPS, claude: true, ...mine });
  const { token } = await signIn(s);
  const work = path.join(s.home, 'work');
  fs.mkdirSync(work);
  return { s, token, work, file: path.join(s.state, 'scheduled.json'), saved: () => JSON.parse(fs.readFileSync(path.join(s.state, 'scheduled.json'), 'utf8')).scheduled };
}

// A refused write is answered before its body is read, and the server may then close the socket, so each request gets a socket of its own.
const send = (c, method, url, headers, json) => {
  const all = { connection: 'close', ...headers };
  for (const key of Object.keys(all)) if (all[key] === undefined) delete all[key];
  return request(c.s, method, url, { headers: all, json });
};
const write = (c, method, url, json, headers) => send(c, method, url, { ...as(c.token), origin: c.s.origin, ...headers }, json);
const read = (c, url) => send(c, 'GET', url, as(c.token));
const listed = async c => (await read(c, '/api/scheduled')).body().scheduled;
const sessions = async c => (await read(c, '/api/sessions')).body();
const starts = c => cliCalls(c.s).filter(x => x.started);
const NEW = c => ({ title: 'Look at the R&D doc', at: soon(), cwd: c.work, prompt: 'Read the R&D doc.', model: 'haiku', effort: 'high', mode: 'plan' });

test('a scheduled session is added, read, edited, cancelled and deleted over HTTP', async () => {
  const c = await open();
  assert.deepEqual((await read(c, '/api/scheduled')).body(), { scheduled: [], problem: null });
  const added = await write(c, 'POST', '/api/scheduled', { ...NEW(c), group: 'work' });
  assert.equal(added.status, 200, added.text);
  const { scheduled } = added.body();
  assert.deepEqual([scheduled.id, scheduled.title, scheduled.cwd, scheduled.model, scheduled.effort, scheduled.mode, scheduled.group, scheduled.groupName, scheduled.status, scheduled.problem],
    ['look-at-the-r-d-doc', 'Look at the R&D doc', c.work, 'haiku', 'high', 'plan', 'cg-work', 'Work', 'pending', null]);
  assert.deepEqual(c.saved().map(s => [s.id, s.status, s.prompt]), [['look-at-the-r-d-doc', 'pending', 'Read the R&D doc.']]);
  assert.equal((await write(c, 'POST', '/api/scheduled', NEW(c))).body().scheduled.id, 'look-at-the-r-d-doc-2');

  const later = soon(48);
  const edited = await write(c, 'PATCH', '/api/scheduled/look-at-the-r-d-doc', { title: 'Renamed', at: later, group: null, prompt: 'Other text.' });
  assert.equal(edited.status, 200, edited.text);
  assert.deepEqual([edited.body().scheduled.title, edited.body().scheduled.at, edited.body().scheduled.group, edited.body().scheduled.prompt, edited.body().scheduled.id], ['Renamed', later, null, 'Other text.', 'look-at-the-r-d-doc']);

  const cancelled = await write(c, 'POST', '/api/scheduled/look-at-the-r-d-doc/cancel', {});
  assert.deepEqual([cancelled.status, cancelled.body().scheduled.status], [200, 'cancelled']);
  assert.deepEqual((await listed(c)).map(s => [s.id, s.status]), [['look-at-the-r-d-doc', 'cancelled'], ['look-at-the-r-d-doc-2', 'pending']], 'cancelling keeps the entry');

  const gone = await write(c, 'DELETE', '/api/scheduled/look-at-the-r-d-doc');
  assert.deepEqual([gone.status, gone.body()], [200, { removed: 'look-at-the-r-d-doc' }]);
  assert.deepEqual((await listed(c)).map(s => s.id), ['look-at-the-r-d-doc-2']);
  assert.deepEqual([(await write(c, 'DELETE', '/api/scheduled/look-at-the-r-d-doc')).status, (await write(c, 'PATCH', '/api/scheduled/nope', { title: 'x' })).status, (await write(c, 'POST', '/api/scheduled/nope/start', {})).status], [404, 404, 404]);
  assert.equal(starts(c).length, 0, 'nothing started');
});

test('a time in the past is refused on add and on an edit that changes the time, and every bad field is named, with nothing written', async () => {
  const c = await open();
  const made = (await write(c, 'POST', '/api/scheduled', NEW(c))).body().scheduled;
  const before = fs.readFileSync(c.file, 'utf8');
  const past = await write(c, 'POST', '/api/scheduled', { ...NEW(c), at: soon(-1) });
  assert.deepEqual([past.status, past.body().error, past.body().problems], [400, 'Nothing was saved. Check the date and time.', { at: 'That time has already passed. Pick one in the future.' }]);
  const edit = await write(c, 'PATCH', `/api/scheduled/${made.id}`, { at: soon(-1) });
  assert.deepEqual([edit.status, Object.keys(edit.body().problems)], [400, ['at']]);
  const bad = await write(c, 'POST', '/api/scheduled', { title: ' ', at: 'soon', cwd: path.join(c.s.home, 'nowhere'), model: 'two words', effort: 'extreme', mode: 'sometimes', group: 'Nowhere', prompt: ' ' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body().problems), ['title', 'at', 'cwd', 'model', 'effort', 'mode', 'group', 'prompt']);
  assert.equal(bad.body().error, 'Nothing was saved. Check the title, date and time, folder, model, effort, permission mode, group and prompt.');
  assert.equal(fs.readFileSync(c.file, 'utf8'), before);
  assert.equal((await write(c, 'POST', '/api/scheduled', [])).status, 400);
});

test('start now starts the session at once, in the group, with the first message wrapped, and the entry cannot then be edited, cancelled or started again', async () => {
  const c = await open();
  const made = (await write(c, 'POST', '/api/scheduled', { ...NEW(c), group: 'cg-work' })).body().scheduled;
  const started = await write(c, 'POST', `/api/scheduled/${made.id}/start`, {});
  assert.equal(started.status, 200, started.text);
  const { sessionId, scheduled } = started.body();
  assert.deepEqual([scheduled.status, scheduled.sessionId, scheduled.lastError], ['started', sessionId, null]);
  await until(() => starts(c).length === 1);
  const [call] = starts(c);
  assert.equal(call.cwd, fs.realpathSync(c.work));
  assert.equal(call.started[call.started.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(call.started[call.started.indexOf('--model') + 1], 'haiku');
  await until(() => cliCalls(c.s).some(x => x.user));
  assert.equal(cliCalls(c.s).find(x => x.user).user, wrapOneOff(made.id, 'Read the R&D doc.'));
  await until(() => JSON.parse(fs.readFileSync(c.s.layout, 'utf8')).assignments?.[sessionId] === 'cg-work');

  const ix = await sessions(c);
  const row = ix.groups.find(g => g.id === 'cg-work').sessions.find(r => r.id === sessionId);
  assert.deepEqual([row.title, row.routine, ix.routines.length], ['Look at the R&D doc', null, 0], 'a session like any other, in its group, not a routine run');

  for (const [method, url, json] of [['PATCH', `/api/scheduled/${made.id}`, { title: 'x' }], ['POST', `/api/scheduled/${made.id}/cancel`, {}], ['POST', `/api/scheduled/${made.id}/start`, {}]]) {
    const res = await write(c, method, url, json);
    assert.deepEqual([res.status, /^Look at the R&D doc is started, so it cannot be /.test(res.body().error)], [409, true], `${method} ${url}`);
  }
  assert.equal(starts(c).length, 1);
  assert.equal((await write(c, 'DELETE', `/api/scheduled/${made.id}`)).status, 200, 'but it can be deleted, and the session stays');
  assert.equal((await sessions(c)).groups.find(g => g.id === 'cg-work').sessions.some(r => r.id === sessionId), true);
});

test('start now with a folder that has gone is a refusal that starts nothing and leaves the entry pending', async () => {
  const c = await open();
  const made = (await write(c, 'POST', '/api/scheduled', NEW(c))).body().scheduled;
  fs.rmSync(c.work, { recursive: true });
  const res = await write(c, 'POST', `/api/scheduled/${made.id}/start`, {});
  assert.deepEqual([res.status, res.body().error], [400, `The folder ${c.work} does not exist.`]);
  assert.equal((await listed(c))[0].status, 'pending');
  assert.equal((await listed(c))[0].problem, `The folder ${c.work} does not exist.`);
  assert.equal(starts(c).length, 0);
});

test('the check at start catches up one that came due while GhostShell was down, skips one over 12 hours late, and starts on Home when the group is gone', async () => {
  const c = await open();
  const entry = (id, ago, extra) => ({ id, title: id, at: localIso(Date.now() - ago), cwd: c.work, prompt: `Do ${id}.`, ...extra });
  fs.writeFileSync(c.file, JSON.stringify({ scheduled: [
    entry('caught-up', 10 * 60_000),
    entry('too-late', 13 * HOUR),
    entry('no-group', 5 * 60_000, { group: 'cg-gone' }),
    { ...entry('future', -HOUR) },
  ] }));
  const again = await restart(c.s);
  const d = { ...c, s: again, token: (await signIn(again)).token };
  await until(() => d.saved().filter(s => s.status === 'started' && s.sessionId).length === 2 && d.saved().find(s => s.id === 'too-late').status === 'skipped');
  const by = id => d.saved().find(s => s.id === id);
  assert.deepEqual([by('too-late').status, by('too-late').sessionId, by('too-late').lastError], ['skipped', null, '13 h late, over the 12 h limit']);
  assert.deepEqual([by('caught-up').status, by('caught-up').lastError, by('future').status], ['started', null, 'pending']);
  assert.deepEqual([by('no-group').status, by('no-group').lastError], ['started', 'Its group was deleted, so it started on Home.']);
  assert.deepEqual(JSON.parse(fs.readFileSync(d.s.layout, 'utf8')).assignments ?? {}, {}, 'both on Home');
  assert.equal(starts(d).length, 2);
  const third = await restart(d.s);
  await signIn(third);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(cliCalls(third).filter(x => x.started).length, 2, 'a restart starts none of them again');
});

test('every write refuses a cross-site request and a request with no session, and a read needs the session too', async () => {
  const c = await open();
  const made = (await write(c, 'POST', '/api/scheduled', NEW(c))).body().scheduled;
  for (const [method, url, json] of [['POST', '/api/scheduled', NEW(c)], ['PATCH', `/api/scheduled/${made.id}`, { title: 'x' }], ['DELETE', `/api/scheduled/${made.id}`], ['POST', `/api/scheduled/${made.id}/cancel`, {}], ['POST', `/api/scheduled/${made.id}/start`, {}]]) {
    assert.equal((await write(c, method, url, json, { origin: 'http://evil.example' })).status, 403, `${method} ${url} cross-site`);
    assert.equal((await send(c, method, url, { origin: c.s.origin }, json)).status, 401, `${method} ${url} signed out`);
  }
  assert.equal((await send(c, 'GET', '/api/scheduled', {})).status, 401);
  assert.deepEqual((await listed(c)).map(s => s.status), ['pending']);
  assert.equal(starts(c).length, 0);
});

test('the routes answer 404 for a path they do not have and 405 for a method they do not allow', async () => {
  const c = await open();
  assert.equal((await write(c, 'POST', '/api/scheduled/x/y/z', {})).status, 404);
  assert.equal((await write(c, 'POST', '/api/scheduled/x/wipe', {})).status, 404);
  const wrong = await write(c, 'PUT', '/api/scheduled', {});
  assert.deepEqual([wrong.status, wrong.headers.allow], [405, 'GET, POST']);
  assert.equal((await write(c, 'GET', '/api/scheduled/x/cancel')).status, 405);
  assert.equal((await write(c, 'PATCH', '/api/scheduled/bad%20id', {})).status, 400);
});

test('the session list says the server has scheduled sessions, for a page that has to cope without them', async () => {
  const c = await open();
  assert.equal((await sessions(c)).features.scheduled, true);
});
