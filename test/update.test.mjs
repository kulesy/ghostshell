// Run with `npm test`. The update banner's rules against real git in scratch folders: a bare "origin" and a clone that plays the checkout GhostShell
// runs from. The restart helper is a recording fake, so nothing here restarts anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importedAt, inQuietWindow, makeUpdate, needsRestart, parseSubject, QUIET_REASON, repoUrl, restartRefused, waitMinutes } from '../lib/update.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-update-test-'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const put = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

// A bare origin with one commit, the `author` clone that adds merged changes to it, and the `live` clone that is the checkout the server runs.
function repos() {
  const dir = fs.mkdtempSync(path.join(base, 'case-'));
  const origin = path.join(dir, 'origin.git');
  const author = path.join(dir, 'author');
  const live = path.join(dir, 'live');
  git(dir, 'init', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '--quiet', origin, author);
  git(author, 'config', 'user.name', 'Test');
  git(author, 'config', 'user.email', 'test@example.test');
  git(author, 'checkout', '-q', '-b', 'main');
  put(author, 'server.mjs', "import './lib/a.mjs';\nimport { x } from './public/ui/imported.js';\nexport { y } from './public/ui/deeper.js';\nawait import('./lib/lazy.mjs');\n");
  put(author, 'lib/a.mjs', 'export const a = 1;\n');
  put(author, 'lib/lazy.mjs', 'export const z = 1;\n');
  put(author, 'public/ui/imported.js', "import './nested.js';\nexport const x = 1;\n");
  put(author, 'public/ui/nested.js', 'export const n = 1;\n');
  put(author, 'public/ui/deeper.js', 'export const y = 1;\n');
  put(author, 'public/app.js', 'export const app = 1;\n');
  put(author, 'public/ui/page-only.js', 'export const p = 1;\n');
  put(author, 'docs/a.md', 'a\n');
  put(author, 'package.json', '{}\n');
  git(author, 'add', '-A');
  git(author, 'commit', '-q', '-m', 'First (#1)');
  git(author, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '--quiet', origin, live);
  git(live, 'config', 'user.name', 'Test');
  git(live, 'config', 'user.email', 'test@example.test');
  const merge = (subject, files) => {
    for (const [file, text] of Object.entries(files)) put(author, file, text ?? '');
    git(author, 'add', '-A');
    git(author, 'commit', '-q', '-m', subject);
    git(author, 'push', '-q', 'origin', 'main');
  };
  return { live, author, merge, dir };
}

const SATURDAY = new Date(2026, 10, 7, 8, 0);
const MONDAY_EARLY = new Date(2026, 10, 2, 8, 0);

function rig(over = {}) {
  const r = { ...repos(), restarts: [], busy: 0, locked: false, at: SATURDAY, uptime: 3600, ...over };
  r.update = makeUpdate({
    root: r.live, restart: (root, minutes) => { r.restarts.push([root, minutes]); return Promise.resolve(''); }, locked: () => r.locked, busy: () => r.busy, now: () => r.at, uptime: () => r.uptime, graceMs: r.graceMs ?? 60_000, log: r.log,
    ...(r.git && { git: r.git(r.live) }),
  });
  return r;
}
const head = r => git(r.live, 'rev-parse', 'HEAD').trim();
const originHead = r => git(r.live, 'rev-parse', 'origin/main').trim();

test('the quiet window is weekdays from 07:00 to 09:45 and no other time', () => {
  const at = (day, h, m) => new Date(2026, 10, day, h, m);
  assert.equal(inQuietWindow(at(2, 6, 59)), false, 'Monday 06:59');
  assert.equal(inQuietWindow(at(2, 7, 0)), true, 'Monday 07:00');
  assert.equal(inQuietWindow(at(2, 9, 44)), true, 'Monday 09:44');
  assert.equal(inQuietWindow(at(2, 9, 45)), false, 'Monday 09:45');
  assert.equal(inQuietWindow(at(6, 8, 0)), true, 'Friday 08:00');
  assert.equal(inQuietWindow(at(7, 8, 0)), false, 'Saturday 08:00');
  assert.equal(inQuietWindow(at(8, 8, 0)), false, 'Sunday 08:00');
  assert.equal(restartRefused(at(2, 8, 0)), 'Restarts wait until 09:45 on weekdays.');
  assert.equal(restartRefused(at(7, 8, 0)), '');
});

test('a restart may wait 30 minutes, or less when that would reach the next weekday 07:00', () => {
  const at = (day, h, m, s = 0) => new Date(2026, 10, day, h, m, s);
  assert.equal(waitMinutes(at(6, 6, 50)), 9, 'Friday 06:50');
  assert.equal(waitMinutes(at(2, 6, 58)), 1, 'Monday 06:58');
  assert.equal(waitMinutes(at(2, 6, 59)), 0, 'Monday 06:59');
  assert.equal(waitMinutes(at(2, 6, 30)), 29, 'Monday 06:30');
  assert.equal(waitMinutes(at(2, 6, 0)), 30, 'Monday 06:00');
  assert.equal(waitMinutes(at(7, 8, 0)), 30, 'Saturday 08:00');
  assert.equal(waitMinutes(at(6, 17, 0)), 30, 'Friday 17:00');
  assert.equal(waitMinutes(at(2, 9, 45)), 30, 'Monday 09:45');
  assert.equal(restartRefused(at(2, 6, 59, 0)), QUIET_REASON, 'the last minute before 07:00 cannot be waited out');
});

test('a squash merge subject gives the title and the pull request, and any other subject stays whole', () => {
  const repo = 'https://github.com/acme/widgets';
  assert.deepEqual(parseSubject('Leave a chat alone (#34)', repo), { title: 'Leave a chat alone', url: 'https://github.com/acme/widgets/pull/34' });
  assert.deepEqual(parseSubject('Fix (the) thing (#7)', repo), { title: 'Fix (the) thing', url: 'https://github.com/acme/widgets/pull/7' });
  assert.deepEqual(parseSubject('Leave a chat alone (#34)', null), { title: 'Leave a chat alone', url: null });
  assert.deepEqual(parseSubject('Merge branch main', repo), { title: 'Merge branch main', url: null });
  assert.deepEqual(parseSubject('Mention (#12) in the middle', repo), { title: 'Mention (#12) in the middle', url: null });
});

test('a GitHub remote in the ssh or https form gives the repository address, and any other host gives none', () => {
  for (const remote of ['git@github.com:acme/widgets.git', 'git@github.com:acme/widgets', 'https://github.com/acme/widgets.git', 'https://github.com/acme/widgets', 'https://user@github.com/acme/widgets.git', 'ssh://git@github.com/acme/widgets.git', 'https://github.com/acme/widgets/\n']) {
    assert.equal(repoUrl(remote), 'https://github.com/acme/widgets', remote);
  }
  assert.equal(repoUrl('https://github.com/acme/my.repo.git'), 'https://github.com/acme/my.repo');
  for (const remote of ['git@gitlab.com:acme/widgets.git', 'https://example.com/acme/widgets', '/tmp/origin.git', '']) assert.equal(repoUrl(remote), null, remote);
});

test('the server, its libraries, package.json, config.json and the files it imports need a restart, and other files do not', async () => {
  const r = repos();
  const set = await importedAt((commit, file) => Promise.resolve(git(r.live, 'show', `${commit}:${file}`)), 'HEAD');
  assert.deepEqual([...set].sort(), ['lib/a.mjs', 'lib/lazy.mjs', 'public/ui/deeper.js', 'public/ui/imported.js', 'public/ui/nested.js', 'server.mjs']);
  for (const file of ['server.mjs', 'lib/new.mjs', 'lib/group-guide.md', 'package.json', 'config.json', 'public/ui/imported.js', 'public/ui/nested.js']) assert.equal(needsRestart(file, set), true, file);
  for (const file of ['public/app.js', 'public/ui/page-only.js', 'public/app.css', 'docs/a.md', 'README.md', 'test/x.test.mjs', 'bin/restart.mjs']) assert.equal(needsRestart(file, set), false, file);
});

test('a change to page files only is pulled with no restart, and the banner goes', async () => {
  const r = rig();
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n', 'docs/a.md': 'b\n' });
  assert.deepEqual(r.update.state(), { show: false }, 'nothing is known before the first check');
  await r.update.check();
  const state = r.update.state();
  assert.deepEqual([state.show, state.kind, state.stage, state.count, state.restart, state.blocked], [true, 'update', 'idle', 1, false, '']);
  assert.deepEqual(state.changes, [{ title: 'Move the button', url: null }]);
  assert.deepEqual(await r.update.update(), {});
  assert.equal(head(r), originHead(r));
  assert.deepEqual(r.restarts, []);
  assert.deepEqual(r.update.state(), { show: false });
});

test('a change to a file the server imports counts as a server change, even in public/', async () => {
  for (const [file, restart] of [['public/ui/imported.js', true], ['public/ui/nested.js', true], ['lib/a.mjs', true], ['package.json', true], ['server.mjs', true], ['public/ui/page-only.js', false]]) {
    const r = rig();
    r.merge('Change a file (#2)', { [file]: '// changed\n' });
    await r.update.check();
    assert.equal(r.update.state().restart, restart, file);
  }
});

test('a file the running server imported and a later commit deletes still counts', async () => {
  const r = rig();
  fs.rmSync(path.join(r.author, 'public/ui/deeper.js'));
  r.merge('Drop a file (#2)', {});
  await r.update.check();
  assert.equal(r.update.state().restart, true);
});

test('a server change is merged, then the restart helper is asked once, to wait at most 30 minutes', async () => {
  const r = rig();
  r.busy = 2;
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  r.merge('Move the button (#3)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  assert.deepEqual([r.update.state().kind, r.update.state().count, r.update.state().restart, r.update.state().busy], ['update', 2, true, 2], 'the count is there while idle, for the force question');
  assert.deepEqual(r.update.state().changes.map(c => c.title), ['Move the button', 'Change the server'], 'newest first');
  assert.deepEqual(await r.update.update(), {});
  assert.equal(head(r), originHead(r));
  assert.deepEqual(r.restarts, [[r.live, 30]]);
  const state = r.update.state();
  assert.deepEqual([state.kind, state.stage, state.busy, state.problem], ['pulled', 'restarting', 2, '']);
  assert.deepEqual(await r.update.update(), { problem: 'A restart is already under way.' });
  assert.equal(r.restarts.length, 1);
});

test('a restart is asked for with the minutes left before the next weekday 07:00', async () => {
  const r = rig({ at: new Date(2026, 10, 6, 6, 50) });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  await r.update.update();
  assert.deepEqual(r.restarts, [[r.live, 9]], "one minute is kept back from the 10 left");
});

test('a restart waits out the quiet window, but a page-only update does not', async () => {
  const r = rig({ at: MONDAY_EARLY });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  const before = head(r);
  assert.equal(r.update.state().blocked, 'Restarts wait until 09:45 on weekdays.');
  assert.deepEqual(await r.update.update(), { problem: QUIET_REASON });
  assert.deepEqual([head(r), r.restarts.length], [before, 0], 'nothing was merged or restarted');
  r.at = new Date(2026, 10, 2, 9, 45);
  assert.equal(r.update.state().blocked, '');
  assert.deepEqual(await r.update.update(), {});
  assert.equal(r.restarts.length, 1);

  const quiet = rig({ at: MONDAY_EARLY });
  quiet.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  await quiet.update.check();
  assert.equal(quiet.update.state().blocked, '');
  assert.deepEqual(await quiet.update.update(), {});
  assert.equal(head(quiet), originHead(quiet));
});

test('an update is refused, and nothing changes, when the checkout has uncommitted changes to a tracked file', async () => {
  const r = rig();
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  put(r.live, 'untracked.txt', 'not tracked\n');
  const before = head(r);
  put(r.live, 'docs/a.md', 'edited\n');
  assert.deepEqual(await r.update.update(), { problem: 'This checkout has uncommitted changes.' });
  assert.deepEqual([head(r), fs.readFileSync(path.join(r.live, 'docs/a.md'), 'utf8')], [before, 'edited\n']);
  git(r.live, 'checkout', '--', 'docs/a.md');
  assert.deepEqual(await r.update.update(), {}, 'an untracked file does not block it');
});

test('an update is refused when the checkout is not on main', async () => {
  const r = rig();
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  git(r.live, 'checkout', '-q', '-b', 'topic');
  const before = head(r);
  assert.deepEqual(await r.update.update(), { problem: 'This checkout is not on main.' });
  assert.equal(head(r), before);
  git(r.live, 'checkout', '-q', 'main');
  git(r.live, 'checkout', '-q', '--detach');
  assert.deepEqual(await r.update.update(), { problem: 'This checkout is not on main.' }, 'a detached head is not main');
});

test('an update is refused when the checkout has a commit that is not on main', async () => {
  const r = rig();
  put(r.live, 'public/mine.js', 'mine\n');
  git(r.live, 'add', '-A');
  git(r.live, 'commit', '-q', '-m', 'Local work');
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  const before = head(r);
  assert.deepEqual(await r.update.update(), { problem: 'This checkout has diverged from main.' });
  assert.deepEqual([head(r), r.restarts.length], [before, 0]);
});

test('an update is refused while a restart is under way, and when there is nothing to update', async () => {
  const r = rig();
  assert.deepEqual(await r.update.update(), { problem: 'There is nothing to update.' });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  r.locked = true;
  const before = head(r);
  assert.deepEqual(await r.update.update(), { problem: 'A restart is already under way.' });
  assert.equal(head(r), before);
  assert.equal(r.update.state().stage, 'restarting');
});

test('a checkout pulled by hand shows Pulled, waiting for a restart when the server must restart, and Restart runs only the helper', async () => {
  const r = rig();
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  git(r.live, 'pull', '-q', '--ff-only');
  const pulled = head(r);
  await r.update.check();
  const state = r.update.state();
  assert.deepEqual([state.kind, state.count, state.restart, state.stage], ['pulled', 1, true, 'idle']);
  assert.deepEqual(await r.update.update(), {});
  assert.deepEqual([head(r), r.restarts], [pulled, [[r.live, 30]]]);
});

test('a checkout pulled by hand with page-only changes shows nothing, because they are already live', async () => {
  const r = rig();
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  git(r.live, 'pull', '-q', '--ff-only');
  await r.update.check();
  assert.deepEqual(r.update.state(), { show: false });
});

test('a pulled checkout that is behind main again lists the changes since the server started', async () => {
  const r = rig();
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  git(r.live, 'pull', '-q', '--ff-only');
  r.merge('Move the button (#3)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  assert.deepEqual([r.update.state().kind, r.update.state().count, r.update.state().restart], ['update', 2, true]);
});

test('when the helper gives up, the banner offers Restart again and shows the last line of the helper\'s log', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'log-'));
  const log = path.join(dir, 'restart.log');
  fs.writeFileSync(log, '2026-10-01T00:00:00.000Z Gave up after 30 minutes. An old attempt.\n');
  const r = rig({ log, graceMs: 0 });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  assert.equal(r.update.state().problem, '', 'a log from before is not shown');
  await r.update.update();
  assert.equal(r.update.state().stage, 'idle', 'no lock was written');
  assert.equal(r.update.state().problem, '', 'the helper has not written yet');
  await new Promise(resolve => setTimeout(resolve, 20));
  fs.appendFileSync(log, '2026-11-02T01:00:00.000Z Gave up after 30 minutes without restarting. Still running: pid 12, pid 13.\n');
  const state = r.update.state();
  assert.deepEqual([state.kind, state.stage, state.problem], ['pulled', 'idle', 'Gave up after 30 minutes without restarting. Still running: pid 12, pid 13.']);
  assert.deepEqual(await r.update.update(), {});
  assert.equal(r.restarts.length, 2);
});

test('a failed fetch keeps the last result', async () => {
  let down = false;
  const r = rig({
    git: root => (args, timeout) => {
      if (down && args[0] === 'fetch') return Promise.reject(new Error('offline'));
      return new Promise((resolve, reject) => {
        try { resolve(git(root, ...args)); } catch (e) { reject(e); }
      });
    },
  });
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  assert.equal(r.update.state().count, 1);
  down = true;
  r.merge('Move it again (#3)', { 'public/app.js': 'export const app = 3;\n' });
  await r.update.check();
  assert.equal(r.update.state().count, 1);
});

test('a folder that is not a git repository shows nothing and refuses an update', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'plain-'));
  const update = makeUpdate({ root: dir });
  await update.check();
  assert.deepEqual(update.state(), { show: false });
  assert.deepEqual(await update.update(), { problem: 'There is nothing to update.' });
});

test('the changes link to their pull requests on a GitHub remote', async () => {
  const r = rig({ git: root => (args, timeout) => (args[0] === 'remote'
    ? Promise.resolve('git@github.com:acme/widgets.git\n')
    : new Promise((resolve, reject) => { try { resolve(git(root, ...args)); } catch (e) { reject(e); } })) });
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  r.merge('A commit with no number', { 'docs/a.md': 'c\n' });
  await r.update.check();
  assert.deepEqual(r.update.state().changes, [{ title: 'A commit with no number', url: null }, { title: 'Move the button', url: 'https://github.com/acme/widgets/pull/2' }]);
});

test('a merge that crosses 07:00 on a weekday is kept, and the restart is refused rather than started inside the window', async () => {
  const times = [new Date(2026, 10, 2, 6, 0), new Date(2026, 10, 2, 7, 1)];
  const r = rig();
  Object.defineProperty(r, 'at', { get: () => times.shift() ?? new Date(2026, 10, 2, 7, 1) });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  assert.deepEqual(await r.update.update(), { problem: QUIET_REASON });
  assert.equal(head(r), originHead(r));
  assert.deepEqual(r.restarts, []);
  assert.deepEqual([r.update.state().kind, r.update.state().stage], ['pulled', 'idle']);
});

test('a restart helper that cannot start is reported, and the banner does not say a restart is under way', async () => {
  const r = rig();
  r.update = makeUpdate({ root: r.live, restart: () => Promise.resolve('Could not start the restart helper.'), now: () => SATURDAY, graceMs: 60_000 });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  assert.deepEqual(await r.update.update(), { problem: 'Could not start the restart helper.' });
  assert.deepEqual([r.update.state().kind, r.update.state().stage], ['pulled', 'idle']);
});

test('a failed read of server.mjs is tried again on the next check instead of letting a server change through as page only', async () => {
  let fail = true;
  const r = rig({
    git: root => args => {
      if (fail && args[0] === 'show' && args[1].endsWith(':server.mjs')) { fail = false; return Promise.reject(new Error('timed out')); }
      return new Promise((resolve, reject) => { try { resolve(git(root, ...args)); } catch (e) { reject(e); } });
    },
  });
  r.merge('Change an imported page file (#2)', { 'public/ui/imported.js': "import './nested.js';\nexport const x = 2;\n" });
  await r.update.check();
  assert.deepEqual(r.update.state(), { show: false });
  await r.update.check();
  assert.equal(r.update.state().restart, true);
});

test('a force while idle restarts at once, with no wait, and then reports it is going', async () => {
  const r = rig();
  r.busy = 2;
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  assert.deepEqual([r.update.state().force, r.update.state().busy], [true, 2]);
  assert.deepEqual(await r.update.update({ force: true }), {});
  assert.equal(head(r), originHead(r));
  assert.deepEqual(r.restarts, [[r.live, null]]);
  const state = r.update.state();
  assert.deepEqual([state.stage, state.force, state.busy], ['restarting', false, 0]);
  assert.deepEqual(await r.update.update({ force: true }), { problem: 'A restart is already under way.' });
  assert.equal(r.restarts.length, 1);
});

test('a force goes through while a helper waits, and a second force is refused', async () => {
  const r = rig();
  r.busy = 3;
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  await r.update.update();
  r.locked = true;
  assert.deepEqual(r.restarts, [[r.live, 30]]);
  const waiting = r.update.state();
  assert.deepEqual([waiting.stage, waiting.force, waiting.busy], ['restarting', true, 3]);
  assert.deepEqual(await r.update.update(), { problem: 'A restart is already under way.' }, 'a normal press is still refused');
  assert.deepEqual(await r.update.update({ force: true }), {});
  assert.deepEqual(r.restarts, [[r.live, 30], [r.live, null]]);
  const going = r.update.state();
  assert.deepEqual([going.stage, going.force, going.busy], ['restarting', false, 0]);
  assert.deepEqual(await r.update.update({ force: true }), { problem: 'A restart is already under way.' });
  assert.equal(r.restarts.length, 2);
});

test('a force goes ahead inside the quiet window, where a normal update is refused', async () => {
  const r = rig({ at: MONDAY_EARLY });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  assert.deepEqual([r.update.state().blocked, r.update.state().force], [QUIET_REASON, true]);
  assert.deepEqual(await r.update.update(), { problem: QUIET_REASON });
  assert.equal(r.restarts.length, 0);
  assert.deepEqual(await r.update.update({ force: true }), {});
  assert.deepEqual(r.restarts, [[r.live, null]]);
});

test('a force merges the unmerged changes first, also when a fetch since found more', async () => {
  const r = rig();
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  const checked = originHead(r);
  r.merge('Move the button (#3)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  r.locked = true;
  await r.update.update({ force: true });
  assert.notEqual(head(r), checked, 'it merged the commit the latest check looked at');
  assert.equal(head(r), originHead(r));
  assert.deepEqual(r.restarts, [[r.live, null]]);
});

test('a force whose merge fails restarts nothing', async () => {
  const r = rig();
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  put(r.live, 'docs/a.md', 'edited\n');
  const before = head(r);
  assert.deepEqual(await r.update.update({ force: true }), { problem: 'This checkout has uncommitted changes.' });
  assert.deepEqual([head(r), r.restarts], [before, []]);
  assert.equal(r.update.state().stage, 'idle');
});

test('a force on a young server is refused with the guard\'s reason, before anything is merged', async () => {
  const r = rig({ uptime: 20.6 });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  const before = head(r);
  const { problem } = await r.update.update({ force: true });
  assert.match(problem, /Wait 40 more seconds before restarting it/);
  assert.deepEqual([head(r), r.restarts], [before, []]);
  r.uptime = 60;
  assert.deepEqual(await r.update.update({ force: true }), {});
});

test('a page-only change refuses a force and offers none', async () => {
  const r = rig();
  r.merge('Move the button (#2)', { 'public/app.js': 'export const app = 2;\n' });
  await r.update.check();
  assert.equal(r.update.state().force, false);
  const before = head(r);
  assert.deepEqual(await r.update.update({ force: true }), { problem: 'Nothing waiting needs a restart.' });
  assert.deepEqual([head(r), r.restarts], [before, []]);
});

test('no force is offered while an update is under way, and none is possible with nothing waiting', async () => {
  const r = rig();
  assert.deepEqual(await r.update.update({ force: true }), { problem: 'There is nothing to update.' });
  r.merge('Change the server (#2)', { 'lib/a.mjs': 'export const a = 2;\n' });
  await r.update.check();
  const pending = r.update.update();
  assert.equal(r.update.state().stage, 'updating');
  assert.equal(r.update.state().force, false);
  await pending;
});
