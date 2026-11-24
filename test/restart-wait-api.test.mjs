// Run with `npm test`. The route a restart worker reads each chat's background jobs from, over HTTP against the real server with the fake CLI of test/harness.mjs,
// and the real bin/restart.mjs waiting on it. See docs/always-on.md "Restart the service".
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TOKEN_FILE, TOKEN_HEADER } from '../lib/restart.mjs';
import { as, request, signIn, start, until, ROOT } from './harness.mjs';

const SECRET = 'a-token-the-worker-wrote';
const SESSIONS = [{ id: 'live', title: 'Runs the deploy', source: 'cli', ago: 1 }];

async function open() {
  const s = await start({ claude: true, sessions: SESSIONS });
  const { token } = await signIn(s);
  const say = text => request(s, 'POST', '/api/sessions/live/send', { headers: { origin: s.origin, ...as(token) }, json: { text } });
  const ask = (header = SECRET, method = 'GET') => request(s, method, '/restart-wait', { headers: header === null ? {} : { [TOKEN_HEADER]: header } });
  const tokenFile = path.join(s.state, TOKEN_FILE);
  return { s, say, ask, tokenFile };
}

test('the route answers 403 JSON to every request that does not hold the token, and never HTML, though it sits before the sign-in', async () => {
  const { ask, tokenFile } = await open();
  const refused = async (res, why) => {
    assert.equal(res.status, 403, why);
    assert.match(res.headers['content-type'], /^application\/json/, why);
    assert.deepEqual(res.body(), { error: 'Not allowed.' }, why);
  };
  await refused(await ask(), 'no token file');
  fs.writeFileSync(tokenFile, SECRET);
  await refused(await ask(null), 'no header');
  await refused(await ask('wrong'), 'a wrong header');
  await refused(await ask(SECRET, 'POST'), 'a POST with the right header');
  fs.writeFileSync(tokenFile, '');
  await refused(await ask(''), 'an empty file and an empty header');
  await refused(await ask('x'), 'an empty file');
});

test('with the token the route lists each chat that has a process with its pid, job count and title, and a job that ends brings it back to 0', async () => {
  const { s, say, ask, tokenFile } = await open();
  fs.writeFileSync(tokenFile, SECRET);
  assert.deepEqual((await ask()).body(), { chats: [] }, 'no chat has a process yet');
  await say('start a job');
  await until(async () => (await ask()).body().chats[0]?.jobs === 1);
  await say('finish the turn');
  const [chat] = (await ask()).body().chats;
  assert.deepEqual([chat.jobs, chat.title], [1, 'Runs the deploy']);
  assert.match(execFileSync('ps', ['-p', String(chat.pid), '-o', 'command=']).toString(), /claude/, 'the pid is the CLI process');
  await say('end the job');
  await until(async () => (await ask()).body().chats[0]?.jobs === 0);
  assert.equal((await ask()).status, 200);
});

test('npm run restart waits on a chat that ended its turn with a background job running, names it in its log, and goes once the job ends', async () => {
  const { s, say, ask, tokenFile } = await open();
  await say('start a job');
  await until(() => fs.existsSync(path.join(s.home, 'claude.log')));
  await say('finish the turn');
  const transcript = path.join(s.home, '.claude', 'projects', '-test-folder', 'live.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } })}\n${JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } })}\n`);
  const launchctl = path.join(s.home, 'launchctl');
  fs.writeFileSync(launchctl, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(path.join(s.home, 'launchctl.log'))}, process.argv.slice(2).join(' ') + '\\n');\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: s.home, PORT: String(s.port), CAPCOM_STATE: s.state, CAPCOM_LAUNCHCTL: launchctl, CAPCOM_RESTART_MIN_UPTIME_MS: '0', CAPCOM_RESTART_POLL_MS: '100' };
  const worker = spawn(process.execPath, [path.join(ROOT, 'bin', 'restart.mjs'), '--foreground', '--label', 'com.example.capcom', '--wait', '1'], { env });
  let out = '';
  worker.stdout.on('data', d => { out += d; });
  worker.stderr.on('data', d => { out += d; });
  try {
    await until(() => /Waiting for "Runs the deploy" \(1 background job\)\./.test(out), 10_000);
    assert.ok(fs.existsSync(tokenFile), 'the worker left its token for the server to check');
    assert.ok(!fs.existsSync(path.join(s.home, 'launchctl.log')), 'nothing restarted while the job ran');
    await say('end the job');
    await until(() => fs.existsSync(path.join(s.home, 'launchctl.log')), 10_000);
    assert.match(fs.readFileSync(path.join(s.home, 'launchctl.log'), 'utf8'), /kickstart -k gui\/\d+\/com\.example\.capcom/);
  } finally { worker.kill(); }
  await until(() => !fs.existsSync(tokenFile), 5000);
});
