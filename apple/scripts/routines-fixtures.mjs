// The routine and scheduled screens' stub, with fixed data: a heading with only idle routines, a loose idle routine, a routine with a run,
// a pending and a skipped scheduled session. Every write is recorded. By default each is refused; with `accept` it is applied to this stub's own lists
// and nothing else, so no real routine is made, changed, started or deleted. Never point the app at a real server for this: a Run now there starts a real session.
import http from 'node:http';

// Returns the server without listening, so the caller picks the port. `writes` holds each write, and GET /__writes returns them to a test.
export function routinesStub({ accept = false } = {}) {
  const now = Date.now();
  const day = 86_400_000;
  const iso = ms => {
    const offset = -new Date(ms).getTimezoneOffset();
    const pad = n => String(Math.abs(n)).padStart(2, '0');
    return `${new Date(ms + offset * 60_000).toISOString().slice(0, 19)}${offset >= 0 ? '+' : '-'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  };
  const at = (days, hour, minute = 0) => { const d = new Date(now + days * day); d.setHours(hour, minute, 0, 0); return d.getTime(); };
  // Days to the next Monday, so the weekly routine's `0 9 * * 1` and its next times agree.
  const monday = (8 - new Date(now).getDay()) % 7 || 7;
  const row = (id, title, extra = {}) => ({ id, title, state: 'idle', cwd: '/Users/me/Projects/site', branch: 'main', lastActivityAt: now - 600_000, sortAt: now - 600_000, ...extra });
  const index = {
    station: 'stub', projects: [],
    features: { routineEdits: true, routineFiles: true, routineHeadings: true, scheduled: true, accountPins: true },
    pinned: [],
    groups: [{ id: 'g1', name: 'Release', project: null, sessions: [row('rel-1', 'Write the changelog')] }],
    routines: [{ name: 'nightly', title: 'Nightly check', latest: row('run-3', 'Run', { routine: 'nightly' }), earlier: [row('run-2', 'Run', { lastActivityAt: now - day })] }],
    ungrouped: [row('u-1', 'Look at the failing build')],
  };
  const routine = (id, title, extra = {}) => ({
    id, title, cron: '0 9 * * 1', jitterSeconds: 0, file: `/Users/me/.ghostshell/routines/${id}.md`, cwd: '/Users/me/Projects/site', enabled: true,
    lastRunAt: null, lastSessionId: null, lastError: null, running: false, next: iso(at(1, 9)), ...extra,
  });
  // Reports has only idle routines, Old backup is idle and loose, and nightly is the one with runs.
  const routineList = { routines: [
    routine('nightly', 'Nightly check', { cron: '30 7 * * 1-5', lastRunAt: iso(now - 600_000), lastSessionId: 'run-3', next: iso(at(1, 7, 30)) }),
    routine('weekly', 'Weekly report', { heading: 'Reports', next: iso(at(monday, 9)) }),
    routine('sync', 'Sync the docs', { heading: 'Reports', cron: '15 */4 * * *', next: iso(now + 3_600_000) }),
    routine('backup', 'Old backup', { cron: '0 2 * * *', enabled: false, next: null }),
  ] };
  const scheduled = (id, title, extra = {}) => ({
    id, title, at: iso(at(1, 9)), cwd: '/Users/me/Projects/site', prompt: 'Draft the release notes from the merged pull requests.', status: 'pending', running: false, ...extra,
  });
  const scheduledList = { scheduled: [
    scheduled('notes', 'Draft the release notes', { group: 'g1', groupName: 'Release' }),
    scheduled('review', 'Quarterly review', { at: iso(at(3, 14, 30)), cwd: '/Users/me/Projects/web' }),
    scheduled('keys', 'Rotate the keys', { at: iso(at(-1, 8)), status: 'skipped', lastError: 'The folder /Users/me/gone is not there.' }),
    scheduled('done', 'Archive the old logs', { at: iso(at(-2, 18)), status: 'started', sessionId: 'u-1', startedAt: iso(at(-2, 18)) }),
  ] };
  const writes = [];
  const send = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  // Accept mode: the same lists the GET routes serve, changed the way the real server changes them.
  let made = 0;
  const kept = ['title', 'heading', 'cron', 'jitterSeconds', 'cwd', 'model', 'effort', 'mode', 'account', 'enabled'];
  const apply = (method, pathname, body, res) => {
    const [, , kind, id, action] = pathname.split('/');
    const list = kind === 'routines' ? routineList.routines : scheduledList.scheduled;
    const key = kind === 'routines' ? 'routine' : 'scheduled';
    const entry = list.find(e => e.id === id);
    if (method === 'POST' && !id) {
      const fresh = kind === 'routines'
        ? routine(`made-${++made}`, body.title, { enabled: true, ...pick(body, kept) })
        : scheduled(`made-${++made}`, body.title, { ...pick(body, ['at', 'cwd', 'model', 'effort', 'mode', 'group']), groupName: body.group === 'g1' ? 'Release' : undefined });
      list.push(fresh);
      return send(res, 200, { [key]: fresh });
    }
    if (!entry) return send(res, 404, { error: 'That is not here.' });
    if (method === 'DELETE') { list.splice(list.indexOf(entry), 1); return send(res, 200, { ok: true }); }
    if (method === 'PATCH') { Object.assign(entry, pick(body, [...kept, 'at', 'group'])); return send(res, 200, { [key]: entry }); }
    if (action === 'enabled') entry.enabled = body.enabled;
    if (action === 'run') Object.assign(entry, { lastRunAt: iso(now), lastSessionId: 'u-1' });
    if (action === 'cancel') entry.status = 'cancelled';
    if (action === 'start') Object.assign(entry, { status: 'started', sessionId: 'u-1', startedAt: iso(now) });
    return send(res, 200, action === 'run' || action === 'start' ? { sessionId: 'u-1', [key]: entry } : { [key]: entry });
  };
  const pick = (from, keys) => Object.fromEntries(keys.filter(k => k in from).map(k => [k, from[k]]));
  const stub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const { pathname } = new URL(req.url, 'http://stub');
      if (pathname === '/login') return res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
      if (req.method !== 'GET') {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* not JSON */ }
        writes.push({ method: req.method, pathname, body });
        if (accept) return apply(req.method, pathname, body, res);
        return send(res, 400, { error: 'That could not be saved.', problems: pathname.includes('scheduled')
          ? { title: 'Give it a title.', cwd: 'That folder is not there.' } : { cron: 'Use five fields, such as 30 7 * * 1-5.', cwd: 'That folder is not there.' } });
      }
      if (pathname === '/__writes') return send(res, 200, writes);
      if (pathname === '/api/routines') return send(res, 200, routineList);
      if (/^\/api\/routines\/[\w-]+\/prompt$/.test(pathname)) return send(res, 200, { file: '/Users/me/.ghostshell/routines/weekly.md', text: 'Write the weekly report from the merged pull requests.\n', ours: true });
      if (pathname === '/api/scheduled') return send(res, 200, scheduledList);
      if (pathname === '/api/schedule') return send(res, 200, { next: [iso(at(monday, 9)), iso(at(monday + 7, 9)), iso(at(monday + 14, 9))] });
      if (pathname === '/api/folders') return send(res, 200, { folders: ['/Users/me/Projects/site', '/Users/me/Projects/web'] });
      if (pathname === '/api/accounts') return send(res, 200, { accounts: [{ id: 'work', name: 'Work', active: true }, { id: 'home', name: 'Home' }] });
      return send(res, 200, pathname.startsWith('/api/archived') ? { archived: [] } : index);
    });
  });
  return { server: stub, writes };
}
