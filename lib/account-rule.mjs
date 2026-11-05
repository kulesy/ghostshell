// Which Claude account a session runs on. Plain data in, plain data out, so the runner, the index and the routine checks all use one rule.
// See docs/adr/20261104-pin-work-to-an-account.md.

const own = (map, id) => (map && typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : undefined);
// A pin is a non-empty account id. Anything else is no pin.
const pinOf = value => (typeof value === 'string' && value ? value : null);

// `self` is `{ id?, pin, routine, group, parent }` for the session asking: its own pin, the id of the routine that started it, the id of its
// group (the group it sits in, or the one whose chat it is) and the id of the session it nests under. `d` is `{ facts, routines, groups,
// projects, active }`: `facts(id)` gives that shape for a known session or null for one that is not known, the others map an id to
// `{ account }` (a group also has `project`), and `active` is the active account's id.
// Returns `{ account, from, via, pin }`. `from` says which step chose it: session, routine, parent, group, project or active. `via` is the id of
// the thing the step looked at, and `pin` is `{ kind, id }` of the session, routine, group or project that really holds the pin, found by following a parent up. A pin to an id nobody lists is returned as it stands and never falls through to the next step.
export function accountFor(self, d, seen = new Set()) {
  if (self.id) seen.add(self.id);
  const mine = pinOf(self.pin);
  if (mine) return { account: mine, from: 'session', via: self.id ?? null, pin: { kind: 'session', id: self.id ?? null } };
  const routine = pinOf(own(d.routines, self.routine)?.account);
  if (routine) return { account: routine, from: 'routine', via: self.routine, pin: { kind: 'routine', id: self.routine } };
  const parent = self.parent;
  if (parent && !seen.has(parent)) {
    const facts = d.facts(parent);
    if (facts) {
      const up = accountFor({ ...facts, id: parent }, d, seen);
      if (up.from !== 'active') return { account: up.account, from: 'parent', via: parent, pin: up.pin };
    }
  }
  const group = own(d.groups, self.group);
  const inGroup = pinOf(group?.account);
  if (inGroup) return { account: inGroup, from: 'group', via: self.group, pin: { kind: 'group', id: self.group } };
  const project = pinOf(own(d.projects, group?.project)?.account);
  if (project) return { account: project, from: 'project', via: group.project, pin: { kind: 'project', id: group.project } };
  return { account: d.active, from: 'active', via: null, pin: null };
}

// What stops a result from running, or null. Only a pin blocks: the active account is the one place GhostShell already reports sign-in.
// `states` is `{ list, signedOut(account), checked(account) }`. An account whose first check has not finished counts as signed in.
// `nameOf(from, via)` gives the words for where the pin came from. The result carries ids and names, never an email or a token.
export function blockedBy(result, states, nameOf = () => '') {
  if (result.from === 'active') return null;
  const account = states.list.find(a => a.id === result.account);
  const fromName = nameOf(result.from, result.via);
  if (!account) return { account: null, reason: 'removed', from: result.from, fromName, pin: result.pin ?? null };
  if (!states.checked(account) || !states.signedOut(account)) return null;
  return { account: { id: account.id, name: account.name }, reason: 'signed-out', from: result.from, fromName, pin: result.pin ?? null };
}

const WHERE = { session: 'This session', routine: 'Its routine', parent: 'The session it sits under', group: 'Its group', project: 'Its project' };

// The sentence a refusal shows, and the error a start throws so the route can answer 409 with the data.
export function blockedMessage(blocked) {
  const who = `${WHERE[blocked.from] ?? 'This work'}${blocked.fromName ? ` (${blocked.fromName})` : ''}`;
  return blocked.reason === 'removed'
    ? `${who} is pinned to an account GhostShell no longer lists. Clear the pin first.`
    : `${who} is pinned to ${blocked.account.name}, which is signed out. Sign it in first.`;
}

export function blockedError(blocked) {
  return Object.assign(new Error(blockedMessage(blocked)), { status: 409, blocked });
}
