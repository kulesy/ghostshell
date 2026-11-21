#!/usr/bin/env node
// Screenshots the web page at phone width, and at the Mac window's default and minimum size, against the same stubs the iPhone run signs in to, so a screen shows the same data on both.
// Headless Chromium only. Set PLAYWRIGHT_CORE to the playwright-core folder of a checkout that has it. It never opens a browser the owner uses, port 4310 or ~/.config/capcom.
//   node apple/scripts/page-shots.mjs [--out <folder>] [--size 375|402|960|640] [--scheme light|dark] [--set chat,groups,empty,organise,routines,files,banners,signin|all] [--only <screen prefix>]
//   node apple/scripts/page-shots.mjs --journeys [--journey <id>] [--out <folder>]
// Writes <out>/page/<width>/<scheme>/<screen>.png. Screen names follow the iPhone UI tests' shot names where one exists.
// --journeys plays apple/scripts/journeys.mjs at 960 wide in light with real clicks and keys, a shot after each step as j-<journey>-<n>-<step>.png, and writes <out>/journeys-web.json.
// A failed step is recorded and its journey skipped from there. Only a crash of the run itself sets the exit code.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findChromium, notFound } from '../../test/browser.mjs';
import { startChatStub } from './chat-fixtures.mjs';
import { makePng } from './png.mjs';
import { startFilesStub } from './files-fixtures.mjs';
import { startGroupStub } from './group-fixtures.mjs';
import { JOURNEYS, shotName, verbOf } from './journeys.mjs';
import { routinesStub } from './routines-fixtures.mjs';
import { startScratch } from './test-server.mjs';

// NOTE: [12 Nov 2026] EK - playwright-core is not a dependency of this repo, so PLAYWRIGHT_CORE points at a checkout that has it.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const SIZES = { 375: 667, 402: 874, 960: 640, 640: 420 };
const PHONES = [375, 402];
const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : undefined);
const OUT = path.resolve(option('--out') || '/private/tmp/claude-501/parity-survey');
const sizes = option('--size') ? [Number(option('--size'))] : PHONES;
const schemes = option('--scheme') ? [option('--scheme')] : ['light', 'dark'];
const sets = (option('--set') || 'chat,groups,empty').split(',');
const only = option('--only');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// MARK: Servers

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const FEATURES = { groupSessions: true, sectionSessions: true, groupEdits: true, groupRename: true, routineEdits: true, routineFiles: true, scheduled: true, subStatus: true,
  pullStatus: true, linkStatus: true, groupUpdates: true, subagents: true, newParent: true, banners: true, accounts: true, accountPins: true, many: true, routineHeadings: true };
// The shape the real server's list always has, which the page reads without checking. The chat and files stubs send only `ungrouped`.
const LIST = { station: 'stub', projects: [], pinned: [], routines: [], started: [], other: [], sections: [], groups: [] };
const json = (res, body, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

// What the iPhone run's proxy answers in front of the chat stub (apple/scripts/iphone.mjs startFixtures), so the Accounts and Passkeys screens match.
function accountsFixture() {
  const day = 86_400_000;
  const now = Date.now();
  const personal = { id: 'personal', name: 'Personal' };
  const work = { id: 'work', name: 'Work' };
  const limits = [
    { kind: 'session', percent: 62, resetsAt: new Date(now + 95 * 60_000).toISOString(), severity: 'normal' },
    { kind: 'weekly_all', percent: 84, resetsAt: new Date(now + 2 * day).toISOString(), severity: 'warning' },
  ];
  return {
    accounts: {
      autoSwitch: true, waiting: false, chrome: { state: 'elsewhere', to: personal, on: work, email: 'me@example.com' },
      accounts: [
        { id: 'work', name: 'Work', stage: 'idle', signedOut: false, endsAt: now + 20 * day, email: 'me@example.com', planType: 'Max', active: true,
          plan: { limits, at: now }, pinned: { sessions: 2 }, chats: [{ id: 'rich', title: 'Fix the flaky upload test', state: 'working' }] },
        { id: 'personal', name: 'Personal', stage: 'idle', signedOut: false, endsAt: now + 3 * day, email: 'me@home.example', planType: 'Pro', active: false,
          plan: { limits: [limits[0]], at: now }, pinned: {}, chats: [] },
      ],
    },
    passkeys: { available: true, passkeys: [
      { id: 'pk-1', device: 'MacBook Pro, Safari', rpId: 'example.ts.net', created: new Date(now - 40 * day).toISOString(), used: new Date(now - 2 * day).toISOString() },
    ] },
  };
}

// What the Mac's accounts flow serves at first: the login, update, out-of-usage, auto-switch and Chrome banners together.
function bannersFixture() {
  const now = Date.now();
  const work = { id: 'work', name: 'Work' };
  const personal = { id: 'personal', name: 'Personal' };
  const changes = [['Add a context meter', 1], ['Fix the sidebar jump', 2], ['Show the plan bars', 3]].map(([title, n]) => ({ title, url: `https://github.com/kulesy/ghostshell/pull/${n}` }));
  return {
    login: { visible: true, signedOut: false, endsAt: now + 3 * 86_400_000, stage: 'idle', account: 'Personal', accountId: 'personal' },
    update: { show: true, kind: 'update', stage: 'idle', count: 7, restart: true, busy: 2, force: true, blocked: '', changes },
    accounts: { out: { name: 'Work', text: 'Resets at 3:00 pm', at: now, to: personal }, auto: { at: now, from: work, to: personal } },
    chrome: { state: 'elsewhere', to: personal, on: work, email: 'me@example.com' },
  };
}

// What the page gets where a stub has no route, so a screen draws its empty state and not an error.
const empty = pathname => (pathname === '/api/routines' ? { routines: [] } : pathname === '/api/scheduled' ? { scheduled: [] } : /\/chips$/.test(pathname) ? { chips: [] }
  : pathname === '/renew' ? { ok: true } : {});

// Serves public/ and the two page templates itself, so no sign-in is needed, and forwards every other request to the stub. `answer` may
// reply first. `patch` returns a function that changes the stub's JSON body for a path on its way back.
function startProxy(upstream, { answer = () => undefined, patch = () => undefined } = {}) {
  const target = new URL(upstream);
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://page');
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return void res.writeHead(200, { 'Content-Type': 'text/html' }).end(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/\{\{home\}\}/g, '/Users/me').replace(/\{\{station\}\}/g, 'GhostShell'));
    }
    if (req.method === 'GET' && pathname === '/login') {
      return void res.writeHead(200, { 'Content-Type': 'text/html' }).end(fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8').replace('{{message}}', ''));
    }
    const type = TYPES[path.extname(pathname)];
    const file = path.join(PUBLIC, pathname);
    if (req.method === 'GET' && type && file.startsWith(PUBLIC + path.sep) && fs.existsSync(file)) {
      return void res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(fs.readFileSync(file));
    }
    if (pathname === '/passkey-options') return req.resume(), json(res, {});
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const mine = answer(pathname, req, body);
      if (mine !== undefined) return json(res, mine);
      const change = patch(pathname, new URL(req.url, 'http://page').searchParams);
      const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, reply => {
        if (reply.statusCode === 404 && (pathname.startsWith('/api/') || pathname === '/renew')) { reply.resume(); return void json(res, empty(pathname)); }
        if (!change) { res.writeHead(reply.statusCode, reply.headers); return void reply.pipe(res); }
        const parts = [];
        reply.on('data', chunk => parts.push(chunk));
        reply.on('end', () => {
          const out = Buffer.from(JSON.stringify(change(JSON.parse(Buffer.concat(parts).toString() || '{}'))));
          res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': out.length }).end(out);
        });
      });
      up.on('error', () => res.destroy());
      res.on('close', () => up.destroy());
      up.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    address: `http://localhost:${server.address().port}`,
    stop: () => { server.closeAllConnections(); server.close(); },
  })));
}

// The server's system notices carry a `details` list that the chat stub leaves out, and the page reads its length. The files and groups stubs
// ignore `after`, so the page's poll would append the whole chat again.
// A journey sends a message and waits for the reply, so it keeps the stub's `after` answers.
const forMessages = (query, live = false) => body => ({ ...body, items: query.has('after') && !live ? [] : body.items.map(i => (i.kind === 'system' && !i.details ? { ...i, details: [] } : i)),
  ...(query.has('after') && !live && { start: body.end }) });
const forList = (features, live) => (p, query) => (p === '/api/sessions' ? body => ({ ...LIST, ...body, ...(features && { features }) }) : /\/messages$/.test(p) ? forMessages(query, live) : undefined);

// Each set starts its stubs fresh, so what one screen changes never reaches the next run.
const SETS = {
  // `journey` is for the journeys run: the stub takes approvals and the page's polls reach it.
  async chat({ journey = false } = {}) {
    const stub = await startChatStub({ decisions: journey });
    const fixtures = accountsFixture();
    const proxy = await startProxy(stub.address, {
      answer: p => (p === '/api/accounts' || p === '/api/accounts/plan' ? fixtures.accounts : p === '/api/banners' ? {} : p === '/api/passkeys' ? fixtures.passkeys : undefined),
      patch: forList(FEATURES, journey),
    });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.stop(); } };
  },
  async banners() {
    const stub = await startChatStub();
    const fixtures = accountsFixture();
    const proxy = await startProxy(stub.address, {
      answer: p => (p === '/api/accounts' || p === '/api/accounts/plan' ? fixtures.accounts : p === '/api/banners' ? bannersFixture() : p === '/api/passkeys' ? fixtures.passkeys : undefined),
      patch: forList(FEATURES),
    });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.stop(); } };
  },
  async files() {
    const stub = await startFilesStub();
    const proxy = await startProxy(stub.address, { answer: p => (p === '/api/banners' ? {} : undefined), patch: forList() });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.stop(); } };
  },
  async groups() {
    const stub = await startGroupStub();
    const proxy = await startProxy(stub.address, { answer: p => (p === '/api/banners' ? {} : undefined), patch: forList() });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.stop(); } };
  },
  async routines(extra = {}) {
    const stub = routinesStub({ accept: extra.accept });
    await new Promise(resolve => stub.server.listen(0, '127.0.0.1', resolve));
    const proxy = await startProxy(`http://localhost:${stub.server.address().port}`, {
      answer: p => (p === '/api/banners' ? {} : extra.answer?.(p)),
      patch: forList(FEATURES),
    });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.server.closeAllConnections(); stub.server.close(); } };
  },
  // The scratch server serves the real page, so the browser signs in to it with its password.
  async organise() {
    const scratch = await startScratch();
    return { address: scratch.address, password: fs.readFileSync(scratch.passwordFile, 'utf8').trim(), stop: () => scratch.stop() };
  },
  // The scratch server renders the real sign-in page and its errors. The screens sign in themselves.
  async signin() {
    const scratch = await startScratch();
    return { address: scratch.address, stop: () => scratch.stop() };
  },
  // Empty states: a list with no sessions, no routines, no scheduled sessions, no accounts and no passkeys.
  async empty() {
    const stub = await startChatStub();
    const proxy = await startProxy(stub.address, {
      answer: p => (p === '/api/sessions' ? { ...LIST, features: FEATURES, ungrouped: [] }
        : p === '/api/routines' ? { routines: [] } : p === '/api/scheduled' ? { scheduled: [] } : p === '/api/banners' ? {}
        : p === '/api/accounts' || p === '/api/accounts/plan' ? { autoSwitch: false, waiting: false, accounts: [] } : p === '/api/passkeys' ? { available: true, passkeys: [] } : undefined),
    });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.stop(); } };
  },
};

// MARK: Screens

// Each screen is [name, run(page, ctx)]. `ctx.go(hash)` opens a route and waits for the page to draw, and `ctx.shot()` saves the current look under the screen's name.
// The page's own scroll box in a chat, scrolled from its end by `back` pixels.
const scrollThread = (page, back) => page.evaluate(b => { const t = document.querySelector('.transcript'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - b); }, back);
const chatScreen = (id, text, after = async () => {}) => async (page, ctx) => {
  await ctx.go(`#/s/${id}`);
  await page.getByText(text).first().waitFor({ timeout: 15_000 });
  await after(page, ctx);
};

// Opens a link in the files chat and waits for `shown` in the panel, or `wait` ms when the file has no text to wait for.
const fileScreen = (link, shown, wait = 600) => async (page, ctx) => {
  await ctx.go('#/s/files');
  await page.getByText('All five match the notes.').first().waitFor({ timeout: 15_000 });
  await page.getByText(link, { exact: true }).first().click();
  if (shown) await page.getByText(shown).first().waitFor({ timeout: 15_000 });
  await sleep(wait);
};

const SCREENS = {
  chat: [
    ['01-sign-in', async (page, ctx) => { await page.goto(`${ctx.address}/login`); await sleep(800); }],
    ['02-sidebar', (page, ctx) => ctx.go('#/')],
    ['03-chat-rich', chatScreen('rich', 'Done. I added')],
    ['04-chat-scrolled', chatScreen('rich', 'Done. I added', (page) => scrollThread(page, 1200))],
    ['05-chat-widgets', chatScreen('widgets', 'Say the word and I will go further', () => sleep(2500))],
    ['06-approval-question', chatScreen('ask-question', 'Which test runner')],
    ['07-approval-plan', chatScreen('ask-plan', 'Make the upload wait')],
    ['07b-approval-plan-buttons', chatScreen('ask-plan', 'Make the upload wait', page => scrollThread(page, 0))],
    ['08-approval-bash', chatScreen('ask-bash', 'git push')],
    ['09-accounts', async (page, ctx) => { await ctx.go('#/accounts'); await page.locator('.accounts-body').waitFor(); }],
    ['09b-accounts-scrolled', async (page, ctx) => {
      await ctx.go('#/accounts');
      await page.locator('.accounts-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    }],
    ['10-passkeys', async (page, ctx) => { await ctx.go('#/passkeys'); await page.getByText('MacBook Pro, Safari').first().waitFor(); }],
    ['11-account-menu', async (page, ctx) => { await ctx.go('#/'); await page.locator('.foot-account').click(); await page.locator('[role=menu]').waitFor(); }],
    ['chat-empty', async (page, ctx) => { await ctx.go('#/s/empty'); await sleep(800); }],
    ['chat-streaming', chatScreen('stream', 'Go on, I am ready', () => sleep(4000))],
    ['approval-edit', chatScreen('ask-edit', 'I need your go-ahead')],
    // The Mac composer flow's last state: a picture and a file attached, then a two-line draft.
    ['composer-draft', chatScreen('composer', 'I renamed it in 4 files', async page => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-page-composer-'));
      makePng(path.join(dir, 'screenshot.png'));
      fs.writeFileSync(path.join(dir, 'release-notes.txt'), 'Release notes for 4.2\n');
      await page.locator('input[type=file]').setInputFiles([path.join(dir, 'screenshot.png'), path.join(dir, 'release-notes.txt')]);
      await page.getByRole('button', { name: 'Remove screenshot.png' }).waitFor();
      await page.getByRole('button', { name: 'Remove release-notes.txt' }).waitFor();
      await page.locator('#text').fill('Rename it in the docs too\nand keep the alias for one release');
    })],
    ['term-chat', chatScreen('term', 'Both blocks have a Run button')],
    ['term-panel', chatScreen('term', 'Both blocks have a Run button', async page => {
      await page.getByRole('button', { name: 'Terminal', exact: true }).click();
      await page.getByText('localhost:5173').first().waitFor({ timeout: 15_000 });
      await sleep(1200);
    })],
  ],
  groups: [
    ['groups-1-sidebar', (page, ctx) => ctx.go('#/')],
    ['groups-2-group-chat', async (page, ctx) => { await ctx.go('#/'); await page.locator('a.group-head').first().click(); await sleep(1500); }],
    ['organise-row-menu', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.more[aria-label^="Actions for"]').first().click(); await page.locator('[role=menu]').waitFor(); }],
    ['organise-sheet-rename-session', async (page, ctx) => {
      await ctx.go('#/');
      await page.locator('button.more[aria-label^="Actions for"]').first().click();
      await page.getByRole('menuitem', { name: /^Rename/ }).first().click();
      await page.locator('form input:focus').waitFor();
    }],
    ['organise-move', async (page, ctx) => {
      await ctx.go('#/');
      await page.locator('button.more[aria-label^="Actions for"]').first().click();
      await page.getByRole('menuitem', { name: /^Move/ }).first().click();
      await sleep(600);
    }],
    ['organise-select', async (page, ctx) => {
      await ctx.go('#/');
      await page.locator('button.more[aria-label^="Actions for"]').first().click();
      await page.getByRole('menuitem', { name: /^Select/ }).first().click();
      await sleep(600);
    }],
    ['organise-new-menu', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.add').click(); await page.locator('[role=menu]').waitFor(); }],
    ['organise-find', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.find').click(); await sleep(600); }],
    ['organise-find-results', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.find').click(); await page.keyboard.type('release'); await sleep(600); }],
    ['organise-projects-menu', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.projects-toggle').click(); await sleep(600); }],
  ],
  empty: [
    ['list-empty', (page, ctx) => ctx.go('#/')],
    ['routines-empty', (page, ctx) => ctx.go('#/routines')],
    ['scheduled-empty', (page, ctx) => ctx.go('#/scheduled')],
    ['accounts-empty', (page, ctx) => ctx.go('#/accounts')],
    ['passkeys-empty', (page, ctx) => ctx.go('#/passkeys')],
  ],
  // Named after the Mac accounts flow's shots.
  banners: [
    ['6-banners', async (page, ctx) => { await ctx.go('#/'); await page.getByText('7 merged changes are waiting').first().waitFor({ timeout: 15_000 }); }],
    ['6-force-question', async (page, ctx) => {
      await ctx.go('#/');
      await page.getByRole('button', { name: /Force restart/ }).first().click();
      await page.getByText('2 running chats will be cut.').first().waitFor();
    }],
    ['6-accounts', async (page, ctx) => { await ctx.go('#/accounts'); await page.locator('.accounts-body').waitFor(); }],
    ['6-passkeys', async (page, ctx) => { await ctx.go('#/passkeys'); await page.getByText('MacBook Pro, Safari').first().waitFor(); }],
  ],
  // Named after the Mac files flow's shots, which open the same chat's links in turn.
  files: [
    ['10-tool-tiles', async (page, ctx) => { await ctx.go('#/s/files'); await page.getByText('All five match the notes.').first().waitFor({ timeout: 15_000 }); await sleep(1200); }],
    ['10-viewer-tool', async (page, ctx) => {
      await ctx.go('#/s/files');
      await page.getByText('All five match the notes.').first().waitFor({ timeout: 15_000 });
      await sleep(1200);
      await page.locator('.tool-images img, .result-images img, .thumb').last().click();
      await page.getByText(/\d of 7/).first().waitFor();
    }],
    ['10-file-markdown', fileScreen('NOTES.md:14', 'Upload notes')],
    ['10-file-text-line', fileScreen('server.js:42', 'const RETRIES = 5;')],
    ['10-file-pdf', fileScreen('report.pdf', null, 2500)],
    ['10-file-audio', fileScreen('intro.wav', null, 1000)],
    ['10-file-binary', fileScreen('archive.zip', 'ZIP file')],
    ['10-file-missing', fileScreen('gone.txt', null)],
    ['10-viewer-picture', fileScreen('diagram.png', null, 1500)],
  ],
  // Named after the Mac's sign-in shots.
  signin: [
    ['1-signin-idle', async (page, ctx) => { await page.goto(`${ctx.address}/login`); await sleep(800); }],
    ['1-wrong-password', async (page, ctx) => {
      await page.goto(`${ctx.address}/login`);
      await page.fill('#password', 'wrong');
      await page.click('button[type=submit]');
      await sleep(1000);
    }],
    ['2-locked', async (page, ctx) => {
      for (let i = 0; i < 10; i++) await fetch(`${ctx.address}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' });
      await page.goto(`${ctx.address}/login`);
      await page.fill('#password', 'wrong');
      await page.click('button[type=submit]');
      await page.getByText('Too many tries').first().waitFor();
    }],
  ],
  // Named after the Mac run's shots (`main` and `organise`), which sign in to the same seeded scratch server.
  organise: [
    ['list-rows', (page, ctx) => ctx.go('#/')],
    ['session-chosen', async (page, ctx) => { await ctx.go('#/'); await page.locator('a.row').first().click(); await sleep(1000); }],
    ['new-group-menu', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.add').click(); await page.locator('[role=menu]').waitFor(); }],
  ],
  routines: [
    ['sidebar-routines', (page, ctx) => ctx.go('#/')],
    ['routines-list', (page, ctx) => ctx.go('#/routines')],
    ['routine-form', async (page, ctx) => { await ctx.go('#/routines'); await page.getByText('Weekly report').locator('visible=true').first().click(); await sleep(1000); }],
    ['scheduled-list', (page, ctx) => ctx.go('#/scheduled')],
  ],
};

// MARK: Run

async function runSet(browser, name, width, scheme) {
  const height = SIZES[width];
  if (!SCREENS[name]) {
    console.error(`  skipping ${name}: no SCREENS entry`);
    return [];
  }
  const server = await SETS[name]();
  const dir = path.join(OUT, 'page', String(width), scheme);
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: PHONES.includes(width), hasTouch: PHONES.includes(width), colorScheme: scheme });
  const failed = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', e => console.error(`  page error: ${e.message}`));
    if (server.password) {
      await page.goto(`${server.address}/login`);
      await page.fill('#password', server.password);
      await Promise.all([page.waitForURL(/signed-in/), page.click('button[type=submit]')]);
    }
    for (const [screen, run] of SCREENS[name]) {
      if (only && !screen.startsWith(only)) continue;
      const ctx = {
        address: server.address,
        go: async hash => {
          await page.goto(`${server.address}/`, { waitUntil: 'domcontentloaded' });
          await page.evaluate(h => { location.hash = h; }, hash);
          await page.waitForSelector('#root > *', { timeout: 15_000 });
          await sleep(800);
        },
        shot: async (label = screen) => { await sleep(500); await page.screenshot({ path: path.join(dir, `${label}.png`) }); },
      };
      try {
        await run(page, ctx);
        await ctx.shot();
      } catch (e) {
        failed.push(`${name}/${screen}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: path.join(dir, `${screen}.FAILED.png`) }).catch(() => {});
      }
    }
  } finally {
    await context.close();
    await server.stop();
  }
  return failed;
}

// MARK: Journeys

const STEP_TIMEOUT = 8_000;
const JOURNEY_STUBS = { chat: () => SETS.chat({ journey: true }), files: () => SETS.files(), routines: () => SETS.routines({ accept: true }) };
const visible = (page, text) => page.getByText(text).locator('visible=true');

// Each verb of apple/scripts/journeys.mjs as the page's real input: a click or a key a person would press.
const VERBS = {
  open: (page, id) => page.locator(`a.row[href="#/s/${id}"]`).click({ timeout: STEP_TIMEOUT }),
  type: async (page, text) => {
    if (!(await page.evaluate(() => document.activeElement?.matches('input, textarea')))) await page.locator('#text').click({ timeout: STEP_TIMEOUT });
    await page.keyboard.type(text);
  },
  key: (page, key) => page.keyboard.press(key),
  press: (page, name, { card, nth = 0 } = {}) => {
    const scope = card ? page.locator('article.approval').filter({ hasText: card }) : page;
    const buttons = scope.getByRole('button', { name, exact: true });
    return (card ? buttons.nth(nth) : buttons.or(page.getByRole('link', { name, exact: true })).locator('visible=true').first()).click({ timeout: STEP_TIMEOUT });
  },
  pick: async (page, [question, ...options]) => {
    for (const o of options) await page.locator('fieldset.ask').filter({ hasText: question }).locator(`button.option[data-o="${o}"]`).click({ timeout: STEP_TIMEOUT });
  },
  link: (page, text) => page.getByText(text, { exact: true }).first().click({ timeout: STEP_TIMEOUT }),
  search: async (page, text) => { await page.locator('button.find').click({ timeout: STEP_TIMEOUT }); await page.keyboard.type(text); },
  choose: (page, n) => page.locator('[role=option]').nth(n).click({ timeout: STEP_TIMEOUT }),
  route: (page, name) => page.locator(`a[href="#/${name}"]`).locator('visible=true').first().click({ timeout: STEP_TIMEOUT }),
  fill: async (page, { field, text }) => {
    const box = page.getByLabel(field, { exact: true });
    await box.click({ timeout: STEP_TIMEOUT });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(text);
  },
};

// What the page shows once the step is done, or throws when it does not within the timeout.
async function expectShown(page, expect) {
  if (!expect) return;
  if ('results' in expect) return void await page.waitForFunction(n => document.querySelectorAll('[role=option]').length === n, expect.results, { timeout: STEP_TIMEOUT });
  if ('gone' in expect) return void await page.getByText(expect.gone).locator('visible=true').first().waitFor({ state: 'hidden', timeout: STEP_TIMEOUT });
  for (const text of [].concat(expect.text)) await visible(page, text).first().waitFor({ timeout: STEP_TIMEOUT });
}

// Plays one journey on a fresh stub and returns a record per step. A failed step still gets its shot and the rest are skipped.
async function playJourney(browser, journey, dir) {
  const server = await JOURNEY_STUBS[journey.stub]();
  const context = await browser.newContext({ viewport: { width: 960, height: SIZES[960] }, deviceScaleFactor: 2, colorScheme: 'light' });
  const records = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', e => console.error(`  page error: ${e.message}`));
    await page.goto(`${server.address}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 15_000 });
    await sleep(1500);
    let failedAt = null;
    for (const [i, step] of journey.steps.entries()) {
      const record = { journey: journey.id, step: step.id, n: i + 1, status: 'ok', reason: '' };
      records.push(record);
      if (failedAt) { Object.assign(record, { status: 'skipped', reason: `after ${failedAt}` }); continue; }
      try {
        const verb = verbOf(step);
        await VERBS[verb](page, step.do[verb], step.do);
        await expectShown(page, step.expect);
      } catch (e) {
        failedAt = step.id;
        Object.assign(record, { status: 'failed', reason: e.message.split('\n')[0] });
        console.log(`JOURNEY web ${journey.id}/${step.id}: ${record.reason}`);
      }
      await sleep(500);
      await page.screenshot({ path: path.join(dir, `${shotName(journey.id, i + 1, step.id)}.png`) });
    }
  } finally {
    await context.close();
    await server.stop();
  }
  return records;
}

async function runJourneys(browser) {
  const dir = path.join(OUT, 'page', '960', 'light');
  fs.mkdirSync(dir, { recursive: true });
  const wanted = (option('--journey') || '').split(',').filter(Boolean);
  const records = [];
  for (const journey of JOURNEYS.filter(j => !wanted.length || wanted.includes(j.id))) {
    console.log(`== journey ${journey.id}`);
    records.push(...await playJourney(browser, journey, dir));
  }
  fs.writeFileSync(path.join(OUT, 'journeys-web.json'), JSON.stringify(records, null, 2));
  const bad = records.filter(r => r.status !== 'ok');
  console.log(`Journeys: ${records.length - bad.length} of ${records.length} steps ok.`);
}

// --serve <set> starts one set's servers, prints the address and waits, for looking at the page by hand in a test browser.
if (option('--serve')) {
  const server = await SETS[option('--serve')]();
  console.log(JSON.stringify({ address: server.address, password: server.password }));
  process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
  await new Promise(() => {});
}

const headless = findChromium();
if (!headless) { console.error(notFound()); process.exit(1); }
const browser = await chromium.launch({ executablePath: headless });
if (argv.includes('--journeys')) {
  try { await runJourneys(browser); } finally { await browser.close(); }
  process.exit(0);
}
const failures = [];
try {
  for (const width of sizes) for (const scheme of schemes) for (const name of sets.includes('all') ? Object.keys(SETS) : sets) {
    console.log(`== ${name} ${width} ${scheme}`);
    failures.push(...await runSet(browser, name, width, scheme));
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `FAILED:\n${failures.join('\n')}` : 'All screens saved.');
console.log(`Screenshots are in ${path.join(OUT, 'page')}`);
process.exit(failures.length ? 1 : 0);
