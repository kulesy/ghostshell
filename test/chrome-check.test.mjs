// Run with `npm test`. Whether Chrome's Claude extension is on the account just switched to: the probe against a tiny fake of `claude --claude-in-chrome-mcp`, and the
// banner state around it with a fake probe, fake open and a clock and timers the test moves. Nothing here starts Chrome or the real claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserSeen, makeChromeCheck, OPEN_FAILED, RECHECK_MS, WATCH_MS } from '../lib/chrome-check.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-chrome-test-'));
// Answers as the real server does, by LIST (the text of the answer) and MODE: `exit` leaves after the first answer and `hang` never answers the call.
// It logs its arguments and the methods it was sent to LOG, and its pid to PID.
const FAKE = path.join(dir, 'claude');
fs.writeFileSync(FAKE, `#!${process.execPath}
const fs = require('node:fs');
const say = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
fs.writeFileSync(process.env.PID, String(process.pid));
fs.appendFileSync(process.env.LOG, JSON.stringify({ args: process.argv.slice(2) }) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync(process.env.LOG, JSON.stringify({ method: m.method }) + '\\n');
  if (m.method === 'initialize') {
    say({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {} } });
    if (process.env.MODE === 'exit') process.exit(0);
  }
  if (m.method === 'tools/call' && process.env.MODE !== 'hang') say({ id: m.id, result: { content: [{ type: 'text', text: process.env.LIST }] } });
});
`, { mode: 0o755 });

let n = 0;
async function probe(list, { mode = '', limitMs } = {}) {
  const log = path.join(dir, `log-${++n}`);
  const pid = path.join(dir, `pid-${n}`);
  const got = await browserSeen({ claude: FAKE, env: { LIST: list, MODE: mode, LOG: log, PID: pid }, ...(limitMs && { limitMs }) });
  return { got, log: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)), pid: Number(fs.readFileSync(pid, 'utf8')) };
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async pid => { for (let i = 0; i < 100 && alive(pid); i++) await new Promise(r => setTimeout(r, 20)); return !alive(pid); };
const browser = over => ({ deviceId: 'd1', name: 'Fake', osPlatform: 'darwin', connectedAt: 1, isLocal: true, inUse: false, ...over });

test('a listed browser on this computer is seen, and the child is sent the three messages and then killed', async () => {
  const { got, log, pid } = await probe(JSON.stringify([browser()]));
  assert.equal(got, true);
  assert.deepEqual(log, [{ args: ['--claude-in-chrome-mcp'] }, { method: 'initialize' }, { method: 'notifications/initialized' }, { method: 'tools/call' }]);
  assert.equal(await gone(pid), true);
});

test('an empty list, or browsers on other computers only, are not seen', async () => {
  assert.equal((await probe('[]')).got, false);
  assert.equal((await probe(JSON.stringify([browser({ isLocal: false }), browser({ onThisComputer: false })]))).got, false);
});

test('onThisComputer wins over isLocal when it is there', async () => {
  assert.equal((await probe(JSON.stringify([browser({ isLocal: true, onThisComputer: false })]))).got, false);
  assert.equal((await probe(JSON.stringify([browser({ isLocal: false, onThisComputer: true })]))).got, true);
});

test('plain text, bad JSON and an answer that is not a list say nothing, and so does a child that exits', async () => {
  for (const text of ['Browser extension is not connected. Please try again.', '[{"deviceId":', '{"browsers":[]}', 'null']) {
    assert.equal((await probe(text)).got, null, text);
  }
  assert.equal((await probe('[]', { mode: 'exit' })).got, null);
  assert.equal(await browserSeen({ claude: path.join(dir, 'missing'), env: {} }), null, 'a program that cannot start');
});

test('a child that never answers is given up on at the limit and killed', async () => {
  const started = Date.now();
  const { got, pid } = await probe('[]', { mode: 'hang', limitMs: 300 });
  assert.equal(got, null);
  assert.ok(Date.now() - started < 3000);
  assert.equal(await gone(pid), true);
});

const START = Date.parse('2026-11-04T00:00:00Z');
const MIN = 60_000;

// Accounts main and second. `seen` says what the probe answers for each id, and a `gate` holds the probes until the test lets them go.
function rig({ uses = true, enabled } = {}) {
  const r = { at: START, uses, seen: {}, probes: [], opens: 0, openFails: false, timers: [], gate: null, active: 'main' };
  const list = [{ id: 'main', name: 'Main', dir: '/secret/main' }, { id: 'second', name: 'Second', dir: '/secret/second' }];
  const accounts = { usesChrome: () => r.uses, list: () => list.map(a => ({ ...a })), find: id => list.find(a => a.id === id) ?? null };
  r.list = list;
  r.check = makeChromeCheck({
    accounts,
    enabled,
    probe: async a => {
      r.probes.push(a.id);
      if (r.gate) await r.gate;
      if (r.seen[a.id] instanceof Error) throw r.seen[a.id];
      return r.seen[a.id] ?? null;
    },
    emailOf: id => (id === 'second' ? 'second@example.com' : ''),
    openSettings: async () => { r.opens++; await r.openGate; if (r.openFails) throw new Error('secret reason'); },
    now: () => r.at,
    wait: (run, ms) => {
      const t = { run, ms, live: true };
      r.timers.push(t);
      return () => { t.live = false; };
    },
  });
  r.to = id => r.check.switched(accounts.find(id));
  r.live = () => r.timers.filter(t => t.live);
  r.fire = async () => {
    const t = r.live().at(-1);
    t.live = false;
    await t.run();
  };
  return r;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const BRIEF = { second: { id: 'second', name: 'Second' }, main: { id: 'main', name: 'Main' } };

test('a browser seen on the new account clears everything', async () => {
  const r = rig();
  r.seen.second = true;
  r.to('second');
  assert.deepEqual(r.check.state(), { checking: true });
  await settle();
  assert.equal(r.check.state(), null);
  assert.equal(r.live().length, 0);
  assert.deepEqual(r.probes.sort(), ['main', 'second'], 'every account is asked, in parallel');
});

test('a browser on another account names that account, with the email of the new one', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = false;
  r.to('second');
  await settle();
  assert.deepEqual(r.check.state(), { state: 'elsewhere', to: BRIEF.second, on: BRIEF.main, email: 'second@example.com', opened: false });
  assert.doesNotMatch(JSON.stringify(r.check.state()), /secret/, 'no folder in the state');
});

test('no browser anywhere, or a probe that fails, is unsure and names no other account', async () => {
  const r = rig();
  r.seen.main = false;
  r.seen.second = new Error('boom');
  r.to('second');
  await settle();
  assert.deepEqual(r.check.state(), { state: 'unknown', to: BRIEF.second, email: 'second@example.com', opened: false });
});

test('with no Chrome set up a switch probes nothing and clears a banner that stood', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  assert.equal(r.check.state().state, 'elsewhere');
  r.uses = false;
  r.probes.length = 0;
  r.to('main');
  assert.equal(r.check.state(), null);
  assert.deepEqual([r.probes.length, r.live().length], [0, 0]);
});

test('with the chrome setting off a switch probes nothing and shows no banner, because chats start without Chrome', async () => {
  const r = rig({ enabled: false });
  r.seen.main = true;
  r.to('second');
  await settle();
  assert.equal(r.check.state(), null);
  assert.deepEqual([r.probes.length, r.live().length], [0, 0]);
});

test('a rename while the banner stands shows the new names', async () => {
  const r = rig();
  r.seen.main = true;
  r.check.switched({ ...r.list[1] });
  await settle();
  r.list[0].name = 'Home';
  r.list[1].name = 'Work';
  const { to, on } = r.check.state();
  assert.deepEqual([to.name, on.name], ['Work', 'Home']);
});

test('an answer from before a later switch is dropped', async () => {
  const r = rig();
  let release;
  r.gate = new Promise(resolve => { release = resolve; });
  r.seen.main = true;
  r.to('second');
  r.gate = null;
  r.to('main');
  await settle();
  assert.equal(r.check.state(), null, 'main sees a browser, so the second switch clears');
  release();
  await settle();
  assert.equal(r.check.state(), null, 'the first switch would have said elsewhere');
  assert.equal(r.live().length, 0);
});

test('while a banner stands only the new account is asked, one probe at a time, and a browser seen clears it', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  assert.deepEqual(r.live().map(t => t.ms), [RECHECK_MS]);
  r.probes.length = 0;
  await r.fire();
  assert.deepEqual(r.probes, ['second']);
  assert.equal(r.check.state().state, 'elsewhere');
  assert.equal(r.live().length, 1, 'the next timer starts once the probe has ended');
  r.seen.second = true;
  await r.fire();
  assert.equal(r.check.state(), null);
  assert.equal(r.live().length, 0);
});

test('a new switch cancels the timer of the one before', async () => {
  const r = rig();
  r.to('second');
  await settle();
  assert.equal(r.live().length, 1);
  r.to('main');
  assert.equal(r.live().length, 0);
});

test('after ten minutes the banner stays, opened goes false and the probing stops', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  await r.check.open();
  assert.equal(r.check.state().opened, true);
  r.at += WATCH_MS - 1;
  assert.equal(r.check.state().opened, true);
  r.at += 1;
  assert.equal(r.check.state().opened, false);
  r.probes.length = 0;
  await r.fire();
  assert.deepEqual([r.probes.length, r.live().length], [0, 0]);
  assert.equal(r.check.state().state, 'elsewhere');
});

test('Open opens the settings, marks the banner opened, and starts watching again once the window had ended', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  r.at += WATCH_MS;
  await r.fire();
  assert.equal(r.live().length, 0);
  await r.check.open();
  assert.equal(r.opens, 1);
  assert.equal(r.check.state().opened, true);
  assert.equal(r.live().length, 1);
  r.at += WATCH_MS - MIN;
  r.probes.length = 0;
  r.seen.second = true;
  await r.fire();
  assert.equal(r.probes[0], 'second', 'the tick asks the new account first, and the survey it starts asks the rest');
  assert.equal(r.check.state(), null);
});

test('Open in the middle of the window moves its end and keeps one timer', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  r.at += 8 * MIN;
  await r.check.open();
  assert.equal(r.live().length, 1);
  r.at += 8 * MIN;
  r.probes.length = 0;
  await r.fire();
  assert.deepEqual(r.probes, ['second']);
  assert.equal(r.check.state().opened, true);
});

test('a failed open answers with plain words and does not mark the banner opened', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  r.openFails = true;
  assert.equal(await r.check.open(), OPEN_FAILED);
  assert.equal(r.check.state().opened, false);
});

test('an Open press still running when another switch lands does not mark the new banner opened', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  let release;
  r.openGate = new Promise(resolve => { release = resolve; });
  const press = r.check.open();
  r.seen = { second: true };
  r.to('main');
  await settle();
  release();
  await press;
  assert.equal(r.check.state().opened, false);
});

test('Dismiss clears the banner and the timer, and a probe still running does not bring it back', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  let release;
  r.gate = new Promise(resolve => { release = resolve; });
  const tick = r.fire();
  r.check.dismiss();
  assert.equal(r.check.state(), null);
  release();
  await tick;
  await settle();
  assert.deepEqual([r.check.state(), r.live().length], [null, 0]);
});

test('reading the state never probes or starts a timer', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  const before = [r.probes.length, r.timers.length];
  for (let i = 0; i < 5; i++) r.check.state();
  assert.deepEqual([r.probes.length, r.timers.length], before);
});

test('a survey asks every account once, and claims Chrome is elsewhere for an account that answered false when another answered true', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = false;
  await r.check.survey();
  assert.deepEqual(r.probes.sort(), ['main', 'second']);
  assert.equal(r.check.elsewhere('second'), 'main');
  assert.equal(r.check.elsewhere('main'), null, 'the account with the browser has nothing to claim');
  assert.equal(r.check.state(), null, 'a survey shows no banner');
});

test('a null answer makes no claim about that account, and nobody seeing a browser claims nothing about anyone', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = null;
  await r.check.survey();
  assert.equal(r.check.elsewhere('second'), null, 'no answer is not a no');
  r.seen.main = false;
  r.seen.second = false;
  await r.check.survey();
  assert.deepEqual([r.check.elsewhere('main'), r.check.elsewhere('second')], [null, null], 'Chrome may only be closed');
  r.seen.main = null;
  r.seen.second = null;
  await r.check.survey();
  assert.deepEqual([r.check.elsewhere('main'), r.check.elsewhere('second')], [null, null]);
});

test('a probe that fails counts as no answer in a survey', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = new Error('boom');
  await r.check.survey();
  assert.equal(r.check.elsewhere('second'), null);
});

test('a survey with one account, the chrome setting off or Chrome not set up asks nothing and claims nothing', async () => {
  const one = rig();
  one.seen.main = true;
  one.list.pop();
  await one.check.survey();
  assert.deepEqual(one.probes, []);

  const off = rig({ enabled: false });
  await off.check.survey();
  assert.deepEqual(off.probes, []);

  const none = rig({ uses: false });
  await none.check.survey();
  assert.deepEqual(none.probes, []);
  assert.equal(none.check.elsewhere('second'), null);
});

test('a later survey replaces the earlier answer, and one that no longer applies clears it', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = false;
  await r.check.survey();
  assert.equal(r.check.elsewhere('second'), 'main');
  r.seen.main = false;
  r.seen.second = true;
  await r.check.survey();
  assert.deepEqual([r.check.elsewhere('second'), r.check.elsewhere('main')], [null, 'second'], 'the extension moved');
  r.list.pop();
  await r.check.survey();
  assert.equal(r.check.elsewhere('main'), null, 'with one account left the old answer is gone');
});

test('a claim about an account that has been removed since is dropped', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = false;
  await r.check.survey();
  r.list.splice(0, 1);
  assert.equal(r.check.elsewhere('second'), null, 'the account with the browser is no longer listed');
});

test('a survey called while one runs starts no probes, and runs again once it has ended', async () => {
  const r = rig();
  let release;
  r.gate = new Promise(resolve => { release = resolve; });
  const first = r.check.survey();
  await settle();
  await r.check.survey();
  assert.equal(r.probes.length, 2, 'the second call asked nobody');
  release();
  await first;
  await r.check.survey();
  assert.equal(r.probes.length, 4);
});

test('a banner tick that sees a browser clears the banner and starts a survey, because the extension has moved', async () => {
  const r = rig();
  r.seen.main = true;
  r.seen.second = false;
  r.to('second');
  await settle();
  r.probes.length = 0;
  r.seen.main = false;
  r.seen.second = true;
  await r.fire();
  await settle();
  assert.equal(r.check.state(), null);
  assert.deepEqual(r.probes.sort(), ['main', 'second', 'second'], 'the tick asked second, then the survey asked both');
  assert.equal(r.check.elsewhere('main'), 'second');
});

test('a banner tick that sees nothing starts no survey', async () => {
  const r = rig();
  r.seen.main = true;
  r.to('second');
  await settle();
  r.probes.length = 0;
  await r.fire();
  assert.deepEqual(r.probes, ['second']);
});
