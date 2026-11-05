// The rule for which account work runs on. See docs/adr/20261104-pin-work-to-an-account.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFor, blockedBy, blockedError, blockedMessage } from '../lib/account-rule.mjs';

// `known` maps a session id to its facts, so a test lays out only the sessions it needs.
const data = ({ known = {}, routines = {}, groups = {}, projects = {}, active = 'main' } = {}) => ({
  active, routines, groups, projects, facts: id => (Object.hasOwn(known, id) ? known[id] : null),
});

test('with nothing pinned the active account is used', () => {
  assert.deepEqual(accountFor({ id: 's1' }, data()), { account: 'main', from: 'active', via: null, pin: null });
});

test('each step on its own picks its account and says where it came from', () => {
  const d = data({
    known: { up: { pin: 'parentpin' } },
    routines: { r1: { account: 'routinepin' } },
    groups: { g1: { account: 'grouppin', project: 'p1' }, g2: { project: 'p1' } },
    projects: { p1: { account: 'projectpin' } },
  });
  assert.deepEqual(accountFor({ id: 's1', pin: 'sessionpin' }, d), { account: 'sessionpin', from: 'session', via: 's1', pin: { kind: 'session', id: 's1' } });
  assert.deepEqual(accountFor({ id: 's1', routine: 'r1' }, d), { account: 'routinepin', from: 'routine', via: 'r1', pin: { kind: 'routine', id: 'r1' } });
  assert.deepEqual(accountFor({ id: 's1', parent: 'up' }, d), { account: 'parentpin', from: 'parent', via: 'up', pin: { kind: 'session', id: 'up' } });
  assert.deepEqual(accountFor({ id: 's1', group: 'g1' }, d), { account: 'grouppin', from: 'group', via: 'g1', pin: { kind: 'group', id: 'g1' } });
  assert.deepEqual(accountFor({ id: 's1', group: 'g2' }, d), { account: 'projectpin', from: 'project', via: 'p1', pin: { kind: 'project', id: 'p1' } });
});

test('an earlier step beats every later one', () => {
  const d = data({
    known: { up: { pin: 'parentpin', group: 'g1' } },
    routines: { r1: { account: 'routinepin' } },
    groups: { g1: { account: 'grouppin', project: 'p1' } },
    projects: { p1: { account: 'projectpin' } },
  });
  const all = { id: 's1', pin: 'sessionpin', routine: 'r1', parent: 'up', group: 'g1' };
  assert.equal(accountFor(all, d).from, 'session');
  assert.equal(accountFor({ ...all, pin: undefined }, d).from, 'routine');
  assert.equal(accountFor({ ...all, pin: undefined, routine: undefined }, d).from, 'parent');
  assert.equal(accountFor({ ...all, pin: undefined, routine: undefined, parent: undefined }, d).from, 'group');
  const noGroupPin = data({ groups: { g1: { project: 'p1' } }, projects: { p1: { account: 'projectpin' } } });
  assert.equal(accountFor({ id: 's1', group: 'g1' }, noGroupPin).from, 'project');
});

test('a session in a group with a pin uses the group, and a group without one falls to its project, then active', () => {
  const d = data({ groups: { g1: { account: 'a', project: 'p1' }, g2: { project: 'p1' }, g3: {} }, projects: { p1: { account: 'b' } } });
  assert.equal(accountFor({ id: 's', group: 'g1' }, d).account, 'a');
  assert.equal(accountFor({ id: 's', group: 'g2' }, d).account, 'b');
  assert.equal(accountFor({ id: 's', group: 'g3' }, d).account, 'main');
});

test('a parent passes on what it resolves to, including its own group, and a parent on the active account does not hide the child\'s group', () => {
  const d = data({
    known: { up: { group: 'g1' }, plain: {}, mid: { parent: 'up' } },
    groups: { g1: { account: 'a' }, g2: { account: 'b' } },
  });
  assert.deepEqual(accountFor({ id: 's', parent: 'up' }, d), { account: 'a', from: 'parent', via: 'up', pin: { kind: 'group', id: 'g1' } });
  assert.deepEqual(accountFor({ id: 's', parent: 'mid' }, d), { account: 'a', from: 'parent', via: 'mid', pin: { kind: 'group', id: 'g1' } });
  assert.deepEqual(accountFor({ id: 's', parent: 'plain', group: 'g2' }, d), { account: 'b', from: 'group', via: 'g2', pin: { kind: 'group', id: 'g2' } });
});

test('a parent the index does not know is ignored', () => {
  const d = data({ groups: { g1: { account: 'a' } } });
  assert.equal(accountFor({ id: 's', parent: 'gone', group: 'g1' }, d).from, 'group');
  assert.equal(accountFor({ id: 's', parent: 'gone' }, d).from, 'active');
});

test('a loop of parents ends, and a session that is its own parent is ignored', () => {
  const d = data({ known: { a: { parent: 'b' }, b: { parent: 'a' }, c: { parent: 'c', pin: 'x' } }, groups: { g1: { account: 'a' } } });
  assert.deepEqual(accountFor({ id: 'a', parent: 'b', group: 'g1' }, d), { account: 'a', from: 'group', via: 'g1', pin: { kind: 'group', id: 'g1' } });
  assert.equal(accountFor({ id: 'z', parent: 'c' }, d).account, 'x');
  assert.equal(accountFor({ id: 'c', parent: 'c' }, d).account, 'main');
  assert.equal(accountFor({ id: 'q', parent: 'q' }, data()).from, 'active');
});

test('a pin to an id nobody lists stands and never falls through to the next step', () => {
  const d = data({ routines: { r1: { account: 'gone' } }, groups: { g1: { account: 'other' } } });
  assert.deepEqual(accountFor({ id: 's', pin: 'gone', group: 'g1' }, d), { account: 'gone', from: 'session', via: 's', pin: { kind: 'session', id: 's' } });
  assert.deepEqual(accountFor({ id: 's', routine: 'r1', group: 'g1' }, d), { account: 'gone', from: 'routine', via: 'r1', pin: { kind: 'routine', id: 'r1' } });
});

test('a pin that is empty or not a string is no pin', () => {
  const d = data({ groups: { g1: { account: '' }, g2: { account: 7 } } });
  assert.equal(accountFor({ id: 's', pin: '', group: 'g1' }, d).from, 'active');
  assert.equal(accountFor({ id: 's', pin: null, group: 'g2' }, d).from, 'active');
});

test('an id such as __proto__ or toString finds nothing in the maps', () => {
  const d = data();
  assert.equal(accountFor({ id: 's', routine: 'toString', group: '__proto__' }, d).from, 'active');
});

test('a group\'s chat takes the group\'s pin, and a section\'s chat has no group so it falls to active', () => {
  const d = data({ known: { gchat: { group: 'g1' }, schat: {} }, groups: { g1: { account: 'a' } } });
  assert.deepEqual(accountFor({ id: 'gchat', ...d.facts('gchat') }, d), { account: 'a', from: 'group', via: 'g1', pin: { kind: 'group', id: 'g1' } });
  assert.deepEqual(accountFor({ id: 'schat', ...d.facts('schat') }, d), { account: 'main', from: 'active', via: null, pin: null });
});

const states = ({ out = [], unchecked = [] } = {}) => ({
  list: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second' }],
  signedOut: a => out.includes(a.id),
  checked: a => !unchecked.includes(a.id),
});
const nameOf = (from, via) => `${from}:${via}`;

test('only a pin blocks, and the active account never does, signed out or not', () => {
  const active = { account: 'second', from: 'active', via: null };
  assert.equal(blockedBy(active, states({ out: ['second'] }), nameOf), null);
  assert.equal(blockedBy({ account: 'second', from: 'group', via: 'g1' }, states(), nameOf), null);
});

test('a pinned account that is signed out blocks and the data names the account and where the pin sits', () => {
  assert.deepEqual(blockedBy({ account: 'second', from: 'group', via: 'g1' }, states({ out: ['second'] }), nameOf), {
    account: { id: 'second', name: 'Second' }, reason: 'signed-out', from: 'group', fromName: 'group:g1', pin: null,
  });
});

test('a pinned account nobody lists blocks as removed with no account', () => {
  assert.deepEqual(blockedBy({ account: 'gone', from: 'session', via: 's1' }, states(), nameOf), {
    account: null, reason: 'removed', from: 'session', fromName: 'session:s1', pin: null,
  });
});

test('an account whose first check has not finished is not blocked', () => {
  assert.equal(blockedBy({ account: 'second', from: 'session', via: 's1' }, states({ out: ['second'], unchecked: ['second'] }), nameOf), null);
});

test('the blocked data holds ids and names only', () => {
  const got = blockedBy({ account: 'second', from: 'project', via: 'p1' }, states({ out: ['second'] }), nameOf);
  assert.deepEqual(Object.keys(got.account).sort(), ['id', 'name']);
});

test('the refusal names the account and where the pin came from, and the error carries a 409 and the data', () => {
  const signedOut = { account: { id: 'second', name: 'Second' }, reason: 'signed-out', from: 'group', fromName: 'Work' };
  assert.equal(blockedMessage(signedOut), 'Its group (Work) is pinned to Second, which is signed out. Sign it in first.');
  const removed = { account: null, reason: 'removed', from: 'session', fromName: '' };
  assert.equal(blockedMessage(removed), 'This session is pinned to an account GhostShell no longer lists. Clear the pin first.');
  const e = blockedError(signedOut);
  assert.equal(e.status, 409);
  assert.equal(e.blocked, signedOut);
  assert.equal(e.message, blockedMessage(signedOut));
});

test('a pin names the session, routine, group or project that holds it, following a parent up to it', () => {
  const d = data({
    known: { up: { group: 'g1' }, mid: { parent: 'up' }, top: { pin: 'x' }, kid: { parent: 'top' } },
    routines: { r1: { account: 'a' } },
    groups: { g1: { account: 'a' }, g2: { project: 'p1' } },
    projects: { p1: { account: 'b' } },
  });
  assert.deepEqual(accountFor({ id: 's', pin: 'a' }, d).pin, { kind: 'session', id: 's' });
  assert.deepEqual(accountFor({ id: 's', routine: 'r1' }, d).pin, { kind: 'routine', id: 'r1' });
  assert.deepEqual(accountFor({ id: 's', group: 'g1' }, d).pin, { kind: 'group', id: 'g1' });
  assert.deepEqual(accountFor({ id: 's', group: 'g2' }, d).pin, { kind: 'project', id: 'p1' });
  assert.deepEqual(accountFor({ id: 's', parent: 'mid' }, d).pin, { kind: 'group', id: 'g1' });
  assert.deepEqual(accountFor({ id: 's', parent: 'kid' }, d).pin, { kind: 'session', id: 'top' });
  assert.equal(accountFor({ id: 's' }, d).pin, null);
});

test('the blocked data carries the pin of the result, so a nested session names the session above that holds it', () => {
  const pin = { kind: 'session', id: 'top' };
  const got = blockedBy({ account: 'gone', from: 'parent', via: 'kid', pin }, states(), nameOf);
  assert.deepEqual(got.pin, pin);
  assert.deepEqual(blockedBy({ account: 'second', from: 'routine', via: 'r1', pin: { kind: 'routine', id: 'r1' } }, states({ out: ['second'] }), nameOf).pin, { kind: 'routine', id: 'r1' });
});

test('a block reached through a parent names the group, project or session that holds the pin, with its own name', () => {
  const of = (pin, account = 'second') => blockedBy({ account, from: 'parent', via: 'mid', pin }, states({ out: ['second'] }), nameOf);
  const group = of({ kind: 'group', id: 'g1' });
  assert.equal(group.fromName, 'group:g1');
  assert.equal(blockedMessage(group), 'The group of the session it sits under (group:g1) is pinned to Second, which is signed out. Sign it in first.');
  assert.equal(blockedMessage(of({ kind: 'project', id: 'p1' })), 'The project of the session it sits under (project:p1) is pinned to Second, which is signed out. Sign it in first.');
  assert.equal(blockedMessage(of({ kind: 'session', id: 'top' })), 'The session it sits under (session:top) is pinned to Second, which is signed out. Sign it in first.');
  assert.equal(blockedMessage(of({ kind: 'routine', id: 'r1' }, 'gone')), 'The routine of the session it sits under (routine:r1) is pinned to an account GhostShell no longer lists. Clear the pin first.');
});

test('a grandparent whose own parent inherits from a group is named for the group', () => {
  const d = {
    facts: id => ({ mid: { parent: 'kid' }, kid: { group: 'g1' } })[id] ?? null,
    groups: { g1: { account: 'second' } }, projects: {}, routines: {}, active: 'main',
  };
  const got = accountFor({ id: 'self', parent: 'mid' }, d);
  assert.deepEqual([got.from, got.via, got.pin], ['parent', 'mid', { kind: 'group', id: 'g1' }]);
  assert.match(blockedMessage(blockedBy(got, states({ out: ['second'] }), nameOf)), /^The group of the session it sits under \(group:g1\)/);
});
