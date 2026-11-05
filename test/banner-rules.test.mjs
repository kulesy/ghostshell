// Run with `npm test`. What the sidebar banners say, which button they offer and how fast the page polls. Dates are built in the page's zone,
// so the test reads the same anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft, endWords, FAST_MS, forceQuestion, keptWhileRestarting, loginBanner, pollMs, SLOW_MS, supportsBanners, updateBanner } from '../public/ui/banner-rules.js';

const NOW = new Date(2026, 10, 2, 8, 0).getTime();
const login = over => ({ visible: true, signedOut: false, endsAt: new Date(2026, 10, 6, 9, 36).getTime(), stage: 'idle', problem: '', ...over });
const update = over => ({ show: true, kind: 'update', stage: 'idle', count: 3, changes: [], restart: true, blocked: '', busy: 0, force: true, problem: '', ...over });

test('only a server that sets banners gets the banners', () => {
  assert.equal(supportsBanners({ features: { banners: true } }), true);
  assert.equal(supportsBanners({ features: { subagents: true } }), false);
  assert.equal(supportsBanners(null), false);
});

test('the end of a sign-in is said as a day, a date and a clock time in the page\'s zone', () => {
  assert.equal(endWords(new Date(2026, 10, 6, 9, 36).getTime()), 'Fri 6 Nov, 09:36');
  assert.equal(endWords(new Date(2026, 11, 1, 0, 5).getTime()), 'Tue 1 Dec, 00:05');
  assert.equal(daysLeft(new Date(2026, 10, 2, 23, 59).getTime(), NOW), 0);
  assert.equal(daysLeft(new Date(2026, 10, 3, 0, 1).getTime(), NOW), 1);
  assert.equal(daysLeft(new Date(2026, 10, 6, 9, 36).getTime(), NOW), 4);
});

test('a sign-in ending soon names the days left, and says today and tomorrow when it is', () => {
  const view = loginBanner(login(), NOW);
  assert.equal(view.title, "Claude's sign-in ends in 4 days");
  assert.equal(view.text, 'It ends on Fri 6 Nov, 09:36. Chats and routines stop until you sign in again. Signing in now starts a fresh four weeks.');
  assert.deepEqual([view.tone, view.action, view.progress, view.problem], [null, { label: 'Sign in on the Mac', busy: false }, '', '']);
  assert.equal(loginBanner(login({ endsAt: new Date(2026, 10, 3, 9, 0).getTime() }), NOW).title, "Claude's sign-in ends tomorrow");
  assert.equal(loginBanner(login({ endsAt: new Date(2026, 10, 2, 23, 0).getTime() }), NOW).title, "Claude's sign-in ends today");
});

test('signed out is a warning that says every chat and routine fails', () => {
  const view = loginBanner(login({ signedOut: true, endsAt: null }), NOW);
  assert.deepEqual([view.tone, view.title, view.text], ['warning', 'Claude is signed out', 'Every chat and routine fails until you sign in again.']);
});

test('while the CLI waits the button is busy and the banner says to approve the page on the Mac', () => {
  const view = loginBanner(login({ stage: 'waiting' }), NOW);
  assert.deepEqual([view.action, view.progress], [{ label: 'Waiting for the Mac', busy: true }, 'Approve the sign-in page in the browser on the Mac.']);
});

test('a failed sign-in shows the server\'s fixed reason and offers the button again', () => {
  const view = loginBanner(login({ stage: 'failed', problem: 'Timed out waiting for the sign-in page to be approved.' }), NOW);
  assert.deepEqual([view.problem, view.action.busy], ['Timed out waiting for the sign-in page to be approved.', false]);
});

test('no banner shows when the server says there is none', () => {
  assert.equal(loginBanner(login({ visible: false }), NOW), null);
  assert.equal(loginBanner(undefined, NOW), null);
  assert.equal(updateBanner({ show: false }), null);
  assert.equal(updateBanner(undefined), null);
});

test('waiting changes are counted in words, with one for a restart and one for the page alone', () => {
  const view = updateBanner(update());
  assert.deepEqual([view.title, view.text, view.action.label], ['3 merged changes are waiting', 'Updating restarts GhostShell once no chat is running.', 'Update and restart']);
  const one = updateBanner(update({ count: 1, restart: false }));
  assert.deepEqual([one.title, one.text, one.action.label], ['1 merged change is waiting', 'These change only the page, so updating needs no restart.', 'Update']);
});

test('five changes are listed with their links, and the rest are counted', () => {
  const changes = Array.from({ length: 7 }, (_, i) => ({ title: `Change ${i}`, url: `https://github.com/acme/widgets/pull/${i}` }));
  const view = updateBanner(update({ count: 12, changes }));
  assert.deepEqual([view.changes.length, view.more], [5, 7]);
  assert.equal(updateBanner(update({ count: 2, changes: changes.slice(0, 2) })).more, 0);
});

test('a pulled checkout says it waits for a restart and offers Restart', () => {
  const view = updateBanner(update({ kind: 'pulled', count: 2 }));
  assert.deepEqual([view.title, view.text, view.action.label], ['Pulled, waiting for a restart', 'Restarting GhostShell once no chat is running.', 'Restart']);
});

test('a restart says how many running chats it waits for, and then that it is restarting', () => {
  const said = busy => updateBanner(update({ stage: 'restarting', busy }));
  assert.equal(said(2).progress, 'Restarting once 2 running chats finish.');
  assert.equal(said(1).progress, 'Restarting once 1 running chat finishes.');
  assert.equal(said(0).progress, 'Restarting now.');
  assert.deepEqual(said(2).action, { label: 'Restarting', busy: true, blocked: false });
  assert.equal(updateBanner(update({ stage: 'updating' })).progress, 'Updating.');
  assert.equal(updateBanner(update({ stage: 'updating' })).action.label, 'Updating');
});

test('a restart held back by the quiet window disables the button and says why', () => {
  const view = updateBanner(update({ blocked: 'Restarts wait until 09:45 on weekdays.' }));
  assert.deepEqual([view.action.blocked, view.action.busy, view.progress], [true, false, 'Restarts wait until 09:45 on weekdays.']);
  assert.equal(updateBanner(update({ blocked: '' })).action.blocked, false);
});

test('a helper that gave up shows as the banner\'s problem', () => {
  assert.equal(updateBanner(update({ kind: 'pulled', problem: 'Gave up after 30 minutes without restarting.' })).problem, 'Gave up after 30 minutes without restarting.');
});

test('the page polls fast while a sign-in waits or a restart is under way, and slowly otherwise', () => {
  assert.equal(pollMs(null), SLOW_MS);
  assert.equal(pollMs({ login: { stage: 'idle' }, update: { stage: 'idle' } }), SLOW_MS);
  assert.equal(pollMs({ login: { stage: 'waiting' }, update: { show: false } }), FAST_MS);
  assert.equal(pollMs({ login: { stage: 'idle' }, update: { stage: 'restarting' } }), FAST_MS);
  assert.equal(pollMs({ login: { stage: 'idle' }, update: { stage: 'updating' } }), FAST_MS);
  assert.equal(pollMs({ login: { stage: 'idle' }, update: { stage: 'idle' }, chrome: { checking: true } }), FAST_MS);
  assert.equal(pollMs({ login: { stage: 'idle' }, update: { stage: 'idle' }, chrome: { state: 'unknown' } }), SLOW_MS);
  assert.equal(pollMs({ chrome: null }), SLOW_MS);
});

test('a failed read while restarting keeps the banner and drops the count of chats, since the server is gone', () => {
  const before = { login: { stage: 'idle' }, update: { stage: 'restarting', busy: 2, show: true } };
  assert.deepEqual(keptWhileRestarting(before).update, { stage: 'restarting', busy: 0, force: false, show: true });
  const idle = { update: { stage: 'idle', busy: 0 } };
  assert.equal(keptWhileRestarting(idle), idle);
  assert.equal(keptWhileRestarting(null), null);
});

test('the Force restart button is offered only when the server says so, as an outline button', () => {
  assert.deepEqual(updateBanner(update()).force, { label: 'Force restart', variant: 'outline' });
  assert.equal(updateBanner(update({ force: false })).force, null);
  assert.equal(updateBanner(update({ force: undefined })).force, null, 'an older server sends none');
});

test('the Force restart question counts the chats it cuts, in the singular too', () => {
  assert.equal(forceQuestion(update({ kind: 'pulled', busy: 3 })), '3 running chats will be cut.');
  assert.equal(forceQuestion(update({ kind: 'pulled', busy: 1 })), '1 running chat will be cut.');
  assert.equal(forceQuestion(update({ kind: 'pulled', busy: 0 })), 'No chat is running, so none will be cut.');
});

test('the Force restart question says the changes are pulled first, and that it goes ahead inside the quiet window', () => {
  assert.equal(forceQuestion(update({ busy: 2, count: 3 })), '2 running chats will be cut. The 3 merged changes will be pulled first.');
  assert.equal(forceQuestion(update({ busy: 0, count: 1 })), 'No chat is running, so none will be cut. The 1 merged change will be pulled first.');
  assert.equal(
    forceQuestion(update({ kind: 'pulled', busy: 1, blocked: 'Restarts wait until 09:45 on weekdays.' })),
    '1 running chat will be cut. This goes ahead inside the quiet window, which holds restarts until 09:45 on weekdays.',
  );
});

test('with an account named, the signed out banner names it and says which chats and routines fail', () => {
  const view = loginBanner(login({ signedOut: true, endsAt: null, account: 'Second', accountId: 'second' }), NOW);
  assert.deepEqual([view.tone, view.title, view.text], ['warning', 'Second is signed out', 'Chats and routines on Second fail until you sign in again.']);
});

test('with an account named, an ending sign-in names it and keeps the existing text', () => {
  const view = loginBanner(login({ account: 'Second', accountId: 'second' }), NOW);
  assert.equal(view.title, "Second's sign-in ends in 4 days");
  assert.equal(view.text, 'It ends on Fri 6 Nov, 09:36. Chats and routines stop until you sign in again. Signing in now starts a fresh four weeks.');
  assert.equal(loginBanner(login({ account: 'Second', endsAt: new Date(2026, 10, 3, 9, 0).getTime() }), NOW).title, "Second's sign-in ends tomorrow");
  assert.equal(loginBanner(login({ account: 'Second', endsAt: new Date(2026, 10, 2, 23, 0).getTime() }), NOW).title, "Second's sign-in ends today");
});
