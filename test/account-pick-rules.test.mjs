// Run with `npm test`. What the account picks and notices show, as rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChoices, accountItems, accountLabel, blockedPlan, offersPick, rowIn } from '../public/ui/account-rules.js';

const ON = { features: { accountPins: true } };
const MAIN = { id: 'main', name: 'Main' };
const SECOND = { id: 'second', name: 'Second' };

test('a single account with nothing pinned shows no pick, and a pin keeps it', () => {
  assert.equal(offersPick(ON, [MAIN], false), false);
  assert.equal(offersPick(ON, [MAIN], true), true);
  assert.equal(offersPick(ON, [MAIN, SECOND], false), true);
});

test('an older server that does not pin shows no pick, even with a pin or two accounts', () => {
  assert.equal(offersPick({ features: {} }, [MAIN, SECOND], true), false);
});

test('the menu marks the pin, lets Active account clear it, and ends in the two notes', () => {
  const picked = [];
  const items = accountItems({ accounts: [MAIN, SECOND], pin: 'second', follows: 'Main', pick: id => picked.push(id) });
  assert.deepEqual(items.filter(i => i.checked).map(i => i.label), ['Second']);
  items[0].run();
  assert.deepEqual(picked, [null]);
  assert.equal(items[1].run !== undefined, true);
  assert.equal(items[2].run, undefined);
  assert.equal(items.filter(i => i.note).length, 2);
});

test('a signed out account cannot be picked, and shows as signed out', () => {
  const items = accountItems({ accounts: [MAIN, { ...SECOND, signedOut: true }], pin: null, pick: () => {} });
  const second = items.find(i => i.label === 'Second');
  assert.equal(second.disabled, true);
  assert.equal(second.value, 'Signed out');
});

test('a pin to an account no longer listed shows as a removed account, marked', () => {
  const items = accountItems({ accounts: [MAIN], pin: 'gone', pick: () => {} });
  assert.deepEqual(items.filter(i => i.checked).map(i => i.label), ['Removed account']);
});

test('the quiet label names the account only when more than one is listed', () => {
  assert.equal(accountLabel([MAIN, SECOND], 'second'), 'Second');
  assert.equal(accountLabel([MAIN], 'main'), '');
});

test('a blocked notice acts at the level the block names', () => {
  const ctx = { id: 's1', group: 'g1', project: 'p1', routine: 'r1' };
  const out = { reason: 'signed-out', account: SECOND, message: 'words' };
  assert.deepEqual(blockedPlan({ ...out, from: 'group' }, ctx).change, { kind: 'group', id: 'g1' });
  assert.equal(blockedPlan({ ...out, from: 'group' }, ctx).signIn, 'second');
  assert.deepEqual(blockedPlan({ reason: 'removed', account: null, from: 'project' }, ctx).clear, { kind: 'project', id: 'p1' });
  assert.deepEqual(blockedPlan({ reason: 'removed', account: null, from: 'session' }, ctx).clear, { kind: 'session', id: 's1' });
  assert.equal(blockedPlan({ ...out, from: 'routine' }, ctx).routine, 'r1');
  assert.equal(blockedPlan(null, ctx), null);
});

test('a row is found in a group, in the started list or under a parent', () => {
  const ix = { pinned: [], groups: [{ sessions: [{ id: 'a', children: [{ id: 'kid' }] }] }], started: [{ id: 'b' }], ungrouped: [], other: [], routines: [] };
  assert.equal(rowIn(ix, 'kid').id, 'kid');
  assert.equal(rowIn(ix, 'b').id, 'b');
  assert.equal(rowIn(ix, 'zzz'), null);
});

test('the routine form keeps a signed out or removed value as its own option and disables a signed out one it is not on', () => {
  const list = [MAIN, { ...SECOND, signedOut: true }];
  assert.deepEqual(accountChoices(list, '').map(c => c[2]), [false, false, true]);
  assert.deepEqual(accountChoices(list, 'second').map(c => c[2]), [false, false, false]);
  assert.deepEqual(accountChoices([MAIN], 'gone').at(-1), ['gone', 'Removed account', false]);
});
