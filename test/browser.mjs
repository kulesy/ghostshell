// Shared by the tests that run UI code in a real page: Playwright's Chromium headless shell, driven over the DevTools protocol
// on a pipe, with public/ served to it from a free port.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const KEYS = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Escape: 27, Enter: 13, Home: 36, End: 35 };

const cacheDir = () => process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
const list = dir => { try { return fs.readdirSync(dir); } catch { return []; } };

// The Chromium headless shell to run, or null: the file CAPCOM_BROWSER names, unchecked so a wrong path fails the tests rather
// than skipping them, else the newest one in Playwright's cache.
export function findChromium() {
  if (process.env.CAPCOM_BROWSER) return process.env.CAPCOM_BROWSER;
  const cache = cacheDir();
  const revisions = list(cache)
    .map(name => ({ name, revision: Number(/^chromium_headless_shell-(\d+)$/.exec(name)?.[1]) }))
    .filter(r => r.revision)
    .sort((a, b) => b.revision - a.revision);
  for (const { name } of revisions) {
    // The platform folder's name changes with the system and the CPU, so any folder that holds the shell will do.
    for (const platform of list(path.join(cache, name))) {
      const shell = path.join(cache, name, platform, 'chrome-headless-shell');
      if (fs.existsSync(shell)) return shell;
    }
  }
  return null;
}

// The reason a test gives for skipping when findChromium finds nothing, naming where it looked.
export const notFound = () => `no Chromium found: looked for chromium_headless_shell-<revision>/<platform folder>/chrome-headless-shell in ${cacheDir()}, and CAPCOM_BROWSER is not set`;

// What public/ serves at a path: the file and its type, or null for a path outside public/, a type it does not serve or a file it lacks.
function fromPublic(pathname) {
  try {
    const file = path.join(PUBLIC, decodeURIComponent(pathname));
    const type = TYPES[path.extname(file)];
    return file.startsWith(PUBLIC + path.sep) && type ? { type, body: fs.readFileSync(file) } : null;
  } catch { return null; }
}

// Serves public/ on 127.0.0.1 and a free port, and the HTML in `pages` at the paths that name it. Returns its origin and a way to close it.
export async function serve(pages = {}) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const found = pages[pathname] !== undefined ? { type: 'text/html; charset=utf-8', body: pages[pathname] } : fromPublic(pathname);
    if (!found) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': found.type }).end(found.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}

// Starts the browser in a profile of its own. Returns `open(url)`, which gives a page, and `close()`. A browser that cannot start throws here.
export async function launch(chromium) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-browser-'));
  // Commands go in on fd 3 and replies come out on fd 4, each JSON message ending in a NUL byte. The browser quits when its pipe
  // closes, so a test that dies takes it along.
  const child = spawn(chromium, ['--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const [, , stderr, commands, replies] = child.stdio;
  const waiting = new Map();
  const problemsOf = new Map();
  let next = 0;
  let gone = null;
  let errors = '';
  let heard = Buffer.alloc(0);

  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  const fail = reason => {
    gone ||= new Error(`${reason}. ${errors}`.trim());
    for (const { reject } of waiting.values()) reject(gone);
    waiting.clear();
  };
  child.once('error', error => fail(`The browser did not start: ${error.message}`));
  child.once('exit', (code, signal) => fail(`The browser ${chromium} exited with ${code ?? signal}`));
  stderr.on('data', chunk => { errors += chunk; });
  commands.on('error', () => {});

  function hear(m) {
    if (m.id) {
      const call = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) call?.reject(new Error(`${call.method} failed: ${m.error.message}`));
      else call?.resolve(m.result);
      return;
    }
    const problems = problemsOf.get(m.sessionId);
    if (m.method === 'Runtime.exceptionThrown') problems?.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems?.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  }
  replies.on('data', chunk => {
    heard = Buffer.concat([heard, chunk]);
    for (let end = heard.indexOf(0); end >= 0; end = heard.indexOf(0)) {
      hear(JSON.parse(heard.subarray(0, end).toString('utf8')));
      heard = heard.subarray(end + 1);
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (gone) { reject(gone); return; }
    const id = ++next;
    waiting.set(id, { resolve, reject, method });
    commands.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });

  async function close() {
    send('Browser.close').catch(() => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
    fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }, () => {});
  }

  // `phone` is a narrow screen touched by a finger: no hover, a coarse pointer and a mobile viewport.
  async function open(url, { phone = false } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const problems = [];
    problemsOf.set(sessionId, problems);
    const call = (method, params) => send(method, params, sessionId);
    await call('Runtime.enable');
    await call('Page.enable');
    // The page keeps the focus whichever tab the browser has in front, so the focus it hands out can be read back.
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await call('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    if (phone) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const { errorText } = await call('Page.navigate', { url });
    if (errorText) throw new Error(`${url} did not load: ${errorText}`);

    async function evaluate(expression) {
      const { result, exceptionDetails } = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    }

    async function until(expression, ms = 5000) {
      for (const start = Date.now(); !(await evaluate(expression));) {
        if (Date.now() - start > ms) throw new Error(`timed out waiting for ${expression}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }

    // Input waits for the next frame and the effects that follow it, as a person's does, because a menu adds its Esc listener only then.
    const settled = () => evaluate('new Promise(done => { requestAnimationFrame(() => setTimeout(done)); setTimeout(done, 100); })');

    // Only a keyDown that carries text types a character, which the printable keys and Enter do. The rest are the key alone.
    async function press(key) {
      const printable = /^[a-z0-9]$/i.test(key);
      if (!printable && !KEYS[key]) throw new Error(`press does not know the key ${key}`);
      await settled();
      const text = printable ? key : key === 'Enter' ? '\r' : undefined;
      const which = {
        key,
        code: printable ? `${/\d/.test(key) ? 'Digit' : 'Key'}${key.toUpperCase()}` : key,
        windowsVirtualKeyCode: printable ? key.toUpperCase().charCodeAt(0) : KEYS[key],
      };
      await call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...which, ...(text && { text }) });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', ...which });
    }

    const centre = selector => evaluate(`(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`);

    async function click(selector) {
      await settled();
      const { x, y } = await centre(selector);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }

    // A finger's tap on the middle of `selector`, which the page hears as a touch and then a click, as it does from a phone.
    async function tap(selector) {
      await settled();
      const { x, y } = await centre(selector);
      await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }

    // Sets the size of the screen, as turning a phone or narrowing a window does. A phone stays a phone.
    const resize = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: phone ? 2 : 1, mobile: phone });

    // Moves the mouse to the middle of `selector`, as a pointer does that passes over it.
    async function hover(selector) {
      await settled();
      const { x, y } = await centre(selector);
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    }

    // Presses the left button on the middle of `selector` and holds it, so a test sees what the press does before the click. `up` lets go.
    let held = null;
    async function down(selector) {
      await settled();
      held = await centre(selector);
      for (const type of ['mouseMoved', 'mousePressed']) await call('Input.dispatchMouseEvent', { type, ...held, button: 'left', clickCount: 1 });
    }

    async function up() {
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...held, button: 'left', clickCount: 1 });
    }

    // Presses the left button on the middle of `from`, nudges it far enough to lift a header, and then moves to the point the expression `to` gives, which
    // is read once the page has drawn what the lift adds. It leaves the button down for the test to look at the page, and the function it
    // returns lets go.
    async function carry(from, to) {
      await settled();
      const start = await centre(from);
      const nudge = { x: start.x, y: start.y + 8 };
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...nudge, button: 'left', buttons: 1 });
      await settled();
      const end = await evaluate(to);
      for (let i = 1; i <= 10; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nudge.x + (end.x - nudge.x) * i / 10, y: nudge.y + (end.y - nudge.y) * i / 10, button: 'left', buttons: 1 });
      await settled();
      return async () => {
        await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
        await settled();
      };
    }

    // One turn of the wheel over the middle of `selector`, a negative deltaY scrolling up.
    async function wheel(selector, deltaY) {
      await settled();
      const { x, y } = await centre(selector);
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
    }

    return {
      problems,
      evaluate,
      until,
      press,
      click,
      tap,
      resize,
      hover,
      down,
      up,
      carry,
      wheel,
      close: async () => {
        problemsOf.delete(sessionId);
        await send('Target.closeTarget', { targetId });
      },
    };
  }

  try {
    await Promise.race([
      send('Browser.getVersion'),
      new Promise((_, reject) => { setTimeout(reject, 15_000, new Error(`The browser ${chromium} did not answer in 15 seconds.`)).unref(); }),
    ]);
  } catch (error) {
    await close();
    throw error;
  }
  return { open, close };
}
