// Run with `npm test`. The page's thread logic is plain functions on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { absorb, activity, display, doingNow, groupable, groupStart, prepend, step, summarize } from '../public/ui/thread.js';

const MAILBOX = '0f8a1c2e-1111-4a2b-9c3d-123456789abc';
const CALENDAR = '6a1b2c3d-2222-4e5f-8a9b-0c1d2e3f4a5b';

let n = 0;
const item = (kind, extra = {}) => ({ kind, key: `k${++n}`, ...extra });
const tool = (name, extra = {}) => item('tool', { id: `t${n + 1}`, name, status: 'ok', input: {}, ...extra });
const think = text => item('thinking', { msgId: 'm', text });
const said = text => item('assistant', { msgId: 'm', text });

test('thinking between tool calls folds into the group with them, in order', () => {
  const [a, b, c] = [think('first'), tool('Bash'), think('second')];
  const rows = display([said('Hello'), a, b, c, tool('Read')]);
  assert.deepEqual(rows.map(r => r.kind), ['assistant', 'group']);
  assert.equal(rows[1].rows.length, 4);
  assert.deepEqual(rows[1].rows.slice(0, 3), [a, b, c]);
  assert.equal(rows[1].key, `g${a.key}`);
});

test('thinking with no tool call beside it stays a row of its own, one for each block', () => {
  const [a, b, reply] = [think('one'), think('two'), said('Done')];
  assert.deepEqual(display([a, b, reply]), [a, b, reply]);
});

test('a command run in an older CLI, which logs its input and its output as two items, is one row and ends a run of tools', () => {
  const [before, input, output, after] = [tool('Read'), item('bash', { command: 'ls', stdout: '', stderr: '' }), item('bash', { command: '', stdout: 'a', stderr: '' }), tool('Grep')];
  const rows = display([before, input, output, after]);
  assert.deepEqual(rows.map(r => r.kind), ['group', 'bash', 'group']);
  assert.deepEqual([rows[1].command, rows[1].stdout], ['ls', 'a']);
});

test('a message or a card ends a run, so the thinking after it starts the next one', () => {
  const rows = display([tool('Bash'), said('Result'), think('more'), tool('Grep'), tool('mcp__capcom__spawn_task'), tool('Read')]);
  assert.deepEqual(rows.map(r => r.kind), ['group', 'assistant', 'group', 'tool', 'group']);
  assert.equal(rows[2].rows.length, 2);
});

test('a group that thought says so first, then what its calls did', () => {
  const g = summarize([think('x'), think('y'), tool('Read', { input: { file_path: '/a' } }), tool('Bash')]);
  assert.equal(g.title, 'Thought, read 1 file, ran 1 command');
  assert.equal(g.status, 'ok');
  assert.equal(summarize([tool('Bash', { status: 'pending' }), think('z')]).note, 'running');
});

test('Chrome calls are counted as Chrome whichever server id the extension goes by, and a server that only starts like it is not', () => {
  const desktop = name => tool(`mcp__Claude_in_Chrome__${name}`);
  assert.equal(summarize([desktop('navigate'), desktop('computer'), desktop('find')]).title, 'Used Chrome 3 times');
  assert.equal(summarize([tool('mcp__claude-in-chrome__navigate'), desktop('javascript_tool')]).title, 'Used Chrome 2 times');
  assert.equal(summarize([tool('mcp__claude-in-chrome-beta__computer')]).title, 'Used 1 tool');
});

test('sending a message to another session and looking up who can receive one are named in a group, not counted as other tools', () => {
  const g = summarize([tool('ListAgents'), tool('SendMessage', { input: { to: 'Worker' } }), tool('SendMessage', { input: { to: 'Worker' } })]);
  assert.equal(g.title, 'Looked up other sessions, sent 2 messages');
  assert.equal(summarize([tool('SendMessage', { status: 'denied' })]).note, '1 denied');
  assert.deepEqual(activity({ tools: [{ name: 'SendMessage', summary: 'to Worker: Run the tests' }] }), { doing: 'Sending a message', detail: 'to Worker: Run the tests' });
  assert.deepEqual(activity({ tools: [{ name: 'ListAgents', summary: 'other sessions' }] }), { doing: 'Looking up other sessions', detail: 'other sessions' });
});

test('the status line names the one tool running, with what it works on', () => {
  assert.deepEqual(activity({ tools: [{ name: 'Bash', summary: 'npm test' }] }), { doing: 'Running', detail: 'npm test' });
  assert.deepEqual(activity({ tools: [{ name: 'Read', summary: 'lib/runner.mjs' }] }), { doing: 'Reading', detail: 'lib/runner.mjs' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__claude-in-chrome__navigate', summary: 'https://example.com' }] }), { doing: 'Using Chrome', detail: 'https://example.com' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__visualize__show_widget', summary: '' }] }), { doing: 'Using', detail: 'visualize show widget' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__Claude_Browser__computer', summary: 'screenshot' }] }), { doing: 'Using', detail: 'Claude Browser computer: screenshot' });
});

test('the status line says Using Chrome for a Chrome tool under either server id, with what it works on', () => {
  for (const name of ['mcp__claude-in-chrome__navigate', 'mcp__Claude_in_Chrome__navigate']) {
    assert.deepEqual(activity({ tools: [{ name, summary: 'https://example.com/docs' }] }), { doing: 'Using Chrome', detail: 'https://example.com/docs' });
  }
});

test('several tools at once are counted and named once each', () => {
  const work = { tools: [{ name: 'Read', summary: 'a' }, { name: 'Read', summary: 'b' }, { name: 'Grep', summary: 'c' }] };
  assert.deepEqual(activity(work), { doing: 'Running 3 tools', detail: 'Read, Grep' });
});

test('several MCP tools at once are named with their servers, so two called computer are told apart', () => {
  const work = { tools: [{ name: 'mcp__Claude_Browser__computer', summary: 'screenshot' }, { name: 'mcp__claude-in-chrome__computer', summary: 'screenshot' }, { name: 'mcp__Claude_Browser__computer', summary: 'zoom' }, { name: 'Read', summary: 'a' }] };
  assert.deepEqual(activity(work), { doing: 'Running 4 tools', detail: 'Claude Browser computer, Chrome computer, Read' });
});

test('the status line names a connector by the name its session gives it, and as a connector when it gives none, for one tool or several', () => {
  const names = { [MAILBOX]: 'Mailbox' };
  const one = { tools: [{ name: `mcp__${MAILBOX}__search_threads`, summary: 'invoices' }] };
  assert.deepEqual(activity(one, names), { doing: 'Using', detail: 'Mailbox search threads: invoices' });
  assert.deepEqual(activity(one), { doing: 'Using', detail: 'connector search threads: invoices' });
  const several = { tools: [{ name: `mcp__${MAILBOX}__search_threads`, summary: 'a' }, { name: `mcp__${CALENDAR}__list_events`, summary: 'b' }, { name: 'Read', summary: 'c' }] };
  assert.deepEqual(activity(several, names), { doing: 'Running 3 tools', detail: 'Mailbox search threads, connector list events, Read' });
  assert.deepEqual(activity(several), { doing: 'Running 3 tools', detail: 'connector search threads, connector list events, Read' });
  assert.deepEqual(activity({ tools: [{ name: 'Bash', summary: 'npm test' }] }, names), { doing: 'Running', detail: 'npm test' });
});

test('with no tool the status line says thinking, writing or just working', () => {
  assert.equal(activity({ tools: [], thinking: true, writing: false }).doing, 'Thinking');
  assert.equal(activity({ tools: [], thinking: false, writing: true }).doing, 'Writing');
  assert.equal(activity({ tools: [], thinking: false, writing: false }).doing, 'Working');
  assert.equal(activity(null).doing, 'Working');
});

const running = (name, summary = '') => ({ tools: [{ name, summary }] });

test('the status line phrase names the one tool running by its kind, without what it works on', () => {
  const phrase = name => doingNow(running(name, 'detail the row would show'));
  assert.equal(phrase('Bash'), 'Running a command');
  assert.equal(phrase('Read'), 'Reading a file');
  assert.equal(phrase('NotebookRead'), 'Reading a file');
  for (const name of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) assert.equal(phrase(name), 'Editing a file');
  assert.equal(phrase('Grep'), 'Searching');
  assert.equal(phrase('Glob'), 'Searching');
  assert.equal(phrase('WebSearch'), 'Searching the web');
  assert.equal(phrase('WebFetch'), 'Fetching a page');
  assert.equal(phrase('Agent'), 'Running an agent');
  assert.equal(phrase('Task'), 'Running an agent');
  assert.equal(phrase('Skill'), 'Using a skill');
  assert.equal(phrase('TodoWrite'), 'Updating the to-do list');
  assert.equal(phrase('SendMessage'), 'Sending a message');
  assert.equal(phrase('ListAgents'), 'Looking up other sessions');
  for (const name of ['mcp__claude-in-chrome__navigate', 'mcp__Claude_in_Chrome__navigate']) assert.equal(phrase(name), 'Using Chrome');
  assert.equal(phrase('mcp__visualize__show_widget'), 'Using visualize show widget');
});

test('the status line phrase counts several tools, and with none says thinking, writing or working', () => {
  assert.equal(doingNow({ tools: [{ name: 'Read' }, { name: 'Grep' }, { name: 'Bash' }] }), 'Running 3 tools');
  assert.equal(doingNow({ tools: [{ name: 'Read' }, { name: 'Read' }] }), 'Running 2 tools');
  assert.equal(doingNow({ tools: [], thinking: true, writing: false }), 'Thinking');
  assert.equal(doingNow({ tools: [], thinking: false, writing: true }), 'Writing');
  assert.equal(doingNow({ tools: [], thinking: false, writing: false }), 'Working');
  assert.equal(doingNow({ thinking: true }), 'Thinking');
  assert.equal(doingNow(null), 'Working');
});

test('the status line phrase names a connector by the name its session gives it, and as a connector when it gives none', () => {
  const names = { [MAILBOX]: 'Mailbox' };
  const one = running(`mcp__${MAILBOX}__search_threads`, 'invoices');
  assert.equal(doingNow(one, names), 'Using Mailbox search threads');
  assert.equal(doingNow(one), 'Using connector search threads');
  assert.equal(doingNow(running('Bash'), names), 'Running a command');
});

test('a running group names the call still waiting for its result, the last of them when several wait', () => {
  const rows = [tool('Read', { status: 'pending', summary: 'a.mjs' }), tool('Bash', { status: 'pending', summary: 'npm test' }), tool('Grep', { status: 'ok', summary: 'todo' })];
  assert.equal(step(rows), 'Running npm test');
  assert.equal(step([...rows.slice(0, 1), think('next'), tool('Grep', { status: 'ok', summary: 'todo' })]), 'Reading a.mjs');
});

test('a running group with no call waiting names its last call, and thinking never counts as one', () => {
  const rows = [tool('Bash', { summary: 'npm test' }), tool('Read', { summary: 'lib/runner.mjs' }), think('what next')];
  assert.equal(step(rows), 'Reading lib/runner.mjs');
  assert.equal(step([think('only thinking')]), '');
  assert.equal(step([]), '');
});

test('a running group with a detail to show reads as its row does, and with none reads as the status line does, with no trailing space', () => {
  const names = { [MAILBOX]: 'Mailbox' };
  assert.equal(step([tool('mcp__x__y', { status: 'pending', summary: 'z' })]), 'Using x y: z');
  assert.equal(step([tool(`mcp__${MAILBOX}__search_threads`, { status: 'pending', summary: 'invoices' })], names), 'Using Mailbox search threads: invoices');
  assert.equal(step([tool('ListAgents', { status: 'pending', summary: '' })]), 'Looking up other sessions');
  assert.equal(step([tool('Bash', { status: 'pending' })]), 'Running a command');
  assert.equal(step([tool('Read', { status: 'pending', summary: '' })]), 'Reading a file');
  assert.equal(step([tool('Edit', { status: 'pending', summary: '' })]), 'Editing a file');
  assert.equal(step([tool('WebFetch', { status: 'pending', summary: '' })]), 'Fetching a page');
  assert.equal(step([tool('Grep', { status: 'pending', summary: '' })]), 'Searching');
  assert.equal(step([tool(`mcp__${MAILBOX}__search_threads`, { status: 'pending', summary: '' })], names), 'Using Mailbox search threads');
  assert.equal(step([tool('', { status: 'pending', summary: '' })]), 'Using');
  assert.equal(step([tool('Bash', { status: 'pending', summary: 'npm test' })]), 'Running npm test');
});

test('a group began when its first row with a readable time did, and has no start when none has', () => {
  const at = iso => ({ at: iso });
  const first = '2026-10-21T10:00:05.000Z';
  assert.equal(groupStart([tool('Bash', at(first)), tool('Read', at('2026-10-21T10:00:09.000Z'))]), Date.parse(first));
  assert.equal(groupStart([think('no time'), tool('Bash', at(null)), tool('Read', at('not a time')), tool('Grep', at(first))]), Date.parse(first));
  assert.equal(groupStart([think('no time'), tool('Bash', at(null))]), null);
  assert.equal(groupStart([]), null);
});

const fresh = () => ({ items: [], orphans: new Map() });
const call = (id, name = 'Read') => ({ kind: 'tool', id, name, status: 'pending', summary: '' });
const answer = (toolId, extra = {}) => ({ kind: 'result', toolId, status: 'ok', output: 'done', ...extra });
const shot = ref => ({ ref, type: 'image/png' });

test('a result hands its pictures to its tool, and one with none leaves the tool without a list', () => {
  const [read, grep] = [call('toolu_1'), call('toolu_2', 'Grep')];
  const { items } = absorb(fresh(), [read, grep, answer('toolu_1', { images: [shot('5.r0.u'), shot('5.r1.u')] }), answer('toolu_2')]);
  assert.deepEqual(items.map(i => [i.status, i.output]), [['ok', 'done'], ['ok', 'done']]);
  assert.deepEqual(items[0].images, [shot('5.r0.u'), shot('5.r1.u')]);
  assert.equal('images' in items[1], false);
  assert.equal('images' in read, false, 'the tool the page held before is not changed in place');
});

test('a result that arrives in a later read finds its tool already in the thread and brings its pictures', () => {
  const first = absorb(fresh(), [call('toolu_1')]);
  const next = absorb(first, [answer('toolu_1', { images: [shot('9.r0.u')] })]);
  assert.deepEqual(next.items[0].images, [shot('9.r0.u')]);
  assert.equal(first.items[0].status, 'pending');
  assert.equal(next.orphans.size, 0);
});

test('a result that comes before its tool waits with its pictures, and the earlier chunk that holds the tool settles it', () => {
  const later = absorb(fresh(), [answer('toolu_1', { images: [shot('7.r0.u')] })]);
  assert.equal(later.items.length, 0);
  assert.deepEqual(later.orphans.get('toolu_1').images, [shot('7.r0.u')]);
  const joined = prepend(later, [call('toolu_1'), call('toolu_2')]);
  assert.deepEqual(joined.items.map(i => [i.id, i.status]), [['toolu_1', 'ok'], ['toolu_2', 'pending']]);
  assert.deepEqual(joined.items[0].images, [shot('7.r0.u')]);
  assert.equal('images' in joined.items[1], false);
  assert.equal(joined.orphans.size, 0);
});

test('a chunk that holds both a tool and its result brings the pictures too, and one without pictures adds no list', () => {
  const joined = prepend(absorb(fresh(), [call('toolu_9')]), [call('toolu_1'), answer('toolu_1', { images: [shot('2.r0.u')] }), call('toolu_2'), answer('toolu_2')]);
  assert.deepEqual(joined.items[0].images, [shot('2.r0.u')]);
  assert.equal('images' in joined.items[1], false);
  assert.equal(joined.items.length, 3);
});

// toolu_1 is called twice, as when a block is copied, and toolu_2 answers twice, the second time with no picture.
const REPEATS = [
  call('toolu_1'), answer('toolu_1', { images: [shot('1.r0.u')] }),
  call('toolu_1'), answer('toolu_1', { images: [shot('3.r0.u')] }),
  call('toolu_2'), answer('toolu_2', { images: [shot('5.r0.u')] }), answer('toolu_2', { status: 'failed', output: 'no picture' }),
];
const unkeyed = items => items.map(({ key, ...rest }) => rest);

test('where tool ids repeat, a thread opened at any point and loaded earlier, or grown by appends first, comes out as it does read whole', () => {
  const whole = absorb(fresh(), REPEATS);
  assert.deepEqual(whole.items.map(i => [i.id, i.status, i.output, i.images]), [
    ['toolu_1', 'ok', 'done', [shot('1.r0.u')]],
    ['toolu_1', 'ok', 'done', [shot('3.r0.u')]],
    ['toolu_2', 'failed', 'no picture', [shot('5.r0.u')]],
  ], 'a result settles the last call with its id before it, and one with no picture keeps the pictures the call has');
  for (let a = 0; a <= REPEATS.length; a++) {
    for (let b = a; b <= REPEATS.length; b++) {
      const [first, middle, last] = [REPEATS.slice(0, a), REPEATS.slice(a, b), REPEATS.slice(b)];
      const opened = absorb(fresh(), last);
      const kept = structuredClone(opened);
      assert.deepEqual(unkeyed(prepend(prepend(opened, middle), first).items), unkeyed(whole.items), `opened at ${b}, then loaded from ${a} and from 0`);
      assert.deepEqual(opened, kept, `opened at ${b}, the thread Load earlier started from is not changed in place`);
      assert.deepEqual(unkeyed(prepend(absorb(absorb(fresh(), middle), last), first).items), unkeyed(whole.items), `opened at ${a} up to ${b}, then appended to and loaded from 0`);
    }
  }
});

test('a form call stands as its own row and ends a run, unless it failed or was denied', () => {
  const form = status => tool('mcp__capcom__show_form', { status, input: { title: 'Plan', questions: [] } });
  const [before, ok, after] = [tool('Bash'), form('ok'), tool('Read')];
  const rows = display([before, ok, after]);
  assert.deepEqual(rows.map(r => r.kind), ['group', 'tool', 'group'], 'the form is a row of its own between two runs');
  assert.equal(rows[1], ok);
  assert.equal(groupable(form('pending')), false, 'a form still being asked shows its card, and waits for the record');
  assert.equal(groupable(form('failed')), true);
  assert.equal(groupable(form('denied')), true);
  assert.equal(groupable(tool('mcp__capcom__show_widget', { input: { widget_code: '<p></p>' } })), false);
  assert.equal(groupable(tool('mcp__other__show_form', { status: 'ok' })), false, 'any server\'s show_form is read the same way');
});
