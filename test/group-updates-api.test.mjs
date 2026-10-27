// Run with `npm test`. The ranked update over HTTP against the real server and a fake CLI: the feature flag, the typing route, and one update
// arriving in a group's chat as a message from GhostShell. The instance divides its waits by 600 with CAPCOM_GROUP_UPDATE_SCALE, so a run takes seconds.
// The rules and the text have their own tests in group-updates.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, listen, request, signIn, start, until as waitFor } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const SESSIONS = [
  { id: 'a', title: 'Member A', group: 'cg-work', ago: 5 },
  { id: 'b', title: 'Member B', group: 'cg-work', ago: 6 },
  { id: 'old', title: 'Archived member', group: 'cg-work', archived: true, ago: 20 },
  { id: 'loose', title: 'In no group', ago: 7 },
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1 },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }, { id: 'cg-home', name: 'Home' }];
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = async (s, token, route) => (await request(s, 'GET', route, { headers: as(token) })).body();
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const ready = async mine => {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, claude: true, gh: true, env: { CAPCOM_GROUP_UPDATE_SCALE: '600' }, ...mine });
  return { s, ...(await signIn(s)) };
};
const updates = s => cliCalls(s).filter(c => typeof c.user === 'string' && c.user.startsWith('<session-message from="ghostshell"'));

test('the list says the server takes group updates and the typing ping', async () => {
  const { s, token } = await ready();
  assert.equal((await get(s, token, '/api/sessions')).features.groupUpdates, true);
});

test('the typing ping is a 204 for a group\'s chat, behind the sign-in, and refuses a session that is no group\'s and an id that is no session', async () => {
  const { s, token } = await ready();
  const route = id => `/api/sessions/${id}/typing`;
  assert.equal((await request(s, 'POST', route(WORK), { json: {} })).status, 401);
  const ok = await post(s, token, route(WORK));
  assert.deepEqual([ok.status, ok.text], [204, '']);
  const loose = await post(s, token, route('loose'));
  assert.deepEqual([loose.status, loose.body()], [400, { error: 'Only a group\'s chat takes this.' }]);
  const none = await post(s, token, route('nothing'));
  assert.deepEqual([none.status, none.body()], [404, { error: 'No session with that id on this Mac.' }]);
  assert.equal((await post(s, token, route('a.b'))).status, 400);
  assert.equal((await request(s, 'GET', route(WORK), { headers: as(token) })).status, 405);
});

test('a session in the group failing is sent to the group\'s chat as a message from GhostShell, with the rules, and not sent again', async () => {
  const { s, token } = await ready({ marks: { seen: { [WORK]: 1 } } });
  // A page with the chat open keeps the cache warm for the update.
  const viewer = listen(s, token, WORK);
  try {
    await until(() => viewer.events.length > 0);
    assert.deepEqual(updates(s), []);
    // Long enough for the first look, which only takes a baseline.
    await new Promise(resolve => setTimeout(resolve, 600));
    const marks = path.join(s.state, 'marks.json');
    const kept = JSON.parse(fs.readFileSync(marks, 'utf8'));
    fs.writeFileSync(marks, JSON.stringify({ ...kept, errors: { a: Date.now() } }));
    await until(() => updates(s).length === 1);
    const { user } = updates(s)[0];
    assert.match(user, /^<session-message from="ghostshell" from-name="GhostShell">\nStatus update for the group "Work", \d{4}-\d\d-\d\d \d\d:\d\d\.\n\nChanged since the last update:\n- "Member A" ended its turn with an error\.\n\nLive sessions \(2\):\n/);
    assert.match(user, /- "Member A" \[a\]: ended its last turn with an error, last moved [^\n]*\n- "Member B" \[b\]: idle,/);
    assert.doesNotMatch(user, /Archived member|In no group/);
    assert.match(user, /\nStatus updates\. When the group's sessions change[\s\S]*\n\nRank these sessions by the ranking rules in your instructions and reply with the numbered list only\.\n<\/session-message>$/);
    assert.ok(cliCalls(s).some(c => c.started?.includes('--resume') && c.started[c.started.indexOf('--resume') + 1] === WORK), 'the chat was resumed');
    const record = JSON.parse(fs.readFileSync(path.join(s.state, 'group-updates.json'), 'utf8'))[WORK];
    assert.deepEqual([record.count, record.rules], [1, true]);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(updates(s).length, 1, 'nothing changed since, so nothing more');
  } finally {
    viewer.close();
  }
});
