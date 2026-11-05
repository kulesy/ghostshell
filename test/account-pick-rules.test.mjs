// Run with `npm test`. What the account picks and notices show, as rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChoices, accountItems, accountLabel, accountMenu, blockedNow, blockedPlan, chatAccount, draftAccount, offersPick, rowAccountMenu, rowFor } from '../public/ui/account-rules.js';

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

test('a blocked notice acts at the pin the server names, whatever the level the block came from', () => {
  const out = { reason: 'signed-out', account: SECOND, message: 'words' };
  assert.deepEqual(blockedPlan({ ...out, from: 'group', pin: { kind: 'group', id: 'g1' } }).change, { kind: 'group', id: 'g1' });
  assert.equal(blockedPlan({ ...out, from: 'group', pin: { kind: 'group', id: 'g1' } }).signIn, 'second');
  assert.deepEqual(blockedPlan({ reason: 'removed', account: null, from: 'project', pin: { kind: 'project', id: 'p1' } }).clear, { kind: 'project', id: 'p1' });
  assert.deepEqual(blockedPlan({ reason: 'removed', account: null, from: 'parent', pin: { kind: 'session', id: 'top' } }).clear, { kind: 'session', id: 'top' });
  assert.equal(blockedPlan(null), null);
});

test('a routine pin links to the routine form by id and offers no clear or change, for any run of it', () => {
  const plan = blockedPlan({ reason: 'removed', account: null, from: 'routine', pin: { kind: 'routine', id: 'r1' } });
  assert.deepEqual([plan.routine, plan.clear, plan.change], ['r1', null, null]);
  assert.equal(blockedPlan({ reason: 'signed-out', account: SECOND, from: 'parent', pin: { kind: 'routine', id: 'r2' } }).routine, 'r2');
});

test('the row tells the truth about a block, and a refusal holds only until the list is read again', () => {
  const refused = { message: 'refused' };
  const row = { blocked: { message: 'row' } };
  assert.equal(blockedNow({ row, refused, fresh: true }).message, 'refused');
  assert.equal(blockedNow({ row: {}, refused, fresh: false }), null);
  assert.equal(blockedNow({ row, refused: null, fresh: true }).message, 'row');
  assert.equal(blockedNow({ row: null, status: { blocked: { message: 'status' } }, refused: null, fresh: false }).message, 'status');
});

test('a row is found in a group, in the started list, under a parent, in a routine, or as a group\'s own chat', () => {
  const ix = { pinned: [], groups: [{ id: 'g', sessions: [{ id: 'a', children: [{ id: 'kid' }] }], session: { id: 'gchat' } }], started: [{ id: 'b' }], ungrouped: [], other: [], routines: [{ latest: { id: 'run' }, earlier: [{ id: 'old' }] }] };
  for (const id of ['kid', 'b', 'run', 'old', 'gchat']) assert.equal(rowFor(ix, id).id, id);
  assert.equal(rowFor(ix, 'zzz'), null);
});

const IX = { ...ON, pinned: [], ungrouped: [], other: [], started: [], routines: [], projects: [{ id: 'p1', account: 'main' }], groups: [{ id: 'gs', project: 'p1', account: 'second', sessions: [] }, { id: 'gp', project: 'p1', sessions: [] }, { id: 'gn', sessions: [] }] };
const LIST = [{ ...MAIN, active: true }, SECOND];

test('a draft runs on its own pick, then its group\'s pin, then its project\'s, then the active account, as the server starts it', () => {
  const at = (group, pick = null) => draftAccount({ ix: IX, accounts: LIST, group, pick });
  assert.deepEqual(at('gs', 'main'), { account: 'main', from: 'session' });
  assert.deepEqual(at('gs'), { account: 'second', from: 'group' });
  assert.deepEqual(at('gp'), { account: 'main', from: 'project' });
  assert.deepEqual(at('gn'), { account: 'main', from: 'active' });
  assert.deepEqual(at(null), { account: 'main', from: 'active' });
});

test('a draft in the Pinned section sends no group, so no group pin applies to it', () => {
  assert.equal(draftAccount({ ix: IX, accounts: LIST, group: 'pinned', pick: null }).from, 'active');
});

test('a server that does not pin sends no group, so a draft takes the active account', () => {
  assert.equal(draftAccount({ ix: { ...IX, features: {} }, accounts: LIST, group: 'gs', pick: null }).from, 'active');
});

test('the composer of a draft in a group pinned to Second labels Second and says Active account follows Second', () => {
  const got = chatAccount({ ix: IX, accounts: LIST, draft: true, id: null, group: 'gs', picked: null });
  assert.deepEqual([got.offered, got.shown, got.follows, got.pin], [true, 'second', 'Second', null]);
  assert.equal(chatAccount({ ix: IX, accounts: LIST, draft: true, id: null, group: 'gs', picked: 'main' }).shown, 'main');
});

test('the composer of a session has a pick only when its row is in the list, and a group\'s own chat has a label and no pick', () => {
  const ix = { ...IX, groups: [{ id: 'g', session: { id: 'gchat', account: 'second' }, sessions: [{ id: 's', account: 'main', accountPin: 'main' }] }] };
  const own = chatAccount({ ix, accounts: LIST, draft: false, id: 's' });
  assert.deepEqual([own.offered, own.pin, own.shown, own.follows], [true, 'main', 'main', '']);
  const chat = chatAccount({ ix, accounts: LIST, draft: false, id: 'gchat' });
  assert.deepEqual([chat.offered, chat.shown], [false, 'second']);
  assert.equal(chatAccount({ ix, accounts: LIST, draft: false, id: 'nope' }).offered, false);
});

test('one rule builds every Account menu, and offers nothing without a choice or the accounts', () => {
  const pick = () => {};
  assert.equal(accountMenu({ ix: IX, accounts: null, pin: null, pick }).length, 0);
  assert.equal(accountMenu({ ix: IX, accounts: [MAIN], pin: null, pick }).length, 0);
  const [item] = accountMenu({ ix: IX, accounts: LIST, pin: 'second', pick, icon: 'i' });
  assert.deepEqual([item.label, item.value, item.icon], ['Account', 'Second', 'i']);
  assert.equal(accountMenu({ ix: IX, accounts: [MAIN], pin: 'gone', pick })[0].value, 'Removed');
  const row = rowAccountMenu({ ix: IX, accounts: LIST, row: { account: 'second', accountPin: null }, pick })[0];
  assert.equal(row.items[0].value, 'Second');
  assert.equal(rowAccountMenu({ ix: IX, accounts: LIST, row: { account: 'second', accountPin: 'second' }, pick })[0].items[0].value, null);
});

test('the routine form keeps a signed out or removed value as its own option and disables a signed out one it is not on', () => {
  const list = [MAIN, { ...SECOND, signedOut: true }];
  assert.deepEqual(accountChoices(list, '').map(c => c[2]), [false, false, true]);
  assert.deepEqual(accountChoices(list, 'second').map(c => c[2]), [false, false, false]);
  assert.deepEqual(accountChoices([MAIN], 'gone').at(-1), ['gone', 'Removed account', false]);
});

test('the buttons say whose pin they act on when it is not the session\'s own', () => {
  const out = { reason: 'signed-out', account: SECOND, message: 'words' };
  const own = blockedPlan({ ...out, from: 'session', pin: { kind: 'session', id: 's' } });
  assert.deepEqual([own.changeLabel, own.clearLabel], ['Change the pin', 'Clear the pin']);
  assert.equal(blockedPlan({ ...out, from: 'parent', pin: { kind: 'group', id: 'g' } }).changeLabel, "Change the group's pin");
  assert.equal(blockedPlan({ reason: 'removed', account: null, from: 'project', pin: { kind: 'project', id: 'p' } }).clearLabel, "Clear the project's pin");
  assert.equal(blockedPlan({ reason: 'removed', account: null, from: 'parent', pin: { kind: 'session', id: 'top' } }).clearLabel, "Clear that session's pin");
});

test('a group\'s own chat reads its block from the row the index sends for it', () => {
  const rest = { pinned: [], started: [], ungrouped: [], other: [], routines: [] };
  const ix = { ...rest, groups: [{ id: 'g', session: { id: 'gchat', account: 'gone', blocked: { message: 'chat block' } }, sessions: [] }] };
  assert.equal(blockedNow({ row: rowFor(ix, 'gchat'), refused: null, fresh: false }).message, 'chat block');
  const cleared = { ...rest, groups: [{ id: 'g', session: { id: 'gchat', state: 'idle' }, sessions: [] }] };
  assert.equal(blockedNow({ row: rowFor(cleared, 'gchat'), refused: null, fresh: false }), null);
});
