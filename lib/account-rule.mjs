// Which Claude account a session runs on. Plain data in, plain data out, so the runner, the index and the routine checks all use one rule.
// See docs/adr/20261104-pin-work-to-an-account.md and docs/adr/20261109-spill-pinned-work-to-an-overflow-account.md.

const own = (map, id) => (map && typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : undefined);
// A pin is a non-empty account id. Anything else is no pin.
const pinOf = value => (typeof value === 'string' && value ? value : null);
// The overflow a holder's pin names, as a field to spread into a result. An overflow equal to its pin is no overflow.
const overflowOf = (holder, account) => {
  const overflow = pinOf(holder?.overflow);
  return overflow && overflow !== account ? { overflow } : {};
};

// `self` is `{ id?, pin, overflow?, routine, group, parent }` for the session asking: its own pin and overflow, the id of the routine that started it, the id of its
// group (the group it sits in, or the one whose chat it is) and the id of the session it nests under. `d` is `{ facts, routines, groups,
// projects, active }`: `facts(id)` gives that shape for a known session or null for one that is not known, the others map an id to
// `{ account }` (a group also has `project`), and `active` is the active account's id.
// Returns `{ account, from, via, pin, overflow? }`. `overflow` is the overflow account of the holder whose pin was chosen, and a routine has none. `from` says which step chose it: session, routine, parent, group, project or active. `via` is the id of
// the thing the step looked at, and `pin` is `{ kind, id }` of the session, routine, group or project that really holds the pin, found by following a parent up. A pin to an id nobody lists is returned as it stands and never falls through to the next step.
export function accountFor(self, d, seen = new Set()) {
  if (self.id) seen.add(self.id);
  const mine = pinOf(self.pin);
  if (mine) return { account: mine, from: 'session', via: self.id ?? null, pin: { kind: 'session', id: self.id ?? null }, ...overflowOf(self, mine) };
  const routine = pinOf(own(d.routines, self.routine)?.account);
  if (routine) return { account: routine, from: 'routine', via: self.routine, pin: { kind: 'routine', id: self.routine } };
  const parent = self.parent;
  if (parent && !seen.has(parent)) {
    const facts = d.facts(parent);
    if (facts) {
      const up = accountFor({ ...facts, id: parent }, d, seen);
      if (up.from !== 'active') return { account: up.account, from: 'parent', via: parent, pin: up.pin, ...(up.overflow && { overflow: up.overflow }) };
    }
  }
  const group = own(d.groups, self.group);
  const inGroup = pinOf(group?.account);
  if (inGroup) return { account: inGroup, from: 'group', via: self.group, pin: { kind: 'group', id: self.group }, ...overflowOf(group, inGroup) };
  const held = own(d.projects, group?.project);
  const project = pinOf(held?.account);
  if (project) return { account: project, from: 'project', via: group.project, pin: { kind: 'project', id: group.project }, ...overflowOf(held, project) };
  return { account: d.active, from: 'active', via: null, pin: null };
}

// The account a result runs on once its pinned account is out of usage. With an overflow that is listed and usable, that is the overflow and `spilled` names the
// pinned account. Otherwise the result as it stands, so work on two spent accounts stays on its pin. `facts` is `{ isOut(id), usable(id) }`: whether an account is
// out of usage, and whether it is checked, signed in and not out. Callers check `blockedBy` first, since a signed-out pin blocks and never spills.
export function spillOf(result, facts) {
  if (!result.overflow || result.from === 'active' || !facts.isOut(result.account) || !facts.usable(result.overflow)) return result;
  return { ...result, account: result.overflow, spilled: result.account };
}

// What stops a result from running, or null. Only a pin blocks: the active account is the one place GhostShell already reports sign-in.
// `states` is `{ list, signedOut(account), checked(account) }`. An account whose first check has not finished counts as signed in.
// `nameOf(from, via)` gives the words for where the pin came from. The result carries ids and names, never an email or a token.
export function blockedBy(result, states, nameOf = () => '') {
  if (result.from === 'active') return null;
  const account = states.list.find(a => a.id === result.account);
  // The name is the holder's own, so a pin reached through a parent is named for the group or project it sits on and not for the parent.
  const fromName = result.pin ? nameOf(result.pin.kind, result.pin.id) : nameOf(result.from, result.via);
  if (!account) return { account: null, reason: 'removed', from: result.from, fromName, pin: result.pin ?? null };
  if (!states.checked(account) || !states.signedOut(account)) return null;
  return { account: { id: account.id, name: account.name }, reason: 'signed-out', from: result.from, fromName, pin: result.pin ?? null };
}

const WHERE = { session: 'This session', routine: 'Its routine', group: 'Its group', project: 'Its project' };
const KIND = { session: 'session', routine: 'routine', group: 'group', project: 'project' };

// Who holds the pin: the session itself, or what its routine, group or project is, or for a pin reached through a parent, the holder named as the parent's.
function holderWords(blocked) {
  const kind = blocked.pin?.kind ?? blocked.from;
  if (blocked.from === 'parent') return kind === 'session' ? 'The session it sits under' : `The ${KIND[kind] ?? 'holder'} of the session it sits under`;
  return WHERE[kind] ?? 'This work';
}

// The sentence a refusal shows, and the error a start throws so the route can answer 409 with the data.
export function blockedMessage(blocked) {
  const who = `${holderWords(blocked)}${blocked.fromName ? ` (${blocked.fromName})` : ''}`;
  return blocked.reason === 'removed'
    ? `${who} is pinned to an account GhostShell no longer lists. Clear the pin first.`
    : `${who} is pinned to ${blocked.account.name}, which is signed out. Sign it in first.`;
}

export function blockedError(blocked) {
  return Object.assign(new Error(blockedMessage(blocked)), { status: 409, blocked });
}
