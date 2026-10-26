// Run with `npm test`. The samples are the shapes the CLI wrote in real transcripts, trimmed to what the parser reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IMAGE_TYPES } from '../lib/images.mjs';
import { noticeFrom } from '../lib/notices.mjs';
import { completeEnd, listImages, readAfter, readBefore, readHead, readImage, toolSummary } from '../lib/transcripts.mjs';
import { threadImages } from '../public/ui/gallery.js';
import { absorb, prepend } from '../public/ui/thread.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-transcripts-test-'));

const AGENT = `<task-notification>
<task-id>ab2459b937be68d30</task-id>
<tool-use-id>toolu_01B34e3V5dordKYVPdwpDocb</tool-use-id>
<output-file>/private/tmp/tasks/ab2459b937be68d30.output</output-file>
<status>completed</status>
<summary>Agent "Architecture lane for PR #144" finished</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own.</note>
<result>Use &lt;b&gt; for bold &amp; keep it short.</result>
<usage><subagent_tokens>72590</subagent_tokens><tool_uses>10</tool_uses><duration_ms>42520</duration_ms></usage>
</task-notification>`;

const ORPHANS = `<task-notification>
<task-id>bougel110</task-id>
<task-id>bfvjkdpxq</task-id>
<task-id>bmqgx5aeg</task-id>
<task-id>__orphan_summary__:shell</task-id>
<status>stopped</status>
<summary>3 background shell command task(s) from the previous session have no completion record.</summary>
</task-notification>`;

const MONITOR = `<task-notification>
<task-id>b1huq9a9z</task-id>
<summary>Monitor event: "CI checks on PR 149"</summary>
<event>phpstan: fail</event>
If this event is something the user would act on now, send a PushNotification.
</task-notification>`;

const file = (name, entries) => {
  const f = path.join(base, `${name}.jsonl`);
  fs.writeFileSync(f, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { file: f, size: fs.statSync(f).size };
};
const user = content => ({ type: 'user', timestamp: '2026-10-16T01:00:00.000Z', message: { role: 'user', content } });
const queued = (prompt, commandMode, extra = {}) => ({ type: 'attachment', timestamp: '2026-10-16T01:00:01.000Z', attachment: { type: 'queued_command', commandMode, prompt, ...extra } });
const itemsOf = (t, limit = 8000) => readBefore(t, t.size, t.size, '/work', limit).items;
const assistant = (id, content) => ({ type: 'assistant', timestamp: '2026-10-16T01:00:02.000Z', message: { id, role: 'assistant', content } });

test('a finished task is a green notice with its summary, and the ids, output file, note and result behind the details', () => {
  const n = noticeFrom(AGENT);
  assert.equal(n.kind, 'system');
  assert.equal(n.state, 'done');
  assert.equal(n.title, 'Background task finished');
  assert.equal(n.text, 'Agent "Architecture lane for PR #144" finished');
  assert.deepEqual(n.details.map(d => d.label), ['Task', 'Tool call', 'Output file', 'Note', 'Result', 'Usage']);
  assert.equal(n.details[0].value, 'ab2459b937be68d30');
  assert.equal(n.details[4].value, 'Use <b> for bold & keep it short.', 'the CLI escapes what it writes, so the page shows it unescaped');
  assert.equal(n.details[5].value, 'Subagent tokens: 72590\nTool uses: 10\nDuration ms: 42520');
});

test('failed is red, and stopped and killed both read as stopped', () => {
  const failed = noticeFrom('<task-notification>\n<task-id>bi9ejho1p</task-id>\n<status>failed</status>\n<summary>Monitor "x" script failed (exit 144)</summary>\n</task-notification>');
  assert.deepEqual([failed.state, failed.title], ['failed', 'Background task failed']);
  for (const status of ['stopped', 'killed']) {
    const n = noticeFrom(`<task-notification>\n<task-id>b1</task-id>\n<status>${status}</status>\n<summary>Stopped</summary>\n</task-notification>`);
    assert.deepEqual([n.state, n.title], ['stopped', 'Background task stopped'], status);
  }
});

test('several tasks make one notice that counts them, and the CLI\'s orphan marker is never shown', () => {
  const n = noticeFrom(ORPHANS);
  assert.equal(n.title, '3 background tasks stopped');
  assert.deepEqual(n.details, [{ label: 'Tasks', value: 'bougel110, bfvjkdpxq, bmqgx5aeg' }]);
  assert.equal(JSON.stringify(n).includes('__orphan_summary__'), false);
});

test('a monitor line has no status, so it is a plain update that shows the line itself, and the model-only text waits in the details', () => {
  const n = noticeFrom(MONITOR);
  assert.equal(n.state, undefined);
  assert.equal(n.title, 'Background update');
  assert.equal(n.text, 'Monitor event: "CI checks on PR 149"');
  assert.equal(n.output, 'phpstan: fail');
  assert.deepEqual(n.details, [
    { label: 'Task', value: 'b1huq9a9z' },
    { label: 'Also sent to Claude', value: 'If this event is something the user would act on now, send a PushNotification.' },
  ]);
});

test('text after the closing tag is kept in the details, and a tag with no closing tag stays typed text', () => {
  const n = noticeFrom(`<task-notification>\n<task-id>bz10yqun4</task-id>\n<summary>Background command "gh auth" appears to be waiting</summary>\n</task-notification>\nLast output:\nPress Enter`);
  assert.deepEqual(n.details.at(-1), { label: 'Also sent to Claude', value: 'Last output:\nPress Enter' });
  assert.equal(noticeFrom('<task-notification>\n<task-id>b1</task-id>'), null);
});

test('something a person typed is never a notice, even when it mentions the tag', () => {
  assert.equal(noticeFrom('Why does <task-notification> show up in my chat?'), null);
  assert.equal(noticeFrom('fix the <agent-message> parser'), null);
  assert.equal(noticeFrom('<div>pasted markup</div>'), null);
});

test('a long field is cut at the output limit, with the count of what was left out', () => {
  const n = noticeFrom(`<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>${'x'.repeat(50)}</result>\n</task-notification>`, 20);
  assert.equal(n.details.at(-1).value, `${'x'.repeat(20)}\n... (30 more characters)`);
});

test('a message from another session names its sender and shows its text; one written for Claude alone is all details', () => {
  const m = noticeFrom('<cross-session-message from="uds:/tmp/cc.sock" from-name="Write the rule" from-mode="bypass">\nI will stop my dev server soon.\n</cross-session-message>');
  assert.equal(m.title, 'Message from Write the rule');
  assert.equal(m.text, 'I will stop my dev server soon.');
  assert.deepEqual(m.details, [{ label: 'From', value: 'uds:/tmp/cc.sock' }, { label: 'From name', value: 'Write the rule' }, { label: 'From mode', value: 'bypass' }]);
  const idle = noticeFrom('<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>');
  assert.equal(idle.text, undefined);
  assert.deepEqual(idle.details, [{ label: 'Also sent to Claude', value: 'None of the sessions you started is working now.' }]);
  assert.equal(noticeFrom('<ci-monitor-event>Auto-fix is watching PR 7710.</ci-monitor-event>').title, 'Pull request monitor');
  assert.equal(noticeFrom('<agent-message from="a09d">[Subagent hand-back] Report.</agent-message>').title, 'Message from a subagent');
});

test('a message from a parent session shows as a message from another session, and the CLI\'s own tag is not what carries it', () => {
  const m = noticeFrom('<parent-session-message from="abc" from-name="Fix the build (your parent session)">\nPlease rebase.\n</parent-session-message>');
  assert.equal(m.title, 'Message from Fix the build (your parent session)');
  assert.equal(m.text, 'Please rebase.');
  assert.deepEqual(m.details, [{ label: 'From', value: 'abc' }, { label: 'From name', value: 'Fix the build (your parent session)' }]);
  assert.equal(noticeFrom('say <parent-session-message> in a sentence'), null);
});

test('a task that ends while Claude is idle (a user entry) and one that ends mid-turn (a queued attachment) both show as notices', () => {
  const t = file('shapes', [user('first prompt'), user(AGENT), queued(ORPHANS, 'task-notification'), queued('redirect the work', 'prompt')]);
  const items = itemsOf(t);
  assert.deepEqual(items.map(i => [i.kind, i.title || i.text]), [
    ['user', 'first prompt'],
    ['system', 'Background task finished'],
    ['system', '3 background tasks stopped'],
    ['user', 'redirect the work'],
  ]);
  assert.equal(items[1].at, '2026-10-16T01:00:00.000Z');
});

test('the same two shapes read the same on the live path, which reads only what was appended', () => {
  const t = file('live', [user('first prompt')]);
  const from = t.size;
  fs.appendFileSync(t.file, [user(MONITOR), queued(AGENT, 'task-notification')].map(e => JSON.stringify(e)).join('\n') + '\n');
  const r = readAfter(t, from, '/work', 8000);
  assert.deepEqual(r.items.map(i => [i.kind, i.title]), [['system', 'Background update'], ['system', 'Background task finished']]);
});

test('a notice from a sidechain or a meta entry is not shown', () => {
  const t = file('skipped', [{ ...user(AGENT), isSidechain: true }, { ...user(AGENT), isMeta: true }, user('hello')]);
  assert.deepEqual(itemsOf(t).map(i => i.kind), ['user']);
});

const ADDRESS = 'uds:/tmp/cc-socks/22680.sock';
const peer = (body, extra = {}) => ({
  ...user(`Another Claude session sent a message:\n<cross-session-message from="${ADDRESS}" from-name="Worker" from-mode="prompting">\n${body}\n</cross-session-message>\n\nThis came from another Claude session, not from your user.`),
  isMeta: true,
  origin: { kind: 'peer', from: ADDRESS, verifiedPeerPid: 22680, msg_id: 'm1', name: 'Worker', fromMode: 'prompting', body },
  promptSource: 'system',
  turnOrigin: 'peer',
  ...extra,
});

test('a message that arrived from another session is a notice that names its sender, with the sender\'s address and mode behind the details', () => {
  const t = file('peer', [user('first prompt'), peer('Please run the tests.'), user('thanks')]);
  const items = itemsOf(t);
  assert.deepEqual(items.map(i => [i.kind, i.title || i.text]), [['user', 'first prompt'], ['system', 'Message from Worker'], ['user', 'thanks']]);
  assert.equal(items[1].text, 'Please run the tests.', 'the text is the sender\'s own, not the CLI\'s wrapper round it');
  assert.deepEqual(items[1].details, [{ label: 'From', value: ADDRESS }, { label: 'From name', value: 'Worker' }, { label: 'From mode', value: 'prompting' }]);
  assert.equal(items[1].at, '2026-10-16T01:00:00.000Z');
});

test('a sender cannot redraw its own line: breaks, bidi marks and zero-width characters go, a long name is cut, and markup stays plain text', () => {
  const name = `Boss\n‮evil​ <img src=x onerror=alert(1)> ${'x'.repeat(100)}`;
  const t = file('peer-name', [peer('hi', { origin: { kind: 'peer', from: `${ADDRESS}‮`, name, fromMode: 'bypass', body: 'hi' } })]);
  const [n] = itemsOf(t);
  const shown = n.title.slice('Message from '.length, -3);
  assert.equal(shown.startsWith('Boss evil <img src=x onerror=alert(1)> xxx'), true);
  assert.equal([...shown].length, 60);
  assert.equal(n.title.endsWith('...'), true);
  for (const text of [n.title, ...n.details.map(d => d.value)]) assert.doesNotMatch(text, /[\n‮​]/u);
  assert.equal(n.details[1].value.length > 100, true, 'the details keep the whole name');
});

test('a message that arrives while Claude is mid-turn is a queued attachment with the bare tag, and shows the same notice', () => {
  const tag = `<cross-session-message from="${ADDRESS}" from-name="Late sender" from-mode="bypass">\nThe deploy window moved to 5pm.\n</cross-session-message>`;
  const t = file('peer-queued', [user('first prompt'), queued(tag, 'prompt'), user('thanks')]);
  const items = itemsOf(t);
  assert.deepEqual(items.map(i => [i.kind, i.title || i.text]), [['user', 'first prompt'], ['system', 'Message from Late sender'], ['user', 'thanks']]);
  assert.equal(items[1].text, 'The deploy window moved to 5pm.');
  assert.deepEqual(items[1].details, [{ label: 'From', value: ADDRESS }, { label: 'From name', value: 'Late sender' }, { label: 'From mode', value: 'bypass' }]);
});

test('a message a parent sent through send_sub_session is saved as a plain user turn, or a queued one mid-turn, and shows as a message from its parent', () => {
  const tag = '<parent-session-message from="parent-id" from-name="Fix the build (your parent session)">\nPlease rebase.\n</parent-session-message>';
  const t = file('peer-parent', [user('first prompt'), user(tag), queued(tag, 'prompt'), user('thanks')]);
  const items = itemsOf(t);
  assert.deepEqual(items.map(i => [i.kind, i.title || i.text]), [['user', 'first prompt'], ['system', 'Message from Fix the build (your parent session)'], ['system', 'Message from Fix the build (your parent session)'], ['user', 'thanks']]);
  assert.deepEqual(items[1].details, [{ label: 'From', value: 'parent-id' }, { label: 'From name', value: 'Fix the build (your parent session)' }]);
  assert.equal(items[1].text, 'Please rebase.');
});

test('a message with no sender name, or no text, is still a notice', () => {
  const t = file('peer-bare', [peer('', { origin: { kind: 'peer', from: ADDRESS, body: '' } })]);
  const [n] = itemsOf(t);
  assert.deepEqual([n.title, n.text, n.details], ['Message from another session', undefined, [{ label: 'From', value: ADDRESS }]]);
});

test('a message from another session saved without the meta flag is a notice too, and one from a sidechain is not shown', () => {
  const t = file('peer-plain', [peer('plain', { isMeta: undefined }), peer('inside a subagent', { isSidechain: true })]);
  assert.deepEqual(itemsOf(t).map(i => [i.kind, i.text]), [['system', 'plain']]);
});

const SENT = '(recipient: uds:/tmp/cc-socks/25507.sock; msg_id: 3ee60c05-9fba-4a30-84ee-08978a954153)';
const report = text => ({ ...user(`[Cross-session delivery notice] ${text}`), isMeta: true, promptSource: 'system', turnOrigin: 'system' });

test('what the CLI tells a sender about its message is a notice: held, delivered, denied, expired, refused or dropped', () => {
  const t = file('reports', [
    report(`Your message to another session was held by that session ${SENT}. NOT delivered: its Claude has not seen it. Do not resend.`),
    report(`Your message to another session was approved and released to that session ${SENT}.`),
    report(`Your message to another session was denied by the recipient user ${SENT}. Not delivered to that session's Claude.`),
    report(`Your message to another session was not approved before expiry ${SENT}. Not delivered to that session's Claude, and nothing is waiting there.`),
    report(`Your message to another session was refused ${SENT}: that session is not accepting cross-session messages. Not delivered.`),
    report(`Do not resend now: one of your messages to another session was dropped at that session's inbox and NOT delivered (you sent faster than that session accepts). Treat them as unsent.`),
    report(`Do not resend now: 3 of your messages to another session were dropped at that session's inbox and NOT delivered (its queue of undelivered peer messages was full). Treat them as unsent.`),
  ]);
  const items = itemsOf(t);
  assert.deepEqual(items.map(i => [i.state, i.title]), [
    ['waiting', 'Message held by the other session'],
    ['done', 'Message delivered'],
    ['stopped', 'Message denied by the other session'],
    ['failed', 'Message not delivered'],
    ['failed', 'Message refused by the other session'],
    ['failed', 'Message dropped by the other session'],
    ['failed', '3 messages dropped by the other session'],
  ]);
  assert.equal(items[0].text, 'Not delivered yet. It waits for the other session\'s owner to approve it.');
  assert.equal(items[5].text, 'You sent faster than that session accepts.');
  assert.deepEqual(items[0].details.slice(0, 2), [{ label: 'Recipient', value: 'uds:/tmp/cc-socks/25507.sock' }, { label: 'Message', value: '3ee60c05-9fba-4a30-84ee-08978a954153' }]);
  assert.equal(items[0].details.at(-1).label, 'Also sent to Claude', 'the CLI\'s own wording stays behind the details');
});

test('a meta entry that is neither a peer message nor a delivery report stays hidden, and so does a delivery report typed by a person', () => {
  const t = file('meta', [
    { ...user('Caveat: the messages below were generated by the user while running local commands.'), isMeta: true },
    { ...user('[Cross-session delivery notice] Your message to another session was teleported (recipient: x).'), isMeta: true },
    user('[Cross-session delivery notice] Your message to another session was approved and released to that session.'),
    { ...assistant('msg_9', [{ type: 'text', text: 'hello' }]), isMeta: true },
  ]);
  assert.deepEqual(itemsOf(t).map(i => [i.kind, i.text]), [['user', '[Cross-session delivery notice] Your message to another session was approved and released to that session.']]);
});

const HELD = `[Cross-session delivery notice] Your message to another session was held by that session ${SENT}. NOT delivered: its Claude has not seen it. Do not resend.`;

test('a delivery report that arrives while Claude is mid-turn is a notice, and a meta attachment is never shown as a message the owner typed', () => {
  const t = file('report-queued', [
    queued(HELD, 'prompt', { isMeta: true }),
    queued([{ type: 'text', text: HELD }], 'prompt', { isMeta: true }),
    queued('Caveat: the messages below were generated by the user while running local commands.', 'prompt', { isMeta: true }),
    queued(HELD, 'prompt'),
  ]);
  assert.deepEqual(itemsOf(t).map(i => [i.kind, i.title || i.text]), [
    ['system', 'Message held by the other session'],
    ['system', 'Message held by the other session'],
    ['user', HELD],
  ]);
});

test('a queued attachment is a meta turn only when it says so or its origin is a peer, so a task notice or a typed message that has an origin is left as it was', () => {
  const origin = { kind: 'peer', from: ADDRESS, name: 'Worker', fromMode: 'prompting', body: 'The deploy window moved.' };
  const tag = `<cross-session-message from="${ADDRESS}" from-name="Worker" from-mode="prompting">\nThe deploy window moved.\n</cross-session-message>`;
  const t = file('queued-origins', [
    queued(tag, 'prompt', { isMeta: true, origin }),
    queued(tag, 'prompt', { origin }),
    queued(AGENT, 'task-notification', { origin: { kind: 'task-notification' } }),
    queued('redirect the work', 'prompt', { origin: { kind: 'human' } }),
  ]);
  assert.deepEqual(itemsOf(t).map(i => [i.kind, i.title || i.text]), [
    ['system', 'Message from Worker'],
    ['system', 'Message from Worker'],
    ['system', 'Background task finished'],
    ['user', 'redirect the work'],
  ]);
});

const HOST = 'local_11111111-2222-3333-4444-555555555555';
const REMINDER = 'This came from another Claude session, not from your user.';
const wrapped = tag => `Another Claude session sent a message:\n${tag}\n\n${REMINDER}`;

test('a message the host injected has no name or text in its origin, so both come from the tag, and the text runs to the last closing tag', () => {
  const text = 'Close the tag with </cross-session-message> and stop.\n\nThen wait.';
  const tag = `<cross-session-message from="${HOST}" name="Reviewer">\n${text}\n</cross-session-message>`;
  const t = file('peer-host', [{ ...user(wrapped(tag)), isMeta: true, origin: { kind: 'peer', from: HOST, hostInjected: true, fromMode: 'bypass' } }]);
  const [n] = itemsOf(t);
  assert.deepEqual([n.title, n.text], ['Message from Reviewer', text]);
  assert.deepEqual(n.details, [{ label: 'From', value: HOST }, { label: 'From name', value: 'Reviewer' }, { label: 'From mode', value: 'bypass' }]);
});

test('where an origin without text has a name or an address of its own, it wins over the tag round the message', () => {
  const tag = `<cross-session-message from="${ADDRESS}" name="Impostor">\nhi\n</cross-session-message>`;
  const t = file('peer-origin-wins', [{ ...user(wrapped(tag)), isMeta: true, origin: { kind: 'peer', from: HOST, name: 'Reviewer' } }]);
  const [n] = itemsOf(t);
  assert.deepEqual([n.title, n.text, n.details], ['Message from Reviewer', 'hi', [{ label: 'From', value: HOST }, { label: 'From name', value: 'Reviewer' }]]);
});

test('a hand-back from this chat\'s own subagent is a message from a subagent, whether it arrived as a user entry or a queued attachment', () => {
  const text = '[Subagent hand-back] The lint pass is done.';
  const tag = `<agent-message from="agent-0001">\n${text}\n</agent-message>`;
  const origin = { kind: 'peer', from: 'agent-0001', senderTaskId: 'agent-0001', body: text, handback: true };
  const t = file('handback', [
    { ...user(`Another Claude session sent a message:\n${tag}\n\nThat "other Claude session" is an agent working inside this same session.`), isMeta: true, origin: { ...origin, name: 'Linter' } },
    queued(tag, 'prompt', { isMeta: true, origin }),
  ]);
  for (const n of itemsOf(t)) {
    assert.deepEqual([n.kind, n.title, n.text, n.details], ['system', 'Message from a subagent', text, [{ label: 'From', value: 'agent-0001' }]]);
  }
});

test('the live path shows a message that arrives while a session is open, the same as a load does', () => {
  const t = file('peer-live', [user('first prompt')]);
  const from = t.size;
  fs.appendFileSync(t.file, [peer('Are you there?'), report(`Your message to another session was approved and released to that session ${SENT}.`)].map(e => JSON.stringify(e)).join('\n') + '\n');
  const r = readAfter(t, from, '/work', 8000);
  assert.deepEqual(r.items.map(i => [i.kind, i.title]), [['system', 'Message from Worker'], ['system', 'Message delivered']]);
});

test('a send to another session reads as who it went to and what it said, on one line, and a lookup of other sessions says what it looks up', () => {
  const t = file('sends', [
    user('tell the worker'),
    assistant('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'ListAgents', input: {} }]),
    assistant('msg_2', [{ type: 'tool_use', id: 'toolu_2', name: 'SendMessage', input: { to: 'Worker', message: 'Please run\nthe tests.', summary: '' } }]),
    assistant('msg_3', [{ type: 'tool_use', id: 'toolu_3', name: 'SendMessage', input: { to: 'Worker', message: 'Long text', summary: 'Ask for the test results' } }]),
  ]);
  assert.deepEqual(itemsOf(t).filter(i => i.kind === 'tool').map(i => [i.name, i.summary]), [
    ['ListAgents', 'other sessions'],
    ['SendMessage', 'to Worker: Please run the tests.'],
    ['SendMessage', 'to Worker: Ask for the test results'],
  ]);
});

test('pasted text loses the CLI\'s paste tags and stays a message from the person', () => {
  const t = file('pasted', [user('<pasted_content id="3852">\nName: Ryon\n</pasted_content id="3852">'), user('see <pasted_content id="1">the log</pasted_content> please')]);
  assert.deepEqual(itemsOf(t).map(i => i.text), ['Name: Ryon', 'see the log please']);
});

test('a session whose first entry is a notice is titled by its first real prompt', () => {
  const t = file('head', [{ ...user(ORPHANS), cwd: '/work' }, { ...user('Fix the login bug'), cwd: '/work' }]);
  assert.equal(readHead(t).title, 'Fix the login bug');
});

test('a thinking block that has text is a thinking item beside the reply it belongs to, and a redacted one shows nothing', () => {
  const t = file('thinking', [
    user('is 2027 prime?'),
    assistant('msg_1', [{ type: 'thinking', thinking: 'Checking divisors up to 45.', signature: 'sig' }]),
    assistant('msg_1', [{ type: 'thinking', thinking: '', signature: 'sig' }]),
    assistant('msg_1', [{ type: 'text', text: 'Yes.' }]),
  ]);
  assert.deepEqual(itemsOf(t).map(i => [i.kind, i.msgId, i.text]), [
    ['user', undefined, 'is 2027 prime?'],
    ['thinking', 'msg_1', 'Checking divisors up to 45.'],
    ['assistant', 'msg_1', 'Yes.'],
  ]);
});

test('a long thinking summary is cut at the output limit', () => {
  const t = file('long-thinking', [assistant('msg_2', [{ type: 'thinking', thinking: 'y'.repeat(30) }])]);
  assert.equal(itemsOf(t, 10)[0].text, `${'y'.repeat(10)}\n... (20 more characters)`);
});

const picture = (bytes, media_type = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type, data: Buffer.from(bytes).toString('base64') } });
const toolResult = (id, content) => ({ type: 'tool_result', tool_use_id: id, content });
const line = (uuid, content) => ({ ...user(content), uuid });
// Where the second entry of a file starts, which is the number its refs begin with.
const startOfSecond = first => Buffer.byteLength(JSON.stringify(first)) + 1;
const resultsOf = items => items.filter(i => i.kind === 'result');

test('a tool result lists the pictures the page can draw and keeps its text, marking only a picture it cannot draw', () => {
  const t = file('tool-pictures', [line('u1', [
    toolResult('toolu_1', [{ type: 'text', text: 'Took a screenshot.' }, picture([1, 2, 3]), picture([4, 5, 6], 'image/bmp')]),
    toolResult('toolu_2', [picture([7, 8, 9], 'image/jpeg')]),
    toolResult('toolu_3', [{ type: 'text', text: 'Only words.' }]),
    toolResult('toolu_4', 'A plain string.'),
  ])]);
  const [mixed, alone, words, plain] = resultsOf(itemsOf(t));
  assert.equal(mixed.output, 'Took a screenshot.\n[image]');
  assert.deepEqual(mixed.images, [{ ref: '0.r0.u1', type: 'image/png' }]);
  assert.equal(alone.output, '', 'a picture that is listed leaves no placeholder behind');
  assert.deepEqual(alone.images, [{ ref: '0.r2.u1', type: 'image/jpeg' }], 'the bitmap before it took the number r1');
  assert.equal(words.output, 'Only words.');
  assert.equal(plain.output, 'A plain string.');
  assert.equal('images' in words || 'images' in plain, false, 'a result with no picture carries no list');
});

test('pictures are numbered across every result on a line, and the live path reads them the same way', () => {
  const first = line('u0', 'hello');
  const second = line('u2', [
    toolResult('toolu_a', [picture([1]), { type: 'text', text: 'A' }, picture([2])]),
    toolResult('toolu_b', [{ type: 'text', text: 'B' }, picture([3])]),
  ]);
  const t = file('numbering', [first, second]);
  const at = startOfSecond(first);
  const [a, b] = resultsOf(itemsOf(t));
  assert.deepEqual(a.images.map(i => i.ref), [`${at}.r0.u2`, `${at}.r1.u2`]);
  assert.deepEqual(b.images.map(i => i.ref), [`${at}.r2.u2`]);
  const live = readAfter(t, at, '/work', 8000);
  assert.deepEqual(resultsOf(live.items).flatMap(r => r.images.map(i => i.ref)), [`${at}.r0.u2`, `${at}.r1.u2`, `${at}.r2.u2`]);
});

test('a tool picture the page cannot draw still takes its number, so adding a type later moves no ref', () => {
  const BMP = [66, 77, 1];
  const PNG = [1, 1, 1];
  const t = file('undrawn-number', [line('u1', [toolResult('toolu_1', [picture(BMP, 'image/bmp'), picture(PNG)])])]);
  const refs = () => resultsOf(itemsOf(t)).flatMap(r => (r.images || []).map(i => i.ref));
  const bytes = ref => { const got = readImage(t, ref); return got && [...got.bytes]; };
  assert.deepEqual(refs(), ['0.r1.u1'], 'the PNG is the second image block of the result');
  assert.equal(readImage(t, '0.r0.u1'), null, 'the bitmap has a number but cannot be drawn');
  assert.deepEqual(bytes('0.r1.u1'), PNG);
  IMAGE_TYPES.push('image/bmp');
  try {
    assert.deepEqual(refs(), ['0.r0.u1', '0.r1.u1'], 'a type added later gives the bitmap r0');
    assert.deepEqual(bytes('0.r1.u1'), PNG, 'and the address a browser cached still names the same picture');
    assert.deepEqual(bytes('0.r0.u1'), BMP);
  } finally { IMAGE_TYPES.pop(); }
});

test('a sent picture is numbered among the drawable types only, as it has been since the first browsers cached its address', () => {
  const t = file('sent-numbers', [line('u1', [picture([66, 77], 'image/bmp'), picture([2, 2, 2])])]);
  const sent = itemsOf(t).find(i => i.kind === 'user');
  assert.deepEqual(sent.images, [{ ref: '0.0.u1', type: 'image/png' }], 'the PNG is picture 0 because the bitmap is not counted');
  assert.deepEqual([...readImage(t, '0.0.u1').bytes], [2, 2, 2]);
});

const TOOL_A = [0, 1, 2, 250, 255];
const TOOL_B = [9, 8, 7, 128];
const SENT_0 = [10, 11, 12, 200];
const SENT_1 = [13, 14, 15, 201];

test('readImage gives back the picture a ref names, an r ref the tool\'s and a plain one the user\'s, on a line that holds both', () => {
  const first = line('u0', 'hello');
  const second = line('u1', [
    toolResult('toolu_a', [{ type: 'text', text: 'A' }, picture(TOOL_A)]),
    picture(SENT_0),
    toolResult('toolu_b', [picture(TOOL_B, 'image/jpeg')]),
    picture(SENT_1, 'image/webp'),
  ]);
  const t = file('mixed-line', [first, second]);
  const at = startOfSecond(first);
  const items = itemsOf(t);
  const sent = items.find(i => i.kind === 'user' && i.images);
  assert.deepEqual(sent.images, [{ ref: `${at}.0.u1`, type: 'image/png' }, { ref: `${at}.1.u1`, type: 'image/webp' }], 'a sent picture is still named by its plain number');
  assert.deepEqual(resultsOf(items).flatMap(r => r.images.map(i => i.ref)), [`${at}.r0.u1`, `${at}.r1.u1`]);
  const bytes = ref => { const got = readImage(t, ref); return got && [got.type, [...got.bytes]]; };
  assert.deepEqual(bytes(`${at}.r0.u1`), ['image/png', TOOL_A]);
  assert.deepEqual(bytes(`${at}.r1.u1`), ['image/jpeg', TOOL_B]);
  assert.deepEqual(bytes(`${at}.0.u1`), ['image/png', SENT_0]);
  assert.deepEqual(bytes(`${at}.1.u1`), ['image/webp', SENT_1]);
  assert.equal(readImage(t, `${at}.r2.u1`), null, 'there is no third tool picture');
  assert.equal(readImage(t, `${at}.2.u1`), null, 'and no third sent one');
});

test('readImage gives nothing for the wrong uuid, a ref that is badly formed, a line that is not a user entry, or a picture of the other kind', () => {
  const first = line('u0', 'hello');
  const second = line('u1', [toolResult('toolu_a', [picture(TOOL_A)])]);
  const third = line('u2', [picture(SENT_0)]);
  const queuedWithPicture = { ...queued([{ type: 'text', text: 'redirect' }, picture(SENT_1)], 'prompt'), uuid: 'u3' };
  const notUser = { type: 'assistant', uuid: 'u4', message: { role: 'assistant', content: [toolResult('toolu_z', [picture(TOOL_B)])] } };
  const t = file('refusals', [first, second, third, queuedWithPicture, notUser]);
  const at2 = startOfSecond(first);
  const at3 = at2 + Buffer.byteLength(JSON.stringify(second)) + 1;
  const at4 = at3 + Buffer.byteLength(JSON.stringify(third)) + 1;
  const at5 = at4 + Buffer.byteLength(JSON.stringify(queuedWithPicture)) + 1;
  assert.notEqual(readImage(t, `${at2}.r0.u1`), null);
  assert.notEqual(readImage(t, `${at3}.0.u2`), null);
  assert.notEqual(readImage(t, `${at4}.0.u3`), null, 'a queued message\'s picture is still reached by its plain ref');
  assert.equal(readImage(t, `${at2}.r0.u9`), null, 'wrong uuid, tool picture');
  assert.equal(readImage(t, `${at3}.0.u9`), null, 'wrong uuid, sent picture');
  assert.equal(readImage(t, `${at2}.0.u1`), null, 'a plain ref never reaches a tool picture');
  assert.equal(readImage(t, `${at3}.r0.u2`), null, 'an r ref never reaches a sent picture');
  assert.equal(readImage(t, `${at4}.r0.u3`), null, 'an r ref never reaches a queued message');
  assert.equal(readImage(t, `${at5}.r0.u4`), null, 'an r ref reads only a user entry, whatever else holds a tool_result');
  assert.equal(readImage(t, `${at2 + 1}.r0.u1`), null, 'an offset that is not the start of a line');
  for (const bad of ['', undefined, null, 'abc', `${at2}`, `${at2}.u1`, `${at2}.r.u1`, `${at2}.R0.u1`, `${at2}.rr0.u1`, `${at2}.r-1.u1`, `${at2}.r0.u1.x`, `${at2}.r0`, `-1.r0.u1`, `${at2}.r0.u 1`, `${at2}.r0.u1/..`]) {
    assert.equal(readImage(t, bad), null, String(bad));
  }
});

// ---- the list of every picture, for the viewer ----------------------------------------------------

const use = (id, name) => assistant(`msg_${id}`, [{ type: 'tool_use', id, name, input: {} }]);
const lineStarts = t => {
  const bytes = fs.readFileSync(t.file);
  const starts = [0];
  for (let n = bytes.indexOf(0x0a); n !== -1; n = bytes.indexOf(0x0a, n + 1)) starts.push(n + 1);
  return starts;
};
const addressOf = ref => `api/sessions/s1/images/${ref}`;
const drawn = items => threadImages(items, [], addressOf).map(i => i.key);
const emptyThread = () => ({ items: [], orphans: new Map() });
const asRead = (t, from = 0) => drawn(absorb(emptyThread(), readAfter(t, from, '', 8000).items).items);

const SHOT = { sent: 'sent first', a1: 'from A one', a2: 'from A two', b: 'from B', later: 'sent after C was called', c: 'from C', orphan: 'no call', side: 'in a subagent', queued: 'queued with a message' };
// Lines 3 and 4 call A and B, which answer in the opposite order on lines 6 and 5. Line 7 calls C, line 8 sends a picture, and C answers on line 9.
const CHAT = [
  line('u0', 'a message with café and 日本 in it'),
  line('u1', [picture(SHOT.sent)]),
  assistant('m1', [{ type: 'text', text: 'Looking.' }]),
  use('toolu_a', 'Read'),
  use('toolu_b', 'mcp__claude-in-chrome__computer'),
  line('u2', [toolResult('toolu_b', [{ type: 'text', text: 'shot' }, picture(SHOT.b)])]),
  line('u3', [toolResult('toolu_a', [picture(SHOT.a1), picture(SHOT.a2, 'image/jpeg')])]),
  use('toolu_c', 'Bash'),
  line('u4', [picture(SHOT.later)]),
  line('u5', [toolResult('toolu_c', [picture(SHOT.c)])]),
  line('u6', [toolResult('toolu_gone', [picture(SHOT.orphan)])]),
  { ...use('toolu_side', 'Read'), isSidechain: true },
  { ...line('u7', [toolResult('toolu_side', [picture(SHOT.side)])]), isSidechain: true },
  { ...queued([{ type: 'text', text: 'redirect' }, picture(SHOT.queued)], 'prompt'), uuid: 'u8' },
  assistant('m2', [{ type: 'text', text: 'Done.' }]),
  line('u9', 'thanks'),
];
// Where each picture sits in the thread, with the line its bytes are on.
const drawnInOrder = at => [
  [`${at[1]}.0.u1`, SHOT.sent],
  [`${at[6]}.r0.u3`, SHOT.a1],
  [`${at[6]}.r1.u3`, SHOT.a2],
  [`${at[5]}.r0.u2`, SHOT.b],
  [`${at[9]}.r0.u5`, SHOT.c],
  [`${at[8]}.0.u4`, SHOT.later],
  [`${at[13]}.0.u8`, SHOT.queued],
];

test('the list holds every picture of the chat as the thread draws it, a tool\'s at its call, and never a picture\'s bytes', () => {
  const t = file('every-picture', CHAT);
  const at = lineStarts(t);
  const list = listImages(t);
  assert.deepEqual(list, [
    { kind: 'user', images: [{ ref: `${at[1]}.0.u1`, type: 'image/png' }] },
    { kind: 'tool', name: 'Read', images: [{ ref: `${at[6]}.r0.u3`, type: 'image/png' }, { ref: `${at[6]}.r1.u3`, type: 'image/jpeg' }] },
    { kind: 'tool', name: 'mcp__claude-in-chrome__computer', images: [{ ref: `${at[5]}.r0.u2`, type: 'image/png' }] },
    { kind: 'tool', name: 'Bash', images: [{ ref: `${at[9]}.r0.u5`, type: 'image/png' }] },
    { kind: 'user', images: [{ ref: `${at[8]}.0.u4`, type: 'image/png' }] },
    { kind: 'user', images: [{ ref: `${at[13]}.0.u8`, type: 'image/png' }] },
  ], 'B answered first and A second, but A was called first; the result with no call and the subagent\'s are left out');
  assert.deepEqual(drawn(list), drawnInOrder(at).map(([ref]) => ref));
  assert.deepEqual(drawn(list), asRead(t), 'the order is the one the page builds from the same lines');
  for (const bytes of Object.values(SHOT)) assert.equal(JSON.stringify(list).includes(Buffer.from(bytes).toString('base64')), false, bytes);
});

test('each ref in the list is served by readImage with the bytes of its picture', () => {
  const t = file('served', CHAT);
  const refs = listImages(t).flatMap(item => item.images.map(img => img.ref));
  assert.deepEqual(refs, drawnInOrder(lineStarts(t)).map(([ref]) => ref));
  drawnInOrder(lineStarts(t)).forEach(([ref, bytes]) => assert.equal(readImage(t, ref).bytes.toString(), bytes, ref));
});

test('split the file at any line and the pictures listed before it, then those the thread reads from it, are the whole chat', () => {
  const t = file('split', CHAT);
  const whole = asRead(t);
  assert.equal(whole.length, 7);
  for (const start of lineStarts(t)) {
    assert.deepEqual([...drawn(listImages(t, start)), ...asRead(t, start)], whole, `split at byte ${start}`);
  }
});

// A block copied whole, so toolu_x, its answer and a reply written on two lines each appear twice.
const COPIED = [
  use('toolu_x', 'Read'),
  line('u1', [toolResult('toolu_x', [picture('copied')])]),
  assistant('m_x', [{ type: 'text', text: 'It is the same file.' }]),
  assistant('m_x', [{ type: 'text', text: 'Nothing changed.' }]),
  line('u2', 'between the copies'),
  use('toolu_x', 'Read'),
  line('u1', [toolResult('toolu_x', [picture('copied')])]),
  assistant('m_x', [{ type: 'text', text: 'It is the same file.' }]),
  assistant('m_x', [{ type: 'text', text: 'Nothing changed.' }]),
  line('u3', 'after the copy'),
];
// toolu_x answers twice with a picture each time, and toolu_y answers a second time without one.
const TWICE = [
  use('toolu_x', 'Read'),
  line('u1', [toolResult('toolu_x', [picture('first answer')])]),
  line('u2', [toolResult('toolu_x', [picture('second answer')])]),
  use('toolu_y', 'Read'),
  line('u3', [toolResult('toolu_y', [picture('only answer')])]),
  line('u4', [toolResult('toolu_y', [{ type: 'text', text: 'and no picture' }])]),
];
const unkeyed = items => items.map(({ key, ...rest }) => rest);

// The page's first chunk starts at a line, here each line in turn, and each Load earlier reads `chunk` bytes before it.
test('the same holds at every stage of loading earlier, the way the page loads a chat a chunk at a time, and back at the start the thread is the one the whole file reads', () => {
  for (const [name, entries] of [['stages', CHAT], ['stages-copied', COPIED], ['stages-twice', TWICE]]) {
    const t = file(name, entries);
    const whole = absorb(emptyThread(), readAfter(t, 0, '', 8000).items).items;
    for (const open of lineStarts(t)) {
      for (const chunk of [150, 400, 900]) {
        let start = open;
        let thread = absorb(emptyThread(), readAfter(t, open, '', 8000).items);
        for (;;) {
          assert.deepEqual([...drawn(listImages(t, start)), ...drawn(thread.items)], drawn(whole), `${name} opened at ${open}, chunk ${chunk}, start ${start}`);
          if (!start) break;
          const read = readBefore(t, start, chunk, '', 8000);
          start = read.start;
          thread = prepend(thread, read.items);
        }
        assert.deepEqual(unkeyed(thread.items), unkeyed(whole), `${name} opened at ${open}, chunk ${chunk}`);
      }
    }
  }
});

test('a call before the split whose result comes after it counts as before, and a picture sent after the call does not', () => {
  const t = file('call-before', CHAT);
  const at = lineStarts(t);
  const [sent, a1, a2, b, c] = drawnInOrder(at).map(([ref]) => ref);
  assert.deepEqual(drawn(listImages(t, at[5])), [sent, a1, a2, b], 'A and B were called before line 5, though both answer on or after it');
  assert.deepEqual(drawn(listImages(t, at[8])), [sent, a1, a2, b, c], 'C was called on line 7, so its picture is before line 8, which holds the picture sent after the call');
  assert.deepEqual(drawn(listImages(t, at[4])), [sent, a1, a2], 'B is called on line 4, so only A is before it');
  assert.deepEqual(drawn(listImages(t, 0)), []);
});

test('a second result for a call replaces the first one\'s pictures, and a result without pictures leaves them, as on a page that read the whole file', () => {
  const t = file('twice', TWICE);
  const at = lineStarts(t);
  assert.deepEqual(drawn(listImages(t)), [`${at[2]}.r0.u2`, `${at[4]}.r0.u3`]);
  assert.deepEqual(drawn(listImages(t)), asRead(t));
});

test('a picture appended to the file is added, half a line waits for its end, and a late result takes its call\'s place', () => {
  const t = file('growing', [use('toolu_x', 'Read'), line('u1', [picture('sent')])]);
  const append = text => fs.appendFileSync(t.file, text);
  assert.equal(listImages(t).length, 1);
  append(`${JSON.stringify(line('u2', [toolResult('toolu_x', [picture('late')])]))}\n`);
  let at = lineStarts(t);
  assert.deepEqual(drawn(listImages(t)), [`${at[2]}.r0.u2`, `${at[1]}.0.u1`], 'the result is drawn at its call, ahead of the picture sent after the call');
  const half = JSON.stringify(line('u3', [picture('half')]));
  append(half.slice(0, 50));
  assert.equal(listImages(t).length, 2, 'half a line is not read yet');
  append(`${half.slice(50)}\n`);
  at = lineStarts(t);
  assert.deepEqual(drawn(listImages(t)), [`${at[2]}.r0.u2`, `${at[1]}.0.u1`, `${at[3]}.0.u3`]);
  assert.deepEqual(drawn(listImages(t)), asRead(t));
});

test('a file rewritten with other content lists only what it holds now, whether the new content is longer or shorter', () => {
  const others = (tag, count) => Array.from({ length: count }, (_, n) => line(`${tag}${n}`, [picture(`${tag} picture ${n}`)]));
  const t = file('rewritten', CHAT);
  assert.equal(listImages(t).length, 6);
  for (const [tag, count] of [['long', 40], ['short', 3]]) {
    fs.writeFileSync(t.file, others(tag, count).map(e => `${JSON.stringify(e)}\n`).join(''));
    const listed = listImages(t);
    assert.equal(listed.length, count, tag);
    assert.deepEqual(listed, listImages(file(`${tag}-copy`, others(tag, count))), `${tag}: the same as reading that content cold`);
  }
});

test('a scan that throws half way is dropped, so the next call reads the file again instead of adding to it', () => {
  const t = file('half-done', [line('u1', [picture('one')])]);
  assert.equal(listImages(t).length, 1);
  fs.appendFileSync(t.file, [line('u2', [picture('two')]), line('u3', [picture('three')])].map(e => `${JSON.stringify(e)}\n`).join(''));
  // A malformed block no longer makes the scan throw, so the line after two stands in as an entry that throws when it is read.
  const real = JSON.parse;
  JSON.parse = (text, ...rest) => (text.includes('"u3"') ? new Proxy({}, { get() { throw new TypeError('a line that cannot be read'); } }) : real(text, ...rest));
  try { assert.throws(() => listImages(t), TypeError); } finally { JSON.parse = real; }
  fs.writeFileSync(t.file, [line('u1', [picture('one')]), line('u2', [picture('two')])].map(e => `${JSON.stringify(e)}\n`).join(''));
  const at = lineStarts(t);
  assert.deepEqual(drawn(listImages(t)), [`${at[0]}.0.u1`, `${at[1]}.0.u2`], 'two, which the failed scan had read, is not listed twice');
});

const bytesRead = work => {
  const real = fs.readSync;
  let total = 0;
  fs.readSync = (...args) => { const got = real(...args); total += got; return got; };
  try { work(); } finally { fs.readSync = real; }
  return total;
};
const bulky = (tag, lines) => [line(`${tag}p`, [picture(tag)]), ...Array.from({ length: lines }, (_, n) => line(`${tag}${n}`, 'x'.repeat(50_000)))];

test('a second call reads little more than the end of the file, and one after an append reads what was added', () => {
  const t = file('incremental', bulky('inc', 40));
  const cold = bytesRead(() => listImages(t));
  const warm = bytesRead(() => listImages(t));
  assert.ok(cold > 2_000_000, `cold read ${cold}`);
  assert.ok(warm < 100_000, `warm read ${warm}`);
  fs.appendFileSync(t.file, `${JSON.stringify(line('incz', [picture('added')]))}\n`);
  let list;
  const after = bytesRead(() => { list = listImages(t); });
  assert.ok(after < 100_000, `read after an append ${after}`);
  assert.equal(list.length, 2);
});

test('the scans of sixteen files are kept, and the one used least recently goes first', () => {
  const files = Array.from({ length: 17 }, (_, n) => file(`lru${n}`, bulky(`lru${n}`, 4)));
  const read = n => bytesRead(() => listImages(files[n]));
  for (let n = 0; n < 16; n++) read(n);
  assert.ok(read(0) < 100_000, 'the first of sixteen is still kept, and using it makes it the newest');
  read(16);
  assert.ok(read(0) < 100_000, 'so it outlasts the seventeenth');
  assert.ok(read(1) > 150_000, 'and the second, now the oldest, was the one dropped');
});

test('a line longer than a chunk is read whole, and a line that crosses from one chunk to the next is not lost', () => {
  const MiB = 1024 * 1024;
  const t = file('long-lines', [
    line('u1', [picture(Buffer.alloc(3 * MiB, 1))]),
    line('u2', [picture(Buffer.alloc(3 * MiB, 2))]),
    line('u3', [picture(Buffer.alloc(7 * MiB, 3))]),
    line('u4', [picture('small')]),
  ]);
  const at = lineStarts(t);
  assert.deepEqual(drawn(listImages(t)), [`${at[0]}.0.u1`, `${at[1]}.0.u2`, `${at[2]}.0.u3`, `${at[3]}.0.u4`]);
  assert.equal(readImage(t, `${at[2]}.0.u3`).bytes.length, 7 * MiB);
});

// A block that is not an object, whatever puts it in a content list. The array holds a text and a picture of its own,
// and neither may show or take a number.
const NOT_OBJECTS = [null, 'text', 7, true, [{ type: 'text', text: 'inside' }, picture([5, 5, 5])]];
const textBlock = text => ({ type: 'text', text });
// `bad` before, between and after the blocks. undefined is no bad block at all, the control.
const among = (bad, blocks) => (bad === undefined ? blocks : [bad, ...blocks.flatMap(b => [b, bad])]);
// What a load (readBefore) and the live path (readAfter) each make of a file, which have to agree.
const bothReads = t => [itemsOf(t), readAfter(t, 0, '/work', 8000).items];

test('a block that is not an object costs only itself in a message the user typed', () => {
  const t = file('bad-sent', NOT_OBJECTS.map((bad, n) => user(among(bad, [textBlock(`sent ${n}`)]))));
  for (const items of bothReads(t)) {
    assert.deepEqual(items.map(i => [i.kind, i.text]), NOT_OBJECTS.map((_, n) => ['user', `sent ${n}`]));
  }
});

test('a block that is not an object costs only itself in what Claude wrote, beside text, thinking or a tool call', () => {
  const t = file('bad-assistant', NOT_OBJECTS.map((bad, n) => assistant(`msg_${n}`, among(bad, [
    { type: 'thinking', thinking: `thought ${n}` },
    textBlock(`wrote ${n}`),
    { type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'ls' } },
  ]))));
  for (const items of bothReads(t)) {
    assert.deepEqual(items.map(i => [i.kind, i.text || i.id]), NOT_OBJECTS.flatMap((_, n) => [['thinking', `thought ${n}`], ['assistant', `wrote ${n}`], ['tool', `toolu_${n}`]]));
  }
});

test('a block that is not an object costs only itself in a tool result, which keeps its status and the text beside it', () => {
  const t = file('bad-result', NOT_OBJECTS.map((bad, n) => line(`u${n}`, among(bad, [toolResult(`toolu_${n}`, among(bad, [textBlock(`output ${n}`)]))]))));
  for (const items of bothReads(t)) {
    assert.deepEqual(resultsOf(items).map(r => [r.toolId, r.status, r.output.trim()]), NOT_OBJECTS.map((_, n) => [`toolu_${n}`, 'ok', `output ${n}`]));
    assert.deepEqual(items.filter(i => i.kind !== 'result'), [], 'and no message of the user\'s comes out of the blocks that are left');
  }
});

test('content that is neither a list nor a string costs only its own message, in a user entry, an assistant entry and a tool result', () => {
  const ODD = [{ type: 'text', text: 'in an object' }, 7, true];
  const t = file('odd-content', [
    user('before'),
    ...ODD.flatMap((content, n) => [user(content), assistant(`msg_${n}`, content), user([toolResult(`toolu_${n}`, content)])]),
    assistant('msg_string', 'Claude as a string'),
    user('after'),
  ]);
  for (const items of bothReads(t)) {
    assert.deepEqual(items.filter(i => i.kind !== 'result').map(i => [i.kind, i.text]), [['user', 'before'], ['user', 'after']]);
    assert.deepEqual(resultsOf(items).map(r => [r.toolId, r.status, r.output]), ODD.map((_, n) => [`toolu_${n}`, 'ok', '']));
  }
});

test('text or thinking that is not a string shows nothing, and the blocks beside it still show', () => {
  const t = file('odd-words', [assistant('msg_1', [
    { type: 'text' }, { type: 'text', text: null }, { type: 'text', text: 5 }, { type: 'text', text: {} }, { type: 'text', text: true }, textBlock(' \n'),
    { type: 'thinking' }, { type: 'thinking', thinking: 5 }, { type: 'thinking', thinking: {} }, { type: 'thinking', thinking: true }, { type: 'thinking', thinking: ' \n' },
    { type: 'thinking', thinking: 'Weighing it.' },
    textBlock('Done.'),
  ])]);
  for (const items of bothReads(t)) assert.deepEqual(items.map(i => [i.kind, i.text]), [['thinking', 'Weighing it.'], ['assistant', 'Done.']]);
});

test('a tool call whose input is null, or whose name is not a string, is still listed with the summary it can give', () => {
  const t = file('odd-tools', [assistant('msg_1', [
    { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: null },
    { type: 'tool_use', id: 'toolu_2', name: 'mcp__claude-in-chrome__navigate', input: null },
    { type: 'tool_use', id: 'toolu_3', name: 7, input: { command: 'ls' } },
    { type: 'tool_use', id: 'toolu_4', name: 'Bash', input: { command: 'pwd' } },
  ])]);
  for (const items of bothReads(t)) {
    assert.deepEqual(items.map(i => [i.id, i.name, i.summary]), [['toolu_1', 'Bash', ''], ['toolu_2', 'mcp__claude-in-chrome__navigate', ''], ['toolu_3', '', 'ls'], ['toolu_4', 'Bash', 'pwd']]);
  }
  assert.equal(toolSummary('Read', null, '/work'), '', 'the same summary an approval card is given for a call with no input');
});

test('a tool call whose name is not a string, or is missing, is listed with an empty name, so the page can always label it', () => {
  const call = (id, extra) => ({ type: 'tool_use', id, input: { command: 'ls' }, ...extra });
  const t = file('odd-names', [assistant('msg_1', [call('toolu_1', { name: 7 }), call('toolu_2'), call('toolu_3', { name: null }), call('toolu_4', { name: ['Bash'] }), call('toolu_5', { name: 'Bash' })])]);
  for (const items of bothReads(t)) assert.deepEqual(items.map(i => [i.id, i.name, i.summary]), [['toolu_1', '', 'ls'], ['toolu_2', '', 'ls'], ['toolu_3', '', 'ls'], ['toolu_4', '', 'ls'], ['toolu_5', 'Bash', 'ls']]);
});

test('a Chrome computer call whose coordinate is not a list is still listed, with the summary it can give', () => {
  const computer = (id, coordinate) => ({ type: 'tool_use', id, name: 'mcp__claude-in-chrome__computer', input: { action: 'left_click', coordinate } });
  const t = file('odd-coordinates', [assistant('msg_1', [computer('toolu_1', [512, 300]), computer('toolu_2', '[512, 300]'), computer('toolu_3', 512), computer('toolu_4', { x: 512, y: 300 })])]);
  for (const items of bothReads(t)) {
    assert.deepEqual(items.map(i => [i.id, i.summary]), [['toolu_1', 'left_click at 512,300'], ['toolu_2', 'left_click'], ['toolu_3', 'left_click'], ['toolu_4', 'left_click']]);
  }
  assert.equal(toolSummary('mcp__claude-in-chrome__computer', { action: 'left_click', coordinate: '[512, 300]' }, '/work'), 'left_click', 'the same summary an approval card is given');
});

test('a Chrome call is summarised by what it does under either server id, and one with no summary of its own by its first text input', () => {
  const calls = [
    ['navigate', { url: 'https://example.com/docs', tabId: 1 }, 'https://example.com/docs'],
    ['computer', { action: 'left_click', coordinate: [640, 360], tabId: 1 }, 'left_click at 640,360'],
    ['javascript_tool', { text: 'document.title\nreturn 1', tabId: 1 }, 'document.title'],
    ['find', { query: 'Sign up button', tabId: 1 }, 'Sign up button'],
    ['form_input', { ref: 'ref_3', value: 'hello', tabId: 1 }, 'ref_3 = hello'],
    ['read_page', { tabId: 1, filter: 'interactive' }, 'interactive'],
    ['tabs_context_mcp', { createIfEmpty: true }, ''],
  ];
  for (const server of ['claude-in-chrome', 'Claude_in_Chrome']) {
    for (const [tool, input, summary] of calls) assert.equal(toolSummary(`mcp__${server}__${tool}`, input, '/work'), summary, `${server} ${tool}`);
  }
});

test('a block that is not an object costs only itself in a message queued mid-turn, whose picture keeps the number it has without the block', () => {
  for (const [n, bad] of [undefined, ...NOT_OBJECTS].entries()) {
    const t = file(`bad-queued-${n}`, [{ ...queued(among(bad, [textBlock('redirect'), picture(SENT_0)]), 'prompt'), uuid: 'u1' }]);
    for (const items of bothReads(t)) {
      assert.deepEqual(items.map(i => [i.kind, i.text, i.images]), [['user', 'redirect', [{ ref: '0.0.u1', type: 'image/png' }]]], String(bad));
    }
    assert.deepEqual([...readImage(t, '0.0.u1').bytes], SENT_0, String(bad));
  }
});

test('a block that is not an object takes no picture number, so every ref is the one it has without the block, and readImage gives the same bytes', () => {
  const first = line('u0', 'hello');
  const at = startOfSecond(first);
  const BITMAP = [66, 77];
  const mixed = bad => line('u1', among(bad, [
    toolResult('toolu_a', among(bad, [textBlock('A'), picture(BITMAP, 'image/bmp'), picture(TOOL_A)])),
    picture(SENT_0),
    picture(BITMAP, 'image/bmp'),
    toolResult('toolu_b', among(bad, [picture(TOOL_B, 'image/jpeg')])),
    picture(SENT_1, 'image/webp'),
  ]));
  for (const [n, bad] of [undefined, ...NOT_OBJECTS].entries()) {
    const t = file(`refs-${n}`, [first, mixed(bad)]);
    for (const items of bothReads(t)) {
      assert.deepEqual(items.find(i => i.kind === 'user' && i.images).images, [{ ref: `${at}.0.u1`, type: 'image/png' }, { ref: `${at}.1.u1`, type: 'image/webp' }], String(bad));
      assert.deepEqual(resultsOf(items).flatMap(r => (r.images || []).map(i => i.ref)), [`${at}.r1.u1`, `${at}.r2.u1`], String(bad));
    }
    const bytes = ref => { const got = readImage(t, ref); return got && [got.type, [...got.bytes]]; };
    assert.deepEqual(bytes(`${at}.r1.u1`), ['image/png', TOOL_A], String(bad));
    assert.deepEqual(bytes(`${at}.r2.u1`), ['image/jpeg', TOOL_B], String(bad));
    assert.deepEqual(bytes(`${at}.0.u1`), ['image/png', SENT_0], String(bad));
    assert.deepEqual(bytes(`${at}.1.u1`), ['image/webp', SENT_1], String(bad));
    assert.equal(bytes(`${at}.r0.u1`), null, 'the bitmap has the number 0 but cannot be drawn');
    assert.equal(bytes(`${at}.r3.u1`), null, 'there is no fourth tool picture');
    assert.equal(bytes(`${at}.2.u1`), null, 'and no third sent one');
  }
});

test('a line that is not an object costs only itself, and a session file that starts with one still gets its folder, branch and title', () => {
  const lines = [user('a'), ...NOT_OBJECTS, user('b')];
  for (const items of bothReads(file('odd-lines', lines))) assert.deepEqual(items.map(i => i.text), ['a', 'b']);
  const t = file('head-not-objects', [...NOT_OBJECTS, { ...user('Fix the login bug'), cwd: '/work', gitBranch: 'main' }]);
  const head = readHead(t);
  assert.deepEqual([head.cwd, head.branch, head.title], ['/work', 'main', 'Fix the login bug']);
});

test('a block or line that is not an object leaves the whole chat\'s picture list as it is, and a tool whose name is not a string lists its pictures with an empty name', () => {
  const spoil = bad => e => {
    const c = e.message?.content;
    if (!Array.isArray(c)) return e;
    const blocks = c.map(b => (b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: among(bad, b.content) } : b));
    return { ...e, message: { ...e.message, content: among(bad, blocks) } };
  };
  // Each picture by what the page is told about it and the bytes its ref opens, neither of which depends on where its line starts.
  const seen = t => listImages(t).map(({ images, ...item }) => ({ ...item, images: images.map(img => [img.type, readImage(t, img.ref)?.bytes.toString()]) }));
  const clean = seen(file('list-clean', CHAT));
  assert.equal(clean.flatMap(item => item.images).length, 7, 'every picture the thread draws from CHAT');
  for (const [n, bad] of NOT_OBJECTS.entries()) {
    const t = file(`list-not-objects-${n}`, CHAT.flatMap(e => [bad, spoil(bad)(e)]));
    assert.deepEqual(seen(t), clean, String(bad));
  }
  const t = file('list-odd-name', [use('toolu_7', 7), line('u1', [toolResult('toolu_7', [picture('seven')])])]);
  assert.deepEqual(listImages(t).map(item => [item.kind, item.name]), [['tool', '']]);
  assert.equal(drawn(listImages(t)).length, 1, 'the page\'s threadImages takes the list as the server sends it');
});

// Capcom's uploads folder as the server has it, with an upload in it for each of `names`, and the transcript line that mentions them.
function uploaded(names) {
  const dir = path.join(fs.mkdtempSync(path.join(base, 'uploads-')), 'uploads');
  fs.mkdirSync(dir);
  return names.map(([id, name, content, companion]) => {
    const ext = /\.([a-z0-9]+)$/.exec(name)?.[1];
    const stored = path.join(dir, ext ? `${id}.${ext}` : id);
    fs.writeFileSync(stored, content);
    fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify({ name, type: 'text/plain', size: content.length }));
    if (companion) fs.writeFileSync(`${stored}.txt`, companion);
    return { dir, stored, companion: companion ? `${stored}.txt` : null };
  });
}
const ID_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ID_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const readsWith = (t, dir) => [readBefore(t, t.size, t.size, '/work', 8000, dir).items, readAfter(t, 0, '/work', 8000, dir).items];

test('the mentions Capcom puts at the start of a message become file cards described from the upload\'s sidecar, and the typed text is what is left', () => {
  const [a, b] = uploaded([[ID_A, 'Plan v2.html', '<p>hi</p>'], [ID_B, 'Brief.md', '# brief']]);
  const t = file('mentions-capcom', [user(`@"${a.stored}" @"${b.stored}"\ncompare them`)]);
  for (const items of readsWith(t, a.dir)) {
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].files, [
      { name: 'Plan v2.html', type: 'text/plain', size: 9, path: a.stored },
      { name: 'Brief.md', type: 'text/plain', size: 7, path: b.stored },
    ]);
    assert.equal(items[0].text, 'compare them');
  }
});

test('a text copy of a document is mentioned for the CLI and hidden from the card, and a message of files alone has no text', () => {
  const [doc] = uploaded([[ID_A, 'Brief.docx', 'zip bytes', 'the words inside']]);
  const t = file('mentions-companion', [user(`@"${doc.stored}" @"${doc.companion}"`)]);
  for (const items of readsWith(t, doc.dir)) {
    assert.deepEqual(items.map(i => [i.kind, i.text, i.files.map(f => f.name)]), [['user', '', ['Brief.docx']]]);
  }
});

test('a mention of a file Desktop attached is described by its name and a type from its extension, and its size is not read from the disk', () => {
  const dir = fs.mkdtempSync(path.join(base, 'desktop-'));
  const here = path.join(dir, 'Notes.PDF');
  fs.writeFileSync(here, '12345');
  const gone = path.join(dir, 'gone.csv');
  const t = file('mentions-desktop', [user(`@"${here}" @"${gone}" @"${dir}/README"\nhave a look`)]);
  const uploadsDir = path.join(base, 'not-the-uploads-folder');
  for (const items of readsWith(t, uploadsDir)) {
    assert.deepEqual(items[0].files, [
      { name: 'Notes.PDF', type: 'application/pdf', size: null, path: here },
      { name: 'gone.csv', type: 'text/csv', size: null, path: gone },
      { name: 'README', type: '', size: null, path: `${dir}/README` },
    ]);
    assert.equal(items[0].text, 'have a look');
  }
});

test('a sidecar is only believed inside Capcom\'s uploads folder: the same file name anywhere else is described by its own name', () => {
  const [a] = uploaded([[ID_A, 'Called something else.txt', 'x']]);
  const t = file('mentions-elsewhere', [user(`@"${a.stored}"\nlook`)]);
  assert.equal(readsWith(t, path.join(base, 'somewhere-else'))[0][0].files[0].name, `${ID_A}.txt`);
  assert.equal(readsWith(t, undefined)[0][0].files[0].name, `${ID_A}.txt`);
});

test('only a run of mentions at the very start that ends at a newline or the end is taken: the same words in the middle stay text', () => {
  const same = text => readsWith(file(`mentions-text-${text.length}`, [user(text)]), '').map(items => [items[0].text, items[0].files]);
  for (const text of ['please read @"/tmp/a.txt"', '@"/tmp/a.txt" please read it', '@"/tmp/a.txt"@"/tmp/b.txt"\nx', '@"relative/a.txt"\nx', '@"/tmp/a.txt\nx"', 'a\n@"/tmp/a.txt"']) {
    for (const [shown, files] of same(text)) assert.deepEqual([shown, files], [text, undefined], text);
  }
  assert.deepEqual(readsWith(file('mentions-two-lines', [user('@"/tmp/a.txt"\nline one\n@"/tmp/b.txt"')]), '')[0].map(i => [i.text, i.files.length]), [['line one\n@"/tmp/b.txt"', 1]]);
});

test('mentions are read out of a message sent as content blocks beside its pictures, and out of a queued prompt', () => {
  const [a] = uploaded([[ID_A, 'a.txt', 'hello']]);
  const blocks = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: `@"${a.stored}"\nwith a picture` }];
  const t = file('mentions-blocks', [user(blocks), queued(`@"${a.stored}"\nthen this`, 'prompt')]);
  for (const items of readsWith(t, a.dir)) {
    assert.deepEqual(items.map(i => [i.text, i.files?.map(f => f.name), i.images?.length]), [['with a picture', ['a.txt'], 1], ['then this', ['a.txt'], undefined]]);
  }
});

test('a session started with files alone is titled by the file, and by Files when there are several, and typed words win', () => {
  const dir = fs.mkdtempSync(path.join(base, 'head-'));
  const head = (name, text) => readHead(file(name, [{ ...user(text), cwd: '/work' }])).title;
  assert.equal(head('head-one-file', `@"${dir}/plan.csv"`), 'plan.csv');
  assert.equal(head('head-two-files', `@"${dir}/plan.csv" @"${dir}/notes.txt"`), 'Files');
  assert.equal(head('head-file-and-words', `@"${dir}/plan.csv"\nSummarise this`), 'Summarise this');
});

test('a session started with quotes is titled by the words after them, and by the first quote when no words follow', () => {
  const head = (name, text) => readHead(file(name, [{ ...user(text), cwd: '/work' }])).title;
  assert.equal(head('head-quote-words', '> the build failed\n\nWhy did it fail?'), 'Why did it fail?');
  assert.equal(head('head-quote-from', 'From the session "Plan the launch":\n> a launch date\n> in May\n\nWhen is it?'), 'When is it?');
  assert.equal(head('head-quote-alone', '> the build failed\n\n> and then the deploy'), 'the build failed');
  assert.equal(head('head-quote-none', 'Fix the build\n> not a quote'), 'Fix the build\n> not a quote');
});

test('a session started with uploaded files alone is titled by the names the owner gave them, not by <uuid>.<ext>, and a PDF with a text copy is one file', () => {
  const [csv, pdf, doc] = uploaded([[ID_A, 'Budget 2026.csv', 'a,b'], [ID_B, 'Annual report.pdf', 'pdf bytes', 'the words'], ['0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'Brief.docx', 'zip bytes', 'the brief']]);
  const title = (name, dir, text) => readHead(file(name, [{ ...user(text), cwd: '/work' }]), dir).title;
  assert.equal(title('head-upload-csv', csv.dir, `@"${csv.stored}"`), 'Budget 2026.csv');
  assert.equal(title('head-upload-pdf', pdf.dir, `@"${pdf.stored}" @"${pdf.companion}"`), 'Annual report.pdf', 'the text copy is not a second file');
  assert.equal(title('head-upload-docx', doc.dir, `@"${doc.stored}" @"${doc.companion}"`), 'Brief.docx');
  assert.equal(title('head-upload-two', csv.dir, `@"${csv.stored}" @"${pdf.stored}" @"${pdf.companion}"`), 'Files');
  assert.equal(title('head-upload-words', csv.dir, `@"${csv.stored}"\nSummarise this`), 'Summarise this');
  assert.equal(title('head-upload-blind', undefined, `@"${csv.stored}"`), `${ID_A}.csv`, 'without the folder the stored name is all there is, which is why the server passes it');
});

const pdfBlock = bytes => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } });

test('a document block in a message the user sent adds no text and no mark, and the file card comes from the mention beside it', () => {
  const [pdf] = uploaded([[ID_A, 'Report.pdf', 'pdf bytes']]);
  const mention = { type: 'text', text: `@"${pdf.stored}"\nwhat does it say` };
  const t = file('document-blocks', [
    user([pdfBlock([1, 2, 3]), mention]),
    user([picture([4, 5]), pdfBlock([1, 2, 3]), mention]),
    user([pdfBlock([1, 2, 3])]),
    queued([pdfBlock([1, 2, 3]), mention], 'prompt'),
  ]);
  for (const items of readsWith(t, pdf.dir)) {
    assert.deepEqual(items.map(i => [i.kind, i.text, i.files?.map(f => f.name), i.images?.length]), [
      ['user', 'what does it say', ['Report.pdf'], undefined],
      ['user', 'what does it say', ['Report.pdf'], 1],
      ['user', 'what does it say', ['Report.pdf'], undefined],
    ]);
  }
});

test('a line holding a document is skipped by the picture scan and gives no picture, and the pictures on the lines around it keep their place', () => {
  const big = pdfBlock(Array.from({ length: 5000 }, (_, i) => i % 251));
  const second = line('u2', [big, { type: 'text', text: '@"/up/a.pdf"\nthe pdf' }]);
  assert.equal(JSON.stringify(second).includes('"image"'), false, 'the line has nothing the scan looks for');
  const t = file('document-scan', [line('u1', [picture('before'), { type: 'text', text: 'one' }]), second, line('u3', [picture('after'), { type: 'text', text: 'three' }])]);
  const at = lineStarts(t);
  assert.deepEqual(listImages(t), [
    { kind: 'user', images: [{ ref: `${at[0]}.0.u1`, type: 'image/png' }] },
    { kind: 'user', images: [{ ref: `${at[2]}.0.u3`, type: 'image/png' }] },
  ]);
  assert.equal(readImage(t, `${at[2]}.0.u3`).bytes.toString(), 'after');
  assert.deepEqual(listImages(t, at[2]).map(i => i.images.length), [1], 'a list that stops at the picture after the document holds the one before it');
});

const totalRead = reads => reads.mock.calls.reduce((n, call) => n + call.result, 0);

test('a line longer than the chunk is read once, not again for each step back, and stops at the floor it is given', t => {
  const lead = Array.from({ length: 40 }, (_, n) => user(`line ${n}`));
  const before = lead.reduce((n, entry) => n + JSON.stringify(entry).length + 1, 0);
  const long = JSON.stringify(user('x'.repeat(300_000)));
  const t1 = file('long-line', [...lead, user('x'.repeat(300_000)), user('last')]);
  const end = before + long.length + 1;
  const reads = t.mock.method(fs, 'readSync');
  const got = readBefore(t1, end, 1000, '', 8000);
  assert.ok(got.start <= before && got.start > before - 1000, 'it starts on a line, within a chunk before the long one');
  assert.equal(got.items.at(-1).text.length, 300_000);
  assert.ok(totalRead(reads) <= long.length + 2 * 1000, `${totalRead(reads)} bytes read for a line of ${long.length}`);

  reads.mock.resetCalls();
  assert.deepEqual(readBefore(t1, end, 1000, '', 8000, undefined, end - 50_000), { items: [], start: end - 50_000, end });
  assert.equal(totalRead(reads), 50_000, 'nothing is read before the floor');
  assert.equal(readBefore(t1, end, 1000, '', 8000, undefined, 5).start, got.start, 'a floor before the start of the line changes nothing');
});

test('the end of the last complete line is found without reading a byte twice, and nothing further back than a limit', t => {
  const done = `${JSON.stringify(user('first'))}\n`;
  const f = path.join(base, 'unfinished.jsonl');
  fs.writeFileSync(f, `${done}${'x'.repeat(1_000_000)}`);
  const reads = t.mock.method(fs, 'readSync');
  assert.equal(completeEnd({ file: f }), done.length);
  assert.ok(totalRead(reads) <= done.length + 1_000_000, `${totalRead(reads)} bytes read for a file of ${done.length + 1_000_000}`);
  reads.mock.resetCalls();
  assert.equal(completeEnd({ file: f }, 100_000), 0, 'no line end in the last 100,000 bytes');
  assert.equal(totalRead(reads), 100_000);
  assert.equal(completeEnd({ file: f }, 2_000_000), done.length, 'a limit past the line end finds it');
  fs.writeFileSync(f, '');
  assert.equal(completeEnd({ file: f }), 0);
  fs.writeFileSync(f, 'one\ntwo\n');
  assert.equal(completeEnd({ file: f }, 3), 8, 'the last line end is the last byte');
});

test('a send to a sub session is summarised as its recipient and the start of the message', () => {
  assert.equal(toolSummary('mcp__capcom__send_sub_session', { session_id: 'abc', message: 'Please\nrebase' }), 'to abc: Please rebase');
  assert.equal(toolSummary('mcp__capcom__send_sub_session', {}), '');
});
