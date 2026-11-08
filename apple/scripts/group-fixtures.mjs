// A stub server for the group screenshots. A group view needs sessions in every part, pull requests in several states, a chat with suggested
// tasks and a reply that is refused, none of which a scratch server can be made to hold on demand. It records every POST for the checks.
import http from 'node:http';

const HOUR = 3_600_000;
const iso = at => new Date(at).toISOString();

const REPLY = `The build is green again. Two changes fixed it:

- The cache key now includes the lockfile, so a stale cache can no longer be restored.
- The \`prebuild\` step runs before the tests, not after.

\`\`\`sh
npm run build && npm test
\`\`\`

> I did not touch the release workflow.`;

export async function startGroupStub() {
  const now = Date.now();
  const row = (id, title, extra = {}) => ({ id, title, state: 'idle', cwd: '/Users/me/Projects/site', branch: 'main', lastActivityAt: now - 2 * 60_000, sortAt: now - 2 * 60_000, ...extra });
  const subs = [
    row('s-wait', 'Draft the release notes', { state: 'waiting', dot: 'awaiting' }),
    row('s-pr', 'Add the audit log', { dot: 'ready', lastActivityAt: now - 20 * 60_000 }),
    row('s-work', 'Write the changelog', { state: 'working', dot: 'running', lastActivityAt: now - 30_000 }),
    row('s-merged', 'Fix the flaky build', { lastActivityAt: now - 3 * HOUR }),
    row('s-fam', 'Ship the release', { lastActivityAt: now - 5 * HOUR, children: [row('s-kid', 'Check the build', { parent: 's-fam', lastActivityAt: now - 5 * HOUR, state: 'working', dot: 'running' })] }),
    row('s-idle', 'Old release rehearsal', { lastActivityAt: now - 3 * 24 * HOUR }),
  ];
  const index = {
    station: 'stub', projects: [], pinned: [], routines: [], started: [], other: [],
    features: { groupSessions: true, sectionSessions: true, subStatus: true, pullStatus: true },
    sections: [],
    groups: [{ id: 'g1', name: 'Release', project: null, session: { id: 'gchat', state: 'idle' }, sessions: subs }],
    ungrouped: [row('solo', 'A session outside the group', { lastActivityAt: now - 40 * HOUR })],
  };
  const summaries = {
    's-wait': { line: 'Waiting for approval to run the tests.', ask: '', at: now - 2 * 60_000, pending: [{ tool: 'Bash', summary: 'npm test' }], reply: 'I need to run the tests before I write the notes.' },
    's-pr': { line: 'The audit log is ready for review.', ask: '', at: now - 20 * 60_000, pending: [], reply: 'The audit log is in. Please review the pull request.' },
    's-work': { line: 'Writing the changelog.', ask: '', at: now - 30_000, pending: [], reply: 'Going through the merged changes now.' },
    's-merged': { line: 'The build is green.', ask: '', at: now - 3 * HOUR, pending: [], reply: REPLY },
    's-fam': { line: 'Ship the release.', ask: '', at: now - 5 * HOUR, pending: [], reply: 'The release is cut.' },
    's-kid': { line: 'Checking the build.', ask: '', at: now - 5 * HOUR, pending: [], reply: 'Still checking.' },
    's-idle': { line: 'Rehearsal done.', ask: '', at: now - 3 * 24 * HOUR, pending: [], reply: 'Nothing left to do.' },
  };
  const pull = (n, state, extra = {}) => ({ kind: 'pull', url: `https://github.com/example/site/pull/${n}`, title: `Pull request ${n}`, repo: 'example/site', number: n, state,
    mine: true, asked: false, requested: 0, review: '', checks: 'passing', conflicts: false, clean: true, ...extra });
  const pulls = { 's-pr': [pull(201, 'open', { asked: true })], 's-merged': [pull(198, 'merged', { review: 'approved' })] };

  const chipInput = (title, tldr) => ({ title, tldr, prompt: `${tldr}\n\nStart with the failing test and work outward.`, cwd: '/Users/me/Projects/site' });
  const spawn = (id, input) => [{ kind: 'tool', id, name: 'mcp__capcom__spawn_task', summary: input.title, input, status: 'pending' }, { kind: 'result', toolId: id, status: 'ok', output: 'Chip shown.' }];
  const items = [
    { kind: 'user', text: 'What is left before we can ship the release?', at: iso(now - 9 * 60_000) },
    { kind: 'assistant', msgId: 'g1', text: 'Two things are left. I have split them into tasks you can start from here.', at: iso(now - 8 * 60_000) },
    ...spawn('chip-open', chipInput('Add a retry to the upload step', 'The upload step fails once in five runs.')),
    ...spawn('chip-started', chipInput('Tidy the release scripts', 'Merge the two release scripts into one.')),
  ];
  const chips = {
    'chip-started': { toolUseId: 'chip-started', sessionId: 'gchat', title: 'Tidy the release scripts', tldr: '', status: 'started', startedId: 'started-1', opensIn: 'Opened in Release', prompt: '' },
  };

  const calls = [];
  let startFails = true;
  const json = (res, body, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://stub');
      const body = Buffer.concat(chunks).toString();
      if (req.method === 'POST') calls.push(`${url.pathname} ${body}`);
      const { pathname } = url;
      if (pathname === '/login') return void res.writeHead(303, { Location: '/', 'Set-Cookie': 'capcom=stub; HttpOnly' }).end();
      if (pathname === '/api/sessions') return json(res, index);
      if (pathname === '/api/summaries') return json(res, { summaries: Object.fromEntries(url.searchParams.get('ids').split(',').filter(id => summaries[id]).map(id => [id, summaries[id]])) });
      if (pathname === '/api/pulls') return json(res, { pulls: Object.fromEntries(url.searchParams.get('ids').split(',').filter(id => pulls[id]).map(id => [id, pulls[id]])), settling: false });
      if (pathname === '/api/sessions/gchat/chips') return json(res, { chips: Object.values(chips) });
      if (pathname === '/api/chips/start' || pathname === '/api/chips/dismiss') {
        const { toolUseId, title } = JSON.parse(body || '{}');
        if (pathname.endsWith('start') && startFails) { startFails = false; return json(res, { error: 'This chip has no prompt or folder to start from.' }, 400); }
        const started = pathname.endsWith('start');
        chips[toolUseId] = { toolUseId, sessionId: 'gchat', title, tldr: '', status: started ? 'started' : 'dismissed', startedId: started ? 'started-2' : undefined, opensIn: started ? 'Opened in Release' : undefined, prompt: '' };
        return json(res, { id: started ? 'started-2' : undefined, chip: chips[toolUseId] });
      }
      if (/^\/api\/sessions\/s-[^/]+\/send$/.test(pathname)) return json(res, { error: 'That session is busy with another reply.' }, 409);
      if (pathname === '/api/layout/archive') return json(res, { id: JSON.parse(body).id, archived: true, stopped: false });
      const m = /^\/api\/sessions\/gchat\/(messages|events)$/.exec(pathname);
      if (m?.[1] === 'messages') {
        return json(res, { items, start: 0, end: items.length * 100, hasEarlier: false, reset: false, fileLinks: false, terminal: false,
          session: { id: 'gchat', title: 'Release', cwd: '/Users/me/Projects/site', branch: 'main', connectors: {} } });
      }
      if (m?.[1] === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        return void res.write(`event: status\ndata: ${JSON.stringify({ state: 'idle', running: true, model: 'claude-sonnet-5-5', mode: 'default', live: '' })}\n\n`);
      }
      return json(res, {}, 404);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    address: `http://localhost:${server.address().port}`,
    calls,
    stop: () => { server.closeAllConnections(); server.close(); },
  };
}
