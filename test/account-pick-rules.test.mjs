// Run with `npm test`. What the account picks and notices show, as rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChoices, accountItems, accountLabel, accountMenu, blockedNow, blockedPlan, CHROME_NOTE, chatAccount, chromeNote, draftAccount, offersPick, pinnedChromeWords, pinnedStay, pinnedWords, rowAccountMenu, rowFor, SWITCH_LEAVES_PINS } from '../public/ui/account-rules.js';

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

test('a new session under a parent shows the account the parent is pinned to, its own pick comes first, and a parent on the active account changes nothing', () => {
  const ix = { ...IX, started: [
    { id: 'held', account: 'second', accountFrom: 'session' },
    { id: 'grouped', account: 'second', accountFrom: 'group' },
    { id: 'free', account: 'main', accountFrom: 'active' },
    { id: 'kid', parent: 'held', account: 'main', accountFrom: 'active' },
  ] };
  const draft = (parent, picked = null) => chatAccount({ ix, accounts: LIST, draft: true, id: null, group: null, parent, picked }).shown;
  assert.equal(draft('held'), 'second');
  assert.equal(draft('grouped'), 'second');
  assert.equal(draft('kid'), 'second', 'a sub session stands for its parent');
  assert.equal(draft('held', 'main'), 'main');
  assert.equal(draft('free'), LIST.find(a => a.active).id);
  assert.equal(draft('gone'), LIST.find(a => a.active).id);
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

test('a switch that cannot move a session is replaced by a line naming the account its pin keeps it on', () => {
  const words = "This session stays on Second because of a pin, so a switch won't move it. Change the pin to move it.";
  for (const accountFrom of ['session', 'group', 'project', 'routine', 'parent']) assert.equal(pinnedStay({ account: 'second', accountFrom }, [MAIN, SECOND]), words, accountFrom);
  assert.equal(pinnedStay({ account: 'second', accountFrom: 'active' }, [MAIN, SECOND]), '', 'a session nothing pins is moved by a switch');
  assert.equal(pinnedStay({ account: 'main' }, [MAIN, SECOND]), '', 'a row with no account facts is moved by a switch');
  assert.equal(pinnedStay(null, [MAIN, SECOND]), '');
  assert.match(pinnedStay({ account: 'gone', accountFrom: 'session' }, [MAIN, SECOND]), /^This session stays on its account because/);
});

test('what an account has pinned is counted with the right singular and plural, left out when zero, and empty when nothing is pinned', () => {
  assert.equal(pinnedWords({ sessions: 2, groups: 1, projects: 0, routines: 0 }), 'Pinned: 2 sessions, 1 group');
  assert.equal(pinnedWords({ sessions: 1, groups: 2, projects: 1, routines: 3 }), 'Pinned: 1 session, 2 groups, 1 project, 3 routines');
  assert.equal(pinnedWords({ sessions: 0, groups: 0, projects: 0, routines: 1 }), 'Pinned: 1 routine');
  assert.equal(pinnedWords({ sessions: 0, groups: 0, projects: 0, routines: 0 }), '');
  assert.equal(pinnedWords(undefined), '', 'a server that sends no counts');
  assert.equal(SWITCH_LEAVES_PINS, 'A switch leaves pinned work on its account.');
});

// The survey proved Chrome is on Main, so Second carries `chromeOn: 'main'`.
const NO_CHROME = { ...SECOND, chromeOn: 'main' };

test('an account the survey proved cannot reach Chrome reads No Chrome in the menu, and stays selectable', () => {
  const items = accountItems({ accounts: [MAIN, NO_CHROME], pin: null, pick: () => {} });
  const second = items.find(i => i.label === 'Second');
  assert.equal(second.value, 'No Chrome');
  assert.ok(!second.disabled);
  assert.equal(items.find(i => i.label === 'Main').value, null);
});

test('Signed out wins over No Chrome in the menu and the routine form', () => {
  const list = [MAIN, { ...NO_CHROME, signedOut: true }];
  assert.equal(accountItems({ accounts: list, pin: null, pick: () => {} }).find(i => i.label === 'Second').value, 'Signed out');
  assert.equal(accountChoices(list, '')[2][1], 'Second (signed out)');
});

test('the note under the pick says where Chrome is when the survey proved it, and is the static limit otherwise', () => {
  assert.equal(chromeNote([MAIN, NO_CHROME]), "Chrome is on Main, so work on another account can't reach it.");
  assert.equal(chromeNote([MAIN, SECOND]), CHROME_NOTE);
  assert.equal(chromeNote([MAIN]), CHROME_NOTE);
  assert.equal(chromeNote(null), CHROME_NOTE);
  const notes = accountItems({ accounts: [MAIN, NO_CHROME], pin: null, pick: () => {} }).filter(i => i.note).map(i => i.note);
  assert.equal(notes.at(-1), chromeNote([MAIN, NO_CHROME]));
});

test('the routine form marks an account with no Chrome and keeps it selectable', () => {
  const choices = accountChoices([MAIN, NO_CHROME], '');
  assert.deepEqual(choices[2], ['second', 'Second (no Chrome)', false]);
  assert.equal(choices[1][1], 'Main');
});

test('a chromeOn that points at an account no longer listed counts as absent everywhere', () => {
  const stale = [MAIN, { ...SECOND, chromeOn: 'gone' }];
  assert.equal(accountItems({ accounts: stale, pin: null, pick: () => {} }).find(i => i.label === 'Second').value, null);
  assert.equal(chromeNote(stale), CHROME_NOTE);
  assert.equal(accountChoices(stale, '')[2][1], 'Second');
  assert.equal(pinnedChromeWords({ ...stale[1], pinned: { sessions: 1 } }, stale), '');
});

test('the Accounts page line appears only for an account with a pin and a proven lack of Chrome', () => {
  const list = [MAIN, NO_CHROME];
  const pinned = { sessions: 1, groups: 0, projects: 0, routines: 0 };
  assert.equal(pinnedChromeWords({ ...NO_CHROME, pinned }, list), "Chrome is on Main, so these can't reach it.");
  assert.equal(pinnedChromeWords({ ...NO_CHROME, pinned: { sessions: 0, groups: 0, projects: 0, routines: 0 } }, list), '', 'nothing pinned, nothing to reach Chrome');
  assert.equal(pinnedChromeWords({ ...MAIN, pinned }, list), '', 'the account Chrome is on');
  assert.equal(pinnedChromeWords({ ...SECOND, pinned }, [MAIN, SECOND]), '', 'no proof');
});
