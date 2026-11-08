#!/usr/bin/env node
// Drives the Debug app through accessibility, in the background (XCUITest is not available here), and saves every state in light and dark.
// The app draws its own window into a PNG because screen capture permission is off. See apple/README.md.
//
//   node apple/scripts/shots.mjs [--out <folder>] [--only light|dark] [--no-chat] [--chats-only] [--approvals-only] [--flow main|marks|chats|accounts|approvals]
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { startChatStub } from './chat-fixtures.mjs';
import { copyTranscript, startScratch, TEST_CWD } from './test-server.mjs';

const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(option('--out') || path.join(here, '..', 'screenshots'));
const FLOW = option('--flow');
const APPEARANCES = option('--only') ? [option('--only')] : ['light', 'dark'];
const DEFAULT_SIZE = [960, 640];
const MIN_SIZE = [640, 420];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Runs share nothing but apple/build, so building the app and compiling the helper wait for each other there. Everything else is per run.
const BUILD_DIR = path.join(here, '..', 'build');
const BUILD_LOCK = path.join(BUILD_DIR, 'shots-build.lock');
async function withBuildLock(work) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const pidFile = path.join(BUILD_LOCK, 'pid');
  const owner = () => { try { return Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return NaN; } };
  const giveUp = Date.now() + 15 * 60_000;
  for (;;) {
    try {
      fs.mkdirSync(BUILD_LOCK);
      fs.writeFileSync(pidFile, String(process.pid));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const first = owner();
    // NaN means the owner has made the folder and not yet written its pid, which is only stale once the folder is old.
    const young = Date.now() - (fs.statSync(BUILD_LOCK, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 5000;
    const dead = Number.isFinite(first) ? !alive(first) : !young;
    // Read the owner again just before clearing, so a lock another run has only now retaken is left alone.
    if (dead && Object.is(owner(), first)) {
      const stale = `${BUILD_LOCK}.stale-${process.pid}`;
      try { fs.renameSync(BUILD_LOCK, stale); fs.rmSync(stale, { recursive: true, force: true }); continue; } catch { /* another run got there first */ }
    }
    if (Date.now() > giveUp) throw new Error(`Gave up waiting for the build lock ${BUILD_LOCK}, held by pid ${first}.`);
    await sleep(500);
  }
  const release = () => { try { if (owner() === process.pid) fs.rmSync(BUILD_LOCK, { recursive: true, force: true }); } catch { /* left for the stale check */ } };
  process.once('exit', release);
  try { return await work(); } finally { release(); process.removeListener('exit', release); }
}

// The accessibility helper: pid-exact, and it sends no input event. Compiled to a temp name and renamed, so no run sees half a binary.
const AX_SOURCE = path.join(here, 'ax.swift');
const AX = path.join(BUILD_DIR, 'ax');
function compileHelper() {
  if (fs.existsSync(AX) && fs.statSync(AX).mtimeMs >= fs.statSync(AX_SOURCE).mtimeMs) return;
  const temp = `${AX}.${process.pid}`;
  const r = spawnSync('swiftc', ['-O', AX_SOURCE, '-o', temp], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`The accessibility helper did not compile:\n${r.stderr}`);
  fs.renameSync(temp, AX);
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
const pids = new Set();
const servers = new Set();
const suites = new Set();
const services = new Set();
const cameToFront = [];
let frontChecks = 0;
const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const readPassword = server => fs.readFileSync(server.passwordFile, 'utf8').trim();

// The app runs in the background the whole time and is driven through accessibility only (apple/scripts/ax.swift), so nothing here sends a key or a click.
// Each node from tree() is { path, role, subrole, desc, title, value, help, id, disclosing, orientation, focused, selected, pos, size, kid(...indexes) }.
// Its path is child indexes from the window, in the same depth-first order as AppleScript's `entire contents`.
class App {
  constructor(bundle, { address, appearance, tag, notify = false }) {
    this.notify = notify;
    this.appearance = appearance;
    this.tag = tag;
    this.count = 0;
    this.service = `gs-test-${crypto.randomBytes(6).toString('hex')}`;
    this.suite = `com.kulesy.ghostshell.test.${this.service}`;
    this.bundle = bundle;
    this.address = address;
    this.pid = undefined;
    this.shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-shot-'));
    this.alertLog = path.join(this.shotDir, 'alerts.log');
    services.add(this.service);
    suites.add(this.suite);
  }

  // `open -g -n` starts a new instance without activating it. NSAppSleepDisabled stops App Nap from slowing the shot timer and the polling.
  // Another process is also named GhostShell (the installed app, and a Chrome app), so the launched app is found by its unique Keychain service.
  async launch() {
    fs.mkdirSync(this.shotDir, { recursive: true });
    const opened = spawnSync('open', ['-g', '-n', this.bundle, '--args', '-NSAppSleepDisabled', 'YES', '-GSKeychainService', this.service, '-GSAddress', this.address,
      '-GSDefaultsSuite', this.suite, '-GSAppearance', this.appearance, '-GSShotDir', this.shotDir,
      ...(this.notify ? ['-GSNotify', 'on', '-GSAlertLog', this.alertLog] : [])], { encoding: 'utf8', timeout: 30_000 });
    if (opened.status !== 0) throw new Error(`open failed: ${opened.stderr}`);
    const found = await until('process', () => {
      this.pid = Number(spawnSync('pgrep', ['-f', `MacOS/GhostShell .*${this.service}`], { encoding: 'utf8' }).stdout.split('\n')[0]) || undefined;
      return this.pid;
    }, 20);
    if (!found) throw new Error('The app did not start.');
    pids.add(this.pid);
    this.cameToFront = false;
    this.watchdog = setInterval(() => this.watch(), 500);
    const shown = await until('window', () => this.tree().length > 0, 20);
    if (!shown) throw new Error('The app window did not appear.');
    await sleep(600);
  }

  // Records a failed check if the app is the frontmost app when sampled, every 500 ms while the run is awaiting something.
  watch() {
    const front = Number(spawnSync(AX, ['front'], { encoding: 'utf8', timeout: 10_000 }).stdout.trim());
    frontChecks += 1;
    if (front === this.pid && !this.cameToFront) {
      this.cameToFront = true;
      cameToFront.push(`${this.tag} ${this.appearance}`);
      check(false, `the app came to the front (pid ${this.pid}, after: ${this.last})`);
    }
  }

  // Runs one helper command on this app's pid. Returns the parsed JSON, or { ok: false, error } when the helper failed.
  run(command, ...rest) {
    // Typed text can be a password, and this.last is printed in a failure.
    this.last = command === 'type' ? 'type' : [command, ...rest].join(' ').slice(0, 60);
    const r = spawnSync(AX, [command, String(this.pid), ...rest], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1 << 28 });
    if (r.status !== 0) return { ok: false, error: (r.stderr || String(r.error || r.signal)).trim() };
    return JSON.parse(r.stdout);
  }

  // Every node under the main window. The window title follows the chosen session, and the system's saved-password popup is a second window, so the main window is found by its kind.
  tree() {
    const nodes = this.run('tree');
    if (!Array.isArray(nodes)) return [];
    const index = new Map(nodes.map(node => [node.path.join(','), node]));
    for (const node of nodes) node.kid = (...at) => index.get([...node.path, ...at].join(','));
    return nodes;
  }
  find(test) { return this.tree().find(test); }
  findAll(test) { return this.tree().filter(test); }
  // Actions and attribute writes go to the app by pid. `node` is a tree node, or 'focused' for the focused element.
  act(node, action = 'AXPress') { return this.run('act', node === 'focused' ? 'focused' : JSON.stringify(node.path), action).ok === true; }
  set(node, attribute, value) { return this.run('set', node === 'focused' ? 'focused' : JSON.stringify(node.path), attribute, JSON.stringify(value)).ok === true; }

  // The app is never brought to the front, so there is nothing to do.
  front() {}
  send() { throw new Error('Global keystrokes are gone. Use menu, act, set, enter or escape.'); }
  events() { throw new Error('System Events is gone. Use tree, find, findAll, act or set.'); }

  // Appends to the focused field. A secure field reads back empty, so the text becomes its value.
  type(text) { return this.run('type', text).ok === true; }
  enter() { return this.act('focused', 'AXConfirm'); }
  submit() { return this.enter(); }
  // A popover closes on AXCancel, which is what its own Escape does.
  escape() { return this.act(this.find(node => node.role === 'AXPopover') ?? 'focused', 'AXCancel'); }
  resize([w, h]) { return this.run('set', '[]', 'AXSize', JSON.stringify([w, h])).ok === true; }

  // The text of every static text in the window, one per line.
  texts() { return this.findAll(node => node.role === 'AXStaticText' && node.value != null).map(node => `${node.value}\n`).join(''); }
  // With a value, the button must also report it, as the bell does with On and Off.
  hasButton(name, value) { return !!this.find(node => node.role === 'AXButton' && node.desc === name && (value === undefined || node.value === value)); }
  // What the app would have shown, one line per alert: "post <id> <kind> <title>", "withdraw <id>" or "badge <count|none>".
  alerts() {
    try { return fs.readFileSync(this.alertLog, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  }
  // The Settings window opens in front of the main one, so tree() reads it while it is open.
  settingsOpen() { return this.find(node => node.path.length === 0)?.title === 'GhostShell Settings'; }
  openSettings() { return this.menu('GhostShell', 'Settings…'); }
  // Only the Settings window is closed, because closing the main window quits the app.
  closeSettings() {
    const close = this.settingsOpen() && this.find(node => node.path.length === 1 && node.subrole === 'AXCloseButton');
    return !!close && this.act(close);
  }
  // Session rows only. With sections, the nth AXRow is often a heading, and the search field is a row too.
  sessionRowNodes() {
    return this.findAll(node => {
      if (node.role !== 'AXRow') return false;
      const inner = node.kid(0, 0);
      return !!inner && inner.role !== 'AXGroup' && inner.role !== 'AXTextField';
    });
  }
  rows() { return this.sessionRowNodes().length; }
  // Chooses the nth session row (from 0), skipping the section headings and the search field.
  chooseRow(index = 0) {
    const row = this.sessionRowNodes()[index];
    return !!row && this.set(row, 'AXSelected', true);
  }
  chooseFirstRow() { return this.chooseRow(0); }
  // The chat is the last vertical scroll bar in the window, after the sidebar's. 0 is the top and 1 the end.
  scrollChat(to) {
    const bar = this.findAll(node => node.role === 'AXScrollBar' && node.orientation === 'AXVerticalOrientation').at(-1);
    return !!bar && this.set(bar, 'AXValue', to);
  }
  // Presses the first button whose description or title is `name`, or starts with it. An alert's buttons are in the window's contents too.
  press(name, { prefix = false } = {}) {
    const matches = text => (prefix ? text?.startsWith(name) : text === name);
    const tree = this.tree();
    const sheet = tree.find(node => node.role === 'AXSheet')?.path.join();
    const buttons = tree.filter(node => node.role === 'AXButton' && (matches(node.desc) || matches(node.title)));
    // An open alert is in front of the window, so its buttons win over a same-named button behind it.
    const button = buttons.find(node => sheet && node.path.join().startsWith(`${sheet},`)) ?? buttons[0];
    if (!button) return false;
    if (this.act(button)) return true;
    // An alert closes as its button is pressed, and an accessory app answers that press with an error, so a sheet that is gone counts.
    if (!sheet || !button.path.join().startsWith(`${sheet},`)) return false;
    for (let tries = 0; tries < 10; tries += 1) {
      if (!this.tree().some(node => node.role === 'AXSheet')) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    return false;
  }
  // The sidebar top to bottom, a line each: "H" for a heading, "R <hover text> <Expanded|Collapsed|>" for a session row. Row titles
  // are not readable through accessibility, so a row is told apart by its hover text, which the stub varies by folder.
  outline() {
    const nodes = this.tree();
    const list = nodes.find(node => node.role === 'AXOutline');
    if (!list) return [];
    // A row's content sits under its cell, so a session row is the node three levels below the outline's row, and a heading is deeper.
    return nodes.filter(node => node.path.length > list.path.length && node.path.slice(0, list.path.length).join() === list.path.join())
      .flatMap(node => {
        if (node.role === 'AXHeading') return [['H']];
        const isRow = node.path.length === list.path.length + 3 && (node.role === 'AXUnknown' || node.role === 'AXButton');
        return isRow ? [['R', node.help ?? '', typeof node.value === 'string' ? node.value : '']] : [];
      });
  }
  headings() { return this.outline().filter(([kind]) => kind === 'H').length; }
  sessionRows() { return this.outline().filter(([kind]) => kind === 'R'); }
  // Opens or folds the nth section heading (from 0). Pressing the heading goes through the outline, so the app keeps the fold. Setting AXDisclosing on the row does not.
  setSection(n, open) {
    const heading = this.findAll(node => node.role === 'AXRow' && node.kid(0, 0, 0)?.role === 'AXHeading')[n];
    return !!heading && (heading.disclosing === open || this.act(heading.kid(0, 0, 0)));
  }
  viewPopup() { return this.find(node => node.role === 'AXPopUpButton' && node.desc?.startsWith('View')); }
  // What the View menu says about the other views: "View", "View, another view needs you" or "View, another view is working".
  viewMenu() { return this.viewPopup()?.desc ?? ''; }
  // Picks a project (or Home) from the View menu in the sidebar's header. A project's item reads "Name (count)", and the menu is described "View, another view needs you" while one does.
  pickView(name) {
    const popup = this.viewPopup();
    if (!popup || !this.act(popup)) return false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const item = this.find(node => node.role === 'AXMenuItem' && node.title?.startsWith(name));
      if (item) return this.act(item);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    return false;
  }
  // Focuses the sidebar's search field and sets its text.
  search(text) {
    const field = this.find(node => node.subrole === 'AXSearchField');
    return !!field && this.set(field, 'AXFocused', true) && this.set(field, 'AXValue', text);
  }
  // SwiftUI gives its bordered buttons no name, so a button is pressed by its place in the window.
  pressNth(n) {
    const button = this.findAll(node => node.role === 'AXButton')[n - 1];
    return !!button && this.act(button);
  }
  menu(bar, item) { return this.run('menu', bar, item).ok === true; }
  signOutFromMenu() { return this.menu('File', 'Sign Out'); }

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

  // Quits the way the Dock would, and kills the app if it is still there after 6 seconds.
  async quit() {
    clearInterval(this.watchdog);
    if (!this.pid || !alive(this.pid)) { pids.delete(this.pid); return; }
    this.run('quit');
    if (!await until('quit', () => !alive(this.pid), 6)) {
      process.kill(this.pid, 'SIGKILL');
      await until('killed', () => !alive(this.pid), 2);
    }
    pids.delete(this.pid);
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

// The sidebar lists the stub's chats A to Z, so the rows run empty, rich, stream, long.
const CHAT_ROW = { empty: 0, rich: 1, stream: 2, long: 3 };

async function chatFlow(bundle, appearance) {
  const stub = await startChatStub();
  console.log(`\n== ${appearance}: reading chats`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '6' });
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('rows', () => app.rows() === stub.rows.length), 'the chat stub lists its chats');

    app.chooseRow(CHAT_ROW.rich);
    check(await until('rich', () => app.texts().includes('Why is the upload test flaky? It fails about one run in five.'), 20), 'a rich chat shows its first message');
    await sleep(800);
    await app.both('chat-rich');
    app.scrollChat(0.35);
    await sleep(800);
    await app.shot(`6-chat-rich-middle-${appearance}`);
    app.resize(MIN_SIZE);
    await sleep(700);
    app.scrollChat(0.35);
    await sleep(800);
    await app.shot(`6-chat-rich-middle-min-${appearance}`);
    app.resize(DEFAULT_SIZE);
    await sleep(700);

    app.chooseRow(CHAT_ROW.stream);
    check(await until('stream', () => app.texts().includes('Go on, I am ready.'), 20), 'a streaming chat shows its last message');
    await sleep(5000);
    await app.both('chat-streaming');

    app.chooseRow(CHAT_ROW.long);
    check(await until('long', () => app.texts().includes('Question 600: what does step 600 of the migration do?'), 20), 'a long chat opens at its end');
    await sleep(800);
    await app.both('chat-long-end');
    app.resize(DEFAULT_SIZE);
    await sleep(700);
    app.scrollChat(0);
    await sleep(2500);
    await app.shot(`6-chat-long-scrolled-up-${appearance}`);
    app.scrollChat(0);
    await sleep(2500);
    await app.shot(`6-chat-long-scrolled-up-again-${appearance}`);

    app.chooseRow(CHAT_ROW.empty);
    check(await until('empty', () => app.texts().includes('Nothing here yet'), 20), 'an empty chat says so');
    await app.both('chat-empty');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the chat stub');
  } finally {
    await app.quit();
    stub.stop();
  }
}

// Chats that stop on a prompt. The stub holds each chat's `pending` list, so the cards can be drawn without a model.
async function approvalsFlow(bundle, appearance) {
  const stub = await startChatStub();
  console.log(`\n== ${appearance}: approval cards`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '7' });
  const shown = async (row, title) => {
    app.chooseRow(row);
    return check(await until(title, () => app.texts().includes(title), 20), `the card "${title}" is drawn`);
  };
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('rows', () => app.rows() === stub.rows.length), 'the chat stub lists its chats');

    await shown(4, 'Bash wants to run a command');
    await sleep(800);
    await app.both('approval-bash');
    // The stub has no approve route, so the decision fails and the card keeps its buttons and shows why.
    check(app.press('Deny'), 'Deny is pressed on the Bash card');
    check(await until('error', () => app.texts().includes('The server answered with an error (404). Try again.')), 'a failed decision shows its reason on the card');
    await sleep(500);
    await app.shot(`7-approval-bash-error-${appearance}-default`);

    await shown(5, 'Edit wants to change');
    await sleep(800);
    await app.both('approval-edit');

    await shown(6, 'Claude is asking');
    check(app.press('node:test'), 'an option is picked');
    await sleep(800);
    await app.both('approval-question');
    check(app.press('Lint') && app.press('Types'), 'two checks are picked');
    await sleep(600);
    await app.both('approval-question-picked');

    await shown(7, 'Claude has a plan');
    await sleep(800);
    await app.both('approval-plan');

    await shown(8, 'Bash wants to run a command');
    await sleep(800);
    await app.both('approval-stacked');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the approvals stub');
  } finally {
    await app.quit();
    stub.stop();
  }
}

async function mainFlow(bundle, appearance, withChat) {
  const server = await startScratch({ claude: withChat });
  servers.add(server);
  const app = new App(bundle, { address: server.address, appearance, tag: '1', notify: true });
  console.log(`\n== ${appearance}: sign in, list, chat, notifications, relaunch, sign out`);
  try {
    await app.launch();
    await app.both('signin-idle');

    app.type('not the password');
    app.submit();
    check(await until('wrong', () => app.texts().includes('That password did not match.')), 'a wrong password shows its message');
    await app.both('wrong-password');

    app.type(readPassword(server));
    app.submit();
    check(await until('rows', () => app.sessionRows().length === 8), 'signing in shows the 8 seeded sessions');
    await app.both('list-rows');

    // The bell starts on (-GSNotify), turns notifications off and on again, and the pane agrees with it.
    check(app.hasButton('Notifications', 'On'), 'the toolbar bell starts on');
    await app.both('toolbar-notifications-on');
    app.press('Notifications');
    check(await until('bell off', () => app.hasButton('Notifications', 'Off')), 'clicking the bell turns notifications off');
    await app.both('toolbar-notifications-off');
    await settingsShot(app, 'settings-off');
    app.press('Notifications');
    check(await until('bell on', () => app.hasButton('Notifications', 'On')), 'clicking the bell again turns them on');
    await settingsShot(app, 'settings-on');

    app.chooseFirstRow();
    check(await until('title', () => app.texts().includes('Add dark mode to the chart')), 'choosing a row shows its title in the detail');
    await app.both('session-chosen');

    if (withChat) {
      const token = await signInDirect(server);
      const started = await ownerCall(server, 'api/new', { cwd: TEST_CWD, text: 'Reply with the single word ok.', model: 'haiku' }, token);
      const { id } = await started.json().catch(() => ({}));
      check(started.status === 200 && !!id, 'a Haiku chat starts through the server');
      check(await until('new row', () => app.sessionRows().length === 9, 20), 'the new chat appears in the list with no action in the window');
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
      check(await until('finished alert', () => app.alerts().some(line => line.startsWith(`post ${id} finished `)), 15), 'the finished chat raised a "finished" alert for its session');
      check(app.alerts().some(line => line.startsWith('badge ')), 'the Dock badge was set');
      await sleep(4000);
      copyTranscript(server, id);
      await app.both('list-chat-finished');
      app.chooseRow(0);
      check(await until('real chat', () => app.texts().includes('Reply with the single word ok.'), 20), 'the finished Haiku chat reads back in the window');
      await sleep(800);
      await app.both('chat-real');
      await ownerCall(server, 'logout', undefined, token);
    }

    const posted = app.alerts().filter(line => line.startsWith('post ')).length;
    await app.quit();
    process.kill(server.pid, 'SIGSTOP');
    await app.launch();
    await sleep(1500);
    check(!app.hasButton('Sign In') && !app.texts().includes('Address'), 'a relaunch stays signed in');
    await app.both('loading');
    process.kill(server.pid, 'SIGCONT');
    check(await until('rows', () => app.sessionRows().length === (withChat ? 9 : 8), 20), 'the list loads once the server answers');
    await sleep(1500);
    check(app.alerts().filter(line => line.startsWith('post ')).length === posted, 'a relaunch raises no alerts for sessions that finished while it was closed');

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

// Opens the Settings window from the app menu, saves it and closes it with its close button.
async function settingsShot(app, name) {
  let open = false;
  for (let attempt = 0; attempt < 3 && !open; attempt++) {
    app.openSettings();
    open = await until('settings', () => app.settingsOpen(), 5);
  }
  check(open, `the app menu opens the Settings window (${name})`);
  if (!open) return;
  await sleep(500);
  await app.shot(`${app.tag}-${name}-${app.appearance}`);
  app.closeSettings();
  check(await until('closed', () => !app.settingsOpen(), 10), `its close button closes the Settings window (${name})`);
}

async function emptyAndLocked(bundle, appearance) {
  const server = await startScratch({ empty: true });
  servers.add(server);
  const app = new App(bundle, { address: server.address, appearance, tag: '2' });
  console.log(`\n== ${appearance}: empty list, locked`);
  try {
    await app.launch();
    app.type(readPassword(server));
    app.submit();
    check(await until('empty', () => app.texts().includes('No sessions found')), 'a server with no sessions shows the empty state');
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

async function badAddresses(bundle, appearance) {
  console.log(`\n== ${appearance}: unreachable, bad address`);
  const dead = new App(bundle, { address: `http://localhost:${await freePort()}`, appearance, tag: '3' });
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
  const bad = new App(bundle, { address: 'http://example.com', appearance, tag: '4' });
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
// Its index has a pinned row, a family, a routine with earlier runs, two groups (one in a project) and every mark.
async function marks(bundle, appearance) {
  console.log(`\n== ${appearance}: every status mark, sections, project, search, fold kept`);
  const now = Date.now();
  const row = (id, title, extra = {}) => ({ id, title, state: 'idle', cwd: '/Users/me/Projects/site', branch: 'main', lastActivityAt: now - 600_000, sortAt: now - 600_000, ...extra });
  const rows = [['Waiting on an approval', 'awaiting'], ['This turn failed', 'error'], ['Finished and unread', 'ready'], ['Still working', 'running'], ['Nothing to look at'],
    ['Work out why the nightly build of the shared design system fails on the third Tuesday of every month, but only on the runner with the older toolchain']]
    .map(([title, dot], i) => row(`mark-${i}`, title, { dot, sortAt: now - i * 60_000 }));
  const index = {
    station: 'stub', problem: 'Could not read the Desktop list', projects: [{ id: 'p1', name: 'Website' }, { id: 'p2', name: 'Empty' }],
    pinned: [row('pin-1', 'Pinned checklist')],
    groups: [
      { id: 'g1', name: 'Release', project: null, sessions: [
        row('fam', 'Ship the release', { dot: 'ready', children: [row('kid-1', 'Draft the notes', { parent: 'fam', dot: 'awaiting', state: 'waiting' }), row('kid-2', 'Check the build', { parent: 'fam' })] }),
        row('rel-2', 'Write the changelog', { state: 'working', dot: 'running', turnMs: 125_000 })] },
      { id: 'g2', name: 'Site', project: 'p1', sessions: [row('site-1', 'Redo the landing page', { cwd: '/Users/me/Projects/web' })] },
    ],
    routines: [{ name: 'nightly', title: 'Nightly check', latest: row('run-3', 'Run', { routine: 'nightly' }), earlier: [row('run-2', 'Run', { lastActivityAt: now - 86_400_000 }), row('run-1', 'Run', { lastActivityAt: now - 172_800_000 })] }],
    ungrouped: rows,
  };
  const archived = [row('arch-1', 'Old release rehearsal', { archived: true, cwd: '/Users/me/Projects/old' })];
  // The login reply is held until the signing-in shot is taken.
  let hold = true;
  const held = [];
  const answer = res => res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
  const stub = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/login') { if (hold) held.push(res); else answer(res); }
    else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(req.url.startsWith('/api/archived') ? { archived } : index));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const app = new App(bundle, { address: `http://localhost:${stub.address().port}`, appearance, tag: '5', notify: true });
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('held', () => held.length > 0, 6), 'the stub holds the sign-in request while the window waits');
    await app.both('signing-in');
    hold = false;
    held.splice(0).forEach(answer);
    // Home: Routines, Pinned, Release and Ungrouped. Pinned (1), Release (4 with its family open), Ungrouped (6) and the routine are 12 rows.
    check(await until('rows', () => app.headings() === 4 && app.sessionRows().length === 12), 'Home lists four sections and 12 rows');
    const lines = () => app.sessionRows().map(([, help]) => help);
    check(lines().some(help => help.includes('Needs input')) && lines().some(help => help.includes('Failed')) && lines().some(help => help.includes('working')),
      'rows carry their marks in the hover text');
    check(app.texts().includes('Could not read the Desktop list.'), 'the index problem shows above the list');
    await app.both('list-marks');

    app.setSection(2, false);
    check(await until('folded', () => app.sessionRows().length === 8), 'folding Release hides its four rows');
    await app.quit();
    await app.launch();
    check(await until('kept', () => app.headings() === 4 && app.sessionRows().length === 8), 'the fold is still there after a relaunch');
    await app.both('fold-kept');
    app.setSection(2, true);
    check(await until('opened', () => app.sessionRows().length === 12), 'opening Release shows its rows again');

    app.pickView('Website');
    check(await until('project', () => app.headings() === 2 && lines().some(help => help.includes('Projects/web'))), 'the Website view shows Pinned and its own group, and not Release');
    await app.both('project-view');
    check(app.viewMenu() === 'View, another view needs you', 'Home needs you, so the View menu carries the waiting lamp');

    // With nothing in Home waiting, its one working chat lights the green lamp instead.
    index.groups[0].sessions[0].children[0].state = 'idle';
    check(await until('working lamp', () => app.viewMenu() === 'View, another view is working'), 'a working view lights the working lamp when none waits');
    await app.both('project-view-working');

    // A project with no groups and nothing pinned says "No groups yet" once. Pinned rows show in every view, so the stub drops its own first.
    index.pinned = [];
    check(await until('pinned gone', () => app.sessionRows().length === 1), 'the next poll drops the pinned row');
    app.pickView('Empty');
    const saysNoGroups = () => app.texts().split('\n').filter(line => line === 'No groups yet').length;
    check(await until('empty project', () => app.headings() === 0 && app.sessionRows().length === 0 && saysNoGroups() === 1), 'an empty project says "No groups yet" once');
    await app.both('empty-project');

    app.search('release');
    // Typing is slower than the list, so the row count is what shows the whole word has arrived.
    check(await until('archived hit', () => app.headings() === 2 && app.sessionRows().length === 2 && lines().some(help => help.includes('Projects/old'))), 'searching shows a live hit and an archived hit');
    await app.both('search-archived');
    app.search('zzzz');
    check(await until('no hits', () => app.sessionRows().length === 0), 'a search with no match lists nothing');

    // Two rows wait at the start, which is the Dock count. A row that then starts waiting raises one alert and moves the count to three.
    check(app.alerts().includes('badge 2') && !app.alerts().some(line => line.startsWith('post ')), 'the first list sets the Dock count to 2 and raises no alert');
    rows[4].dot = 'awaiting';
    check(await until('needs you', () => app.alerts().includes('post mark-4 needs-you Nothing to look at'), 15), 'a row that starts waiting raises a "needs you" alert');
    check(app.alerts().includes('badge 3'), 'the Dock count moves to 3');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the stub');
  } finally {
    await app.quit();
    held.splice(0).forEach(answer);
    stub.closeAllConnections();
    stub.close();
  }
}

// The accounts, banners, context meter and passkeys all need a server that is out of usage, mid-update and so on, which a scratch server can't be.
// A stub answers them, and records every call so the Force restart question can be shown to POST nothing until it is confirmed.
// Never point these buttons at a real server: update and force restart run `npm run restart`, and a sign-in opens a browser on this Mac.
async function accountsFlow(bundle, appearance) {
  console.log(`\n== ${appearance}: accounts, banners, context meter, passkeys`);
  const now = Date.now();
  const day = 86_400_000;
  const rows = ['Fix the flaky upload test', 'Write the release notes', 'Tidy the sidebar']
    .map((title, i) => ({ id: `acct-${i}`, title, dot: i === 0 ? 'running' : undefined, state: 'idle', sortAt: now - i * 60_000 }));
  const work = { id: 'work', name: 'Work' };
  const personal = { id: 'personal', name: 'Personal' };
  const chrome = { state: 'elsewhere', to: personal, on: work, email: 'me@example.com' };
  const update = { show: true, kind: 'update', stage: 'idle', count: 7, restart: true, busy: 2, force: true, blocked: '',
    changes: [['Add a context meter', 1], ['Fix the sidebar jump', 2], ['Show the plan bars', 3]].map(([title, n]) => ({ title, url: `https://github.com/kulesy/ghostshell/pull/${n}` })) };
  let banners = {
    login: { visible: true, signedOut: false, endsAt: now + 3 * day, stage: 'idle', account: 'Personal', accountId: 'personal' },
    update,
    accounts: { out: { name: 'Work', text: 'Resets at 3:00 pm', at: now, to: personal }, auto: { at: now, from: work, to: personal } },
    chrome,
  };
  const limits = [
    { kind: 'session', percent: 62, resetsAt: new Date(now + 95 * 60_000).toISOString(), severity: 'normal' },
    { kind: 'weekly_all', percent: 84, resetsAt: new Date(now + 2 * day).toISOString(), severity: 'warning' },
    { kind: 'weekly_scoped', group: 'opus', scope: 'Opus', percent: 97, resetsAt: new Date(now + 2 * day).toISOString(), severity: 'critical' },
  ];
  const accounts = {
    autoSwitch: true, waiting: true, auto: banners.accounts.auto, chrome,
    accounts: [
      { id: 'work', name: 'Work', stage: 'idle', signedOut: false, endsAt: now + 20 * day, email: 'me@example.com', planType: 'Max', active: true,
        plan: { limits, at: now }, pinned: { sessions: 2, groups: 1 },
        chats: [{ id: 'acct-0', title: 'Fix the flaky upload test', state: 'working' }, { id: 'acct-1', title: 'Write the release notes', state: 'waiting' }] },
      { id: 'personal', name: 'Personal', stage: 'idle', signedOut: false, endsAt: now + 3 * day, email: 'me@home.example', planType: 'Pro', active: false,
        plan: { limits: [limits[0]], at: now }, chromeOn: 'work', pinned: { routines: 1 }, chats: [] },
      { id: 'spare', name: 'Spare', stage: 'waiting', signedOut: true, active: false, pinned: {}, chats: [] },
    ],
  };
  const context = detail => ({ source: 'process', total: 84_000, window: 200_000, autoCompactAt: 160_000, model: 'claude-opus-4-5',
    ...(detail === 'full' ? { categories: [{ id: 'sys', name: 'System prompt', tokens: 3200 }, { id: 'tools', name: 'Tools', tokens: 14_800 }, { id: 'msgs', name: 'Messages', tokens: 66_000 }],
      free: { name: 'Free space', tokens: 116_000 }, buffer: { name: 'Autocompact buffer', tokens: 40_000 } } : {}) });
  const passkeys = { available: true, passkeys: [
    { id: 'pk-1', device: 'MacBook Pro, Safari', rpId: 'localhost', created: new Date(now - 40 * day).toISOString(), used: new Date(now - 2 * day).toISOString() },
    { id: 'pk-2', device: 'iPhone, Safari', rpId: 'localhost', created: new Date(now - 9 * day).toISOString() },
  ] };
  const calls = [];
  const send = (res, body) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  const stub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const { pathname } = new URL(req.url, 'http://stub');
      if (req.method === 'POST') calls.push(pathname);
      if (pathname === '/login') return res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
      if (pathname === '/api/accounts') return send(res, accounts);
      if (pathname === '/api/accounts/plan') return send(res, accounts);
      if (pathname === '/api/banners') return send(res, banners);
      if (pathname === '/api/banners/force-restart') return send(res, { ...banners, update: { ...update, stage: 'restarting' } });
      if (pathname === '/api/passkeys') return send(res, passkeys);
      if (pathname.endsWith('/context')) return send(res, context(JSON.parse(Buffer.concat(chunks).toString() || '{}').detail));
      if (pathname.endsWith('/plan')) return send(res, { limits });
      return send(res, { ungrouped: rows });
    });
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const app = new App(bundle, { address: `http://localhost:${stub.address().port}`, appearance, tag: '6' });
  const sees = text => app.texts().includes(text);
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('rows', () => app.rows() === rows.length), 'the stub list shows its sessions');

    const titles = ["sign-in ends in 3 days", 'Work is out of usage', 'Switched to Personal', 'Chrome is still on Work', '7 merged changes are waiting'];
    check(await until('banners', () => titles.every(sees), 20), 'each banner shows its title');
    await app.both('banners');

    // The banners are read every 15 seconds, so the four others are taken off and the update one is left to press.
    banners = { update };
    check(await until('only update', () => !sees('Work is out of usage') && sees('7 merged changes are waiting'), 30), 'the banners that are gone leave the sidebar');
    check(app.pressNth(2), 'the update banner has a Force restart button');
    check(await until('question', () => sees('2 running chats will be cut.'), 10), 'Force restart asks what it will cut');
    await app.both('force-question');
    check(app.press('Cancel'), 'Cancel is on the question');
    await sleep(1500);
    check(!calls.includes('/api/banners/force-restart'), 'Cancel sends no restart');
    check(app.pressNth(2) && await until('question again', () => sees('2 running chats will be cut.'), 10), 'Force restart asks again');
    check(app.press('Force restart'), 'the question has a Force restart button');
    check(await until('posted', () => calls.filter(call => call === '/api/banners/force-restart').length === 1, 10), 'confirming sends one restart');
    await sleep(1500);
    check(calls.filter(call => call === '/api/banners/force-restart').length === 1, 'the restart is sent once');
    await app.both('restarting');

    check(app.menu('View', 'Accounts'), 'the View menu has Accounts');
    check(await until('accounts', () => ['Running chats', 'Spare', 'Personal'].every(sees), 15), 'the Accounts screen shows each account');
    check(sees('Signed out') && sees('Active'), 'the Accounts screen says which is active and which is signed out');
    await app.both('accounts');

    check(app.menu('View', 'Passkeys'), 'the View menu has Passkeys');
    check(await until('passkeys', () => sees('MacBook Pro, Safari') && sees('iPhone, Safari'), 15), 'the Passkeys screen lists each passkey');
    await app.both('passkeys');

    app.chooseFirstRow();
    check(await until('meter', () => app.hasButton('Context: 84,000 of 200,000 tokens, 42% used'), 15), 'choosing a session shows the context meter');
    await app.both('meter');

    // A popover can close when the window is resized, so each size opens its own.
    for (const [name, size] of [['default', DEFAULT_SIZE], ['min', MIN_SIZE]]) {
      app.resize(size);
      await sleep(700);
      check(app.press('Context:', { prefix: true }), `the meter opens its popover at the ${name} size`);
      check(await until('popover', () => sees('Plan usage') && sees('Messages'), 10), `the popover shows the parts and the plan at the ${name} size`);
      await app.shot(`${app.tag}-meter-popover-${appearance}-${name}`);
      app.escape();
      await sleep(500);
    }
    app.resize(DEFAULT_SIZE);
  } finally {
    await app.quit();
    stub.closeAllConnections();
    stub.close();
  }
}

const cleanup = async () => {
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  for (const server of servers) { try { process.kill(server.pid, 'SIGCONT'); } catch {} await server.stop(); }
  for (const suite of suites) spawnSync('defaults', ['delete', suite], { stdio: 'ignore', timeout: 10_000 });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => cleanup().finally(() => process.exit(130)));

fs.mkdirSync(OUT, { recursive: true });
let exitCode = 1;
try {
  const bundle = await withBuildLock(() => {
    const built = build({ release: false });
    compileHelper();
    return built;
  });
  const flows = argv.includes('--approvals-only') ? ['approvals'] : argv.includes('--chats-only') ? ['chats'] : FLOW ? [FLOW] : ['main', 'marks', 'chats', 'accounts', 'approvals'];
  for (const appearance of APPEARANCES) {
    if (flows.includes('main')) {
      await mainFlow(bundle, appearance, !argv.includes('--no-chat'));
      await emptyAndLocked(bundle, appearance);
      await badAddresses(bundle, appearance);
    }
    if (flows.includes('marks')) await marks(bundle, appearance);
    if (flows.includes('chats')) await chatFlow(bundle, appearance);
    if (flows.includes('accounts')) await accountsFlow(bundle, appearance);
    if (flows.includes('approvals')) await approvalsFlow(bundle, appearance);
  }
  // watch() has already failed a check for each app that came forward.
  if (!cameToFront.length) check(true, `no test app came to the front (${frontChecks} samples)`);
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
