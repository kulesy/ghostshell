// A stub server for the chip account journeys. Three chats each hold one suggested-task card: one that names an account, one that names a signed
// out account and one that names none. It serves the account list, the chips and the Start and Dismiss routes, and records every POST.
import http from 'node:http';

const MAIN = { id: 'main', name: 'Main' };
const SECOND = { id: 'second', name: 'Second' };
const THIRD = { id: 'third', name: 'Third' };
const choices = Object.fromEntries([MAIN, SECOND, THIRD].map(a => [a.id, { account: a.id }]));

export async function startChipStub() {
  const now = Date.now();
  const chatIds = ['chip-named', 'chip-out', 'chip-pins'];
  const rows = [
    { id: 'chip-named', title: 'Suggest a task on a named account', state: 'idle', dot: null, sortAt: now - 60_000 },
    { id: 'chip-out', title: 'Suggest a task on a signed out account', state: 'idle', dot: null, sortAt: now - 120_000 },
    { id: 'chip-pins', title: 'Suggest a task with no account', state: 'idle', dot: null, sortAt: now - 180_000 },
  ];
  const accounts = [
    { id: 'main', name: 'Main', stage: 'idle', signedOut: false, active: true, pinned: {}, chats: [] },
    { id: 'second', name: 'Second', stage: 'idle', signedOut: false, active: false, pinned: {}, chats: [] },
    { id: 'third', name: 'Third', stage: 'idle', signedOut: true, active: false, pinned: {}, chats: [] },
  ];
  const input = { title: 'Add a retry to the upload step', tldr: 'The upload step fails once in five runs.', prompt: 'The upload step fails once in five runs.\n\nStart with the failing test and work outward.', cwd: '/Users/me/Projects/site' };
  const itemsOf = chat => [
    { kind: 'user', text: 'What should we do about the upload step?', at: new Date(now - 9 * 60_000).toISOString() },
    { kind: 'assistant', msgId: `${chat}-a`, text: 'I have written it up as a task you can start from here.', at: new Date(now - 8 * 60_000).toISOString() },
    { kind: 'tool', id: `${chat}-tool`, name: 'mcp__capcom__spawn_task', summary: input.title, input, status: 'pending' },
    { kind: 'result', toolId: `${chat}-tool`, status: 'ok', output: 'Chip shown.' },
  ];
  const chips = {
    'chip-named': { toolUseId: 'chip-named-tool', sessionId: 'chip-named', title: input.title, tldr: input.tldr, status: 'open', prompt: input.prompt, cwd: input.cwd, account: 'second',
      accountCard: { account: 'main', from: 'active', choices } },
    'chip-out': { toolUseId: 'chip-out-tool', sessionId: 'chip-out', title: input.title, tldr: input.tldr, status: 'open', prompt: input.prompt, cwd: input.cwd, account: 'third',
      accountCard: { account: 'main', from: 'active', choices } },
  };
  const pinsDefault = { account: 'second', from: 'group', fromName: 'Release', choices };

  const calls = [];
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
      if (pathname === '/api/sessions') return json(res, { ungrouped: rows });
      if (pathname === '/api/accounts') return json(res, { autoSwitch: false, waiting: false, accounts });
      const chat = /^\/api\/sessions\/([^/]+)\/(chips|messages|events)$/.exec(pathname);
      if (chat && chatIds.includes(chat[1])) {
        if (chat[2] === 'chips') return json(res, { chips: chips[chat[1]] ? [chips[chat[1]]] : [], accountDefault: pinsDefault });
        if (chat[2] === 'messages') {
          const items = itemsOf(chat[1]);
          return json(res, { items, start: 0, end: items.length * 100, hasEarlier: false, reset: false, fileLinks: false, terminal: false,
            session: { id: chat[1], title: 'Release', cwd: input.cwd, branch: 'main', connectors: {} } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        return void res.write(`event: status\ndata: ${JSON.stringify({ state: 'idle', running: true, model: 'claude-sonnet-5-5', mode: 'default', live: '' })}\n\n`);
      }
      if (pathname === '/api/chips/start' || pathname === '/api/chips/dismiss') {
        const { toolUseId, sessionId } = JSON.parse(body || '{}');
        const started = pathname.endsWith('start');
        const chat = sessionId ?? toolUseId.replace(/-tool$/, '');
        chips[chat] = { toolUseId, sessionId: chat, title: input.title, tldr: '', status: started ? 'started' : 'dismissed', startedId: started ? 'started-1' : undefined, opensIn: started ? 'Opened in Release' : undefined, prompt: '' };
        return json(res, { id: started ? 'started-1' : undefined, chip: chips[chat] });
      }
      return json(res, {}, 404);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    address: `http://localhost:${server.address().port}`,
    rows,
    calls,
    stop: () => { server.closeAllConnections(); server.close(); },
  };
}
