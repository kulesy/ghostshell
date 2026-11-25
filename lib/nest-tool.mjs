// nest_session and unnest_session. Being nested grants the parent a read and the whole family sends, renames, moves and takes out with no card, so the owner's card
// lists each consequence. The card's text and its key come from one plan the server works out, so the call can check it is the nest that was shown.
import { sectionById, sectionOf } from '../public/ui/sections.js';
import { bare, count, oneLine, refusal } from './groups.mjs';
import { changed, idOf, label, named, ranOn, reach, showsIn } from './layout-tools.mjs';

const parentOf = args => {
  if (typeof args.parent !== 'string' || !args.parent.trim()) throw refusal('Give the id of the session to nest it under as parent. unnest_session takes a session out from under another.');
  return args.parent.trim();
};

const namer = subs => {
  const rows = new Map(subs.lookup({ archived: true }).rows.map(r => [r.id, r]));
  return id => named(rows.get(id), id);
};

const groupLabel = (id, groups) => label(groups.find(g => g.id === id) ?? { id, name: id });

function projectName(subs, id) {
  if (!id) return 'Home';
  try {
    const found = subs.projects().find(p => p.id === id);
    return `the project ${found ? label(found) : `[${id}]`}`;
  } catch {
    return `the project [${id}]`;
  }
}

const and = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0]);
const readers = place => [place.group && `group:${place.group}`, place.section && `section:${place.section}`].filter(Boolean);

// What the nest takes the session out of, as the sidebar shows it.
const leaves = (plan, name, groups) => [plan.before.pinned && 'Pinned', plan.before.group && `the group ${groupLabel(plan.before.group, groups)}`, plan.parent && name(plan.parent)].filter(Boolean);

const accountLine = ({ account }) => {
  if (!account.changes) return null;
  if (!account.to) return 'It may change the account it runs on.';
  return `It then runs on ${ranOn(account)}${account.below ? `, and the ${count(account.below, 'session')} under it or linked with it can change account too` : ''}.`;
};

const CALLER = {
  moved: () => 'This chat is the session being nested.',
  under: () => 'This chat is one of the sessions under the one being nested.',
  root: (name, plan) => `This chat is ${name(plan.root)}, the session it nests under.`,
  family: () => 'This chat is in the family it joins.',
  reads: (name, plan) => `This chat already reads ${name(plan.root)}.`,
};

// The lines of the card for a plan: the action, then one consequence a line, only those that apply.
export function nestLines(plan, subs, groups) {
  const name = namer(subs);
  const { moved, root, under, family, before, after } = plan;
  const rootName = name(root);
  const lines = [`nest ${name(moved)} under ${rootName}${plan.redirected ? `, since ${name(plan.given)} is itself nested under it` : ''}`];
  lines.push(`${reach(under.length, `${rootName} can then read`)}.`);
  const members = ['It', under.length && `the ${count(under.length, 'session')} under it`, rootName, family.length > 1 && `the ${count(family.length - 1, 'other session')} in that family`].filter(Boolean);
  lines.push(`${and(members)} can then message, rename, move and take out one another with no card.`);
  if (plan.lost.length) lines.push(`The ${count(plan.lost.length, 'session')} under it then show${plan.lost.length === 1 ? 's' : ''} beside it, and it can no longer read ${plan.lost.length === 1 ? 'it' : 'them'}.`);
  const out = leaves(plan, name, groups);
  const project = before.project !== after.project ? ` Its project changes from ${projectName(subs, before.project)} to ${projectName(subs, after.project)}.` : '';
  lines.push(`${out.length ? `It leaves ${and(out)} and shows` : 'It shows'} under ${rootName} in ${showsIn(after, groups)}.${project}${under.length ? ` The ${count(under.length, 'session')} under it move${under.length === 1 ? 's' : ''} with it.` : ''}`);
  const had = readers(before);
  for (const key of readers(after).filter(k => !had.includes(k))) {
    const [kind, id] = key.split(':');
    const own = plan.callerChat === id;
    const who = own ? `This ${kind}'s chat` : `The chat of the ${kind} ${kind === 'group' ? groupLabel(id, groups) : label(sectionById(id) ?? { id, name: id })}`;
    lines.push(`${reach(under.length, `${who} can then read`)}.`);
  }
  const account = accountLine(plan);
  if (account) lines.push(account);
  if (plan.chips.length) lines.push(`The ${count(plan.chips.length, 'session')} started from its chips can then send to ${rootName} with no card.`);
  if (CALLER[plan.caller]) lines.push(CALLER[plan.caller](name, plan));
  lines.push(`${reach(under.length, `Archiving ${rootName} archives`)}.`);
  return lines;
}

// A refusal or a nest already in place gets no card: the call answers with the reason and has no approval to write with. Anything else thrown shows the usual card with no key.
export function nestApproval(input, subs, groups) {
  const asked = input && typeof input === 'object' ? input : {};
  const id = typeof asked.session_id === 'string' ? asked.session_id.trim() : '';
  const parent = typeof asked.parent === 'string' ? asked.parent.trim() : '';
  if (!id || !parent) return { quiet: true };
  let plan;
  try {
    plan = subs.nestPlan(id, parent);
  } catch (err) {
    if (err.status) return { quiet: true };
    throw err;
  }
  if (plan.already) return { quiet: true };
  return { summary: nestLines(plan, subs, groups).join('\n'), key: JSON.stringify(plan) };
}

// The card's line when no plan could be made: the sessions as the other tools name them, with no consequences.
export function nestSummary(input, subs) {
  const asked = input && typeof input === 'object' ? input : {};
  const rows = subs.lookup({ archived: true }).rows;
  const shown = value => {
    const id = typeof value === 'string' ? oneLine(value.trim(), 80) : '';
    const row = rows.find(r => r.id === id);
    return row ? named(row, id) : `an unknown session${bare(id, 80) ? ` [${bare(id, 80)}]` : ''}`;
  };
  return `nest ${shown(asked.session_id)} under ${shown(asked.parent)}`;
}

export function unnestSummary(input, subs, groups) {
  const asked = input && typeof input === 'object' ? input : {};
  const id = typeof asked.session_id === 'string' ? oneLine(asked.session_id.trim(), 80) : '';
  const rows = subs.lookup({ archived: true }).rows;
  const row = rows.find(r => r.id === id);
  const session = row ? named(row, id) : `an unknown session${bare(id, 80) ? ` [${bare(id, 80)}]` : ''}`;
  const parent = subs.lookup({ archived: false }).rows.find(r => r.id === id)?.parent;
  if (!row || !parent) return `take ${session} out from under its parent`;
  const out = { ...row, parent: null };
  const place = { pinned: !!row.pinned, group: row.group ?? null, section: sectionOf(out, new Map([[id, out]])) };
  let change = {};
  try { change = subs.unnestChange?.(id) ?? {}; } catch { change = { changes: true }; }
  const notes = [];
  if (change.project) notes.push('changes its project');
  if (change.account && change.to) notes.push(`runs it on ${ranOn(change)}${change.below ? `, and the ${count(change.below, 'session')} linked with it can change account too` : ''}`);
  else if (change.account || (change.changes && !change.project)) notes.push('may change the account it runs on');
  return `take ${session} out from under ${named(rows.find(r => r.id === parent), parent)}, so it shows in ${showsIn(place, groups)}${notes.length ? `, which ${and(notes)}` : ''}`;
}

// `takeNest` hands over the key the owner approved for this tool use id, once. A call with no approval, or one for another plan, writes nothing.
export function nestSession(args, { subs, groups, takeNest, toolUseId }) {
  const approved = takeNest?.(toolUseId);
  const id = idOf(args);
  const parent = parentOf(args);
  const plan = changed(() => subs.nestPlan(id, parent));
  const list = groups?.() ?? [];
  const name = namer(subs);
  if (plan.already) return `${name(id)} is already nested under ${name(plan.root)}. Nothing changed.`;
  if (!approved) throw refusal('The owner has not approved this nest. Nothing changed.');
  if (approved !== JSON.stringify(plan)) throw refusal('What the approval card showed has changed since. Nothing changed. Call nest_session again to ask the owner.');
  changed(() => subs.nest(id, parent));
  const { before, after } = plan;
  const out = leaves(plan, name, list);
  const project = before.project !== after.project ? ` Its project is now ${projectName(subs, after.project)}.` : '';
  return [
    `Nested ${name(plan.moved)} under ${name(plan.root)}.`,
    plan.redirected && `${name(plan.given)} is itself nested under ${name(plan.root)}, so it went under ${name(plan.root)}.`,
    `${out.length ? `It left ${and(out)} and now` : 'It now'} shows in ${showsIn(after, list)}.${project}`,
    plan.under.length && `The ${count(plan.under.length, 'session')} under it went with it.`,
  ].filter(Boolean).join(' ');
}
