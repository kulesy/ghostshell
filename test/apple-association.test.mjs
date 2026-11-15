// Run with `node --test test/apple-association.test.mjs`. The iPhone app's associated domain file is answered only for a valid team ID.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request, start } from './harness.mjs';

const PATH = '/.well-known/apple-app-site-association';
const asked = teamId => start({ env: { CAPCOM_APPLE_TEAM_ID: teamId } }).then(s => request(s, 'GET', PATH).then(res => ({ s, res })));

test('a valid team ID is answered as JSON before sign-in, with no redirect', async () => {
  const { res } = await asked('ABCDE12345');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.headers.location, undefined);
  assert.deepEqual(res.body(), { webcredentials: { apps: ['ABCDE12345.com.kulesy.ghostshell.iphone'] } });
});

test('an unset or invalid team ID keeps the answer any unknown path gets', async () => {
  const unknown = await asked('');
  const reference = await request(unknown.s, 'GET', '/.well-known/something-else');
  assert.equal(unknown.res.status, reference.status);
  assert.equal(unknown.res.text, reference.text);
  assert.doesNotMatch(unknown.res.text, /webcredentials/);
  const unset = await start();
  assert.equal((await request(unset, 'GET', PATH)).text, reference.text);
  for (const bad of ['abcde12345', 'ABCDE1234', 'ABCDE123456', 'ABCDE-2345', '../../etc']) {
    const { res } = await asked(bad);
    assert.equal(res.text, reference.text, bad);
  }
});
