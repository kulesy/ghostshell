// The Claude accounts GhostShell can run chats under. The first is the CLI's own sign-in, left as the server found it. An added account is a config folder
// of its own, so the CLI keeps a separate sign-in for it and GhostShell never touches a token. See docs/adr/20261102-switch-claude-accounts.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAIN = 'main';
export const MAX_NAME = 40;
const STALE_LOCK_MS = 60_000;

// NOTE: [2 Nov 2026] EK - The CLI names a folder's keychain entry after the first 8 hex digits of the SHA-256 of CLAUDE_CONFIG_DIR as given: NFC only, no ~, realpath
// or trimming (checked on CLI 2.1.316). If that moves, an account's sign-in end is unreadable and it falls back to the CLI's own loggedIn.
export const serviceFor = dir => (dir ? `Claude Code-credentials-${crypto.createHash('sha256').update(String(dir).normalize('NFC')).digest('hex').slice(0, 8)}` : 'Claude Code-credentials');

// What belongs to one login, so an added account keeps its own. Every name that starts with a dot is left out as well, which covers the CLI's lock files.
const PER_ACCOUNT = new Set(['.claude.json', '.credentials.json', 'sessions', 'session-env', 'shell-snapshots', 'statsig', 'cache', 'backups', 'daemon', 'jobs', 'teams',
  'policy-limits.json', 'remote-settings.json', 'history.jsonl', 'debug', 'telemetry', 'stats-cache.json', 'mcp-needs-auth-cache.json']);
const perAccount = name => name.startsWith('.') || PER_ACCOUNT.has(name);

// The user settings in .claude.json that an added account takes from the first. They hold MCP settings, which can carry API keys, so they are never logged.
export const SETTING_KEYS = ['mcpServers', 'projects', 'hasCompletedOnboarding', 'githubRepoPaths', 'claudeInChromeDefaultEnabled', 'hasCompletedClaudeInChromeOnboarding', 'cachedChromeExtensionInstalled'];

const readObject = file => {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return undefined; }
};

export function makeAccounts(stateDir, { env = process.env, home = os.homedir, warn = () => {} } = {}) {
  const file = path.join(stateDir, 'accounts.json');
  const first = { id: MAIN, name: 'Main' };
  let saved = { active: MAIN, autoSwitch: false, accounts: [first] };

  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text !== null) try {
    const got = JSON.parse(text);
    const added = (Array.isArray(got.accounts) ? got.accounts : []).filter(a => typeof a?.id === 'string' && a.id !== MAIN && typeof a.dir === 'string' && typeof a.name === 'string');
    const named = got.accounts?.find?.(a => a?.id === MAIN)?.name;
    saved = { active: got.active, autoSwitch: got.autoSwitch === true, accounts: [{ ...first, ...(typeof named === 'string' && named && { name: named }) }, ...added.map(({ id, name, dir }) => ({ id, name, dir }))] };
  } catch {
    // The next save would overwrite a corrupt file and lose the added accounts, so it is moved aside. Its content is not quoted.
    try {
      fs.renameSync(file, `${file}.bad-${Date.now()}`);
      warn('accounts.json could not be read and was moved aside. Only the first account is listed.');
    } catch { /* the first account alone */ }
  }
  if (!saved.accounts.some(a => a.id === saved.active)) saved.active = MAIN;

  const save = () => {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(saved, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  };

  const sharedDir = () => env.CLAUDE_CONFIG_DIR || path.join(home(), '.claude');
  const sharedJson = () => (env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home(), '.claude.json'));

  // A link for each shared entry, checked again at every switch so an entry added to the first folder later is linked too. A real file is left alone.
  const link = account => {
    const from = sharedDir();
    fs.mkdirSync(account.dir, { recursive: true, mode: 0o700 });
    for (const d of [path.dirname(account.dir), account.dir]) fs.chmodSync(d, 0o700);
    for (const name of fs.readdirSync(from)) {
      if (perAccount(name)) continue;
      const to = path.join(account.dir, name);
      const source = path.join(from, name);
      let seen = null;
      try { seen = fs.lstatSync(to); } catch { /* not there yet */ }
      if (seen && !seen.isSymbolicLink()) continue;
      if (seen) {
        if (fs.readlinkSync(to) === source) continue;
        fs.unlinkSync(to);
      }
      fs.symlinkSync(source, to);
    }
  };

  // Read, merge and rename under the CLI's own lock for that file, and skip when the CLI holds it. A file that cannot be read is left as it is.
  const copySettings = account => {
    const wanted = readObject(sharedJson());
    if (!wanted) return;
    const target = path.join(account.dir, '.claude.json');
    const lock = `${target}.lock`;
    // A lock the CLI left behind when it was killed is taken over once it is a minute old.
    try { fs.mkdirSync(lock); } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs <= STALE_LOCK_MS) return;
        fs.rmdirSync(lock);
        fs.mkdirSync(lock);
      } catch { return; }
    }
    try {
      const have = fs.existsSync(target) ? readObject(target) : {};
      if (!have) return;
      const temp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ ...have, ...Object.fromEntries(SETTING_KEYS.filter(k => k in wanted).map(k => [k, wanted[k]])) }, null, 2), { mode: 0o600 });
      fs.renameSync(temp, target);
    } finally {
      fs.rmdirSync(lock);
    }
  };

  const find = id => saved.accounts.find(a => a.id === id) ?? null;
  const taken = (name, except) => saved.accounts.some(a => a.id !== except && a.name.toLowerCase() === name.toLowerCase());
  const cleanName = (name, except) => {
    const text = typeof name === 'string' ? name.trim() : '';
    if (!text || text.length > MAX_NAME || /[\p{Cc}]/u.test(text)) return { problem: `Give the account a name of 1 to ${MAX_NAME} characters.` };
    if (taken(text, except)) return { problem: 'Another account already has that name.' };
    return { name: text };
  };

  return {
    list: () => saved.accounts.map(a => ({ ...a })),
    find,
    get active() { return find(saved.active); },
    get autoSwitch() { return saved.autoSwitch; },
    serviceOf: account => serviceFor(account.dir ?? env.CLAUDE_CONFIG_DIR),
    // What `claude auth` is given beside its clean environment: the account's folder, when it has one.
    loginEnvOf: account => (account.dir ?? env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: account.dir ?? env.CLAUDE_CONFIG_DIR } : {}),
    // The environment a process of this account starts with: the server's own, plus the folder of an added account.
    envFor: account => (account.dir ? { ...env, CLAUDE_CONFIG_DIR: account.dir } : env),
    // Makes the account's folder and brings its links and settings up to date. A failure is logged without any value and leaves the account as it was.
    prepare(account) {
      if (!account.dir) return;
      try { link(account); } catch (e) { warn(`Could not link the shared entries for ${account.name}: ${e.code || 'error'}`); }
      try { copySettings(account); } catch (e) { warn(`Could not copy the settings for ${account.name}: ${e.code || 'error'}`); }
    },
    add(name) {
      const got = cleanName(name);
      if (got.problem) return got;
      const id = `a${crypto.randomBytes(4).toString('hex')}`;
      const account = { id, name: got.name, dir: path.join(stateDir, 'accounts', id) };
      saved.accounts.push(account);
      save();
      return { account };
    },
    rename(id, name) {
      const account = find(id);
      if (!account) return { problem: 'No such account.' };
      const got = cleanName(name, id);
      if (got.problem) return got;
      account.name = got.name;
      save();
      return { account };
    },
    setActive(id) {
      saved.active = id;
      save();
    },
    setAuto(on) {
      saved.autoSwitch = on === true;
      save();
    },
  };
}
