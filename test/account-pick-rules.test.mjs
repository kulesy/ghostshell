// Run with `npm test`. What the account picks and notices show, as rules that need no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChoices, accountItems, accountLabel, accountMenu, blockedNow, blockedPlan, CHROME_NOTE, chatAccount, chipAccount, chipAccountItems, chromeNote, draftAccount, offersPick, pinnedChromeWords, pinsKey, pinnedStay, pinnedWords, rowAccountMenu, rowFor, spillLine, SWITCH_LEAVES_PINS } from '../public/ui/account-rules.js';

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

const THIRD = { id: 'third', name: 'Third' };
const overflowOf = items => items.find(i => i.group);

test('a pin that holds its own shows the overflow choices under it, with Stay on the pinned account marked when there is none', () => {
  const picked = [];
  const items = accountItems({ accounts: [MAIN, SECOND, THIRD], pin: 'second', follows: '', pick: () => {}, pickOverflow: id => picked.push(id) });
  const group = overflowOf(items);
  assert.equal(group.group, 'If Second runs out');
  assert.deepEqual(group.items.map(i => i.label), ['Main', 'Third', 'Stay on Second']);
  assert.deepEqual(group.items.filter(i => i.checked).map(i => i.label), ['Stay on Second']);
  group.items[0].run();
  assert.equal(group.items[2].run, undefined);
  assert.deepEqual(picked, ['main']);
});

test('the overflow in use is marked, can be run again to stay put, and has no run of its own', () => {
  const picked = [];
  const group = overflowOf(accountItems({ accounts: [MAIN, SECOND], pin: 'second', overflow: 'main', follows: '', pick: () => {}, pickOverflow: id => picked.push(id) }));
  assert.deepEqual(group.items.filter(i => i.checked).map(i => i.label), ['Main']);
  assert.equal(group.items[0].run, undefined);
  group.items[1].run();
  assert.deepEqual(picked, [null]);
});

test('no overflow choices without more than one account, a pin of its own, or a way to pick, and none for a removed pin', () => {
  const ask = o => overflowOf(accountItems({ follows: '', pick: () => {}, pickOverflow: () => {}, ...o }));
  assert.equal(ask({ accounts: [SECOND], pin: 'second' }), undefined);
  assert.equal(ask({ accounts: [MAIN, SECOND], pin: null }), undefined);
  assert.equal(ask({ accounts: [MAIN, SECOND], pin: 'second', pickOverflow: undefined }), undefined);
  assert.equal(ask({ accounts: [MAIN], pin: 'gone' }), undefined);
});

test('overflow choices carry No Chrome by the account pick rule, and a signed out account cannot be chosen', () => {
  const accounts = [{ ...MAIN, chromeOn: 'second' }, SECOND, { ...THIRD, signedOut: true }];
  const group = overflowOf(accountItems({ accounts, pin: 'second', follows: '', pick: () => {}, pickOverflow: () => {} }));
  const [main, third] = group.items;
  assert.equal(main.value, 'No Chrome');
  assert.equal(!!main.disabled, false);
  assert.deepEqual([third.value, third.disabled], ['Signed out', true]);
});

test('the Account menus pass the overflow of a row, a group or a project through, and the row menu keeps the pick', () => {
  const row = { accountPin: 'second', accountOverflow: 'main', account: 'second' };
  const [menu] = rowAccountMenu({ ix: ON, accounts: [MAIN, SECOND], row, pick: () => {}, pickOverflow: () => {} });
  assert.deepEqual(overflowOf(menu.items).items.filter(i => i.checked).map(i => i.label), ['Main']);
  const [other] = accountMenu({ ix: ON, accounts: [MAIN, SECOND], pin: 'second', overflow: 'main', pick: () => {}, pickOverflow: () => {} });
  assert.deepEqual(overflowOf(other.items).items.filter(i => i.checked).map(i => i.label), ['Main']);
});

test('a chat reads its overflow from its row, and a chat without a pin of its own has none', () => {
  const ix = { ...ON, pinned: [], groups: [], ungrouped: [], other: [], routines: [], started: [{ id: 'a', account: 'second', accountPin: 'second', accountOverflow: 'main' }, { id: 'b', account: 'main' }] };
  assert.equal(chatAccount({ ix, accounts: [MAIN, SECOND], id: 'a' }).overflow, 'main');
  assert.equal(chatAccount({ ix, accounts: [MAIN, SECOND], id: 'b' }).overflow, null);
});

test('the spill line names both accounts, adds Chrome when the survey proved the account it runs on cannot reach it, and is empty for a row that did not spill', () => {
  const row = { account: 'main', accountSpill: 'second' };
  assert.equal(spillLine(row, [MAIN, SECOND]), 'Second is out of usage, so this session runs on Main until Second resets.');
  assert.equal(spillLine(row, [{ ...MAIN, chromeOn: 'second' }, SECOND]), "Second is out of usage, so this session runs on Main until Second resets. Chrome is on Second, so it can't reach Chrome.");
  assert.equal(spillLine({ account: 'main' }, [MAIN, SECOND]), '');
  assert.equal(spillLine(row, [MAIN]), '', 'an account no longer listed has no line');
});

const ACTIVE = { account: 'main', from: 'active' };
const GROUP = { account: 'second', from: 'group', fromName: 'Loose', choices: { main: { account: 'main' }, second: { account: 'second' } } };

test('a chip card shows no account line with one account, no card from the server, or nothing to name', () => {
  assert.equal(chipAccount({ card: ACTIVE, accounts: [MAIN] }), null);
  assert.equal(chipAccount({ card: null, accounts: [MAIN, SECOND], named: 'second' }), null);
  assert.equal(chipAccount({ card: undefined, accounts: [MAIN, SECOND] }), null);
});

test('a chip with no account follows the pins, and posts a null account with the account it confirms', () => {
  const line = chipAccount({ card: ACTIVE, accounts: [MAIN, SECOND] });
  assert.deepEqual([line.state, line.ok, line.by, line.line, line.replaces], ['ok', true, 'pins', 'Starts on Main, the active account.', '']);
  assert.deepEqual(line.post, { account: null, confirmAccount: 'main' });
  const pinned = chipAccount({ card: GROUP, accounts: [MAIN, SECOND] });
  assert.equal(pinned.line, 'Starts on Second, pinned to the group Loose.');
  assert.deepEqual(pinned.post, { account: null, confirmAccount: 'second' });
});

test('the owner\'s pick wins over the chip, and the chip wins over the pins', () => {
  const chip = chipAccount({ card: GROUP, accounts: [MAIN, SECOND], named: 'main' });
  assert.deepEqual([chip.by, chip.id, chip.post], ['chip', 'main', { account: 'main', confirmAccount: 'main' }]);
  const picked = chipAccount({ card: GROUP, accounts: [MAIN, SECOND], named: 'main', pick: 'second' });
  assert.deepEqual([picked.by, picked.id, picked.line], ['pick', 'second', 'Starts on Second, picked here.']);
  const follow = chipAccount({ card: GROUP, accounts: [MAIN, SECOND], named: 'main', pick: null });
  assert.deepEqual([follow.by, follow.id, follow.post], ['pins', 'second', { account: null, confirmAccount: 'second' }]);
});

test('a chip that names an account other than its place\'s pin says it replaces the pin, and a chip that names the pinned account does not', () => {
  const replaced = chipAccount({ card: { ...GROUP, overflow: 'main' }, accounts: [MAIN, SECOND], named: 'main' });
  assert.equal(replaced.replaces, 'It does not follow the pin to Second on the group Loose, or its overflow to Main. It has no overflow account.');
  assert.equal(replaced.ok, true);
  assert.equal(chipAccount({ card: GROUP, accounts: [MAIN, SECOND], named: 'second' }).replaces, '');
  assert.equal(chipAccount({ card: ACTIVE, accounts: [MAIN, SECOND], named: 'second' }).replaces, '', 'the active account is not a pin');
});

test('the card names the holder of a pin by its kind and name, and says "the session it opens under" with no name', () => {
  const line = from => chipAccount({ card: { account: 'second', ...from }, accounts: [MAIN, SECOND] }).line;
  assert.equal(line({ from: 'project', fromName: 'Work' }), 'Starts on Second, pinned to the project Work.');
  assert.equal(line({ from: 'session', fromName: 'Maker' }), 'Starts on Second, pinned to the session “Maker”.');
  assert.equal(line({ from: 'session' }), 'Starts on Second, pinned to the session it opens under.');
});

test('a pin the account spilled off says which account it runs on and when the pinned one resets', () => {
  const card = { account: 'main', spill: 'second', from: 'group', fromName: 'Loose' };
  const line = chipAccount({ card, accounts: [MAIN, SECOND] });
  assert.equal(line.line, 'Starts on Main. Second, pinned to the group Loose, is out of usage, so it starts on Main until Second resets.');
  assert.deepEqual(line.post, { account: null, confirmAccount: 'main' });
});

test('a signed out account stops Start, and a removed one stops it with no sign-in state', () => {
  const out = chipAccount({ card: ACTIVE, accounts: [MAIN, { ...SECOND, signedOut: true }], named: 'second' });
  assert.deepEqual([out.state, out.ok, out.id, out.line], ['signedOut', false, 'second', 'Second, chosen by this chip, is signed out. Sign it in, or pick another account.']);
  const active = chipAccount({ card: ACTIVE, accounts: [{ ...MAIN, signedOut: true }, SECOND] });
  assert.deepEqual([active.state, active.ok], ['signedOut', false]);
  const named = chipAccount({ card: ACTIVE, accounts: [MAIN, SECOND], named: 'gone' });
  assert.deepEqual([named.state, named.ok, named.line], ['removed', false, 'The account this chip names is no longer listed. Pick another.']);
  const pinned = chipAccount({ card: { account: 'gone', from: 'group', fromName: 'Loose' }, accounts: [MAIN, SECOND] });
  assert.deepEqual([pinned.state, pinned.ok, pinned.line], ['removed', false, 'The pin it opens under is to an account that is no longer listed. Pick another.']);
  assert.equal(chipAccount({ card: { account: 'gone', from: 'group', blocked: { message: 'Blocked words.' } }, accounts: [MAIN, SECOND] }).line, 'Blocked words.');
});

test('the card\'s menu follows the pins first, lists each account, checks the current choice, and has no notes', () => {
  const picked = [];
  const make = line => chipAccountItems({ accounts: [MAIN, SECOND], card: GROUP, line, pick: id => picked.push(id) });
  const pins = make(chipAccount({ card: GROUP, accounts: [MAIN, SECOND] }));
  assert.deepEqual(pins.map(i => i.label), ['Follow the pins', 'Main', 'Second']);
  assert.deepEqual(pins.filter(i => i.checked).map(i => i.label), ['Follow the pins']);
  assert.equal(pins[0].value, 'Second', 'follow the pins runs as the account the pins give');
  assert.equal(pins.some(i => i.note), false);
  const chosen = make(chipAccount({ card: GROUP, accounts: [MAIN, SECOND], named: 'main' }));
  assert.deepEqual(chosen.filter(i => i.checked).map(i => i.label), ['Main']);
  chosen[0].run();
  assert.deepEqual(picked, [null]);
  assert.equal(chosen[1].run, undefined, 'the current choice has nothing to run');
});

test('the pins key changes when a group, project or session pin or overflow does, and not otherwise', () => {
  const ix = () => ({ groups: [{ id: 'g', account: null, overflow: null, sessions: [{ id: 'a', accountPin: null }] }], projects: [{ id: 'p', account: null }], pinned: [], routines: [], started: [], ungrouped: [], other: [] });
  assert.equal(pinsKey(null), '');
  assert.equal(pinsKey(ix()), pinsKey(ix()));
  const g = ix(); g.groups[0].account = 'second';
  const p = ix(); p.projects[0].account = 'second';
  const o = ix(); o.groups[0].overflow = 'main';
  const s = ix(); s.groups[0].sessions[0].accountPin = 'second';
  assert.equal(new Set([ix(), g, p, o, s].map(pinsKey)).size, 5);
});

test('the item that clears the pin takes its own words, and the notes can be left out', () => {
  const items = accountItems({ accounts: [MAIN, SECOND], pin: null, follows: 'Main', pick() {}, none: 'Follow the pins', notes: false });
  assert.deepEqual(items.map(i => i.label), ['Follow the pins', 'Main', 'Second']);
  assert.equal(accountItems({ accounts: [MAIN, SECOND], pin: null, follows: 'Main', pick() {} })[0].label, 'Active account');
});
