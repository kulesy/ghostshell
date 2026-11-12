#!/usr/bin/env node
// Builds and drives the iPhone app in the Simulator. Nothing here opens the Simulator window or takes the keyboard: simulators are booted with
// `simctl boot` and the UI tests run through xcodebuild, so the run can go on while the Mac is in use.
//   node apple/scripts/iphone.mjs build [--release]
//   node apple/scripts/iphone.mjs shot [--out <folder>] [--device se|16pro] [--only light|dark] [--test <name>[,<name>...]]
// A Debug build is for the Simulator. A Release build is for a device with signing off, then searched for the Debug hooks like the Mac one.
// Tests run against a stub in front of the chat stub, never port 4310 and never ~/.config/capcom.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire } from '../../lib/lock.mjs';
import { checkNoHooks } from './build.mjs';
import { startChatStub } from './chat-fixtures.mjs';
import { startFilesStub } from './files-fixtures.mjs';
import { startGroupStub } from './group-fixtures.mjs';
import { makePng } from './png.mjs';
import { routinesStub } from './routines-fixtures.mjs';
import { startScratch } from './test-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apple = path.resolve(here, '..');
const PROJECT = path.join(apple, 'GhostShell.xcodeproj');
const DERIVED = path.join(apple, 'build', 'ios');
// The app passes its UI tests on iOS 27.2, the runtime the Actions runner has. Set GS_IOS_RUNTIME to try another, such as ...SimRuntime.iOS-18-6.
const RUNTIME = process.env.GS_IOS_RUNTIME || 'com.apple.CoreSimulator.SimRuntime.iOS-27-2';
const DEVICES = {
  se: { name: 'iPhone SE (3rd generation)', type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation' },
  '16pro': { name: 'iPhone 16 Pro', type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro' },
};

const argv = process.argv.slice(2);
const command = argv[0];
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : undefined);
// One run boots Simulators at a time on the Mac, whichever worktree it is in.
const SIMULATOR_LOCK = '/tmp/ghostshell-simulator.lock';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function xcodebuild(args, label) {
  const r = spawnSync('xcodebuild', ['-project', PROJECT, '-scheme', 'GhostShelliPhone', '-derivedDataPath', DERIVED, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(r.stdout.split('\n').filter(l => /error:|BUILD FAILED|TEST FAILED/.test(l)).join('\n') || r.stderr);
    throw new Error(`The ${label} failed.`);
  }
  return r.stdout;
}

// No -sdk here: it would override the watch app's SDK too, and the watch app is built into this one.
function build({ release }) {
  if (!release) {
    xcodebuild(['-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', 'build'], 'Simulator Debug build');
    return path.join(DERIVED, 'Build', 'Products', 'Debug-iphonesimulator', 'GhostShelliPhone.app');
  }
  xcodebuild(['-configuration', 'Release', '-destination', 'generic/platform=iOS', 'CODE_SIGNING_ALLOWED=NO', 'build'], 'iOS Release build');
  const app = path.join(DERIVED, 'Build', 'Products', 'Release-iphoneos', 'GhostShelliPhone.app');
  // The bundle is flat, so its binaries are the executable and any dylib beside it.
  const files = [path.join(app, 'GhostShelliPhone'), ...fs.readdirSync(app).filter(n => n.endsWith('.dylib')).map(n => path.join(app, n))];
  checkNoHooks(app, files);
  return app;
}

// MARK: Simulators

const simctl = (...args) => spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });

// Each worktree gets its own simulators, named with a short hash of the repo path, so two runs never drive the same device.
const WORKTREE = crypto.createHash('sha1').update(path.resolve(apple, '..')).digest('hex').slice(0, 6);

function findOrCreate({ name: base, type }) {
  if (!JSON.parse(simctl('list', 'runtimes', '-j').stdout).runtimes.some(r => r.identifier === RUNTIME && r.isAvailable)) {
    throw new Error(`The ${RUNTIME} runtime is not installed. Install it with \`xcodebuild -downloadPlatform iOS\`, or set GS_IOS_RUNTIME to one that is.`);
  }
  const name = `${base} (${WORKTREE})`;
  const list = JSON.parse(simctl('list', 'devices', '-j', 'available').stdout).devices[RUNTIME] ?? [];
  const found = list.find(d => d.name === name);
  if (found) return found.udid;
  const made = simctl('create', name, type, RUNTIME);
  if (made.status !== 0) throw new Error(`Could not create the ${name} simulator: ${made.stderr}`);
  console.log(`Created the ${name} simulator.`);
  return made.stdout.trim();
}

// `boot` starts the device without a window, and `bootstatus -b` waits until it is usable. Simulator.app is never opened.
function boot(udid) {
  const state = JSON.parse(simctl('list', 'devices', '-j').stdout).devices[RUNTIME].find(d => d.udid === udid)?.state;
  if (state !== 'Booted') simctl('boot', udid);
  // A runner's first boot of a fresh device can take over four minutes.
  const r = spawnSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { encoding: 'utf8', timeout: 600_000 });
  if (r.status !== 0) throw new Error(`The simulator ${udid} did not boot.`);
  // The keyboard's sliding-to-type card would cover the first screen after each fresh simulator.
  simctl('spawn', udid, 'defaults', 'write', 'com.apple.keyboard.preferences', 'DidShowContinuousPathIntroduction', '-bool', 'true');
  // The composer's photo picker needs a picture to choose.
  const photo = path.join(DERIVED, 'test-photo.png');
  fs.mkdirSync(DERIVED, { recursive: true });
  if (!fs.existsSync(photo)) makePng(photo, 200);
  simctl('addmedia', udid, photo);
}

// MARK: Servers

// The chat stub does not know the accounts, banners or passkeys routes, and answers an approval with 404. This sits in front of it, answers those,
// forwards the rest, and keeps what the tests need to read: the widget sends and the approval decisions.
// `empty` serves no accounts and no passkeys, for the empty states.
function startFixtures(stub, { empty = false } = {}) {
  const day = 86_400_000;
  const now = Date.now();
  const work = { id: 'work', name: 'Work' };
  const personal = { id: 'personal', name: 'Personal' };
  const chrome = { state: 'elsewhere', to: personal, on: work, email: 'me@example.com' };
  const limits = [
    { kind: 'session', percent: 62, resetsAt: new Date(now + 95 * 60_000).toISOString(), severity: 'normal' },
    { kind: 'weekly_all', percent: 84, resetsAt: new Date(now + 2 * day).toISOString(), severity: 'warning' },
  ];
  const accounts = {
    autoSwitch: true, waiting: false, chrome,
    accounts: [
      { id: 'work', name: 'Work', stage: 'idle', signedOut: false, endsAt: now + 20 * day, email: 'me@example.com', planType: 'Max', active: true,
        plan: { limits, at: now }, pinned: { sessions: 2 }, chats: [{ id: 'rich', title: 'Fix the flaky upload test', state: 'working' }] },
      { id: 'personal', name: 'Personal', stage: 'idle', signedOut: false, endsAt: now + 3 * day, email: 'me@home.example', planType: 'Pro', active: false,
        plan: { limits: [limits[0]], at: now }, pinned: {}, chats: [] },
    ],
  };
  const passkeys = { available: true, passkeys: [
    { id: 'pk-1', device: 'MacBook Pro, Safari', rpId: 'example.ts.net', created: new Date(now - 40 * day).toISOString(), used: new Date(now - 2 * day).toISOString() },
  ] };
  if (empty) { accounts.accounts = []; passkeys.passkeys = []; }
  const decisions = [];
  const json = (res, body, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://fixtures');
    if (pathname === '/__sends') return json(res, stub.sends);
    if (pathname === '/__calls') return json(res, stub.calls);
    if (pathname === '/__terminal') return json(res, stub.requests);
    if (pathname === '/__decisions') return json(res, decisions);
    if (pathname === '/api/accounts' || pathname === '/api/accounts/plan') return req.resume(), json(res, accounts);
    if (pathname === '/api/banners') return req.resume(), json(res, {});
    if (pathname === '/api/passkeys') return req.resume(), json(res, passkeys);
    const approve = /^\/api\/sessions\/([^/]+)\/approve$/.exec(pathname);
    if (approve && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { decisions.push({ id: approve[1], ...JSON.parse(body) }); } catch { decisions.push({ id: approve[1], bad: body }); }
        json(res, { ok: true });
      });
      return;
    }
    const url = new URL(stub.address);
    const upstream = http.request({ host: '127.0.0.1', port: url.port, path: req.url, method: req.method, headers: req.headers }, answer => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    address: `http://localhost:${server.address().port}`,
    decisions,
    stop: () => { server.closeAllConnections(); server.close(); },
  })));
}

// MARK: Test runs

// The other stubs a test can sign in to, by the name it asks for: files, groups, routines, and organise (a scratch server with seeded sessions).
async function startStubs() {
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://localhost:${server.address().port}`)));
  const files = await startFilesStub();
  const groups = await startGroupStub();
  const routines = routinesStub({ accept: true });
  const routinesEmpty = routinesStub({ accept: true, empty: true });
  const scratch = await startScratch();
  return {
    addresses: { files: files.address, groups: groups.address, routines: await listen(routines.server), routinesempty: await listen(routinesEmpty.server), organise: scratch.address },
    password: fs.readFileSync(scratch.passwordFile, 'utf8').trim(),
    stop: async () => {
      files.stop();
      groups.stop();
      for (const { server } of [routines, routinesEmpty]) { server.closeAllConnections(); server.close(); }
      await scratch.stop();
    },
  };
}

// The xcodebuild run in flight, and whether a signal has asked the run to stop. The loops in `shoot` check the flag between steps.
let testing = null;
let interrupted = false;

function runTests({ udid, device, appearance, out, address, only, stubs }) {
  // The stubs listen on 127.0.0.1 only, and on iOS 27 the Simulator's requests to localhost at times fail as unreachable.
  const ipv4 = a => a.replace('//localhost:', '//127.0.0.1:');
  const env = {
    ...process.env,
    TEST_RUNNER_GS_ADDRESS: ipv4(address), TEST_RUNNER_GS_PASSWORD_ORGANISE: stubs.password, TEST_RUNNER_GS_SHOTDIR: out, TEST_RUNNER_GS_DEVICE: device, TEST_RUNNER_GS_APPEARANCE: appearance,
    ...Object.fromEntries(Object.entries(stubs.addresses).map(([name, a]) => [`TEST_RUNNER_GS_ADDRESS_${name.toUpperCase()}`, ipv4(a)])),
  };
  const result = path.join(DERIVED, 'results', `${device}-${appearance}.xcresult`);
  fs.rmSync(result, { recursive: true, force: true });
  const args = ['-project', PROJECT, '-scheme', 'GhostShelliPhone', '-derivedDataPath', DERIVED, '-destination', `platform=iOS Simulator,id=${udid}`,
    '-resultBundlePath', result, '-parallel-testing-enabled', 'NO', 'test-without-building'];
  for (const name of only ? only.split(',') : []) args.push(`-only-testing:GhostShelliPhoneUITests/GhostShelliPhoneUITests/${name}`);
  return new Promise(resolve => {
    const child = spawn('xcodebuild', args, { env });
    testing = child;
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', status => {
      fs.writeFileSync(path.join(DERIVED, `last-${device}-${appearance}.log`), output);
      const lines = output.split('\n');
      const failed = lines.filter(l => /error:|Test Case .* failed|XCTAssert/.test(l));
      const summary = lines.filter(l => /Executed \d+ tests?/.test(l)).pop() ?? '(no summary line)';
      resolve({ ok: status === 0 && !/Executed 0 tests/.test(summary), summary: summary.trim(), failed });
    });
  });
}

// The Simulator keeps its own log, so a clip the app plays never reaches the Mac's log that test/speakers.mjs reads.
// See https://github.com/kulesy/ghostshell/issues/127.
function soundsSince(udid, since) {
  const r = simctl('spawn', udid, 'log', 'show', '--start', since, '--style', 'compact', '--predicate',
    'process == "GhostShelliPhone" AND eventMessage CONTAINS "client starting: <AudioQueueObject"');
  if (r.status !== 0) throw new Error(`Could not read the simulator's log: ${r.stderr}`);
  return r.stdout.split('\n').filter(line => line.includes('client starting'));
}

async function shoot() {
  const out = path.resolve(option('--out') || path.join(apple, 'screenshots', 'iphone'));
  const devices = option('--device') ? [option('--device')] : Object.keys(DEVICES);
  const appearances = option('--only') ? [option('--only')] : ['light', 'dark'];
  if (!devices.every(d => DEVICES[d]) || !appearances.every(a => a === 'light' || a === 'dark')) throw new Error('--device is se or 16pro, --only is light or dark.');
  fs.mkdirSync(out, { recursive: true });

  console.log('== build for testing');
  xcodebuild(['-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', 'build-for-testing'], 'build for testing');

  const stub = await startChatStub();
  const fixtures = await startFixtures(stub);
  const emptyFixtures = await startFixtures(stub, { empty: true });
  const booted = [];
  let ok = true;
  const release = await acquire(SIMULATOR_LOCK, { what: 'the Simulators', checkout: path.resolve(apple, '..') });
  // Installed once the lock is held, so the `finally` below still shuts down what this run booted and gives the lock back.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; testing?.kill(); });
  try {
    for (const device of devices) {
      if (interrupted) break;
      const udid = findOrCreate(DEVICES[device]);
      const wasBooted = JSON.parse(simctl('list', 'devices', '-j').stdout).devices[RUNTIME].find(d => d.udid === udid)?.state === 'Booted';
      // Recorded before the boot, so a boot that fails or is interrupted midway is still shut down.
      if (!wasBooted) booted.push(udid);
      boot(udid);
      for (const appearance of appearances) {
        if (interrupted) break;
        console.log(`\n== ${DEVICES[device].name}, ${appearance}`);
        // Fresh stubs for each run, because a chip started or a file saved in one run would change what the next one sees.
        const stubs = await startStubs();
        stubs.addresses.accountsempty = emptyFixtures.address;
        const since = new Date().toLocaleString('sv-SE');
        const r = await runTests({ udid, device, appearance, out, address: fixtures.address, only: option('--test'), stubs }).finally(() => stubs.stop());
        console.log(r.ok ? `PASS: ${r.summary}` : `FAIL: ${r.summary}\n${r.failed.join('\n')}`);
        const sounds = soundsSince(udid, since);
        if (sounds.length) console.log(`FAIL: the app put a sound out\n${sounds.join('\n')}`);
        ok = ok && r.ok && !sounds.length;
      }
    }
    console.log(`\nWidget sends the stub recorded: ${stub.sends.length}. Approval decisions: ${fixtures.decisions.length}.`);
  } finally {
    for (const udid of booted) simctl('shutdown', udid);
    fixtures.stop();
    emptyFixtures.stop();
    stub.stop();
    release();
  }
  console.log(`Screenshots are in ${out}`);
  return ok;
}

if (command === 'build') {
  console.log(build({ release: argv.includes('--release') }));
} else if (command === 'shot') {
  const ok = await shoot();
  process.exit(interrupted ? 130 : ok ? 0 : 1);
} else {
  console.error('Usage: iphone.mjs build [--release] | shot [--out <folder>] [--device se|16pro] [--only light|dark] [--test <name>[,<name>...]]');
  process.exit(2);
}
