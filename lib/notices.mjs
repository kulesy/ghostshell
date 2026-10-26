// Messages the CLI saves as user turns although nobody typed them: a background task finishing, a message from another
// session. Each becomes one `system` item, which the page draws as a compact notice. A command run with "!" is a `bash` item instead.

export const capText = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}\n... (${text.length - limit} more characters)` : text);

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'" };
const unescape = s => s.replace(/&(lt|gt|amp|quot|apos|#39);/g, (_, name) => ENTITIES[name]);

const ELEMENT = /<([A-Za-z][\w-]*)>([\s\S]*?)<\/\1>/g;

function humanise(name) {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

const flatten = raw => raw.replace(ELEMENT, (_, tag, value) => `${humanise(tag)}: ${value.trim()}\n`);

const notice = ({ state, title, text = '', output = '', details = [] }, limit) => ({
  kind: 'system',
  ...(state && { state }),
  title,
  ...(text && { text: capText(text, limit) }),
  ...(output && { output: capText(output, limit) }),
  details: details.map(([label, value]) => ({ label, value: capText(value, limit) })),
});

const ORPHAN = '__orphan_summary__';
const ENDED = { completed: ['finished', 'done'], failed: ['failed', 'failed'], stopped: ['stopped', 'stopped'], killed: ['stopped', 'stopped'] };
const LABELS = { 'task-id': 'Task', 'tool-use-id': 'Tool call', 'output-file': 'Output file', 'task-type': 'Type' };
const SHOWN = new Set(['task-id', 'summary', 'event']);

// A finished, failed or stopped task, or a line from a monitor. Ids that start with __orphan_summary__ are the CLI's own markers.
function taskNotice(block, after, limit) {
  const fields = [...block.matchAll(ELEMENT)].map(([, tag, raw]) => [tag, unescape(/<[A-Za-z][\w-]*>/.test(raw) ? flatten(raw) : raw).trim()]);
  const first = tag => fields.find(([t]) => t === tag)?.[1] || '';
  const ids = fields.filter(([tag, value]) => tag === 'task-id' && !value.startsWith(ORPHAN)).map(([, value]) => value);
  const [verb, state] = ENDED[first('status')] || [];
  const details = ids.length ? [[ids.length > 1 ? 'Tasks' : 'Task', ids.join(', ')]] : [];
  for (const [tag, value] of fields) {
    if (value && !SHOWN.has(tag) && !(tag === 'status' && verb)) details.push([LABELS[tag] || humanise(tag), value]);
  }
  const aside = [block.replace(ELEMENT, ''), after].map(s => s.trim()).filter(Boolean).join('\n\n');
  if (aside) details.push(['Also sent to Claude', aside]);
  const title = verb ? `${ids.length > 1 ? `${ids.length} background tasks` : 'Background task'} ${verb}` : 'Background update';
  return notice({ state, title, text: first('summary'), output: first('event'), details }, limit);
}

const SHELL_TAG = /\s*<bash-(input|stdout|stderr)>([\s\S]*?)<\/bash-\1>/y;

// The commands run with ! at the start of a user turn, each with what it printed, and the text left after them. A turn with the
// command alone, and one with only the output, are both groups, because older CLIs saved the two as separate turns.
export function bashFrom(text, limit) {
  const groups = [];
  let end = 0;
  SHELL_TAG.lastIndex = 0;
  for (let found = SHELL_TAG.exec(text); found; found = SHELL_TAG.exec(text)) {
    const [, tag, raw] = found;
    end = SHELL_TAG.lastIndex;
    const group = groups[groups.length - 1];
    const field = { input: 'command', stdout: 'stdout', stderr: 'stderr' }[tag];
    const seen = group && (tag === 'stdout' ? 'stdout' in group || 'stderr' in group : 'stderr' in group);
    if (!group || tag === 'input' || seen) groups.push({});
    groups[groups.length - 1][field] = tag === 'input' ? unescape(raw).trim() : unescape(raw).trimEnd();
  }
  if (!groups.length) return null;
  const cut = value => (limit === undefined ? value : capText(value, limit));
  const items = groups.map(g => ({ kind: 'bash', command: cut(g.command ?? ''), stdout: cut(g.stdout ?? ''), stderr: cut(g.stderr ?? '') }));
  return { items, rest: text.slice(end).trim() };
}

// A sender chooses its own name and address, so line breaks, bidi marks and zero-width characters become a space and a long one is cut.
export const label = (text, limit = Infinity) => {
  const plain = String(text ?? '').replace(/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();
  const chars = [...plain];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}...` : plain;
};

const peerMessage = ({ from, name, mode, body }, limit) => notice({
  title: `Message from ${label(name, 60) || 'another session'}`,
  text: body,
  details: [['From', label(from)], ['From name', label(name)], ['From mode', label(mode)]].filter(([, value]) => value),
}, limit);

// NOTE: [26 Oct 2026] EK - A user turn sent on stdin that is a <cross-session-message> tag is taken by the CLI as a peer message and held, with
// cause no-mode-asserted whatever its from-mode says, then dropped (checked on CLI 2.1.310). A parent's message to a sub session uses its own tag so it is read as a prompt.
export const PARENT_TAG = 'parent-session-message';
const MESSAGES = {
  'cross-session-message': {},
  [PARENT_TAG]: {},
  'ci-monitor-event': { title: 'Pull request monitor' },
  'agent-message': { title: 'Message from a subagent' },
  'side-sessions-event': { title: 'Side sessions are idle', aside: true },
};
// The text runs to the last closing tag, so a sender who writes one in its message is not cut short.
const TAGGED = `<(${Object.keys(MESSAGES).join('|')})((?:\\s[^>]*)?)>([\\s\\S]*)</\\1>`;
const MESSAGE = new RegExp(`^${TAGGED}$`);
const WRAPPED = new RegExp(`^Another Claude session sent a message:\\n${TAGGED}(?:\\n\\n[\\s\\S]*)?$`);

// An aside is written for Claude alone, so it waits behind the details. The origin is the CLI's own record of a peer
// message's sender, so it wins over the tag's attributes where it has them.
function messageNotice([, tag, attrs, body], limit, origin = {}) {
  const { title, aside } = MESSAGES[tag];
  const pairs = [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)];
  if (tag === 'cross-session-message' || tag === PARENT_TAG) {
    const at = Object.fromEntries(pairs.map(([, name, value]) => [name, value]));
    return peerMessage({ from: origin.from ?? at.from, name: origin.name ?? at['from-name'] ?? at.name, mode: origin.fromMode ?? at['from-mode'], body: body.trim() }, limit);
  }
  const details = pairs.map(([, name, value]) => [humanise(name), value]);
  if (aside) details.push(['Also sent to Claude', body.trim()]);
  return notice({ title, text: aside ? '' : body.trim(), details }, limit);
}

const REPORT = /^\[Cross-session delivery notice\] (?:Do not resend now: )?(?:Your message|one of your messages|(\d+) of your messages) to another session (?:was|were) ([\s\S]*)$/;
const REPORTS = [
  { match: /^held by that session/, state: 'waiting', title: 'held by the other session', text: 'Not delivered yet. It waits for the other session\'s owner to approve it.' },
  { match: /^approved and released/, state: 'done', title: 'delivered' },
  { match: /^denied by the recipient/, state: 'stopped', title: 'denied by the other session', text: 'Not delivered.' },
  { match: /^not approved before expiry/, state: 'failed', title: 'not delivered', text: 'It expired before the other session approved it.' },
  { match: /^refused/, state: 'failed', title: 'refused by the other session', text: 'It does not accept messages from other sessions.' },
  { match: /^dropped at that session's inbox/, state: 'failed', title: 'dropped by the other session', text: 'Not delivered.' },
];

function deliveryReport([, count, rest], text, limit) {
  const report = REPORTS.find(r => r.match.test(rest));
  if (!report) return null;
  const reason = /NOT delivered \(([^)]*)\)/.exec(rest)?.[1];
  const to = /\(recipient: ([^;)]*)(?:; msg_id: ([^)]*))?\)/.exec(rest) || [];
  return notice({
    state: report.state,
    title: `${Number(count) > 1 ? `${count} messages` : 'Message'} ${report.title}`,
    text: reason ? `${reason[0].toUpperCase()}${reason.slice(1)}.` : report.text,
    details: [['Recipient', label(to[1])], ['Message', label(to[2])], ['Also sent to Claude', text]].filter(([, value]) => value),
  }, limit);
}

// The two turns the CLI saves for Claude alone that are worth showing: a message that came from another session, and the
// report on one this session sent. Anything else of that kind stays hidden.
export function metaNotice(origin, text, limit) {
  const plain = text.trim();
  if (origin?.kind === 'peer') {
    const hasBody = typeof origin.body === 'string';
    // A subagent's hand-back takes its title from the tag, and a message the host injected has no text or name in its origin.
    const message = origin.handback || !hasBody ? WRAPPED.exec(plain) || MESSAGE.exec(plain) : null;
    if (message) return messageNotice(message, limit, origin);
    return peerMessage({ from: origin.from, name: origin.name, mode: origin.fromMode, body: hasBody ? origin.body.trim() : '' }, limit);
  }
  const report = REPORT.exec(plain);
  return report ? deliveryReport(report, plain, limit) : null;
}

// The item for a user turn the CLI wrote, or null when `text` is something a person typed.
export function noticeFrom(text, limit) {
  const task = /^<task-notification>([\s\S]*?)<\/task-notification>([\s\S]*)$/.exec(text);
  if (task) return taskNotice(task[1], task[2], limit);
  const message = MESSAGE.exec(text);
  return message ? messageNotice(message, limit) : null;
}
