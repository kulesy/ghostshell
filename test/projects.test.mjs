// Run with `npm test`. Projects above groups over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { writePassword } from '../lib/auth.mjs';
import { as, request, restart, signIn, start } from './harness.mjs';

const GROUPS = [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'Notes' }];
const SESSIONS = [
  { id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'In backlog', group: 'cg-b', ago: 2 },
  { id: 's3', title: 'Pinned', pinned: true, ago: 3 },
  { id: 's4', title: 'In no group', ago: 4 },
];

const post = (s, token, url, json, headers) => request(s, 'POST', `/api/layout/${url}`, { headers: { ...as(token), ...headers }, json });
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const places = ix => Object.fromEntries(ix.groups.map(g => [g.id, g.project]));
const kept = ix => Object.fromEntries(ix.groups.map(g => [g.id, g.sessions.map(r => r.title)]));
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));

async function ready(mac) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, ...mac });
  return { s, ...(await signIn(s)) };
}

// The harness sends a body in one piece, so a POST that is still arriving is written by hand.
async function postInParts(s, token, url, json, between) {
  const text = JSON.stringify(json);
  const half = Math.floor(text.length / 2);
  const held = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: `/api/layout/${url}`, headers: { host: `localhost:${s.port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...as(token) } });
  const reply = new Promise((resolve, reject) => {
    held.on('response', res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: () => JSON.parse(body) }));
    });
    held.on('error', reject);
  });
  held.write(text.slice(0, half));
  // Once the server has answered a request sent after these headers, it has read them and passed the first sign-in check.
  await index(s, token);
  between();
  held.end(text.slice(half));
  return reply;
}

test('the list carries the projects in order, and says which project each group is in, with a gone project meaning the top level', async () => {
  const { s, token } = await ready({
    groups: [{ id: 'cg-a', name: 'Reviewing', project: 'cp-x' }, { id: 'cg-b', name: 'Backlog', project: 'cp-gone' }, { id: 'cg-c', name: 'Notes', project: 5 }],
    layout: { projects: [{ id: 'cp-y', name: 'Garden' }, { id: 'cp-x', name: 'Capcom' }] },
  });
  const before = fs.readFileSync(s.layout, 'utf8');
  const ix = await index(s, token);
  assert.deepEqual(ix.projects, [{ id: 'cp-y', name: 'Garden' }, { id: 'cp-x', name: 'Capcom' }]);
  assert.deepEqual(places(ix), { 'cg-a': 'cp-x', 'cg-b': null, 'cg-c': null });
  assert.deepEqual(kept(ix), { 'cg-a': ['In reviewing'], 'cg-b': ['In backlog'], 'cg-c': [] });
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'reading the list changes nothing');
});

test('a layout file from before projects lists none and takes its first project', async () => {
  const { s, token } = await ready();
  const ix = await index(s, token);
  assert.deepEqual(ix.projects, []);
  assert.deepEqual(places(ix), { 'cg-a': null, 'cg-b': null, 'cg-c': null });
  assert.equal('projects' in onDisk(s), false);
  const made = await post(s, token, 'project/add', { name: 'Capcom' });
  assert.equal(made.status, 200);
  assert.deepEqual(onDisk(s).projects, [made.body()]);
  assert.deepEqual((await index(s, token)).projects, [made.body()]);
});

test('a project is added, renamed and deleted, and its name stays text', async () => {
  const { s, token } = await ready();
  const first = (await post(s, token, 'project/add', { name: ' Capcom ' })).body();
  const second = (await post(s, token, 'project/add', { name: '<img src=x onerror=alert(1)>' })).body();
  assert.deepEqual(first, { id: first.id, name: 'Capcom' });
  assert.match(first.id, /^cp-[0-9a-f-]{36}$/);
  assert.equal(second.name, '<img src=x onerror=alert(1)>');
  assert.deepEqual((await index(s, token)).projects, [first, second], 'in the order they were added');

  const renamed = await post(s, token, 'project/rename', { id: first.id, name: 'Capcom app' });
  assert.deepEqual(renamed.body(), { id: first.id, name: 'Capcom app' });
  assert.deepEqual((await index(s, token)).projects, [{ id: first.id, name: 'Capcom app' }, second]);

  const group = await post(s, token, 'group/rename', { id: 'cg-b', name: ' Open   tasks ' });
  assert.deepEqual(group.body(), { id: 'cg-b', name: 'Open tasks' });
  assert.deepEqual((await index(s, token)).groups.map(g => g.name), ['Reviewing', 'Open tasks', 'Notes']);

  const removed = await post(s, token, 'project/remove', { id: first.id });
  assert.equal(removed.status, 200);
  assert.deepEqual((await index(s, token)).projects, [second]);
});

test('a group is added inside a project or at the top level, and moves into a project, between projects and out again', async () => {
  const { s, token } = await ready();
  const [a, b] = [(await post(s, token, 'project/add', { name: 'A' })).body(), (await post(s, token, 'project/add', { name: 'B' })).body()];
  const inside = (await post(s, token, 'group/add', { name: 'Inside A', project: a.id })).body();
  const top = (await post(s, token, 'group/add', { name: 'Top' })).body();
  assert.deepEqual(inside, { id: inside.id, name: 'Inside A', project: a.id });
  assert.deepEqual(top, { id: top.id, name: 'Top' });
  assert.deepEqual(places(await index(s, token)), { 'cg-a': null, 'cg-b': null, 'cg-c': null, [inside.id]: a.id, [top.id]: null });

  assert.deepEqual((await post(s, token, 'group/move', { id: 'cg-a', project: a.id })).body(), { id: 'cg-a', name: 'Reviewing', project: a.id });
  await post(s, token, 'group/move', { id: 'cg-b', project: b.id });
  await post(s, token, 'group/move', { id: 'cg-a', project: b.id });
  await post(s, token, 'group/move', { id: inside.id, project: null });
  await post(s, token, 'group/move', { id: top.id });
  const ix = await index(s, token);
  assert.deepEqual(places(ix), { 'cg-a': b.id, 'cg-b': b.id, 'cg-c': null, [inside.id]: null, [top.id]: null });
  assert.deepEqual(ix.groups.map(g => g.id), ['cg-a', 'cg-b', 'cg-c', inside.id, top.id], 'a group keeps its place in the list when it moves');
  assert.deepEqual(kept(ix)['cg-a'], ['In reviewing'], 'and its sessions go with it');
});

test('deleting a project returns its groups to the top level and loses no group, session or pin', async () => {
  const { s, token } = await ready();
  const gone = (await post(s, token, 'project/add', { name: 'Gone' })).body();
  const stays = (await post(s, token, 'project/add', { name: 'Stays' })).body();
  const extra = (await post(s, token, 'group/add', { name: 'Extra', project: gone.id })).body();
  await post(s, token, 'group/move', { id: 'cg-a', project: gone.id });
  await post(s, token, 'group/move', { id: 'cg-b', project: stays.id });
  const before = onDisk(s);
  const ix = await index(s, token);
  assert.deepEqual(places(ix), { 'cg-a': gone.id, 'cg-b': stays.id, 'cg-c': null, [extra.id]: gone.id });

  assert.equal((await post(s, token, 'project/remove', { id: gone.id })).status, 200);
  const after = await index(s, token);
  assert.deepEqual(after.projects, [stays]);
  assert.deepEqual(places(after), { 'cg-a': null, 'cg-b': stays.id, 'cg-c': null, [extra.id]: null });
  assert.deepEqual(kept(after), { ...kept(ix) });
  assert.deepEqual(after.pinned.map(r => r.title), ['Pinned']);
  assert.deepEqual(after.ungrouped.map(r => r.title), ['In no group']);
  const disk = onDisk(s);
  assert.deepEqual(disk.assignments, before.assignments);
  assert.deepEqual(disk.pinned, before.pinned);
  assert.deepEqual(disk.groups.map(g => g.id), before.groups.map(g => g.id));
});

test('deleting a group puts its sessions back to ungrouped, archived ones and a family too, and deletes no session, pin, transcript or folder', async () => {
  const { s, token } = await ready({ sessions: [...SESSIONS, { id: 's5', title: 'Archived in reviewing', group: 'cg-a', archived: true, ago: 5 }, { id: 's6', title: 'Child of one', parent: 's1', ago: 6 }] });
  const folder = path.join(s.state, 'groups', 'cg-a');
  fs.mkdirSync(folder, { recursive: true });
  const before = await index(s, token);
  assert.deepEqual(before.groups.map(g => [g.id, g.sessions.map(r => r.title), g.archived]), [['cg-a', ['In reviewing'], 1], ['cg-b', ['In backlog'], 0], ['cg-c', [], 0]]);

  const removed = await post(s, token, 'group/remove', { id: 'cg-a' });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body(), { id: 'cg-a', name: 'Reviewing' });
  const after = await index(s, token);
  assert.deepEqual(after.groups.map(g => g.id), ['cg-b', 'cg-c']);
  assert.deepEqual(kept(after), { 'cg-b': ['In backlog'], 'cg-c': [] });
  assert.deepEqual(after.ungrouped.map(r => [r.title, (r.children ?? []).map(c => c.title)]), [['In reviewing', ['Child of one']], ['In no group', []]], 'the family stays together');
  assert.deepEqual(after.pinned.map(r => r.title), ['Pinned']);
  assert.deepEqual(onDisk(s).assignments, { s2: 'cg-b' });
  const archived = (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
  assert.deepEqual(archived.map(r => r.title), ['Archived in reviewing'], 'an archived member stays archived');
  assert.equal(fs.existsSync(folder), true);
  for (const id of ['s1', 's2', 's3', 's4', 's5', 's6']) assert.equal(fs.existsSync(path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`)), true, id);
  assert.equal((await post(s, token, 'group/remove', { id: 'cg-a' })).status, 404, 'a second delete finds nothing');
});

test('a group is ordered before or after another in its view, and the list follows the file', async () => {
  const { s, token } = await ready();
  const project = (await post(s, token, 'project/add', { name: 'A' })).body();
  const [one, two] = [(await post(s, token, 'group/add', { name: 'One', project: project.id })).body(), (await post(s, token, 'group/add', { name: 'Two', project: project.id })).body()];
  const order = async () => (await index(s, token)).groups.map(g => g.id);
  assert.deepEqual(await order(), ['cg-a', 'cg-b', 'cg-c', one.id, two.id]);

  const moved = await post(s, token, 'group/order', { id: 'cg-c', before: 'cg-a' });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.body(), { id: 'cg-c', name: 'Notes' });
  assert.deepEqual(await order(), ['cg-c', 'cg-a', 'cg-b', one.id, two.id]);
  assert.equal((await post(s, token, 'group/order', { id: 'cg-c', after: 'cg-b' })).status, 200);
  assert.deepEqual(await order(), ['cg-a', 'cg-b', 'cg-c', one.id, two.id]);
  assert.equal((await post(s, token, 'group/order', { id: two.id, before: one.id })).status, 200);
  assert.deepEqual(await order(), ['cg-a', 'cg-b', 'cg-c', two.id, one.id], 'a project\'s groups are ordered among themselves');

  const before = fs.readFileSync(s.layout, 'utf8');
  const across = await post(s, token, 'group/order', { id: 'cg-a', after: two.id });
  assert.equal(across.status, 400);
  assert.match(across.body().error, /different views/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.deepEqual(places(await index(s, token)), { 'cg-a': null, 'cg-b': null, 'cg-c': null, [one.id]: project.id, [two.id]: project.id });
});

test('a group copied from Desktop and then deleted does not come back when the server restarts, though Desktop still lists it', async () => {
  const { s } = await ready();
  const config = path.join(s.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const desktop = JSON.parse(fs.readFileSync(config, 'utf8'));
  desktop.preferences.epitaxyPrefs['dframe-group-scopes'] = { scope: { groups: [{ id: 'dg-a', name: 'From Desktop' }, { id: 'dg-b', name: 'Also Desktop' }], assignments: { local_s1: 'dg-a' } } };
  fs.writeFileSync(config, JSON.stringify(desktop));
  const listed = fs.readFileSync(config, 'utf8');
  fs.writeFileSync(s.layout, JSON.stringify({ seededAt: null, groups: [], pinned: ['s3'], assignments: {} }));

  const first = await restart(s);
  const { token } = await signIn(first);
  assert.deepEqual((await index(first, token)).groups.map(g => g.id), ['dg-a', 'dg-b'], 'the first start copies Desktop\'s groups');
  assert.deepEqual(kept(await index(first, token)), { 'dg-a': ['In reviewing'], 'dg-b': [] });
  assert.equal((await post(first, token, 'group/remove', { id: 'dg-a' })).status, 200);

  const second = await restart(first);
  const again = await signIn(second);
  const ix = await index(second, again.token);
  assert.deepEqual(ix.groups.map(g => g.id), ['dg-b']);
  assert.deepEqual(ix.ungrouped.map(r => r.title), ['In reviewing', 'In backlog', 'In no group'], 'its session is ungrouped and not put back in it');
  assert.notEqual(onDisk(second).seededAt, null);
  assert.equal(fs.readFileSync(config, 'utf8'), listed, 'Desktop\'s own file is as it was');
});

test('a refused edit says why and writes nothing', async () => {
  const { s, token } = await ready({ layout: { projects: [{ id: 'cp-x', name: 'Capcom' }] } });
  const before = fs.readFileSync(s.layout, 'utf8');
  const refusals = [
    ['project/add', {}, 400, /Give it a name/],
    ['project/add', { name: '   ' }, 400, /Give it a name/],
    ['project/add', { name: 7 }, 400, /Give it a name/],
    ['project/add', { name: '\u200B\u2060' }, 400, /Give it a name/],
    ['group/add', { name: '\u3164' }, 400, /Give it a name/],
    ['project/add', { name: 'x'.repeat(81) }, 400, /80 characters/],
    ['project/rename', { id: 'cp-x', name: '' }, 400, /Give it a name/],
    ['project/rename', { id: 'cp-none', name: 'Fine' }, 404, /Unknown project/],
    ['group/rename', { id: 'cg-a', name: '' }, 400, /Give it a name/],
    ['group/rename', { id: 'cg-a', name: '\u200B' }, 400, /Give it a name/],
    ['group/rename', { id: 'cg-a', name: 'x'.repeat(81) }, 400, /80 characters/],
    ['group/rename', { id: 'cg-none', name: 'Fine' }, 404, /Unknown group/],
    ['group/rename', { id: 'cp-x', name: 'Fine' }, 404, /Unknown group/],
    ['project/remove', {}, 404, /Unknown project/],
    ['project/remove', { id: 'cg-a' }, 404, /Unknown project/],
    ['group/add', { name: '' }, 400, /Give it a name/],
    ['group/add', { name: 'Fine', project: 'cp-none' }, 404, /Unknown project/],
    ['group/move', { id: 'cg-none', project: null }, 404, /Unknown group/],
    ['group/move', { id: 'cp-x' }, 404, /Unknown group/],
    ['group/move', { id: 'cg-a', project: 'cp-none' }, 404, /Unknown project/],
    ['group/remove', {}, 404, /Unknown group/],
    ['group/remove', { id: 'cp-x' }, 404, /Unknown group/],
    ['group/remove', { id: 'cg-none' }, 404, /Unknown group/],
    ['group/order', { id: 'cg-a' }, 400, /before or after one other/],
    ['group/order', { id: 'cg-a', before: 'cg-b', after: 'cg-c' }, 400, /before or after one other/],
    ['group/order', { id: 'cg-a', before: 'cg-a' }, 400, /another group/],
    ['group/order', { id: 'cg-none', before: 'cg-a' }, 404, /Unknown group/],
    ['group/order', { id: 'cg-a', after: 'cg-none' }, 404, /Unknown group/],
  ];
  for (const [url, body, status, message] of refusals) {
    const res = await post(s, token, url, body);
    assert.equal(res.status, status, `${url} ${JSON.stringify(body)}`);
    assert.match(res.body().error, message, `${url} ${JSON.stringify(body)}`);
  }
  const notJson = await request(s, 'POST', '/api/layout/project/add', { headers: as(token), form: { name: 'Fine' } });
  assert.equal(notJson.status, 400);
  assert.match(notJson.body().error, /JSON/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a layout file that cannot be read is reported, and no project is written over it', async () => {
  const { s, token } = await ready();
  fs.writeFileSync(s.layout, '{ not json');
  assert.match((await index(s, token)).problem, /layout\.json cannot be read/);
  const res = await post(s, token, 'project/add', { name: 'Capcom' });
  assert.equal(res.status, 500);
  assert.match(res.body().error, /layout\.json cannot be read/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), '{ not json');
});

test('only a signed-in POST from this site changes anything, and a GET to these paths never does', async () => {
  const { s, token } = await ready({ layout: { projects: [{ id: 'cp-x', name: 'Capcom' }] } });
  const before = fs.readFileSync(s.layout, 'utf8');
  const urls = ['project/add', 'project/rename', 'group/rename', 'project/remove', 'group/add', 'group/move', 'group/order', 'group/remove'];
  const body = { id: 'cp-x', name: 'Changed', project: 'cp-x' };
  for (const url of urls) {
    assert.equal((await request(s, 'GET', `/api/layout/${url}?id=cp-x&name=Changed&project=cp-x`, { headers: as(token) })).status, 404, `GET ${url}`);
    assert.equal((await request(s, 'PUT', `/api/layout/${url}`, { headers: as(token), json: body })).status, 404, `PUT ${url}`);
    assert.equal((await request(s, 'POST', `/api/layout/${url}`, { json: body })).status, 401, `signed out ${url}`);
    assert.equal((await post(s, token, url, body, { origin: 'http://evil.example' })).status, 403, `cross-site ${url}`);
    assert.equal((await post(s, token, url, body, { origin: `http://localhost:${s.port + 1}` })).status, 403, `another port ${url}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal((await post(s, token, 'project/add', { name: 'Fine' }, { origin: s.origin })).status, 200, 'the same origin is let through');
});

test('an edit still arriving when the password is changed is refused rather than written afterwards', async () => {
  for (const [url, edit] of [['project/add', { name: 'Held' }], ['move', { id: 's1', group: 'cg-b' }], ['rename', { id: 's1', title: 'Held' }]]) {
    const { s, token } = await ready();
    const before = fs.readFileSync(s.layout, 'utf8');
    const reply = await postInParts(s, token, url, edit, () => writePassword(s.state, 'the password after the reset'));
    assert.equal(reply.status, 401, url);
    assert.deepEqual(reply.body(), { error: 'Signed out.' }, url);
    assert.equal(fs.readFileSync(s.layout, 'utf8'), before, url);
  }
});

test('move and pin refuse a body that is not JSON with a 400, as the project routes do, and write nothing', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const url of ['move', 'pin']) {
    const res = await request(s, 'POST', `/api/layout/${url}`, { headers: as(token), form: { id: 's1', group: 'cg-b', pinned: 'true' } });
    assert.equal(res.status, 400, url);
    assert.match(res.body().error, /JSON/, url);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});
