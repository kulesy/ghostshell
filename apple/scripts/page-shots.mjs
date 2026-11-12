#!/usr/bin/env node
// Screenshots the web page at phone width against the same stubs the iPhone run signs in to, so a screen shows the same data on both.
// Headless Chromium only. It never opens a browser the owner uses, port 4310 or ~/.config/capcom.
//   node apple/scripts/page-shots.mjs [--out <folder>] [--size 375|402] [--scheme light|dark] [--set chat,groups,empty] [--only <screen prefix>]
// Writes <out>/page/<width>/<scheme>/<screen>.png. Screen names follow the iPhone UI tests' shot names where one exists.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startChatStub } from './chat-fixtures.mjs';
import { startFilesStub } from './files-fixtures.mjs';
import { startGroupStub } from './group-fixtures.mjs';
import { routinesStub } from './routines-fixtures.mjs';
import { startScratch } from './test-server.mjs';

// NOTE: [11 Nov 2026] EK - playwright-core is not a dependency of this repo, so it is read from a checkout that has it.
const { chromium } = createRequire(import.meta.url)('/Users/elikent/Projects/tinacloud-e2e/node_modules/playwright-core');

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const SIZES = { 375: 667, 402: 874 };
const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : undefined);
const OUT = path.resolve(option('--out') || '/private/tmp/claude-501/parity-survey');
const sizes = option('--size') ? [Number(option('--size'))] : Object.keys(SIZES).map(Number);
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
const forMessages = query => body => ({ ...body, items: query.has('after') ? [] : body.items.map(i => (i.kind === 'system' && !i.details ? { ...i, details: [] } : i)),
  ...(query.has('after') && { start: body.end }) });
const forList = features => (p, query) => (p === '/api/sessions' ? body => ({ ...LIST, ...body, ...(features && { features }) }) : /\/messages$/.test(p) ? forMessages(query) : undefined);

// Each set starts its stubs fresh, so what one screen changes never reaches the next run.
const SETS = {
  async chat() {
    const stub = await startChatStub();
    const fixtures = accountsFixture();
    const proxy = await startProxy(stub.address, {
      answer: p => (p === '/api/accounts' || p === '/api/accounts/plan' ? fixtures.accounts : p === '/api/banners' ? {} : p === '/api/passkeys' ? fixtures.passkeys : undefined),
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
    const stub = routinesStub({ accept: true });
    await new Promise(resolve => stub.server.listen(0, '127.0.0.1', resolve));
    const proxy = await startProxy(`http://localhost:${stub.server.address().port}`, {
      answer: p => (p === '/api/banners' ? {} : extra.answer?.(p)),
    });
    return { address: proxy.address, stop: () => { proxy.stop(); stub.server.closeAllConnections(); stub.server.close(); } };
  },
  // The scratch server serves the real page, so the browser signs in to it with its password.
  async organise() {
    const scratch = await startScratch();
    return { address: scratch.address, password: fs.readFileSync(scratch.passwordFile, 'utf8').trim(), stop: () => scratch.stop() };
  },
  // Empty states: a list with no sessions, no routines and no scheduled sessions.
  async empty() {
    const stub = await startChatStub();
    const proxy = await startProxy(stub.address, {
      answer: p => (p === '/api/sessions' ? { ...LIST, features: FEATURES, ungrouped: [] }
        : p === '/api/routines' ? { routines: [] } : p === '/api/scheduled' ? { scheduled: [] } : p === '/api/banners' ? {} : undefined),
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
    ['organise-projects-menu', async (page, ctx) => { await ctx.go('#/'); await page.locator('button.projects-toggle').click(); await sleep(600); }],
  ],
  empty: [
    ['list-empty', (page, ctx) => ctx.go('#/')],
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
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
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

// --serve <set> starts one set's servers, prints the address and waits, for looking at the page by hand in a test browser.
if (option('--serve')) {
  const server = await SETS[option('--serve')]();
  console.log(JSON.stringify({ address: server.address, password: server.password }));
  process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
  await new Promise(() => {});
}

// NOTE: [11 Nov 2026] EK - playwright-core 1.63 asks for chromium_headless_shell-1243, and only -1234 is cached, which runs fine.
const HEADLESS = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const browser = await chromium.launch({ executablePath: HEADLESS });
const failures = [];
try {
  for (const width of sizes) for (const scheme of schemes) for (const name of sets) {
    console.log(`== ${name} ${width} ${scheme}`);
    failures.push(...await runSet(browser, name, width, scheme));
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `FAILED:\n${failures.join('\n')}` : 'All screens saved.');
console.log(`Screenshots are in ${path.join(OUT, 'page')}`);
process.exit(failures.length ? 1 : 0);
