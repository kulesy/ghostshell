// Run with `npm test`. Reloading an MCP server of a running chat, over HTTP against the real server, whose CLI is the fake from the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { shapeMcp } from '../lib/context.mjs';
import { as, cliCalls, request, signIn, start, until } from './harness.mjs';

const row = (name, over = {}) => ({ name, status: 'connected', scope: 'user', config: { type: 'stdio', command: 'secret-command', args: ['--token', 'secret-token'] }, tools: [], ...over });
const ROWS = [row('notes'), row('tracker', { status: 'failed', error: 'Could not start.' }), row('capcom', { config: { type: 'sdk' }, scope: undefined }), row('paused', { status: 'disabled' })];

const list = (s, token, id, headers = {}) => request(s, 'POST', `/api/sessions/${id}/mcp`, { headers: { ...as(token), ...headers }, json: {} });
const reload = (s, token, id, json) => request(s, 'POST', `/api/sessions/${id}/mcp-reload`, { headers: as(token), json });
const toggles = s => cliCalls(s).filter(c => c.control === 'mcp_toggle').map(c => [c.serverName, c.enabled]);
const servers = (s, rows) => fs.writeFileSync(path.join(s.home, 'mcp-servers.json'), JSON.stringify(rows));
const flag = (s, name, value) => fs.writeFileSync(path.join(s.home, name), value);

// The CLI is only asked once it is running, so a slow machine starting it would use up the time it has to answer.
async function running(rows = ROWS) {
  const s = await start({ claude: true, sessions: [{ id: 'live', title: 'Runs' }, { id: 'idle', title: 'Idle' }] });
  servers(s, rows);
  const { token } = await signIn(s);
  assert.equal((await request(s, 'POST', '/api/sessions/live/send', { headers: as(token), json: { text: 'hello' } })).status, 200);
  await until(() => cliCalls(s).some(c => c.user), 20_000);
  return { s, token };
}

test('only the name, status, scope and error of a server are kept, and a server of GhostShell\'s own or one switched off cannot be reloaded', () => {
  assert.deepEqual(shapeMcp(ROWS), [
    { name: 'notes', status: 'connected', scope: 'user', error: null, reloadable: true },
    { name: 'tracker', status: 'failed', scope: 'user', error: 'Could not start.', reloadable: true },
    { name: 'capcom', status: 'connected', scope: null, error: null, reloadable: false },
    { name: 'paused', status: 'disabled', scope: 'user', error: null, reloadable: false },
  ]);
  assert.equal(shapeMcp([row('long', { error: 'x'.repeat(900) })])[0].error.length, 300);
  assert.deepEqual(shapeMcp([null, 'x', {}, { name: '', status: 'connected' }, { name: 'a' }, { status: 'connected' }]), []);
  for (const none of [undefined, null, 'rows', {}]) assert.deepEqual(shapeMcp(none), []);
});

test('only a signed-in browser on this site can list or reload, by POST, and a chat that is not running is not started to answer', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'quiet', title: 'Idle' }] });
  servers(s, ROWS);
  assert.equal((await request(s, 'POST', '/api/sessions/quiet/mcp', { json: {} })).status, 401);
  assert.equal((await request(s, 'POST', '/api/sessions/quiet/mcp-reload', { json: { name: 'notes' } })).status, 401);
  const { token } = await signIn(s);
  assert.equal((await list(s, token, 'quiet', { origin: 'http://evil.example' })).status, 403);
  assert.equal((await request(s, 'POST', '/api/sessions/quiet/mcp-reload', { headers: { ...as(token), origin: 'http://evil.example' }, json: { name: 'notes' } })).status, 403);
  assert.equal((await request(s, 'GET', '/api/sessions/quiet/mcp', { headers: as(token) })).status, 405);
  assert.equal((await request(s, 'GET', '/api/sessions/quiet/mcp-reload', { headers: as(token) })).status, 405);

  const answer = await list(s, token, 'quiet');
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body(), { running: false, servers: [] });
  const refused = await reload(s, token, 'quiet', { name: 'notes' });
  assert.equal(refused.status, 409);
  assert.match(refused.body().error, /not running.*next starts/);
  assert.deepEqual(cliCalls(s), [], 'nothing was started for either');
});

test('a running chat lists its servers with their name, status, scope and error, and none of their config', async () => {
  const { s, token } = await running();
  const answer = await list(s, token, 'live');
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body(), { running: true, servers: shapeMcp(ROWS) });
  assert.doesNotMatch(JSON.stringify(answer.body()), /secret|command|args/);
});

test('a reload switches the named server off and then on, in that order, and answers with the fresh list', async () => {
  const { s, token } = await running();
  const answer = await reload(s, token, 'live', { name: 'tracker' });
  assert.equal(answer.status, 200);
  assert.deepEqual(toggles(s), [['tracker', false], ['tracker', true]]);
  assert.deepEqual(answer.body().servers.map(r => [r.name, r.status]), [['notes', 'connected'], ['tracker', 'connected'], ['capcom', 'connected'], ['paused', 'disabled']]);
  assert.equal(cliCalls(s).filter(c => c.started).length, 1, 'the process was kept, so the transcript and the context are too');
});

test('a name that is not one of the chat\'s own servers, one of GhostShell\'s own and one that is switched off are refused with nothing sent to the CLI', async () => {
  const { s, token } = await running();
  const refused = async (json, status, words) => {
    const answer = await reload(s, token, 'live', json);
    assert.equal(answer.status, status);
    assert.match(answer.body().error, words);
  };
  await refused({ name: 'nothing' }, 404, /no MCP server with that name/);
  await refused({ name: 'NOTES' }, 404, /no MCP server/);
  await refused({ name: 'notes ' }, 404, /no MCP server/);
  await refused({ name: 'capcom' }, 400, /own server/);
  await refused({ name: 'paused' }, 400, /switched off/);
  for (const name of [undefined, null, 7, '', ['notes'], { name: 'notes' }]) await refused({ name }, 400, /name of the server/);
  assert.deepEqual(toggles(s), []);
  assert.equal((await reload(s, token, 'live', { name: 'notes', command: 'rm', env: { A: '1' } })).status, 200);
  assert.deepEqual(toggles(s), [['notes', false], ['notes', true]], 'only the name of the request reached the CLI');
});

test('a reload that fails to switch the server back on says it was left off, and one that cannot switch it off changes nothing', async () => {
  const { s, token } = await running();
  flag(s, 'mcp-toggle-fails', 'on');
  const failed = await reload(s, token, 'live', { name: 'notes' });
  assert.equal(failed.status, 502);
  assert.match(failed.body().error, /notes was switched off and did not come back on: The fake refused to start it\. Reload it again to switch it back on/);
  const left = failed.body().servers.find(r => r.name === 'notes');
  assert.equal(left.status, 'disabled', 'the list shows where it was left');
  assert.equal(left.reloadable, true, 'a server the reload left off can be reloaded again');
  assert.deepEqual(toggles(s), [['notes', false], ['notes', true]]);

  flag(s, 'mcp-toggle-fails', 'off');
  const stuck = await reload(s, token, 'live', { name: 'tracker' });
  assert.equal(stuck.status, 502);
  assert.equal(stuck.body().error, 'The fake refused to start it.');
  assert.deepEqual(toggles(s).slice(2), [['tracker', false]], 'the enable was never sent');
});

test('a second reload while one runs in the same chat is refused, and the chat takes another once it is done', async () => {
  const { s, token } = await running();
  flag(s, 'mcp-toggle-wait', '300');
  const first = reload(s, token, 'live', { name: 'notes' });
  await until(() => toggles(s).length === 1);
  const second = await reload(s, token, 'live', { name: 'tracker' });
  assert.equal(second.status, 409);
  assert.match(second.body().error, /already running/);
  assert.equal((await first).status, 200);
  assert.deepEqual(toggles(s), [['notes', false], ['notes', true]], 'the refused one sent nothing');
  assert.equal((await reload(s, token, 'live', { name: 'tracker' })).status, 200);
});
