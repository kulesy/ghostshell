// Whether Chrome's Claude extension is signed in to the account a chat runs on, and the banner that says to move it after a switch. GhostShell never signs the
// extension in and never handles a credential: it asks the CLI which browsers it can reach and opens the extension's settings. See docs/adr/20261104-chrome-follows-the-account.md.
import { execFile, spawn } from 'node:child_process';
import readline from 'node:readline';

export const CHECK_LIMIT_MS = 15_000;
export const RECHECK_MS = 15_000;
export const WATCH_MS = 10 * 60_000;
// NOTE: [4 Nov 2026] EK - https://clau.de/chrome/permissions is a private route of the extension and the CLI (the CLI's /chrome opens the same one), checked on extension 1.0.104.
// If it moves, the press lands on claude.ai and the banner's steps still hold.
const CHROME_SETTINGS_URL = 'https://clau.de/chrome/permissions';
export const OPEN_FAILED = 'Could not open Chrome on the Mac. In Chrome, click the Claude icon in the toolbar and open its settings.';

const brief = a => ({ id: a.id, name: a.name });

// Resolves true when the CLI reaches a browser on this Mac, false when it lists none or only other computers', and null when it said nothing usable. A signed out
// folder answers after 10 seconds with plain text, so the limit is longer. No device name or id is kept.
// NOTE: [4 Nov 2026] EK - `--claude-in-chrome-mcp` is an undocumented CLI flag (checked on CLI 2.1.318). If it moves, every check answers null and the banner shows its unsure form.
export function browserSeen({ claude, env, limitMs = CHECK_LIMIT_MS }) {
  return new Promise(resolve => {
    const child = spawn(claude, ['--claude-in-chrome-mcp'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let killer;
    // A process that ignores SIGTERM is killed 5 seconds later, so a stuck one cannot pile up over the re-checks.
    const done = value => {
      clearTimeout(timer);
      resolve(value);
      child.kill();
      killer ??= setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    const timer = setTimeout(() => done(null), limitMs);
    const send = message => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    child.stdin.on('error', () => {});
    child.once('error', () => done(null));
    child.once('close', () => {
      done(null);
      clearTimeout(killer);
    });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let got = null;
      try { got = JSON.parse(line); } catch { return; }
      if (got?.id === 1) {
        send({ method: 'notifications/initialized' });
        send({ id: 2, method: 'tools/call', params: { name: 'list_connected_browsers', arguments: {} } });
      } else if (got?.id === 2) {
        let list = null;
        try { list = JSON.parse(got.result?.content?.[0]?.text); } catch { list = null; }
        done(Array.isArray(list) ? list.some(b => !!(b?.onThisComputer ?? b?.isLocal)) : null);
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ghostshell', version: '0' } } });
  });
}

export const openChromeSettings = ({ open }) => new Promise((resolve, reject) => {
  execFile(open, ['-a', 'Google Chrome', CHROME_SETTINGS_URL], { timeout: 10_000 }, err => (err ? reject(err) : resolve()));
});

const timer = (run, ms) => {
  const t = setTimeout(run, ms);
  t.unref();
  return () => clearTimeout(t);
};

// `probe(account)` answers as browserSeen does and `wait(run, ms)` returns a function that cancels it. `enabled` is the `chrome` setting, since chats started without
// Claude in Chrome have nothing to lose. Everything is in memory, and a page read never probes.
export function makeChromeCheck({ accounts, enabled = true, probe, emailOf = () => '', openSettings, now = Date.now, wait = timer }) {
  let gen = 0;
  let st = null;
  let cancel = null;
  let running = 0;

  const clear = () => {
    gen++;
    cancel?.();
    cancel = null;
    running = 0;
    st = null;
  };
  const standing = () => st && !st.checking && now() < st.until;
  const ask = account => Promise.resolve().then(() => probe(account)).catch(() => null);

  // One probe at a time on the active account, the next timer starting when the last probe ends, until the window runs out.
  function tick(mine) {
    cancel = wait(async () => {
      cancel = null;
      const seen = mine === gen && standing() ? await ask(st.account) : null;
      if (mine !== gen) return;
      if (seen === true) return clear();
      if (standing()) return tick(mine);
      running = 0;
    }, RECHECK_MS);
  }
  function watch() {
    if (running === gen) return;
    running = gen;
    tick(gen);
  }

  return {
    // Every switch comes here. The new account is probed beside the others, and an answer from before a later switch is dropped.
    switched(account) {
      clear();
      if (!enabled || !accounts.usesChrome()) return;
      const mine = gen;
      st = { checking: true, account, until: now() + WATCH_MS, opened: false };
      Promise.all(accounts.list().map(async a => ({ a, seen: await ask(a) }))).then(got => {
        if (mine !== gen) return;
        if (got.find(x => x.a.id === account.id)?.seen === true) return clear();
        const other = got.find(x => x.a.id !== account.id && x.seen === true);
        st = { ...st, checking: false, onId: other?.a.id };
        watch();
      });
    },
    state() {
      if (!st) return null;
      if (st.checking) return { checking: true };
      const on = st.onId && accounts.find(st.onId);
      return { state: on ? 'elsewhere' : 'unknown', to: brief(accounts.find(st.account.id) ?? st.account), ...(on && { on: brief(on) }), email: emailOf(st.account.id) || '', opened: st.opened && now() < st.until };
    },
    dismiss: clear,
    // Opens the extension's settings on the Mac, and watches for another ten minutes from now. Resolves with the refusal, or an empty string.
    async open() {
      const mine = gen;
      try { await openSettings(); } catch { return OPEN_FAILED; }
      if (mine !== gen || !st || st.checking) return '';
      st.opened = true;
      st.until = now() + WATCH_MS;
      watch();
      return '';
    },
  };
}
