#!/usr/bin/env node
// Drives the Debug app through System Events (XCUITest is not available here) and saves every state in light and dark.
// The app draws its own window into a PNG because screen capture permission is off. See apple/README.md.
//
//   node apple/scripts/shots.mjs [--out <folder>] [--only light|dark] [--no-chat]
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { startScratch, TEST_CWD } from './test-server.mjs';

const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(option('--out') || path.join(here, '..', 'screenshots'));
const APPEARANCES = option('--only') ? [option('--only')] : ['light', 'dark'];
const DEFAULT_SIZE = [960, 640];
const MIN_SIZE = [640, 420];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const osa = script => spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 30_000 });

// System Events keystrokes are global, so two runs at once would type into each other's app. One run per machine holds this folder.
const LOCK = '/tmp/ghostshell-shots.lock';
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const lockOwner = () => Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8').trim());
function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid));
      process.on('exit', () => {
        try { if (lockOwner() === process.pid) { fs.unlinkSync(path.join(LOCK, 'pid')); fs.rmdirSync(LOCK); } } catch { /* already gone */ }
      });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let owner = NaN;
    try { owner = lockOwner(); } catch { /* the owner has made the folder and not yet written its pid */ }
    const young = Date.now() - fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs < 5000;
    if (Number.isFinite(owner) ? alive(owner) : young) {
      console.error(`Another shots run holds ${LOCK}${Number.isFinite(owner) ? ` (pid ${owner})` : ''}. Wait for it to finish, then run this again.`);
      process.exit(1);
    }
    // Stale: its owner is dead. Renaming is atomic, so only one run clears it.
    try { fs.renameSync(LOCK, `${LOCK}.stale-${process.pid}`); fs.unlinkSync(path.join(`${LOCK}.stale-${process.pid}`, 'pid')); fs.rmdirSync(`${LOCK}.stale-${process.pid}`); } catch { /* another run got there first */ }
  }
  console.error(`Could not take ${LOCK}.`);
  process.exit(1);
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
  return ok;
};
async function until(what, test, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(300);
  }
  return false;
}

// Everything started here is stopped in `finally`, and on a signal.
const apps = new Set();
const servers = new Set();
const suites = new Set();
const services = new Set();
const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const readPassword = server => fs.readFileSync(server.passwordFile, 'utf8').trim();

class App {
  constructor(binary, { address, appearance, tag }) {
    this.appearance = appearance;
    this.tag = tag;
    this.count = 0;
    this.service = `gs-test-${crypto.randomBytes(6).toString('hex')}`;
    this.suite = `com.kulesy.ghostshell.test.${this.service}`;
    this.binary = binary;
    this.address = address;
    this.pid = undefined;
    this.shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-shot-'));
    services.add(this.service);
    suites.add(this.suite);
  }

  async launch() {
    fs.mkdirSync(this.shotDir, { recursive: true });
    this.child = spawn(this.binary, ['-GSKeychainService', this.service, '-GSAddress', this.address, '-GSDefaultsSuite', this.suite,
      '-GSAppearance', this.appearance, '-GSShotDir', this.shotDir], { stdio: 'ignore' });
    this.pid = this.child.pid;
    apps.add(this.child);
    this.exited = new Promise(resolve => this.child.once('exit', () => { apps.delete(this.child); resolve(); }));
    const shown = await until('window', () => this.events('return count of (windows whose subrole is "AXStandardWindow")').stdout.trim() === '1', 20);
    if (!shown) throw new Error('The app window did not appear.');
    this.front();
    await sleep(600);
  }

  // Another process is also named GhostShell (the installed app, and a Chrome app), so the launched app is found by its pid, never its name.
  // The window title follows the chosen session, and the system's saved-password popup is a second window, so the main window is found by its kind.
  events(body) { return osa(`tell application "System Events" to tell (first process whose unix id is ${this.pid})\n${body}\nend tell`); }
  front() { osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${this.pid}) to true`); }
  // Keystrokes go to whichever app is in front, so every one is sent only after this pid is confirmed to be.
  send(command) {
    const frontPid = () => osa('tell application "System Events" to return unix id of first process whose frontmost is true').stdout.trim();
    if (frontPid() !== String(this.pid)) { this.front(); spawnSync('sleep', ['0.4']); }
    if (frontPid() !== String(this.pid)) throw new Error(`The app (pid ${this.pid}) is not the front process, so nothing was typed.`);
    osa(`tell application "System Events"\n${command}\nend tell`);
  }
  type(text) { this.send(`keystroke ${JSON.stringify(text)}`); }
  enter() { this.send('key code 36'); }
  // The system offers saved passwords in a small window over the field. Escape closes it, so Return reaches the form.
  submit() { this.send('key code 53'); this.send('key code 36'); }
  resize([w, h]) { this.events(`set size of (first window whose subrole is "AXStandardWindow") to {${w}, ${h}}`); }

  // The text of every static text in the window, one per line.
  texts() {
    return this.events(`set els to entire contents of (first window whose subrole is "AXStandardWindow")
set out to ""
repeat with e in els
  try
    if role of e is "AXStaticText" then set out to out & (value of e as text) & linefeed
  end try
end repeat
return out`).stdout;
  }
  hasButton(name) {
    return this.events(`set els to entire contents of (first window whose subrole is "AXStandardWindow")
repeat with e in els
  try
    if role of e is "AXButton" and description of e is ${JSON.stringify(name)} then return "yes"
  end try
end repeat
return "no"`).stdout.trim() === 'yes';
  }
  rows() {
    return Number(this.events(`set els to entire contents of (first window whose subrole is "AXStandardWindow")
set n to 0
repeat with e in els
  try
    if role of e is "AXRow" then set n to n + 1
  end try
end repeat
return n`).stdout.trim());
  }
  chooseFirstRow() {
    this.events(`set els to entire contents of (first window whose subrole is "AXStandardWindow")
repeat with e in els
  try
    if role of e is "AXRow" then
      set selected of e to true
      return
    end if
  end try
end repeat`);
  }
  signOutFromMenu() { this.events('click menu item "Sign Out" of menu 1 of menu bar item "File" of menu bar 1'); }

  async shot(name) {
    this.count += 1;
    const n = this.count;
    fs.writeFileSync(path.join(this.shotDir, 'request.txt'), `${n} ${name}`);
    const saved = await until(name, () => {
      try { return fs.readFileSync(path.join(this.shotDir, 'done.txt'), 'utf8').trim() === `${n} ok`; } catch { return false; }
    }, 10);
    if (!saved) return check(false, `screenshot ${name}`);
    fs.renameSync(path.join(this.shotDir, `${name}.png`), path.join(OUT, `${name}.png`));
    return true;
  }
  // The same state at the default size and at the smallest size the window allows.
  async both(state) {
    const base = `${this.tag}-${state}-${this.appearance}`;
    this.resize(DEFAULT_SIZE);
    await sleep(700);
    await this.shot(`${base}-default`);
    this.resize(MIN_SIZE);
    await sleep(700);
    await this.shot(`${base}-min`);
    this.resize(DEFAULT_SIZE);
    await sleep(400);
  }

  async quit() {
    if (!this.child || this.child.exitCode !== null) return;
    try { this.send('keystroke "q" using command down'); } catch { /* the hard kill below covers it */ }
    const hard = setTimeout(() => this.child.kill('SIGKILL'), 6000);
    await this.exited;
    clearTimeout(hard);
  }
}

// Sends the same requests the app would, so a chat can be started without touching the window.
async function ownerCall(server, route, body, token) {
  const origin = server.address;
  return fetch(`${origin}/${route}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Origin: origin, 'Content-Type': body === undefined || typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json', ...(token ? { Cookie: `capcom=${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function signInDirect(server) {
  const response = await ownerCall(server, 'login', `password=${encodeURIComponent(readPassword(server))}`);
  return /capcom=([0-9a-f]+)/.exec(response.headers.get('set-cookie') || '')?.[1];
}

async function mainFlow(binary, appearance, withChat) {
  const server = await startScratch({ claude: withChat });
  servers.add(server);
  const app = new App(binary, { address: server.address, appearance, tag: '1' });
  console.log(`\n== ${appearance}: sign in, list, chat, relaunch, sign out`);
  try {
    await app.launch();
    await app.both('signin-idle');

    app.type('not the password');
    app.submit();
    check(await until('wrong', () => app.texts().includes('That password did not match.')), 'a wrong password shows its message');
    await app.both('wrong-password');

    app.type(readPassword(server));
    app.submit();
    check(await until('rows', () => app.rows() === 8), 'signing in shows the 8 seeded sessions');
    await app.both('list-rows');

    app.chooseFirstRow();
    check(await until('title', () => app.texts().includes('Fix the flaky upload test')), 'choosing a row shows its title in the detail');
    await app.both('session-chosen');

    if (withChat) {
      const token = await signInDirect(server);
      const started = await ownerCall(server, 'api/new', { cwd: TEST_CWD, text: 'Reply with the single word ok.', model: 'haiku' }, token);
      const { id } = await started.json().catch(() => ({}));
      check(started.status === 200 && !!id, 'a Haiku chat starts through the server');
      check(await until('new row', () => app.rows() === 9, 20), 'the new chat appears in the list with no action in the window');
      await app.both('list-new-chat');
      const finished = await until('finished', async () => {
        const index = await (await fetch(`${server.address}/api/sessions`, { headers: { Cookie: `capcom=${token}` } })).json();
        const rows = [];
        (function walk(value) {
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === 'object') { if (value.id === id && 'state' in value) rows.push(value); Object.values(value).forEach(walk); }
        })(index);
        return rows.length > 0 && rows.every(row => row.state !== 'running');
      }, 90);
      check(finished, 'the chat finishes');
      await sleep(4000);
      await app.both('list-chat-finished');
      await ownerCall(server, 'logout', undefined, token);
    }

    await app.quit();
    process.kill(server.pid, 'SIGSTOP');
    await app.launch();
    await sleep(1500);
    check(!app.hasButton('Sign In') && !app.texts().includes('Address'), 'a relaunch stays signed in');
    await app.both('loading');
    process.kill(server.pid, 'SIGCONT');
    check(await until('rows', () => app.rows() === (withChat ? 9 : 8), 20), 'the list loads once the server answers');

    await server.stop();
    check(await until('foot', () => app.texts().includes("Can't reach the server. Trying again."), 20), 'the foot line shows when the server stops answering');
    await app.both('cannot-reach');

    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'Sign Out in the File menu returns to sign-in');
    await app.both('signed-out');
    const left = spawnSync('security', ['find-generic-password', '-s', app.service], { encoding: 'utf8', timeout: 15_000 });
    check(left.status === 44, 'sign out removed the Keychain item');
  } finally {
    try { process.kill(server.pid, 'SIGCONT'); } catch { /* already stopped */ }
    await app.quit();
    await server.stop();
  }
}

async function emptyAndLocked(binary, appearance) {
  const server = await startScratch({ empty: true });
  servers.add(server);
  const app = new App(binary, { address: server.address, appearance, tag: '2' });
  console.log(`\n== ${appearance}: empty list, locked`);
  try {
    await app.launch();
    app.type(readPassword(server));
    app.submit();
    check(await until('empty', () => app.texts().includes('No sessions yet')), 'a server with no sessions shows the empty state');
    await app.both('list-empty');

    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out again');
    for (let i = 0; i < 10; i++) await ownerCall(server, 'login', 'password=wrong');
    app.type(readPassword(server));
    app.submit();
    check(await until('locked', () => app.texts().includes('Too many tries. Wait 15 minutes.')), 'ten wrong tries lock sign-in and the message says so');
    await app.both('locked');
  } finally {
    await app.quit();
    await server.stop();
  }
}

async function badAddresses(binary, appearance) {
  console.log(`\n== ${appearance}: unreachable, bad address`);
  const dead = new App(binary, { address: `http://localhost:${await freePort()}`, appearance, tag: '3' });
  try {
    await dead.launch();
    dead.type('whatever');
    dead.submit();
    check(await until('unreachable', () => dead.texts().includes("Can't reach that server. Check the address and that GhostShell is running.")), 'a dead address shows the unreachable message');
    await dead.both('unreachable');
  } finally {
    await dead.quit();
  }
  // Plain http off loopback is refused before any request leaves the app.
  const bad = new App(binary, { address: 'http://example.com', appearance, tag: '4' });
  try {
    await bad.launch();
    bad.type('whatever');
    bad.submit();
    check(await until('bad', () => bad.texts().includes('That is not an address GhostShell can use. Use https, or localhost on this Mac.')), 'plain http off this Mac is refused');
    await bad.both('bad-address');
  } finally {
    await bad.quit();
  }
}

// A chat waiting on an approval or a failed turn can't be had on demand from a scratch server, so a stub answers the routes the list uses.
async function marks(binary, appearance) {
  console.log(`\n== ${appearance}: every status mark`);
  const rows = [['Waiting on an approval', 'awaiting'], ['This turn failed', 'error'], ['Finished and unread', 'ready'], ['Still working', 'running'], ['Nothing to look at'],
    ['Work out why the nightly build of the shared design system fails on the third Tuesday of every month, but only on the runner with the older toolchain']]
    .map(([title, dot], i) => ({ id: `mark-${i}`, title, dot, state: 'idle', sortAt: Date.now() - i * 60_000 }));
  // The login reply is held until the signing-in shot is taken.
  let hold = true;
  const held = [];
  const answer = res => res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
  const stub = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/login') { if (hold) held.push(res); else answer(res); }
    else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ungrouped: rows }));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const app = new App(binary, { address: `http://localhost:${stub.address().port}`, appearance, tag: '5' });
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('held', () => held.length > 0, 6), 'the stub holds the sign-in request while the window waits');
    await app.both('signing-in');
    hold = false;
    held.splice(0).forEach(answer);
    check(await until('rows', () => app.rows() === rows.length), 'the list shows a row for each mark, and a long title');
    await app.both('list-marks');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the stub');
  } finally {
    await app.quit();
    held.splice(0).forEach(answer);
    stub.closeAllConnections();
    stub.close();
  }
}

const cleanup = async () => {
  for (const child of apps) child.kill('SIGKILL');
  for (const server of servers) { try { process.kill(server.pid, 'SIGCONT'); } catch {} await server.stop(); }
  for (const suite of suites) spawnSync('defaults', ['delete', suite], { stdio: 'ignore', timeout: 10_000 });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => cleanup().finally(() => process.exit(130)));

acquireLock();
fs.mkdirSync(OUT, { recursive: true });
let exitCode = 1;
try {
  const app = build({ release: false });
  const binary = path.join(app, 'Contents', 'MacOS', 'GhostShell');
  for (const appearance of APPEARANCES) {
    await mainFlow(binary, appearance, !argv.includes('--no-chat'));
    await emptyAndLocked(binary, appearance);
    await badAddresses(binary, appearance);
    await marks(binary, appearance);
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed:\n${failures.map(f => `  ${f}`).join('\n')}` : '\nAll checks passed.');
  console.log(`Screenshots: ${OUT}`);
  exitCode = failures.length ? 1 : 0;
} catch (error) {
  console.error(error.stack || error);
} finally {
  await cleanup();
}
const left = [...services].filter(service => spawnSync('security', ['find-generic-password', '-s', service], { timeout: 15_000 }).status !== 44);
if (left.length) console.log(`Keychain items left for: ${left.join(', ')}`);
process.exit(exitCode);
