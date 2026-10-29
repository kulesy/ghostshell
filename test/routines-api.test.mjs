// Run with `npm test`. The routine routes over HTTP against the real server, with its own state folder under a temporary home. Prompt files and
// folders are in that home, so nothing here reads or writes the real state or any real prompt file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, request, restart, signIn, start, until } from './harness.mjs';

const PROMPT_FILE = '---\nname: desk\ndescription: A routine with a prompt file of its own\n---\n\nCheck the board.\n';
const NEW = { title: 'Morning check', cron: '30 7 * * 1-5', jitterSeconds: 737, prompt: 'Look at the board.' };

// A signed-in server whose routines.json already holds one routine, which reads its prompt from a SKILL.md outside the state folder.
// `sessions` are the runs the session list already holds, and `layout` is written over the layout file.
async function open(sessions, layout) {
  const first = await start({ claude: true, sessions, layout });
  const work = path.join(first.home, 'work');
  const desk = path.join(first.home, 'desktop', 'desk', 'SKILL.md');
  fs.mkdirSync(work);
  fs.mkdirSync(path.dirname(desk), { recursive: true });
  fs.writeFileSync(desk, PROMPT_FILE);
  fs.writeFileSync(path.join(first.state, 'routines.json'), JSON.stringify({
    routines: [{ id: 'desk', title: 'File routine', cron: '30 7 * * 1-5', jitterSeconds: 737, file: desk, cwd: work, model: null, effort: null, mode: null, enabled: false }],
  }, null, 2));
  const s = await restart(first);
  const { token } = await signIn(s);
  const raw = () => fs.readFileSync(path.join(s.state, 'routines.json'), 'utf8');
  return { s, token, work, desk, raw, prompts: path.join(s.state, 'routines') };
}

// A refused write is answered before its body is read, and the server may then close the socket, so each request gets a socket of its own.
const send = (c, method, url, headers, json) => {
  const all = { connection: 'close', ...headers };
  for (const key of Object.keys(all)) if (all[key] === undefined) delete all[key];
  return request(c.s, method, url, { headers: all, json });
};
const write = (c, method, url, json, headers) => send(c, method, url, { ...as(c.token), origin: c.s.origin, ...headers }, json);
const read = (c, url) => send(c, 'GET', url, as(c.token));
const routinesOf = async c => (await read(c, '/api/routines')).body().routines;

test('a routine is added, read, edited, switched, run-checked and deleted over HTTP, and a prompt file outside GhostShell is never written', async () => {
  const c = await open();
  const first = (await read(c, '/api/routines')).body();
  assert.deepEqual([first.problem, first.routines.map(r => [r.id, r.title, r.enabled, r.problem])], [null, [['desk', 'File routine', false, null]]]);
  assert.deepEqual((await read(c, '/api/routines/desk/prompt')).body(), { file: c.desk, text: 'Check the board.', ours: false });

  const added = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, model: 'haiku', effort: 'high', mode: 'plan' });
  assert.equal(added.status, 200, added.text);
  const { routine } = added.body();
  const file = path.join(c.prompts, 'morning-check.md');
  assert.deepEqual([routine.id, routine.title, routine.file, routine.cwd, routine.model, routine.effort, routine.mode, routine.enabled, routine.problem], ['morning-check', 'Morning check', file, c.work, 'haiku', 'high', 'plan', true, null]);
  assert.ok(Date.parse(routine.armedAt) <= Date.now() && Date.now() - Date.parse(routine.armedAt) < 60_000, 'armed from now');
  assert.equal(fs.readFileSync(file, 'utf8'), 'Look at the board.\n');
  assert.deepEqual((await read(c, '/api/routines/morning-check/prompt')).body(), { file, text: 'Look at the board.', ours: true });
  assert.equal((await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work })).body().routine.id, 'morning-check-2');

  const oldFile = fs.statSync(c.desk);
  const edited = await write(c, 'PATCH', '/api/routines/desk', { prompt: 'Check the other board.', title: 'Renamed', jitterSeconds: 60 });
  assert.equal(edited.status, 200, edited.text);
  assert.deepEqual([edited.body().routine.title, edited.body().routine.file, edited.body().routine.jitterSeconds, edited.body().routine.id], ['Renamed', path.join(c.prompts, 'desk.md'), 60, 'desk']);
  assert.equal(fs.readFileSync(path.join(c.prompts, 'desk.md'), 'utf8'), 'Check the other board.\n');
  assert.equal(fs.readFileSync(c.desk, 'utf8'), PROMPT_FILE);
  assert.equal(fs.statSync(c.desk).mtimeMs, oldFile.mtimeMs);
  assert.equal((await read(c, '/api/routines/desk/prompt')).body().text, 'Check the other board.');

  const renamed = await write(c, 'PATCH', '/api/routines/morning-check', { title: 'Evening check' });
  assert.deepEqual([renamed.body().routine.id, renamed.body().routine.title, renamed.body().routine.file], ['morning-check', 'Evening check', file]);
  const off = await write(c, 'POST', '/api/routines/morning-check/enabled', { enabled: false });
  assert.deepEqual([off.status, off.body().routine.enabled, off.body().routine.armedAt], [200, false, null]);
  const on = await write(c, 'PATCH', '/api/routines/morning-check', { enabled: true });
  assert.deepEqual([on.status, on.body().routine.enabled], [200, true]);

  const gone = await write(c, 'DELETE', '/api/routines/morning-check-2');
  assert.deepEqual([gone.status, gone.body()], [200, { removed: 'morning-check-2' }]);
  assert.deepEqual((await routinesOf(c)).map(r => r.id), ['desk', 'morning-check']);
  assert.equal(fs.readFileSync(path.join(c.prompts, 'morning-check-2.md'), 'utf8'), 'Look at the board.\n', 'the prompt file is kept');
  const again = await write(c, 'DELETE', '/api/routines/morning-check-2');
  assert.deepEqual([again.status, again.body().error], [404, 'No routine with that id.']);
  assert.equal((await write(c, 'PATCH', '/api/routines/nope', { title: 'x' })).status, 404);
  assert.equal((await read(c, '/api/routines/nope/prompt')).status, 404);
  assert.equal((await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work })).body().routine.id, 'morning-check-3', 'the deleted routine\'s kept file still holds morning-check-2');
});

test('an id is taken while any run in the session list still holds it, a Desktop-style task folder holds nothing, and new is never an id', async () => {
  const c = await open([
    { id: 'p1', title: 'Old run', routine: 'past-run', ago: 5 },
    { id: 'p2', title: 'Our run', routine: 'our-run', source: 'capcom', ago: 5 },
    { id: 'p3', title: 'Old run, archived', routine: 'archived-run', archived: true, ago: 5 },
  ]);
  const tasks = path.join(c.s.home, '.claude', 'scheduled-tasks');
  fs.mkdirSync(path.join(tasks, 'desktop-only'), { recursive: true });
  const idOf = async title => {
    const res = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, title });
    assert.equal(res.status, 200, res.text);
    return res.body().routine.id;
  };
  assert.equal(await idOf('Desktop only'), 'desktop-only', 'a folder in Desktop\'s task folder holds no id');
  assert.equal(await idOf('Past run'), 'past-run-2', 'the runs of a routine that routines.json no longer holds keep its id');
  assert.equal(await idOf('Our run'), 'our-run-2', 'so do runs GhostShell started');
  assert.equal(await idOf('Archived run'), 'archived-run-2', 'and archived ones');
  assert.equal(await idOf('Desktop only'), 'desktop-only-2');
  assert.equal(await idOf('New'), 'new-2', '#/routines/new is the add form');
  assert.equal(await idOf('Fresh'), 'fresh');
  assert.deepEqual(fs.readdirSync(tasks), ['desktop-only'], 'that folder is not touched');
  assert.deepEqual(fs.readdirSync(path.join(tasks, 'desktop-only')), []);
});

test('a prompt file that cannot be read comes back empty with the error, still as a 200', async () => {
  const c = await open();
  fs.unlinkSync(c.desk);
  const res = await read(c, '/api/routines/desk/prompt');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { file: c.desk, text: '', ours: false, error: `Cannot read ${c.desk}.` });
});

test('a refused add or edit names every bad field under problems, with a one-line error, and writes nothing', async () => {
  const c = await open();
  const before = c.raw();
  const bad = {
    title: ' ', cron: '61 * * * *', jitterSeconds: 90_000, cwd: path.join(c.s.home, 'nowhere'), model: 'two words', effort: 'extreme', mode: 'sometimes', prompt: '  ',
  };
  const keys = ['title', 'cron', 'jitterSeconds', 'cwd', 'model', 'effort', 'mode', 'prompt'];
  for (const [method, url] of [['POST', '/api/routines'], ['PATCH', '/api/routines/desk']]) {
    const res = await write(c, method, url, bad);
    assert.equal(res.status, 400, res.text);
    const { error, problems } = res.body();
    assert.deepEqual(Object.keys(problems), keys, method);
    assert.ok(keys.every(k => typeof problems[k] === 'string' && problems[k].length > 0), method);
    assert.equal(error, 'Nothing was saved. Check the title, schedule, jitter, folder, model, effort, permission mode and prompt.');
    assert.match(problems.cron, /outside 0 to 59/);
    assert.match(problems.cwd, /nowhere does not exist/);
    assert.match(problems.model, /Unknown model two words/);
    assert.match(problems.effort, /Unknown effort level extreme/);
    assert.match(problems.mode, /Unknown permission mode sometimes/);
  }
  const empty = await write(c, 'POST', '/api/routines', {});
  assert.deepEqual([empty.status, Object.keys(empty.body().problems)], [400, ['title', 'cron', 'cwd', 'prompt']]);
  const one = await write(c, 'PATCH', '/api/routines/desk', { cron: 'nonsense' });
  assert.deepEqual([one.status, Object.keys(one.body().problems), one.body().error], [400, ['cron'], 'Nothing was saved. Check the schedule.']);
  const file = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.desk });
  assert.deepEqual([file.status, file.body().problems.cwd], [400, `${c.desk} is not a folder.`]);
  const relative = await write(c, 'POST', '/api/routines', { ...NEW, cwd: 'work' });
  assert.match(relative.body().problems.cwd, /full path/);
  const long = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, title: 'x'.repeat(121) });
  assert.deepEqual([long.status, Object.keys(long.body().problems)], [400, ['title']]);
  assert.equal(c.raw(), before);
  assert.equal(fs.existsSync(c.prompts), false);
  for (const [method, url, json] of [['POST', '/api/routines', 'text'], ['PATCH', '/api/routines/desk', [1]], ['POST', '/api/routines/desk/enabled', { enabled: 'yes' }]]) {
    const res = await write(c, method, url, json);
    assert.equal(res.status, 400, `${method} ${url}`);
    assert.equal(typeof res.body().error, 'string');
  }
  assert.equal(c.raw(), before);
});

test('a title that draws nothing is refused, and enabled null is refused rather than read as on', async () => {
  const c = await open();
  const before = c.raw();
  for (const title of ['\u200b', '\u202e', ' \u2060\u2800 ']) {
    for (const [method, url] of [['POST', '/api/routines'], ['PATCH', '/api/routines/desk']]) {
      const res = await write(c, method, url, { ...NEW, cwd: c.work, title });
      assert.deepEqual([res.status, Object.keys(res.body().problems)], [400, ['title']], `${method} ${JSON.stringify(title)}`);
    }
  }
  const nulled = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, enabled: null });
  assert.deepEqual([nulled.status, nulled.body().error], [400, 'Send enabled as true or false.']);
  const patched = await write(c, 'PATCH', '/api/routines/desk', { enabled: null });
  assert.deepEqual([patched.status, patched.body().error], [400, 'Send enabled as true or false.']);
  assert.equal(c.raw(), before);
  assert.equal(fs.existsSync(c.prompts), false);
  const bidi = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, title: '\u202eMorning\u202c check' });
  assert.deepEqual([bidi.status, bidi.body().routine.title, bidi.body().routine.enabled], [200, 'Morning check', true]);
  const off = await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, title: 'Left off', enabled: false });
  assert.equal(off.body().routine.enabled, false);
});

test('switching a routine on in an edit while its saved folder is gone names the folder under problems, and leaves it off', async () => {
  const c = await open();
  const folder = path.join(c.s.home, 'soon-gone');
  fs.mkdirSync(folder);
  const made = (await write(c, 'POST', '/api/routines', { ...NEW, cwd: folder, enabled: false })).body().routine;
  fs.renameSync(folder, path.join(c.s.home, 'moved-away'));
  const before = c.raw();
  const res = await write(c, 'PATCH', `/api/routines/${made.id}`, { enabled: true });
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(Object.keys(res.body().problems), ['cwd']);
  assert.match(res.body().problems.cwd, /soon-gone does not exist/);
  assert.equal(res.body().error, 'Nothing was saved. Check the folder.');
  assert.equal(c.raw(), before);
  const fixed = await write(c, 'PATCH', `/api/routines/${made.id}`, { enabled: true, cwd: c.work });
  assert.deepEqual([fixed.status, fixed.body().routine.enabled, fixed.body().routine.cwd], [200, true, c.work]);
});

test('every routine write needs this site\'s own Origin, and a cross-site one is refused with a 403 before anything changes', async () => {
  const c = await open();
  const made = (await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work })).body().routine;
  const before = c.raw();
  const requests = [
    ['POST', '/api/routines', { ...NEW, cwd: c.work, title: 'Cross site' }],
    ['PATCH', `/api/routines/${made.id}`, { title: 'Cross site' }],
    ['DELETE', `/api/routines/${made.id}`, undefined],
    ['POST', `/api/routines/${made.id}/run`, {}],
    ['POST', `/api/routines/${made.id}/enabled`, { enabled: false }],
  ];
  const refused = [
    ['no Origin', { origin: undefined }],
    ['another site\'s Origin', { origin: 'http://evil.example' }],
    ['the same host on another port', { origin: `http://localhost:${c.s.port + 1}` }],
    ['an opaque Origin', { origin: 'null' }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }],
    ['Sec-Fetch-Site none', { 'sec-fetch-site': 'none' }],
  ];
  for (const [method, url, json] of requests) {
    for (const [why, headers] of refused) {
      const res = await write(c, method, url, json, headers);
      assert.equal(res.status, 403, `${method} ${url} with ${why}`);
      assert.deepEqual(res.body(), { error: 'Cross-site request refused.' });
    }
    const signedOut = await send(c, method, url, { origin: 'http://evil.example' }, json);
    assert.equal(signedOut.status, 403, `${method} ${url} signed out from another site`);
  }
  assert.equal(c.raw(), before);
  assert.equal(fs.existsSync(path.join(c.prompts, 'cross-site.md')), false);
  const ok = await write(c, 'PATCH', `/api/routines/${made.id}`, { title: 'Same site' }, { 'sec-fetch-site': 'same-origin' });
  assert.equal(ok.status, 200);
  const signedOut = await send(c, 'DELETE', `/api/routines/${made.id}`, { origin: c.s.origin });
  assert.equal(signedOut.status, 401);
});

test('a cross-site Origin is refused on every write method, PATCH and DELETE included, before the sign-in is looked at, and a GET is let through', async () => {
  const c = await open();
  for (const method of ['PATCH', 'DELETE', 'PUT', 'POST']) {
    const res = await send(c, method, '/api/layout/rename', { ...as(c.token), origin: 'http://evil.example' }, { id: 'x', title: 'y' });
    assert.equal(res.status, 403, method);
  }
  const get = await send(c, 'GET', '/api/routines', { ...as(c.token), origin: 'http://evil.example' });
  assert.equal(get.status, 200, 'a GET writes nothing, so it is let through');
  const head = await send(c, 'HEAD', '/api/routines', { ...as(c.token), origin: 'http://evil.example' });
  assert.notEqual(head.status, 403);
});

test('a route with a bad id, an unknown path or the wrong method is refused plainly', async () => {
  const c = await open();
  assert.equal((await write(c, 'PATCH', '/api/routines/a%20b', {})).status, 400);
  assert.equal((await write(c, 'POST', '/api/routines/desk/other', {})).status, 404);
  assert.equal((await write(c, 'POST', '/api/routines/desk/run/extra', {})).status, 404);
  assert.equal((await read(c, '/api/routines/desk/enabled')).status, 405);
  const put = await write(c, 'PUT', '/api/routines/desk', {});
  assert.deepEqual([put.status, put.headers.allow], [405, 'PATCH, DELETE']);
  const get = await read(c, '/api/routines/desk');
  assert.equal(get.status, 405);
  const del = await write(c, 'DELETE', '/api/routines', undefined);
  assert.equal(del.status, 405);
  assert.equal((await write(c, 'POST', '/api/routines/desk/prompt', {})).status, 405);
});

test('the schedule route gives the next three fire times with the jitter, or the reason a schedule is refused', async () => {
  const c = await open();
  const ask = query => read(c, `/api/schedule?${new URLSearchParams(query)}`);
  const res = await ask({ cron: '*/10 * * * *', jitter: '30' });
  assert.equal(res.status, 200);
  const { next } = res.body();
  assert.equal(next.length, 3);
  const times = next.map(t => Date.parse(t));
  assert.ok(next.every(t => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(t)));
  assert.ok(times[0] > Date.now() && times[0] - Date.now() <= 10 * 60_000 + 30_000);
  assert.deepEqual([times[1] - times[0], times[2] - times[1]], [600_000, 600_000]);
  assert.ok(times.every(t => new Date(t).getSeconds() === 30), 'the jitter is on every fire');
  const plain = (await ask({ cron: '0 9 * * *' })).body().next;
  assert.ok(plain.every(t => /T09:00:00/.test(t)), 'no jitter given means none');
  assert.deepEqual((await ask({ cron: '0 0 31 2 *' })).body(), { next: [], problem: null });
  for (const [query, why] of [[{ cron: 'nonsense' }, /five fields/], [{ cron: '61 * * * *' }, /outside 0 to 59/], [{}, /five fields/], [{ cron: '0 9 * * *', jitter: '86400' }, /0 to 86399/], [{ cron: '0 9 * * *', jitter: '1.5' }, /whole number/], [{ cron: '0 9 * * *', jitter: 'x' }, /whole number/]]) {
    const bad = await ask(query);
    assert.equal(bad.status, 200, JSON.stringify(query));
    assert.deepEqual(bad.body().next, []);
    assert.match(bad.body().problem, why);
  }
  assert.equal((await write(c, 'POST', '/api/schedule', {})).status, 405);
  assert.equal((await send(c, 'GET', '/api/schedule?cron=0%209%20*%20*%20*')).status, 401);
  assert.deepEqual((await routinesOf(c)).map(r => r.id), ['desk'], 'asking reserves no routine id');
});

test('a routine cannot be deleted while its run is starting, and can be once the start has failed', async () => {
  const c = await open();
  const made = (await write(c, 'POST', '/api/routines', { ...NEW, cwd: c.work, enabled: false })).body().routine;
  // The fake CLI names a session only for a message it knows, so this start stays open until it times out.
  const running = write(c, 'POST', `/api/routines/${made.id}/run`, {}).catch(() => {});
  await until(async () => (await routinesOf(c)).find(r => r.id === made.id).running);
  const refused = await write(c, 'DELETE', `/api/routines/${made.id}`);
  assert.equal(refused.status, 409);
  assert.match(refused.body().error, /Morning check is still running/);
  assert.deepEqual((await routinesOf(c)).map(r => r.id), ['desk', made.id]);
  assert.ok(fs.existsSync(made.file));
  void running;
});

test('the sessions list tells a page this server can add, edit and delete routines, and run one from a prompt file', async () => {
  const c = await open();
  const res = await read(c, '/api/sessions');
  assert.equal(res.status, 200);
  assert.equal(res.body().features.routineEdits, true);
  assert.equal(res.body().features.routineFiles, true);
  assert.equal(res.body().features.groupEdits, true);
});

test('a routine is added on a prompt file anywhere, edited, moved to GhostShell\'s text and back over HTTP, and the file is never written', async () => {
  const c = await open();
  const dir = path.join(c.s.home, 'notes');
  const file = path.join(dir, 'standup.md');
  const body = '---\nname: standup\n---\n\nSummarise the standup.\n';
  fs.mkdirSync(dir);
  fs.writeFileSync(file, body);
  const old = new Date(2026, 5, 1, 12);
  fs.utimesSync(file, old, old);
  const { prompt, ...fileless } = NEW;
  const snap = () => [fs.readFileSync(file, 'utf8'), fs.statSync(file).mtimeMs, fs.readdirSync(dir)];
  const before = snap();

  const added = await write(c, 'POST', '/api/routines', { ...fileless, cwd: c.work, file });
  assert.equal(added.status, 200, added.text);
  const { routine } = added.body();
  assert.deepEqual([routine.id, routine.file, routine.problem], ['morning-check', file, null]);
  assert.equal(fs.existsSync(c.prompts), false, 'no copy is made');
  assert.deepEqual((await read(c, '/api/routines/morning-check/prompt')).body(), { file, text: 'Summarise the standup.', ours: false });

  const renamed = await write(c, 'PATCH', '/api/routines/morning-check', { title: 'Standup', cron: '0 9 * * 1-5' });
  assert.deepEqual([renamed.status, renamed.body().routine.file], [200, file]);
  const own = path.join(c.prompts, 'morning-check.md');
  const moved = await write(c, 'PATCH', '/api/routines/morning-check', { prompt: 'Summarise the standup.' });
  assert.deepEqual([moved.status, moved.body().routine.file], [200, own]);
  assert.equal(fs.readFileSync(own, 'utf8'), 'Summarise the standup.\n');
  assert.deepEqual((await read(c, '/api/routines/morning-check/prompt')).body(), { file: own, text: 'Summarise the standup.', ours: true });
  const back = await write(c, 'PATCH', '/api/routines/morning-check', { file });
  assert.deepEqual([back.status, back.body().routine.file], [200, file]);
  assert.ok(fs.existsSync(own), 'GhostShell\'s copy stays');
  assert.deepEqual(snap(), before);
});

test('a refused file names the prompt file or the prompt under problems over HTTP, and nothing is saved', async () => {
  const c = await open();
  const before = c.raw();
  const { prompt, ...fileless } = NEW;
  const cases = [
    [{ file: 'standup.md' }, 'file', 'Give the full path, starting with /.'],
    [{ file: '~/standup.md' }, 'file', 'Give the full path, starting with /.'],
    [{ file: path.join(c.s.home, 'missing.md') }, 'file', `Cannot read ${path.join(c.s.home, 'missing.md')}.`],
    [{ file: c.work }, 'file', `${c.work} is a folder, not a file.`],
    [{ file: path.join(c.s.state, 'routines', 'x.md') }, 'file', null],
    [{ file: c.desk, prompt: 'Both.' }, 'prompt', 'Send the prompt text or the path of a file, not both.'],
    [{}, 'prompt', 'Write the prompt the routine will run, or give the path of a prompt file.'],
  ];
  fs.mkdirSync(c.prompts);
  fs.writeFileSync(path.join(c.prompts, 'x.md'), 'x');
  for (const [extra, key, why] of cases) {
    const res = await write(c, 'POST', '/api/routines', { ...fileless, cwd: c.work, ...extra });
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(Object.keys(res.body().problems), [key], JSON.stringify(extra));
    assert.equal(res.body().problems[key], why ?? "That file is in GhostShell's own prompt folder. Choose GhostShell's own text instead.");
  }
  const edit = await write(c, 'PATCH', '/api/routines/desk', { file: c.desk, prompt: 'Both.' });
  assert.deepEqual([edit.status, Object.keys(edit.body().problems)], [400, ['prompt']]);
  assert.equal(c.raw(), before);
  assert.deepEqual(fs.readdirSync(c.prompts), ['x.md']);
});

test('a hand-edited routine whose prompt file or folder is not a full path shows the reason in the list', async () => {
  const c = await open();
  const data = JSON.parse(c.raw());
  data.routines[0].file = 'SKILL.md';
  fs.writeFileSync(path.join(c.s.state, 'routines.json'), JSON.stringify(data));
  assert.equal((await routinesOf(c))[0].problem, 'The prompt file needs a full path, starting with /.');
  data.routines[0].file = c.desk;
  for (const [cwd, why] of [['work', 'The folder work must be a full path starting with /.'], ['', 'The routine has no folder. Give its full path, starting with /.']]) {
    data.routines[0].cwd = cwd;
    fs.writeFileSync(path.join(c.s.state, 'routines.json'), JSON.stringify(data));
    assert.equal((await routinesOf(c))[0].problem, why);
  }
});

// The routine 'desk' is in routines.json with the title 'File routine', and 'past-run' is not.
const sessionsOf = async c => (await read(c, '/api/sessions')).body();
const runTitles = list => list.map(r => r.title);

test('a routine\'s group says its title from routines.json, and a run row follows it unless the run was renamed in the layout', async () => {
  const c = await open([
    { id: 'd1', title: 'Title at the first run', routine: 'desk', ago: 5 },
    { id: 'd2', title: 'Title at the second run', routine: 'desk', ago: 65 },
    { id: 'd3', title: 'Own name in the layout', routine: 'desk', ago: 125 },
  ], { titles: { d3: 'Own name' } });
  const [group] = (await sessionsOf(c)).routines;
  assert.deepEqual([group.name, group.title, group.latest.title, runTitles(group.earlier)], ['desk', 'File routine', 'File routine', ['File routine', 'Own name']]);
  assert.deepEqual([group.latest.renamed, group.earlier[0].renamed, group.earlier[1].renamed], [undefined, undefined, true]);
  const renamed = await write(c, 'PATCH', '/api/routines/desk', { title: 'Brand new name' });
  assert.equal(renamed.status, 200, renamed.text);
  const [after] = (await sessionsOf(c)).routines;
  assert.deepEqual([after.title, after.latest.title, runTitles(after.earlier)], ['Brand new name', 'Brand new name', ['Brand new name', 'Own name']]);
  assert.equal((await routinesOf(c))[0].title, 'Brand new name', 'and the Routines page reads the same name');
});

test('the group of a routine that routines.json no longer holds has no title and its runs keep the title they started with', async () => {
  const c = await open([{ id: 'p1', title: 'Title at the run', routine: 'past-run', ago: 5 }]);
  const [group] = (await sessionsOf(c)).routines;
  assert.equal(Object.hasOwn(group, 'title'), false);
  assert.equal(group.latest.title, 'Title at the run');
  fs.writeFileSync(path.join(c.s.state, 'routines.json'), '{ not json');
  const [unread] = (await sessionsOf(c)).routines;
  assert.equal(Object.hasOwn(unread, 'title'), false, 'and a routines.json that cannot be read gives none either');
  assert.equal(unread.latest.title, 'Title at the run');
});

test('emoji titles go through a rename into routines.json and back unchanged', async () => {
  const c = await open([{ id: 'd1', title: 'First', routine: 'desk', ago: 5 }]);
  for (const title of ['📥 Tina inboxes', '⏳ Timesheet', '🇩🇪 German word', '✅ Done']) {
    const res = await write(c, 'PATCH', '/api/routines/desk', { title });
    assert.equal(res.status, 200, res.text);
    assert.equal(JSON.parse(c.raw()).routines[0].title, title);
    assert.equal((await routinesOf(c))[0].title, title);
    const [group] = (await sessionsOf(c)).routines;
    assert.deepEqual([group.title, group.latest.title], [title, title]);
  }
});
