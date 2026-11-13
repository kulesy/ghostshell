#!/usr/bin/env node
// Drives the Debug app through accessibility, in the background (XCUITest is not available here), and saves every state in light and dark.
// The app draws its own window into a PNG because screen capture permission is off. See apple/README.md.
//
//   node apple/scripts/shots.mjs [--out <folder>] [--only light|dark] [--no-chat] [--chats-only] [--widgets-only] [--approvals-only] [--flow main|marks|chats|widgets|accounts|approvals|organise|routines|files|groups|composer, comma separated] [--files-only] [--no-files]
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
import { listen } from '../../test/speakers.mjs';
import { makePng } from './png.mjs';
import { startFilesStub } from './files-fixtures.mjs';
import { startGroupStub } from './group-fixtures.mjs';
import { routinesStub } from './routines-fixtures.mjs';
import { copyTranscript, startScratch, TEST_CWD } from './test-server.mjs';

const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : undefined);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(option('--out') || path.join(here, '..', 'screenshots'));
const FLOW = option('--flow')?.split(',');
const FLOWS = ['main', 'marks', 'chats', 'widgets', 'accounts', 'approvals', 'organise', 'routines', 'files', 'groups', 'terminal', 'composer'];
if (argv.includes('--flow') && (!FLOW[0] || FLOW.some(flow => !FLOWS.includes(flow)))) {
  console.error(`${FLOW[0] ? `Unknown --flow ${FLOW.join(',')}.` : '--flow needs a value.'} The flows are: ${FLOWS.join(', ')}.`);
  process.exit(2);
}
const APPEARANCES = option('--only') ? [option('--only')] : ['light', 'dark'];
const DEFAULT_SIZE = [960, 640];
const MIN_SIZE = [640, 420];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Runs share nothing but apple/build, so building the app and compiling the helper wait for each other there. Everything else is per run.
const BUILD_DIR = path.join(here, '..', 'build');
const BUILD_LOCK = path.join(BUILD_DIR, 'shots-build.lock');
// The one step that takes the focus (activates the app and sends real keys) holds this, so two runs never type into each other.
const KEYS_LOCK = path.join(BUILD_DIR, 'shots-keys.lock');
async function withLock(lock, work) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const pidFile = path.join(lock, 'pid');
  const owner = () => { try { return Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return NaN; } };
  const giveUp = Date.now() + 15 * 60_000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(pidFile, String(process.pid));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const first = owner();
    // NaN means the owner has made the folder and not yet written its pid, which is only stale once the folder is old.
    const young = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 5000;
    const dead = Number.isFinite(first) ? !alive(first) : !young;
    // Read the owner again just before clearing, so a lock another run has only now retaken is left alone.
    if (dead && Object.is(owner(), first)) {
      const stale = `${lock}.stale-${process.pid}`;
      try { fs.renameSync(lock, stale); fs.rmSync(stale, { recursive: true, force: true }); continue; } catch { /* another run got there first */ }
    }
    if (Date.now() > giveUp) throw new Error(`Gave up waiting for the lock ${lock}, held by pid ${first}.`);
    await sleep(500);
  }
  const release = () => { try { if (owner() === process.pid) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* left for the stale check */ } };
  process.once('exit', release);
  try { return await work(); } finally { release(); process.removeListener('exit', release); }
}

// The accessibility helper: pid-exact, and its only input is the `keys` command behind App.keys(). Compiled to a temp name and renamed, so no run sees half a binary.
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
// Every app this run started, kept after it quits, so the sound check at the end can name them.
const launched = new Set();
const speakers = listen();
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
    launched.add(this.pid);
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
    if (front === this.pid && !this.cameToFront && !this.keying) {
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

  // The app is never brought to the front, except inside keys().
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
  // A button's name is its description, or only its hover text for an icon-only button in the inspector.
  label(node) { return node.desc || node.help || ''; }
  hasButton(name, value) { return !!this.find(node => node.role === 'AXButton' && this.label(node) === name && (value === undefined || node.value === value)); }
  hasText(text) { return this.texts().split('\n').some(line => line.includes(text)); }
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
  // The terminal panel's scroll area, which holds its own vertical bar.
  terminalBar() {
    const nodes = this.tree();
    const panel = nodes.find(node => node.desc === 'Terminal output');
    return panel && nodes.find(node => node.role === 'AXScrollBar' && node.orientation === 'AXVerticalOrientation' && node.path.join().startsWith(`${panel.path.join()},`));
  }
  // The thread's bar when the terminal panel is open: the last vertical bar that is not the panel's.
  scrollThread(to) {
    const mine = this.terminalBar()?.path.join();
    const bar = this.findAll(node => node.role === 'AXScrollBar' && node.orientation === 'AXVerticalOrientation' && node.path.join() !== mine).at(-1);
    return !!bar && this.set(bar, 'AXValue', to);
  }
  // Presses the first button whose description or title is `name`, or starts with it. An alert's buttons are in the window's contents too.
  press(name, { prefix = false } = {}) {
    const matches = text => (prefix ? text?.startsWith(name) : text === name);
    const tree = this.tree();
    const sheet = tree.find(node => node.role === 'AXSheet')?.path.join();
    const buttons = tree.filter(node => node.role === 'AXButton' && (matches(this.label(node)) || matches(node.title)));
    // An open alert is in front of the window, so its buttons win over a same-named button behind it. Otherwise a same-named button that is off, such as the composer's Send, loses to one that is on.
    const button = buttons.find(node => sheet && node.path.join().startsWith(`${sheet},`)) ?? buttons.find(node => node.enabled !== false) ?? buttons[0];
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
  // Sets every vertical scroll bar under the prompt stack. 0 is the top and 1 the end.
  scrollPrompts(to) {
    const nodes = this.tree();
    const stack = nodes.find(node => node.desc === 'Waiting for your answer');
    if (!stack) return false;
    const bars = nodes.filter(node => node.role === 'AXScrollBar' && node.orientation === 'AXVerticalOrientation' && node.path.join().startsWith(`${stack.path.join()},`));
    return bars.length > 0 && bars.every(bar => this.set(bar, 'AXValue', to));
  }
  // A card's buttons expose no name to accessibility, but each one's hover text names its card or question.
  // So this presses the nth button (from 0) whose hover text is `help`.
  pressHelped(help, n = 0) {
    const button = this.findAll(node => node.role === 'AXButton' && node.help === help)[n];
    return !!button && this.act(button);
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
  // A heading's own button is not a separate element: the list merges it into the heading, which carries the button's hover text. AXPress on the heading folds
  // the section, and the button is the heading's named action, which the system words as "Name:<name>\nTarget:0x0\nSelector:(null)".
  headingButton(help) { return this.find(node => node.role === 'AXHeading' && node.help === help); }
  pressHeadingButton(help) {
    const heading = this.headingButton(help);
    return !!heading && this.act(heading, `Name:${help}\nTarget:0x0\nSelector:(null)`);
  }
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
  // Polls the tree for up to 2 seconds for a node.
  waitFor(test, tries = 10) {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const node = this.find(test);
      if (node) return node;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    return undefined;
  }
  // The items directly under a menu, with dividers left out.
  menuItemsOf(menu) {
    const under = menu.path.join();
    return this.findAll(node => node.role === 'AXMenuItem' && node.title && node.path.length === menu.path.length + 1 && node.path.slice(0, -1).join() === under);
  }
  // Cancels an open menu and waits until it has left the tree, so the next one is not mistaken for it.
  closeMenu() {
    const menu = this.find(node => node.role === 'AXMenu');
    if (!menu) return false;
    this.act(menu, 'AXCancel');
    for (let attempt = 0; attempt < 10 && this.find(node => node.role === 'AXMenu'); attempt += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    return true;
  }
  // The nth session row, counted from 0, or the section heading whose title starts with a name.
  rowNode(kind, nth) {
    if (kind !== 'heading') return this.sessionRowNodes()[nth];
    return this.findAll(node => node.role === 'AXRow' && node.kid(0, 0, 0)?.role === 'AXHeading' && node.kid(0, 0, 0).desc?.startsWith(nth))[0];
  }
  // Opens the right-click menu of the nth row or heading, then lists its items (no path) or presses down the path, opening each submenu on the way.
  // The app answers AXShowMenu late and with an error while the menu is open, so the answer is ignored and the tree is watched for the menu instead.
  rowMenu(kind, nth, ...path) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const done = this.openMenu(kind, nth, ...path);
      if (done && (done === true || done.length)) return done;
      this.closeMenu();
    }
    return path.length ? false : [];
  }
  openMenu(kind, nth, ...path) {
    const row = this.rowNode(kind, nth);
    if (!row) return path.length ? false : [];
    const inRow = node => node.role === 'AXMenu' && node.path.length > row.path.length && node.path.slice(0, row.path.length).join() === row.path.join();
    let menu;
    for (const target of kind === 'heading' ? [row.kid(0, 0), row.kid(0, 0, 0)] : [row.kid(0, 0), row.kid(0, 0)]) {
      if (!target) continue;
      this.run('act', JSON.stringify(target.path), 'AXShowMenu');
      menu = this.waitFor(inRow, 15);
      if (menu) break;
    }
    if (!menu) return path.length ? false : [];
    if (!path.length) return this.menuItemsOf(menu).map(item => item.title);
    for (const [i, name] of path.entries()) {
      const item = this.menuItemsOf(menu).find(entry => entry.title === name || entry.title.startsWith(name));
      if (!item || !this.act(item)) return false;
      if (i < path.length - 1) {
        menu = this.waitFor(node => node.role === 'AXMenu' && node.path.length === item.path.length + 1 && node.path.slice(0, -1).join() === item.path.join());
        if (!menu) return false;
      }
    }
    return true;
  }
  // The names of a row's or heading's menu items. The menu is closed again.
  menuItems(kind, nth) {
    const items = this.rowMenu(kind, nth);
    this.closeMenu();
    return items;
  }
  // The names of the View menu's items. The menu is closed again.
  viewItems() {
    const popup = this.viewPopup();
    if (!popup || !this.act(popup)) return [];
    const menu = this.waitFor(node => node.role === 'AXMenu' && node.path.length === popup.path.length + 1 && node.path.slice(0, -1).join() === popup.path.join());
    const items = menu ? this.menuItemsOf(menu).map(item => item.title) : [];
    this.closeMenu();
    return items;
  }
  // Selects several session rows at once through each row's Select item, because accessibility can only select one row.
  selectRows(...indexes) {
    return indexes.every(index => this.rowMenu('row', index, 'Select'));
  }
  selectedCount() { return this.sessionRowNodes().filter(node => node.selected === true).length; }
  // The sheet on show, and the text field in it.
  sheet() { return this.find(node => node.role === 'AXSheet'); }
  fillSheet(text) {
    const sheet = this.sheet();
    const under = sheet?.path.join();
    const field = this.find(node => node.role === 'AXTextField' && under && node.path.join().startsWith(`${under},`));
    return !!field && this.set(field, 'AXFocused', true) && this.set(field, 'AXValue', text);
  }
  // A button's centre in screen points, by its description or title, or undefined.
  centerOf(name) {
    const node = this.find(n => n.role === 'AXButton' && (n.desc === name || n.title === name) && n.pos && n.size);
    return node && [Math.round(node.pos[0] + node.size[0] / 2), Math.round(node.pos[1] + node.size[1] / 2)];
  }
  // A widget counts only a real owner click, which AXPress is not. The Debug app sends a mouse down and up at this point to its own window (ClickWatcher),
  // so the pointer, the front app and the keyboard are untouched.
  async clickAt([x, y]) {
    this.clicks = (this.clicks ?? 0) + 1;
    this.last = `click ${this.clicks}`;
    fs.writeFileSync(path.join(this.shotDir, 'click.txt'), `${this.clicks} ${x} ${y}`);
    const done = await until('click', () => {
      try { return fs.readFileSync(path.join(this.shotDir, 'clicked.txt'), 'utf8').trim() === `${this.clicks} ok`; } catch { return false; }
    }, 10);
    return check(done, `the app took click ${this.clicks}`);
  }
  // The chat comes through twice, the first copy with frames from before it scrolled. The last node that matches is the live one, and an
  // action works on either, so nothing here needs a position.
  // A link's own AXPress hands its URL to the system, which has no app for it, so the line of text that holds the link carries an action
  // named "Open <link text>" that goes through the app's link handler.
  clickLink(text) {
    const nodes = this.tree();
    const link = nodes.filter(node => node.role === 'AXLink' && node.title === text).at(-1);
    const line = link && nodes.find(node => node.path.join() === link.path.slice(0, -1).join());
    return !!line && this.act(line, `Open ${text}`);
  }
  // A picture tile's name is "View image 1 of 5, from a tool", or "View 2 more images" for the last. The nth (from 0) is pressed, in the order they sit.
  clickTile(n) {
    const tiles = new Map();
    for (const node of this.findAll(node => node.role === 'AXButton' && /^View (image \d+ of \d+, from a tool|\d+ more images)$/.test(node.desc ?? ''))) tiles.set(node.desc, node);
    const tile = [...tiles.values()].sort((a, b) => a.pos[0] - b.pos[0])[n];
    return !!tile && this.act(tile);
  }
  // The file editor's text view, a text area named "File text".
  fileText() { return this.findAll(node => node.role === 'AXTextArea' && node.desc === 'File text').at(-1); }
  focusFileText() {
    const field = this.fileText();
    return !!field && this.set(field, 'AXFocused', true);
  }
  // Replaces the text of the first text field whose value is `was`.
  replaceField(was, text) {
    const field = this.find(node => node.role === 'AXTextField' && node.value === was);
    return !!field && this.set(field, 'AXFocused', true) && this.set(field, 'AXValue', text);
  }
  menu(bar, item) { return this.run('menu', bar, item).ok === true; }
  // Opens a menu or pop-up button by its name, then presses one of its items.
  pick(name, item) {
    const button = this.find(node => ['AXMenuButton', 'AXPopUpButton'].includes(node.role) && [node.desc, node.title, node.help].includes(name));
    if (!button || !this.act(button)) return false;
    const entry = this.waitFor(node => node.role === 'AXMenuItem' && node.title === item);
    return !!entry && this.act(entry);
  }
  signOutFromMenu() { return this.menu('File', 'Sign Out'); }

  // The composer. Everything goes through accessibility except the keys its text view reads off the key event (Shift+Enter, and the slash list's Tab and Escape).
  composerBox() { return this.findAll(node => node.role === 'AXTextArea').at(-1); }
  composerText() { return String(this.composerBox()?.value ?? '').replace(/\n$/, ''); }
  // The composer's parts that are missing, empty or outside the window, so a prompt stack above it can't push any of them out of view.
  composerGaps() {
    const nodes = this.tree();
    const win = nodes[0];
    const inside = n => !!n?.pos && !!n.size && n.size[0] > 0 && n.size[1] > 0 && n.pos[0] >= win.pos[0] - 1 && n.pos[1] >= win.pos[1] - 1
      && n.pos[0] + n.size[0] <= win.pos[0] + win.size[0] + 1 && n.pos[1] + n.size[1] <= win.pos[1] + win.size[1] + 1;
    const button = part => nodes.find(n => ['AXButton', 'AXMenuButton', 'AXPopUpButton'].includes(n.role) && [n.desc, n.help, n.title].some(text => text?.includes(part)));
    const box = this.composerBox();
    const parts = { box, 'a box tall enough to type in': box && box.size[1] >= 16 ? box : null, Send: button('Send'), Attach: button('Attach files'),
      Model: button('Model: '), Effort: button('Effort: '), Permissions: button('Permission mode: '), 'a chip': button('Remove screenshot.png') };
    return Object.entries(parts).filter(([, node]) => !inside(node)).map(([name]) => name);
  }
  focusComposer() { const box = this.composerBox(); return !!box && this.set(box, 'AXFocused', true); }
  setComposer(text) { const box = this.composerBox(); return !!box && this.set(box, 'AXFocused', true) && this.set(box, 'AXValue', text); }
  // The one step that takes the focus: under the keys lock, ax activates the app, posts the keys to its pid and gives the focus back.
  async keys(...names) {
    return withLock(KEYS_LOCK, async () => {
      this.keying = true;
      try {
        const r = this.run('keys', ...names);
        await sleep(800);
        return check(r.ok === true, `keys ${names.join(' ')} were sent`);
      } finally {
        this.keying = false;
      }
    });
  }
  // SwiftUI puts a button's label in its description, its help or its title depending on the style, so all three are read.
  buttonsLike(part) {
    return this.findAll(node => ['AXButton', 'AXMenuButton', 'AXPopUpButton'].includes(node.role) && [node.desc, node.help, node.title].some(text => text?.includes(part)));
  }
  hasButtonLike(part) { return this.buttonsLike(part).length > 0; }
  // Picks "Quote" from the context menu of the first static text containing `text`. The menu opens on the text or on one of its parents, so each is tried until a chip is added.
  quote(text) {
    const before = this.buttonsLike('Remove quote').length;
    const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    // The thread can still be settling after a chat opens, so a miss is retried before it counts.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const node = this.find(n => n.role === 'AXStaticText' && String(n.value ?? '').includes(text));
      for (let up = 0; node && up < 6 && up < node.path.length; up += 1) {
        const target = JSON.stringify(node.path.slice(0, node.path.length - up));
        const picked = this.run('pick', target, 'Quote').ok === true;
        if (picked) wait(500);
        if (this.buttonsLike('Remove quote').length > before) return true;
      }
      wait(1000);
    }
    return false;
  }
  // Opens the menu of the button described `name` and lists its items' titles.
  buttonMenuItems(name) {
    const button = this.buttonsLike(name).find(node => node.role !== 'AXButton') ?? this.buttonsLike(name)[0];
    if (!button || !this.act(button)) return [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const items = this.findAll(node => node.role === 'AXMenuItem').map(node => node.title);
      if (items.length) return items;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    return [];
  }
  // The composer attaches the file named in attach.txt (a Debug hook), because the file panel and the pasteboard can't be driven in the background.
  attachFile(file) {
    this.attachCount = (this.attachCount ?? 0) + 1;
    fs.writeFileSync(path.join(this.shotDir, 'attach.txt'), `${this.attachCount} ${file}`);
  }
  // For a failed check: the buttons and fields in the window, so the next run can be fixed from the log.
  dump() {
    const nodes = this.tree().filter(node => ['AXButton', 'AXMenuButton', 'AXPopUpButton', 'AXTextArea', 'AXMenuItem', 'AXSheet', 'AXRow'].includes(node.role));
    console.log(nodes.slice(0, 80).map(node => `${node.role} | ${node.desc ?? ''} | ${node.title ?? ''} | ${node.help ?? ''} | ${node.value ?? ''} | ${node.path.join('.')}`).join('\n'));
  }

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

// The sidebar lists the stub's chats A to Z by title, so a chat's row comes from its title.
const rowOf = (stub, id) => stub.rows.map((r) => r.title).sort((a, b) => a.localeCompare(b)).indexOf(stub.rows.find((r) => r.id === id).title);

// Launches the app, signs in to a chat stub and waits for its chats to be listed.
async function signInToChatStub(app, stub) {
  await app.launch();
  app.type('whatever');
  app.submit();
  check(await until('rows', () => app.rows() === stub.rows.length), 'the chat stub lists its chats');
}

// Listens on a free port and opens the app pointed at it. The caller closes the stub.
async function appOn(stub, bundle, appearance, tag) {
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  return new App(bundle, { address: `http://localhost:${stub.address().port}`, appearance, tag });
}

// Polls the server's own list until the session is neither working nor waiting.
function waitFinished(server, token, id, seconds) {
  return until('finished', async () => {
    const index = await (await fetch(`${server.address}/api/sessions`, { headers: { Cookie: `capcom=${token}` } })).json();
    const rows = [];
    (function walk(value) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') { if (value.id === id && 'state' in value) rows.push(value); Object.values(value).forEach(walk); }
    })(index);
    return rows.length > 0 && rows.every(row => row.state !== 'working' && row.state !== 'waiting');
  }, seconds);
}


async function chatFlow(bundle, appearance) {
  const stub = await startChatStub();
  console.log(`\n== ${appearance}: reading chats`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '6' });
  try {
    await signInToChatStub(app, stub);

    app.chooseRow(rowOf(stub, 'rich'));
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

    app.chooseRow(rowOf(stub, 'stream'));
    check(await until('stream', () => app.texts().includes('Go on, I am ready.'), 20), 'a streaming chat shows its last message');
    await sleep(5000);
    await app.both('chat-streaming');

    app.chooseRow(rowOf(stub, 'long'));
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

    app.chooseRow(rowOf(stub, 'empty'));
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
  const shown = async (id, title) => {
    app.chooseRow(rowOf(stub, id));
    return check(await until(title, () => app.texts().includes(title), 20), `the card "${title}" is drawn`);
  };
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('rows', () => app.rows() === stub.rows.length), 'the chat stub lists its chats');

    await shown('ask-bash', 'Bash wants to run a command');
    await sleep(800);
    await app.both('approval-bash');
    // The stub has no approve route, so the decision fails and the card keeps its buttons and shows why.
    // The stub's Bash card offers Always allow, so its third button is Deny.
    check(app.pressHelped('Bash wants to run a command', 2), 'Deny is pressed on the Bash card');
    check(await until('error', () => app.texts().includes('The server answered with an error (404). Try again.')), 'a failed decision shows its reason on the card');
    await sleep(500);
    await app.shot(`7-approval-bash-error-${appearance}-default`);

    await shown('ask-edit', 'Edit wants to change');
    await sleep(800);
    await app.both('approval-edit');

    await shown('ask-question', 'Claude is asking');
    await sleep(800);
    await app.both('approval-question');
    check(app.pressHelped('Which test runner should the new tests use?', 0), 'an option is picked');
    check(app.pressHelped('Which checks should run before each commit?', 0) && app.pressHelped('Which checks should run before each commit?', 1), 'two checks are picked');
    await sleep(600);
    // Scrolls the card's body to its end. At the smallest window only the last option fits above the buttons.
    check(app.scrollPrompts(1), 'the question card scrolls to its end');
    await sleep(600);
    await app.both('approval-question-picked');

    await shown('ask-plan', 'Claude has a plan');
    await sleep(800);
    await app.both('approval-plan');

    await shown('ask-two', 'Bash wants to run a command');
    await sleep(800);
    await app.both('approval-stacked');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the approvals stub');
  } finally {
    await app.quit();
    stub.stop();
  }
}

// A widget is Claude's own page in a web view. This checks that a click on its button sends one message, that a widget that sends without a click is
// asked about instead, and that the page cannot see the app's bridge.
async function widgetFlow(bundle, appearance) {
  const stub = await startChatStub();
  console.log(`\n== ${appearance}: widgets`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '7' });
  try {
    await signInToChatStub(app, stub);

    app.chooseRow(rowOf(stub, 'widgets'));
    check(await until('widgets', () => app.texts().includes('Say the word and I will go further on any region.'), 20), 'a chat with widgets shows its last message');
    check(await until('button', () => !!app.centerOf('Show Q4 by region'), 20), 'the widget\'s button is reachable');
    await sleep(1500);
    await app.both('widgets');
    check(stub.sends.length === 0, 'no message was sent before any click');

    const target = app.centerOf('Show Q4 by region');
    if (target) await app.clickAt(target);
    check(await until('sent', () => stub.sends.length === 1, 10), 'one click on the widget\'s button sends exactly one message');
    check(stub.sends[0]?.text === 'Break Q4 down by region' && stub.sends[0]?.id === 'widgets', 'the message is the button\'s text, in the widget\'s chat');
    check(await until('bubble', () => app.hasText('Break Q4 down by region'), 10), 'the widget\'s message shows in the thread like a typed one');
    await sleep(2500);
    check(stub.sends.length === 1, 'the click sent no second message');
    await app.shot(`7-widgets-after-click-${appearance}`);

    app.chooseRow(rowOf(stub, 'widgetask'));
    check(await until('ask', () => app.texts().toLowerCase().includes('a widget wants to send this to claude'), 20), 'a widget that sends on its own is asked about');
    await sleep(800);
    check(stub.sends.length === 1, 'the widget with no click sent nothing');
    await app.both('widget-ask');
    app.press('Cancel');
    check(await until('gone', () => !app.texts().toLowerCase().includes('a widget wants to send this to claude'), 10), 'Cancel closes the bar');
    check(stub.sends.length === 1, 'cancelling sent nothing');

    app.chooseRow(rowOf(stub, 'widgets'));
    check(await until('probe', () => app.texts().includes('webkit: undefined, top: blocked'), 20), 'the widget sees no bridge and cannot reach the app page');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the chat stub');
  } finally {
    await app.quit();
    stub.stop();
  }
}

// The composer, against the chat stub: quoting, attachments, the slash menu, an error, Stop, the pickers and the New Session screen.
async function composerFlow(bundle, appearance) {
  const stub = await startChatStub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-composer-'));
  makePng(path.join(dir, 'screenshot.png'));
  fs.writeFileSync(path.join(dir, 'release-notes.txt'), 'Release notes for 4.2\n');
  console.log(`\n== ${appearance}: composer`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '7' });
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('rows', () => app.rows() === stub.rows.length), 'the composer stub lists its chats');

    // A quote from another session, then one from this one.
    app.chooseRow(rowOf(stub, 'other'));
    check(await until('other', () => app.hasText('Draft the release notes for 4.2.'), 20), 'the other chat opens');
    await sleep(800);
    if (!check(app.quote('three headline changes'), 'the message to quote is found and its menu picked')) app.dump();
    app.chooseRow(rowOf(stub, 'composer'));
    check(await until('composer chat', () => app.hasText('Rename `exportRows` to `exportTable` everywhere.') || app.hasText('Rename exportRows to exportTable everywhere.'), 20), 'the composer chat opens');
    await sleep(800);
    check(app.hasText('From Plan the release notes'), 'the quote chip names the session it came from');
    check(app.quote('renamed it in 4 files'), 'a second message to quote is found and its menu picked');
    await app.both('composer-quote');

    // Attachments, then a two-line draft.
    app.setComposer('');
    app.attachFile(path.join(dir, 'screenshot.png'));
    check(await until('image chip', () => app.hasButtonLike('Remove screenshot.png'), 10), 'an attached picture becomes a chip');
    await sleep(800);
    app.attachFile(path.join(dir, 'release-notes.txt'));
    check(await until('file uploaded', () => stub.calls.upload.length === 1, 10), 'an attached file is uploaded');
    app.setComposer('Rename it in the docs too');
    await app.keys('shift-return');
    app.type('and keep the alias for one release');
    await sleep(600);
    check(app.composerText().includes('\n'), 'Shift+Enter makes a new line');
    await app.both('composer-draft');

    // The slash menu.
    app.setComposer('/c');
    await until('slash text', () => app.composerText() === '/c', 10);
    await sleep(600);
    await app.both('composer-slash');
    // The list's rows are not in the accessibility tree, so Tab picking the first one shows it was open.
    await app.keys('tab');
    check(app.composerText().startsWith('/compact '), 'Tab picks the highlighted command');
    app.setComposer('/c');
    await sleep(500);
    await app.keys('escape', 'tab');
    check(app.composerText() === '/c', 'Escape closes the slash menu, so Tab picks nothing');
    app.setComposer('');

    // A refused send keeps everything in the box.
    app.setComposer('reject this one');
    check(app.press('Send'), 'Send is pressed');
    check(await until('error', () => app.hasText('Not sent: That message is too long for this session.'), 10), 'a refused send shows the server\'s sentence');
    check(app.composerText() === 'reject this one', 'a refused send puts the text back');
    await sleep(400);
    app.resize(MIN_SIZE);
    await sleep(1000);
    const errorGaps = app.composerGaps();
    if (!check(errorGaps.length === 0, `the composer stays whole with an error, chips and a draft at the smallest window${errorGaps.length ? ` (missing or cut off: ${errorGaps.join(', ')})` : ''}`)) console.log(app.tree().filter(n => n.pos && n.size && (n.pos[0] > 640 || n.path.length === 0)).map(n => `${n.role} ${n.desc ?? ''} ${n.pos} ${n.size} ${n.path.join('.')}`).join('\n'));
    await app.both('composer-error');
    app.setComposer('');

    // A good send lands in the thread and the box empties.
    app.setComposer('Thanks, that is all');
    check(app.press('Send'), 'Send is pressed again');
    check(await until('sent', () => stub.calls.send.length === 2 && app.hasText('Got it.'), 10), 'a send reaches the server and its reply lands in the thread');
    const sent = stub.calls.send[1];
    check(sent.images?.length === 1 && sent.images[0].mediaType === 'image/png' && !sent.images[0].data.startsWith('data:'), 'the picture goes inline as raw base64');
    check(JSON.stringify(sent.files) === '["up-1"]', 'the uploaded file goes as its id');
    check(/^> /m.test(sent.text) && sent.text.includes('From the session "Plan the release notes":') && sent.text.endsWith('Thanks, that is all'), 'the quotes lead the text');
    check(app.composerText() === '', 'the box is empty after a send');

    // Pickers.
    const items = app.buttonMenuItems('Model: ');
    if (!check(items.includes('Haiku 5.5'), 'the model menu lists the models')) { console.log(items); app.dump(); }
    app.closeMenu();
    await sleep(400);

    // A stack of approval cards above a tall composer, at the smallest window.
    app.chooseRow(rowOf(stub, 'ask-two'));
    check(await until('cards', () => app.hasText('Bash wants to run a command'), 20), 'the chat with three prompts opens');
    app.attachFile(path.join(dir, 'screenshot.png'));
    check(await until('picture chip', () => app.hasButtonLike('Remove screenshot.png'), 10), 'a picture is attached under the cards');
    app.attachFile(path.join(dir, 'release-notes.txt'));
    check(await until('file chip', () => app.hasButtonLike('Remove release-notes.txt'), 10), 'a file is attached under the cards');
    app.setComposer('Run it once the checks pass');
    app.resize(MIN_SIZE);
    await sleep(1000);
    const gaps = app.composerGaps();
    if (!check(gaps.length === 0, `the composer stays whole under the cards at the smallest window${gaps.length ? ` (missing or cut off: ${gaps.join(', ')})` : ''}`)) app.dump();
    await app.both('composer-approval');
    app.setComposer('');
    for (const chip of app.buttonsLike('Remove ')) app.act(chip);

    // Stop on a busy chat.
    app.chooseRow(rowOf(stub, 'stream'));
    check(await until('stream', () => app.hasText('Go on, I am ready.'), 20), 'the busy chat opens');
    await sleep(3000);
    check(app.hasButtonLike('Stop'), 'a busy chat with an empty box shows Stop');
    await app.both('composer-busy');
    check(app.press('Stop'), 'Stop is pressed');
    check(await until('stopped', () => stub.calls.stop.length === 1, 10), 'Stop stops a busy chat');

    // New Session.
    check(app.menu('File', 'New Session') || app.press('New Session'), 'New Session is opened from the File menu or the toolbar');
    check(await until('new screen', () => app.hasText('New session'), 10), 'New Session opens');
    check(await until('folders', () => app.composerText() === '' && app.hasButtonLike('Recent folders'), 10), 'the folder menu loads');
    await sleep(1000);
    await app.both('new-session');
    app.setComposer('Add a dark mode toggle');
    check(app.press('Start session'), 'Start session is pressed');
    check(await until('started', () => stub.calls.created.length === 1, 10), 'Start session starts the session');
    check(stub.calls.created[0].cwd.length > 0 && stub.calls.created[0].model === undefined, 'the new session sends a folder and no unchanged model');
    check(await until('opened', () => !app.hasText('New session') || app.hasText('Add a dark mode toggle'), 10), 'the new session opens');
    app.signOutFromMenu();
    check(await until('signed out', () => app.hasText('Address'), 10), 'signed out of the composer stub');
  } finally {
    await app.quit();
    stub.stop();
  }
}

async function mainFlow(bundle, appearance, withChat) {
  const server = await startScratch({ claude: withChat });
  servers.add(server);
  const pictureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-real-'));
  makePng(path.join(pictureDir, 'colours.png'));
  const app = new App(bundle, { address: server.address, appearance, tag: '1', notify: true });
  let draftToKeep = '';
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
      const finished = await waitFinished(server, token, id, 90);
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

      // The composer against a real Haiku chat: a draft survives a switch, then a message with a picture is sent and lands.
      const prompt = 'In five words, name the main colours of this picture.';
      app.focusComposer();
      app.type(prompt);
      await sleep(500);
      app.chooseRow(1);
      await sleep(1200);
      app.chooseRow(0);
      check(await until('draft back', () => app.composerText() === prompt, 10), 'a draft is still in the box after switching sessions');
      app.setComposer('');
      app.attachFile(path.join(pictureDir, 'colours.png'));
      check(await until('picture chip', () => app.hasButtonLike('Remove colours.png'), 10), 'an attached picture becomes a chip in a real chat');
      await sleep(800);
      app.focusComposer();
      app.type(prompt);
      await sleep(500);
      await app.both('composer-real-draft');
      check(app.press('Send'), 'Send is pressed in a real chat');
      // The scratch server reads a copy of Claude's transcript, so the copy is refreshed while the window waits for the message.
      let copied = 0;
      const landed = await until('landed', () => { if (Date.now() - copied > 3000) { copyTranscript(server, id); copied = Date.now(); } return app.texts().split('\n').some(line => line.includes(prompt)); }, 30);
      await app.shot('1-composer-real-sent-soon');
      check(landed, 'the sent message lands in the thread');
      check(await waitFinished(server, token, id, 90), 'the chat answers the message');
      await sleep(4000);
      copyTranscript(server, id);
      app.chooseRow(1);
      await sleep(800);
      app.chooseRow(0);
      await sleep(1500);
      await app.shot('1-composer-real-sent-done');
      await app.both('chat-real-after-send');
      const transcript = fs.readFileSync(path.join(os.homedir(), '.claude', 'projects', TEST_CWD.replace(/[/.]/g, '-'), `${id}.jsonl`), 'utf8');
      check(transcript.includes('"type":"image"'), 'the transcript holds the picture Claude was sent');
      app.focusComposer();
      app.type('a draft to keep');
      await sleep(500);
      draftToKeep = 'a draft to keep';
      await ownerCall(server, 'logout', undefined, token);
    }

    const posted = app.alerts().filter(line => line.startsWith('post ')).length;
    await app.quit();
    process.kill(server.pid, 'SIGSTOP');
    await app.launch();
    await sleep(1500);
    check(!app.hasButton('Sign in') && !app.texts().includes('Address'), 'a relaunch stays signed in');
    await app.both('loading');
    process.kill(server.pid, 'SIGCONT');
    check(await until('rows', () => app.sessionRows().length === (withChat ? 9 : 8), 20), 'the list loads once the server answers');
    await sleep(1500);
    check(app.alerts().filter(line => line.startsWith('post ')).length === posted, 'a relaunch raises no alerts for sessions that finished while it was closed');
    if (draftToKeep) {
      app.chooseRow(0);
      check(await until('kept draft', () => app.composerText() === draftToKeep, 15), 'a draft survives a relaunch');
      await app.both('composer-relaunched');
    }

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
  const app = await appOn(stub, bundle, appearance, '6');
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

// Organising from the sidebar: a new group, a row's menu, a rename field, a selection of three, a move into the group, and deleting the group.
async function organiseFlow(bundle, appearance) {
  console.log(`\n== ${appearance}: organise sessions, groups and selections`);
  const server = await startScratch();
  servers.add(server);
  const app = new App(bundle, { address: server.address, appearance, tag: '8' });
  try {
    await app.launch();
    app.type(readPassword(server));
    app.submit();
    check(await until('rows', () => app.sessionRows().length === 8), 'signing in shows the 8 seeded sessions');
    const before = app.headings();

    check(app.press('New group'), 'the toolbar has a New group button');
    check(await until('sheet', () => !!app.sheet()), 'New group asks for a name in a sheet');
    check(app.fillSheet('Release work'), 'the sheet takes the name');
    await app.both('new-group-sheet');
    check(app.press('Save'), 'Save is pressed in the sheet');
    check(await until('made', () => app.headings() === before + 1 && !app.sheet()), 'the new group shows as a heading straight away');

    const items = app.menuItems('row', 0);
    console.log('row menu:', items.join(' | '));
    check(['Rename', 'Move to', 'Pin', 'Archive'].every(name => items.some(item => item.startsWith(name))), 'a session row menu offers rename, move, pin and archive');
    check(app.rowMenu('row', 0, 'Rename\u2026'), 'Rename is pressed in the row menu');
    check(await until('rename', () => app.texts().includes('Rename session')), 'Rename opens a field holding the title');
    await app.both('rename-field');
    check(app.press('Cancel') && await until('closed', () => !app.sheet()), 'Cancel closes the rename field');

    check(app.selectRows(0, 1, 2) && await until('selected', () => app.selectedCount() === 3), 'three rows can be selected together');
    await app.both('multi-selection');
    const bulk = app.menuItems('row', 1);
    console.log('selection menu:', bulk.join(' | '));
    check(bulk.some(item => item.startsWith('Archive 3 sessions')), 'a row inside the selection offers the bulk archive');

    check(app.rowMenu('row', 1, 'Move to', 'Release work'), 'Move to Release work is pressed in the selection menu');
    check(await until('moved', () => app.sessionRows().length === 8 && app.headings() === before + 1), 'moving three rows into the group keeps all eight rows');
    await app.both('moved-into-group');

    check(app.rowMenu('heading', 'Release work', 'Delete group\u2026'), 'Delete group is pressed in the heading menu');
    check(await until('ask', () => app.texts().includes('3 sessions become ungrouped')), 'Delete group asks first, naming the group and its three sessions');
    await app.both('delete-group-confirm');
    check(app.press('Delete group'), 'the question is confirmed');
    check(await until('gone', () => app.headings() === before && !app.texts().includes('Release work')), 'the group is gone and its sessions stay');
    await app.both('after-delete');

    const views = app.viewItems();
    console.log('view menu:', views.join(' | '));
    check(views.some(item => item.startsWith('New project')), 'the View menu offers New project');
    app.signOutFromMenu();
  } finally {
    await app.quit();
    await server.stop();
  }
}

// The routine and scheduled screens against a stub with fixed data: a heading with only idle routines, a loose idle routine, a routine with a run,
// a pending and a skipped scheduled session. Every write is recorded and refused, so no real routine is made, changed, started or deleted.
// Never point this at a real server: a Run now there starts a real session.
async function routinesFlow(bundle, appearance) {
  console.log(`\n== ${appearance}: routines, scheduled sessions, idle routine rows, a refused save`);
  const { server: stub, writes } = routinesStub();
  const app = await appOn(stub, bundle, appearance, '9');
  const sees = text => app.texts().includes(text);
  const hovers = () => app.sessionRows().map(([, help]) => help);
  const hasRow = start => hovers().some(help => help.startsWith(start));
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    // Home: Scheduled, Routines, Release and Ungrouped. The idle rows are plain buttons with their words as hover text.
    check(await until('home', () => app.headings() >= 4 && hasRow('Weekly report:') && hasRow('Old backup:')), 'Home lists the idle routines under Routines');
    // Scheduled loads on its own fetch, so it can land after the routines.
    check(await until('scheduled', () => hasRow('Draft the release notes:') && hasRow('Rotate the keys:') && !hasRow('Archive the old logs:')), 'Scheduled lists the pending and skipped sessions and not the started one');
    await app.both('sidebar-routines');

    // A routine in a project shows in that project's view, above Pinned, and counts once: the Launch session and Deploy check make 2.
    check(app.pickView('Website (2)'), 'the View menu counts the Website project at 2');
    check(await until('project routines', () => app.headings() === 3), 'the Website view lists Routines, Pinned and Launch');
    check(!hasRow('Weekly report:') && !hasRow('Old backup:'), 'the Website view leaves out the routines that have no project');
    await app.both('project-routines');
    check(app.pickView('Home'), 'Home is in the View menu');
    check(await until('home again', () => hasRow('Weekly report:')), 'Home lists its routines again');

    check(app.pick('View', 'Manage routines'), 'Manage routines is in the view menu');
    check(await until('routines', () => sees('Weekdays at 07:30') && sees('Off')), 'the Routines page lists the routines');
    await app.both('routines-list');

    check(app.press('Weekly report', { prefix: true }), 'an idle routine in the sidebar can be pressed');
    check(await until('form', () => sees('The full path of the folder each run starts in.')), 'the routine form opens');
    await sleep(1200);
    await app.both('routine-form');

    check(app.press('Save'), 'Save is in the toolbar');
    check(await until('back', () => !sees('The full path of the folder each run starts in.') && sees('Weekdays at 07:30')), 'saving with nothing changed goes back to the list');
    await sleep(1000);
    check(writes.length === 0, 'saving with nothing changed makes no call');

    check(app.press('Weekly report', { prefix: true }) && await until('form again', () => sees('The full path of the folder each run starts in.')), 'the routine form opens again');
    await sleep(1000);
    check(app.replaceField('Weekly report', 'Weekly report, Mondays'), 'the title can be changed');
    check(app.press('Save'), 'Save is in the toolbar again');
    check(await until('refused', () => sees('Use five fields, such as 30 7 * * 1-5.')), 'a refused save shows the server\'s message on the field');
    check(writes.length === 1 && writes[0].method === 'PATCH' && Object.keys(writes[0].body).join() === 'title', 'the save sent only the title and not the schedule');
    await sleep(500);
    await app.both('routine-refused');
    check(app.press('Cancel'), 'Cancel is in the toolbar');

    check(app.pick('View', 'Manage scheduled sessions'), 'Manage scheduled sessions is in the view menu');
    check(await until('scheduled', () => sees('Archive the old logs')), 'the Scheduled page lists the sessions');
    await app.both('scheduled-list');

    check(app.press('Quarterly review', { prefix: true }), 'a pending row in the sidebar can be pressed');
    check(await until('scheduled form', () => sees('The session is called this.')), 'the scheduled form opens');
    await sleep(1000);
    await app.both('scheduled-form');
    check(app.press('Save') && await until('scheduled back', () => !sees('The session is called this.')), 'saving a scheduled session with nothing changed goes back');
    await sleep(1000);
    check(writes.length === 1, 'saving a scheduled session with nothing changed makes no call');

    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the routines stub');
  } finally {
    await app.quit();
    stub.closeAllConnections();
    stub.close();
  }
}

async function filesFlow(bundle, appearance) {
  const stub = await startFilesStub();
  console.log(`\n== ${appearance}: linked files and pictures`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '10' });
  const opens = async (what, link, shown, seconds = 20) => {
    check(app.clickLink(link), `${what} has a link`);
    return check(await until(what, () => app.hasText(shown), seconds), `${what} opens`);
  };
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('rows', () => app.rows() === stub.rows.length), 'the files stub lists its chat');
    app.chooseRow(rowOf(stub, 'files'));
    check(await until('chat', () => app.hasText('All five match the notes.'), 20), 'the files chat shows its last message');
    await sleep(1200);

    // The tool result's pictures sit at the end of the chat, and the last tile reads "+2".
    await app.shot(`10-tool-tiles-${appearance}`);
    check(app.clickTile(0), 'the first tool tile is there');
    check(await until('viewer', () => app.hasText('3 of 7'), 15), 'a tool tile opens the viewer on the whole chat\'s pictures');
    await sleep(800);
    await app.shot(`10-viewer-tool-${appearance}`);
    check(app.press('Next image'), 'the viewer has a Next image button');
    check(await until('next', () => app.hasText('4 of 7'), 10), 'the viewer steps to the next picture');
    await sleep(600);
    await app.shot(`10-viewer-next-${appearance}`);
    check(app.press('Close'), 'the viewer has a Close button');
    check(await until('viewer closed', () => !app.hasText('4 of 7'), 10), 'Close closes the viewer');

    // The message the person sent, with two pictures and a file.
    app.scrollChat(0);
    await sleep(1000);
    await app.shot(`10-attachments-${appearance}`);

    await opens('a markdown file', 'NOTES.md:14', 'Upload notes');
    await sleep(800);
    // A file opened at a line shows its source, so the toggle offers the rendered view.
    await app.both('file-markdown');
    check(app.press('Show rendered'), 'a markdown file at a line offers its rendered view');
    await sleep(800);
    await app.shot(`10-file-markdown-rendered-${appearance}-default`);

    await opens('a text file at a line', 'server.js:42', 'const RETRIES = 5;');
    await sleep(800);
    await app.both('file-text-line');

    check(app.clickLink('report.pdf'), 'the PDF has a link');
    await sleep(2500);
    await app.shot(`10-file-pdf-${appearance}-default`);

    check(app.clickLink('intro.wav'), 'the audio clip has a link');
    check(await until('clips', () => app.hasText('1 of 2'), 15), 'an audio file lists the chat\'s clips');
    await sleep(600);
    await app.both('file-audio');

    await opens('a binary file', 'archive.zip', 'ZIP file');
    await sleep(600);
    await app.shot(`10-file-binary-${appearance}-default`);

    await opens('a missing file', 'gone.txt', 'There is no file at that path.');
    await sleep(600);
    await app.shot(`10-file-missing-${appearance}-default`);
    check(!app.hasText('Cannot open this file'), 'a missing file is a note in the panel, not an alert');

    // A save after the file changed on disk meets the server's 409.
    await opens('a markdown file again', 'NOTES.md:14', 'Upload notes');
    check(app.press('Edit'), 'a markdown file can be edited');
    await sleep(800);
    await app.shot(`10-file-editing-${appearance}-default`);
    check(app.focusFileText(), 'the editor takes the text');
    app.type('x');
    stub.touch('/work/example/NOTES.md');
    check(app.press('Save'), 'the editor has a Save button');
    check(await until('conflict', () => app.hasText('This file changed on disk after you opened it, so nothing was saved.'), 15), 'a stale save says the file changed');
    await sleep(600);
    await app.shot(`10-file-conflict-${appearance}-default`);
    // Keep editing leaves the draft in place. Drafts live in memory only.
    check(app.press('Keep editing'), 'the conflict alert has a Keep editing button');
    await sleep(800);

    app.signOutFromMenu();
    check(await until('signed out', () => app.hasText('Address'), 10), 'signed out of the files stub');
  } finally {
    await app.quit();
    stub.stop();
  }
}


// Group chats and session cards. The stub holds sessions in every part, pull requests in two states, a chat with suggested tasks, a first Start that fails
// and a reply the server refuses. Nothing here touches a real server.
async function groupsFlow(bundle, appearance) {
  console.log(`\n== ${appearance}: group heading, sub sessions panel, cards, reply box, chips`);
  const stub = await startGroupStub();
  const app = new App(bundle, { address: stub.address, appearance, tag: '11' });
  const sees = text => app.texts().includes(text) || app.hasButton(text);
  try {
    await app.launch();
    app.type('whatever');
    app.submit();
    check(await until('heading button', () => app.headingButton('Open the Release chat'), 20), 'the Release heading has its chat button');
    await app.both('sidebar-heading');

    // A press on the heading itself folds the section and opens no chat, as it did before the chat button.
    check(app.act(app.headingButton('Open the Release chat')) && await until('folded', () => app.sessionRows().length < 6, 5) && !sees('Draft the release notes, Waiting on you'), 'pressing the heading folds its section and opens no chat');
    check(app.act(app.headingButton('Open the Release chat')) && await until('unfolded', () => app.sessionRows().length >= 6, 5), 'pressing it again opens the section');
    check(app.pressHeadingButton('Open the Release chat'), 'the heading button opens the group');
    await sleep(800);
    check(await until('fold', () => app.sessionRows().length >= 6, 5), 'the Release section stays open after its chat button is pressed');
    check(await until('panel', () => sees('Draft the release notes, Waiting on you') && sees('Write the changelog, Working'), 20), 'the panel shows a waiting card and a working card');
    check(sees('Add the audit log, Waiting on you'), 'a pull request that needs a review counts as waiting on you');
    check(sees('Fix the flaky build, Idle') || sees('Fix the flaky build, Unread'), 'a merged pull request session is in the panel');
    check(await until('chat', () => app.texts().includes('Two things are left. I have split them into tasks you can start from here.'), 20), 'the group chat is beside the panel');
    await sleep(800);
    await app.both('view');

    check(app.press('Details of Fix the flaky build'), 'a card opens its details');
    check(await until('details', () => app.texts().includes('npm run build && npm test'), 15), 'the details show the latest reply, code block included');
    // The card is the fifth, so the panel is scrolled to show it. The panel's bar is the last vertical one, which scrollChat finds.
    app.scrollChat(1);
    await sleep(500);
    await app.both('details');
    app.scrollChat(0);
    check(app.press('Details of Fix the flaky build'), 'the details close again');

    // The press is answered with an error as the card redraws, so the box opening is the check.
    app.press('Reply to Draft the release notes');
    check(await until('note', () => app.texts().includes("It's waiting on a card in its chat, so this reaches it after you answer that."), 10), 'the reply box says the session is waiting on a card');
    check(!!app.find(node => node.role === 'AXTextArea' && node.desc === 'Message to Draft the release notes') && app.set(app.find(node => node.role === 'AXTextArea' && node.desc === 'Message to Draft the release notes'), 'AXFocused', true), 'the reply box takes focus');
    app.type('Go ahead with the tests.');
    check(app.press('Send'), 'Send is pressed');
    check(await until('refused', () => app.texts().includes('Not sent: That session is busy with another reply.'), 10), 'a refused reply shows Not sent with the reason');
    await app.both('reply-error');
    check(stub.calls.some(call => call.startsWith('/api/sessions/s-wait/send') && call.includes('"text":"Go ahead with the tests."') && !call.includes('mode')), 'the reply was sent as text with no mode');

    // The chat is beside the panel at the default size only.
    app.resize(DEFAULT_SIZE);
    await sleep(700);
    check(await until('chips', () => app.hasButton('Start') && app.texts().includes('Started'), 15), 'an open chip shows Start and a started chip says Started');
    await app.shot(`${app.tag}-chip-open-${appearance}-default`);
    check(app.press('Start'), 'Start is pressed');
    check(await until('chip error', () => app.texts().includes('Not done: This chip has no prompt or folder to start from.'), 10), 'a failed start shows its reason and keeps the buttons');
    await app.shot(`${app.tag}-chip-error-${appearance}-default`);
    check(app.press('Start') && await until('chip started', () => !app.hasButton('Start'), 10), 'the second Start settles the chip as started');
    check(stub.calls.filter(call => call.startsWith('/api/chips/start')).length === 2, 'Start was posted twice');
    await app.shot(`${app.tag}-chip-started-${appearance}-default`);
  } finally {
    await app.quit();
    stub.stop();
  }
}

// The terminal panel under a chat. The stub answers the terminal routes and records each call, so Run, Stop and a typed line are checked on the wire.
async function terminalFlow(bundle, appearance) {
  const stub = await startChatStub();
  console.log(`\n== ${appearance}: the terminal`);
  const app = new App(bundle, { address: stub.address, appearance, tag: '12' });
  const toggle = () => app.find(node => node.role === 'AXButton' && app.label(node) === 'Terminal');
  const input = () => app.find(node => ['AXTextField', 'AXTextArea'].includes(node.role) && /^(Send to|Command in|That command)/.test(node.desc ?? ''));
  const called = (route, test) => stub.requests.some(r => r.route === route && test(r.body));
  try {
    await signInToChatStub(app, stub);

    app.chooseRow(rowOf(stub, 'term'));
    const hasRun = await until('term', () => app.hasButton('Run in terminal'), 20);
    check(hasRun, 'a command block shows its Run button');
    check(toggle()?.enabled === true, 'the Terminal toggle is on in a chat that has a terminal');
    check(app.hasButton('Run in terminal, unavailable because the block holds hidden characters'), 'a block with a hidden character shows a Run button that is off');
    await sleep(800);
    await app.both('term-chat');
    app.scrollChat(0);
    await sleep(1200);
    await app.both('term-blocks-top');
    app.scrollChat(1);
    await sleep(1200);
    await app.both('term-blocks-end');

    check(app.press('Terminal'), 'the toolbar has a Terminal button');
    check(await until('panel', () => app.hasText('npm run dev'), 20), 'the terminal panel shows its runs');
    check(app.hasButton('Stop command'), 'a running command has a Stop button');
    check(await until('bottom', () => (app.terminalBar()?.value ?? 0) > 0.95, 10), 'the panel opens scrolled to its last output');
    check(app.hasText('localhost:5173'), 'the last run\'s output is in the panel');
    await sleep(1200);
    await app.both('term-panel');
    app.resize(MIN_SIZE);
    await sleep(2500);
    await app.shot(`${app.tag}-term-panel-min-settled-${appearance}`);
    app.resize(DEFAULT_SIZE);
    await sleep(1200);
    app.scrollThread(0);
    await sleep(1200);
    await app.shot(`${app.tag}-term-panel-thread-top-${appearance}`);

    check(app.press('Run in terminal'), 'a block can be run');
    check(await until('ran', () => called('run', body => body.source === 'block' && body.command === 'npm test -- upload'), 10), 'the Run button sends the block as a block run');
    await sleep(1200);
    await app.both('term-after-run');

    const field = await until('input', () => input(), 10) && input();
    check(!!field, 'the panel has its input line');
    // A key press needs the app in front, so the line is set through accessibility and sent with the panel's own Send line button.
    check(!!field && app.set(field, 'AXFocused', true) && app.set(field, 'AXValue', 'echo hi'), 'a line is typed into the input');
    await sleep(600);
    await app.both('term-typed');
    check(app.press('Send line'), 'the Send line button is pressed');
    // The fixture's last run is still going, so the line goes to it as input and no command starts.
    check(await until('typed', () => called('input', body => body.run === 'r3' && body.text === 'echo hi\n'), 10), 'a typed line is sent to the running command as input');
    await sleep(1200);
    await app.both('term-after-input');

    check(app.press('Stop command'), 'Stop is pressed');
    check(await until('stopped', () => called('stop', body => body.run === 'r3'), 10), 'Stop sends the running command\'s id');
    await sleep(1200);
    await app.both('term-after-stop');

    // The file panel is the inspector beside the thread and the terminal sits under the thread, so both can be open and each keeps its controls.
    check(app.clickLink('NOTES.md'), 'the reply has a file link');
    check(await until('file', () => app.hasText('Run the upload test, then the build.'), 15), 'the file opens in its panel');
    await sleep(1200);
    check(!!input() && !!toggle() && app.hasButton('Hide file'), 'the terminal input and both toolbar buttons are there with the file panel open');
    await app.both('term-with-file');

    app.chooseRow(rowOf(stub, 'rich'));
    check(await until('rich', () => app.hasText('Why is the upload test flaky? It fails about one run in five.'), 20), 'a chat with no terminal opens');
    check(toggle()?.enabled === false, 'the Terminal toggle is off in a chat that has no terminal');
    await sleep(800);
    await app.both('term-toggle-off');
    app.signOutFromMenu();
    check(await until('signed out', () => app.texts().includes('Address'), 10), 'signed out of the chat stub');
  } finally {
    await app.quit();
    stub.stop();
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
  const bundle = await withLock(BUILD_LOCK, () => {
    const built = build({ release: false });
    compileHelper();
    return built;
  });
  const flows = argv.includes('--files-only') ? ['files'] : argv.includes('--approvals-only') ? ['approvals'] : argv.includes('--widgets-only') ? ['widgets'] : argv.includes('--chats-only') ? ['chats', 'widgets'] : FLOW ? FLOW : FLOWS.filter(flow => flow !== 'files' || !argv.includes('--no-files'));
  for (const appearance of APPEARANCES) {
    if (flows.includes('main')) {
      await mainFlow(bundle, appearance, !argv.includes('--no-chat'));
      await emptyAndLocked(bundle, appearance);
      await badAddresses(bundle, appearance);
    }
    if (flows.includes('marks')) await marks(bundle, appearance);
    if (flows.includes('chats')) await chatFlow(bundle, appearance);
    if (flows.includes('widgets')) await widgetFlow(bundle, appearance);
    if (flows.includes('accounts')) await accountsFlow(bundle, appearance);
    if (flows.includes('approvals')) await approvalsFlow(bundle, appearance);
    if (flows.includes('organise')) await organiseFlow(bundle, appearance);
    if (flows.includes('routines')) await routinesFlow(bundle, appearance);
    if (flows.includes('files')) await filesFlow(bundle, appearance);
    if (flows.includes('groups')) await groupsFlow(bundle, appearance);
    if (flows.includes('terminal')) await terminalFlow(bundle, appearance);
    if (flows.includes('composer')) await composerFlow(bundle, appearance);
  }
  // watch() has already failed a check for each app that came forward.
  if (!cameToFront.length) check(true, `no test app came to the front (${frontChecks} samples)`);
  const sounds = await speakers.heard(launched).catch(error => [error.message]);
  check(!sounds.length, `no test app made a sound (${launched.size} apps)${sounds.map(line => `\n    ${line}`).join('')}`);
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
