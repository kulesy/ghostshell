// Run with `npm test`. The per-account state: who can take over from an account that ran out of usage, how long an out-of-usage mark counts, switching by itself,
// the one sign-in at a time, and what is asked of the CLI and when. Every part that touches the machine is a fake, and the clock is one the test moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INFO_MS, makeAccountLogins, OUT_MS, resetOf, RESTARTING, SIGN_IN_WAITING } from '../lib/account-logins.mjs';

const START = Date.parse('2026-11-02T00:00:00Z');
const DAY = 86_400_000;
const MIN = 60_000;

// `who` maps an account id to what its fake CLI says. An id with `null` says nothing usable, and one with `loggedIn: false` is signed out.
function rig({ ids = ['main', 'second', 'third'], auto = false, who = {}, restarting = false, used = [] } = {}) {
  const r = { at: START, noEnd: false, endOf: {}, used, asks: [], ends: 0, retired: 0, begun: [], prepared: [], switches: [], restarting, who };
  for (const id of ids) if (!(id in r.who)) r.who[id] = { loggedIn: true, email: `${id}@example.com`, subscriptionType: 'max', orgId: `org-${id}` };
  const list = ids.map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) }));
  let active = ids[0];
  r.accounts = {
    list: () => list.map(a => ({ ...a })),
    find: id => list.find(a => a.id === id) ?? null,
    get active() { return list.find(a => a.id === active); },
    autoSwitch: auto,
    serviceOf: a => `service-${a.id}`,
    loginEnvOf: a => ({ CLAUDE_CONFIG_DIR: a.id }),
    prepare: a => r.prepared.push(a.id),
    setActive: id => { active = id; },
  };
  r.logins = makeAccountLogins({
    accounts: r.accounts,
    authInfo: async ({ extra }) => { r.asks.push(extra.CLAUDE_CONFIG_DIR); return r.who[extra.CLAUDE_CONFIG_DIR]; },
    readLoginEnd: async ({ service }) => { r.ends++; return r.noEnd ? null : r.endOf[service.replace('service-', '')] ?? r.at + 20 * DAY; },
    startSignIn: ({ extra }) => { r.begun.push(extra.CLAUDE_CONFIG_DIR); return { exited: new Promise(() => {}), stop() {} }; },
    retireOtherAccounts: () => { r.retired++; },
    inUse: () => r.used,
    afterSwitch: a => r.switches.push([a.id, active]),
    restarting: () => r.restarting,
    now: () => r.at,
  });
  r.active = () => active;
  r.spare = () => r.logins.spareAccount()?.id ?? null;
  return r;
}

const checked = async r => { await r.logins.refreshAll(); return r; };

test('an account is a spare once it has been checked, is signed in and is not out', async () => {
  const r = rig();
  assert.equal(r.spare(), null, 'nothing is known before the first check');
  await r.logins.refresh(r.accounts.find('second'));
  assert.equal(r.spare(), 'second');
  r.who.third = { loggedIn: false };
  r.noEnd = true;
  await r.logins.refreshAll();
  r.logins.markUsage('second', "You've hit your limit");
  assert.equal(r.spare(), null, 'third is signed out and second is out');
});

test('an out mark counts for an hour, then the account is a spare again', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  r.logins.markUsage('second', 'out');
  r.logins.markUsage('main', 'out');
  assert.equal(r.logins.banner().out, null, 'the only other account is out too');
  r.at += OUT_MS - 1;
  assert.equal(r.spare(), null);
  assert.deepEqual(r.logins.view().map(a => a.out?.text), ['out', 'out']);
  r.at += 1;
  assert.equal(r.spare(), 'second');
  assert.deepEqual(r.logins.view().map(a => a.out), [null, null], 'the page shows a mark only while it counts');
  r.logins.markUsage('main', 'out again');
  assert.deepEqual(r.logins.banner().out, { text: 'out again', at: r.at, name: 'Main', to: { id: 'second', name: 'Second' } });
  r.at += OUT_MS;
  assert.equal(r.logins.banner().out, null, 'the active account is no longer shown as out either');
});

test('a clean turn clears a mark at once', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  r.logins.markUsage('second', 'out');
  assert.equal(r.spare(), null);
  r.logins.markUsage('second', null);
  assert.equal(r.spare(), 'second');
});

test('a spare is never the same Claude account as the active one', async () => {
  const r = await checked(rig({ who: { second: { loggedIn: true, email: 'main@example.com', subscriptionType: 'max', orgId: 'org-main' } } }));
  assert.equal(r.spare(), 'third', 'second is main again');
  assert.deepEqual(r.logins.view().map(a => a.sameAs), ['second', 'main', null]);
});

test('with the setting on the first mark switches once, notes it, and a second spent account cannot flip back within the hour', async () => {
  const r = await checked(rig({ ids: ['main', 'second'], auto: true }));
  r.logins.markUsage('main', 'out');
  assert.equal(r.active(), 'second');
  assert.equal(r.retired, 1);
  assert.deepEqual(r.logins.banner().auto, { at: START, from: { id: 'main', name: 'Main' }, to: { id: 'second', name: 'Second' } });
  r.at += 10 * MIN;
  r.logins.markUsage('second', 'out');
  assert.equal(r.active(), 'second', 'main still counts as out');
  r.at += OUT_MS;
  r.logins.markUsage('second', 'out');
  assert.equal(r.active(), 'main', 'main is offered again once its mark has lapsed');
  r.logins.seen();
  assert.equal(r.logins.banner().auto, null);
});

test('a mark on an account that is not the active one, or with the setting off, switches nothing', async () => {
  const off = await checked(rig({ ids: ['main', 'second'] }));
  off.logins.markUsage('main', 'out');
  assert.equal(off.active(), 'main');
  const on = await checked(rig({ ids: ['main', 'second'], auto: true }));
  on.logins.markUsage('second', 'out');
  assert.equal(on.active(), 'main');
});

test('auto-switch does not pick an account before its first check', async () => {
  const r = rig({ ids: ['main', 'second'], auto: true });
  r.logins.markUsage('main', 'out');
  assert.equal(r.active(), 'main');
  await r.logins.refresh(r.accounts.find('second'));
  r.logins.markUsage('main', 'out');
  assert.equal(r.active(), 'second');
});

test('an account the CLI says is signed out is not a spare, and one whose check said nothing is not shut out', async () => {
  const r = rig({ ids: ['main', 'second', 'third'], who: { second: { loggedIn: false }, third: null } });
  r.noEnd = true;
  await r.logins.refreshAll();
  assert.equal(r.logins.state(r.accounts.find('second')).signedOut, true);
  assert.equal(r.spare(), 'third');
});

test('the CLI is asked on the timer and not on a read, and a failed answer is not asked again at once', async () => {
  const r = rig({ ids: ['main', 'second'], who: { second: null } });
  await r.logins.refreshAll();
  assert.deepEqual(r.asks.filter(id => id === 'second').length, 1);
  r.logins.view();
  r.logins.banner();
  r.logins.loginNow();
  assert.equal(r.asks.length, 2, 'reads ask nothing');
  await r.logins.refresh(r.accounts.find('second'));
  assert.equal(r.asks.length, 2, 'not again within ten minutes, though the answer was nothing');
  r.at += INFO_MS + 1;
  await r.logins.refresh(r.accounts.find('second'));
  assert.equal(r.asks.length, 3);
  assert.deepEqual(r.logins.view().map(a => [a.email, a.planType]), [['main@example.com', 'max'], [null, null]]);
});

test('one sign-in runs at a time across the accounts, and one that is waiting may be pressed again', async () => {
  const r = await checked(rig());
  const [main, second] = ['main', 'second'].map(id => r.accounts.find(id));
  assert.equal(r.logins.blocked(), '');
  assert.equal(r.logins.signIn(second), '');
  assert.deepEqual(r.begun, ['second']);
  assert.deepEqual(r.prepared, ['second']);
  assert.equal(r.logins.waiting(), true);
  assert.equal(r.logins.signIn(main), SIGN_IN_WAITING);
  assert.equal(r.logins.blocked(), SIGN_IN_WAITING);
  assert.equal(r.logins.signIn(second), '', 'the waiting one is let through');
  assert.deepEqual(r.begun, ['second'], 'and does not start a second CLI');
});

test('no sign-in starts while GhostShell is about to restart', async () => {
  const r = await checked(rig({ restarting: true }));
  assert.equal(r.logins.signIn(r.accounts.find('second')), RESTARTING);
  assert.deepEqual(r.begun, []);
});

test('the sign-in banner follows the active account and names it once there is more than one', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  assert.equal(r.logins.loginNow().account, 'Main');
  r.logins.switchTo(r.accounts.find('second'));
  assert.equal(r.logins.loginNow().account, 'Second');
  assert.deepEqual(r.prepared, ['second']);
  const one = await checked(rig({ ids: ['main'] }));
  assert.equal('account' in one.logins.loginNow(), false);
});

test('the last plan answer is kept on the account it belongs to', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  r.logins.keepPlan('second', { limits: [], at: START });
  r.logins.keepPlan('nobody', { limits: [], at: START });
  assert.deepEqual(r.logins.view().map(a => a.plan), [null, { limits: [], at: START }]);
});

test('a switch by hand and a switch by itself both tell afterSwitch, once the new account is active', async () => {
  const r = await checked(rig({ ids: ['main', 'second'], auto: true }));
  r.logins.switchTo(r.accounts.find('second'));
  assert.deepEqual(r.switches, [['second', 'second']]);
  r.logins.switchTo(r.accounts.find('main'));
  r.logins.markUsage('main', 'out');
  assert.deepEqual(r.switches, [['second', 'second'], ['main', 'main'], ['second', 'second']]);
});

// ---- the sign-in banner across the accounts in use. `endOf` sets the end of an account's sign-in, and a past end with a CLI that says signed out is a signed out account.

const signOut = (r, id) => { r.endOf[id] = r.at - 1; r.who[id] = { loggedIn: false }; };
const shown = r => { const { account, accountId, visible } = r.logins.loginNow(); return [accountId, account, visible]; };

test('the sign-in banner follows the active account alone when no other account is in use, and names it once more than one is listed', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  assert.deepEqual(shown(r), ['main', 'Main', false]);
  const one = await checked(rig({ ids: ['main'] }));
  assert.deepEqual(Object.keys(one.logins.loginNow()).sort(), ['endsAt', 'problem', 'signedOut', 'stage', 'visible'], 'with one account the answer is as it was');
});

test('an account that is not in use does not show a banner, signed out or ending', async () => {
  const r = rig({ ids: ['main', 'second'] });
  signOut(r, 'second');
  await checked(r);
  assert.deepEqual(shown(r), ['main', 'Main', false]);
  r.used = ['second'];
  assert.deepEqual(shown(r), ['second', 'Second', true]);
  r.used = [];
  r.endOf.second = r.at + 2 * DAY;
  r.who.second = { loggedIn: true };
  await r.logins.refresh(r.accounts.find('second'));
  assert.equal(r.logins.loginNow().visible, false, 'an ending sign-in on an account nobody uses is not shown either');
});

test('of the accounts in use, a sign-in waiting on the Mac shows first, then a signed out account, then the sign-in ending soonest, the active account winning a tie', async () => {
  const r = rig({ used: ['second', 'third'] });
  r.endOf.main = r.at + 3 * DAY;
  r.endOf.second = r.at + 2 * DAY;
  signOut(r, 'third');
  await checked(r);
  assert.equal(shown(r)[0], 'third', 'signed out beats an ending sign-in');
  r.logins.signIn(r.accounts.find('second'));
  assert.equal(shown(r)[0], 'second', 'a sign-in waiting on the Mac beats a signed out account');
  assert.deepEqual(r.logins.loginNow().stage, 'waiting');

  const ending = rig({ used: ['second', 'third'] });
  ending.endOf.main = ending.at + 3 * DAY;
  ending.endOf.second = ending.at + 2 * DAY;
  ending.endOf.third = ending.at + 4 * DAY;
  await checked(ending);
  assert.equal(shown(ending)[0], 'second', 'the soonest end');
  ending.endOf.main = ending.at + 2 * DAY;
  await checked(ending);
  assert.equal(shown(ending)[0], 'main', 'the active account wins a tie');
  ending.endOf.second = ending.at + 20 * DAY;
  ending.endOf.main = ending.at + 20 * DAY;
  ending.endOf.third = ending.at + 20 * DAY;
  await checked(ending);
  assert.deepEqual(shown(ending), ['main', 'Main', false], 'none visible answers the active account');
});

test('one banner shows at a time, and the next shows once that one is fixed', async () => {
  const r = rig({ used: ['second', 'third'] });
  signOut(r, 'second');
  signOut(r, 'third');
  await checked(r);
  assert.equal(shown(r)[0], 'second');
  r.endOf.second = r.at + 20 * DAY;
  r.who.second = { loggedIn: true };
  await checked(r);
  assert.equal(shown(r)[0], 'third');
});

test('an id in use that no account has is ignored', async () => {
  const r = await checked(rig({ ids: ['main', 'second'], used: ['gone', 'second', 'second'] }));
  assert.deepEqual(shown(r), ['main', 'Main', false]);
});

test('an out mark moved to a reset lasts until it, a reset in the past leaves the hour, and a clean turn still clears it', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  r.logins.markUsage('second', 'out');
  r.logins.outUntil('second', r.at - 1);
  r.logins.outUntil('second', Number.NaN);
  r.at += OUT_MS - 1;
  assert.equal(r.logins.isOut('second'), true, 'the hour stands without a usable reset');
  r.at = START;
  r.logins.markUsage('second', 'out');
  r.logins.outUntil('second', START + 3 * 60 * MIN);
  r.at += OUT_MS + 1;
  assert.equal(r.logins.isOut('second'), true, 'longer than an hour');
  assert.equal(r.logins.isUsable('second'), false);
  assert.equal(r.logins.view()[1].out.text, 'out');
  r.at = START + 3 * 60 * MIN;
  assert.deepEqual([r.logins.isOut('second'), r.logins.isUsable('second')], [false, true]);

  r.at = START;
  r.logins.markUsage('second', 'out');
  r.logins.outUntil('second', START + 20 * MIN);
  r.at += 20 * MIN;
  assert.equal(r.logins.isOut('second'), false, 'a reset sooner than the hour ends the mark then');
  r.logins.markUsage('second', 'out');
  r.logins.outUntil('second', r.at + 5 * 60 * MIN);
  r.logins.markUsage('second', null);
  assert.equal(r.logins.isOut('second'), false);
  r.logins.outUntil('second', r.at + 5 * 60 * MIN);
  assert.equal(r.logins.isOut('second'), false, 'a late reset does not bring a cleared mark back');
});

test('a new mark replaces the reset of the old one, and an unknown account is neither out nor usable', async () => {
  const r = await checked(rig({ ids: ['main', 'second'] }));
  r.logins.markUsage('second', 'out');
  r.logins.outUntil('second', START + 5 * 60 * MIN);
  r.logins.markUsage('second', 'out again');
  r.at += OUT_MS;
  assert.equal(r.logins.isOut('second'), false);
  r.logins.outUntil('gone', START + 5 * 60 * MIN);
  assert.deepEqual([r.logins.isOut('gone'), r.logins.isUsable('gone')], [false, false]);
});

test('an account is usable only once checked, signed in and not out', async () => {
  const r = rig({ ids: ['main', 'second'], who: { second: { loggedIn: false } } });
  r.noEnd = true;
  assert.equal(r.logins.isUsable('main'), false, 'not checked yet');
  await r.logins.refreshAll();
  assert.deepEqual([r.logins.isUsable('main'), r.logins.isUsable('second')], [true, false]);
});

test('the reset of a plan answer is the latest among the unscoped limits at 100 percent', () => {
  const limit = (percent, resetsAt, scope = null) => ({ kind: 'k', group: 'g', percent, resetsAt, scope });
  assert.equal(resetOf([limit(100, '2026-11-09T05:00:00.000Z'), limit(100, '2026-11-12T00:00:00.000Z'), limit(40, '2026-11-20T00:00:00.000Z')]), Date.parse('2026-11-12T00:00:00.000Z'));
  assert.equal(resetOf([limit(99, '2026-11-12T00:00:00.000Z')]), null);
  assert.equal(resetOf([limit(100, null)]), null);
  assert.equal(resetOf([limit(100, '2026-11-09T05:00:00.000Z'), limit(100, '2026-11-14T00:00:00.000Z', 'Opus')]), Date.parse('2026-11-09T05:00:00.000Z'), 'a model-scoped limit does not stretch the mark');
  assert.equal(resetOf([limit(100, '2026-11-14T00:00:00.000Z', 'Opus')]), null);
  assert.equal(resetOf(null), null);
});
