// Run with `npm test`. The route that gives Ctrl+K the pull requests each session links, over HTTP against the real server: it needs a sign-in, answers
// from what the worker read in the seeded transcripts, and says when it is still reading. No gh is run and no network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { as, request, signIn, start, until } from './harness.mjs';

const pr = (n, repo = 'acme/web') => `https://github.com/${repo}/pull/${n}`;
const get = (s, token) => request(s, 'GET', '/api/pull-links', { headers: as(token) });

test('the pull request links are refused without a sign-in', async () => {
  const s = await start({ sessions: [{ id: 'top', title: 'Top' }] });
  assert.equal((await request(s, 'GET', '/api/pull-links')).status, 401);
});

test('every pull request a session names is listed under its id, with the number and repo, and nothing for a session that names none', async () => {
  const s = await start({ sessions: [
    { id: 'a', title: 'First', said: [`Opened ${pr(7969)} and ${pr(7969, 'acme/docs')}`] },
    { id: 'b', title: 'Second', said: [`Reviewed ${pr(7969)}`, pr(12)] },
    { id: 'c', title: 'Third' },
  ] });
  const { token } = await signIn(s);
  await until(async () => !(await get(s, token)).body().reading);
  const got = await get(s, token);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body(), { links: { a: ['acme/web#7969', 'acme/docs#7969'], b: ['acme/web#7969', 'acme/web#12'] }, reading: false });
});
