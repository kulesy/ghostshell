// Run with `npm test`. Naming the sessions GhostShell starts: what counts as a title, what a title falls back to, and when one is recorded,
// with the model's answer injected so no model is called. All text here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackTitle, makeTitler, promptFor, tidyTitle, watchFirstTurn } from '../lib/titler.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a model answer is cleaned into a title', () => {
  assert.equal(tidyTitle('Server - Add effort to chips'), 'Server - Add effort to chips');
  assert.equal(tidyTitle('"Docs - Explain the layout file"'), 'Docs - Explain the layout file');
  assert.equal(tidyTitle('`Fix the login page`'), 'Fix the login page');
  assert.equal(tidyTitle('**Tests - Cover the rename route**'), 'Tests - Cover the rename route');
  assert.equal(tidyTitle('## Fix the sidebar'), 'Fix the sidebar');
  assert.equal(tidyTitle('Title: Fix the sidebar.'), 'Fix the sidebar');
  assert.equal(tidyTitle('Fix the sidebar...'), 'Fix the sidebar');
  assert.equal(tidyTitle('  Fix\tthe   sidebar \n'), 'Fix the sidebar');
});

test('only the first line of an answer is the title', () => {
  assert.equal(tidyTitle('\n\nServer - Add a field\nI chose this because the message names the server.'), 'Server - Add a field');
});

test('an answer that is no title is refused', () => {
  for (const raw of ['', '   ', '\n', undefined, null, 42, '​​', '""', "I can't help with that", 'Sorry, I do not have enough to name this', 'I am unable to title this',
    'Here is a title for the session', 'Could you share more detail?', 'What is the task?', 'one two three four five six seven eight nine ten eleven twelve thirteen']) {
    assert.equal(tidyTitle(raw), '', JSON.stringify(raw));
  }
});

test('a title that starts with the letter I is kept when it is not a sentence about the assistant', () => {
  assert.equal(tidyTitle('I18n - Add Welsh strings'), 'I18n - Add Welsh strings');
  assert.equal(tidyTitle('IO errors on upload'), 'IO errors on upload');
});

test('a long title is cut at a word to 80 characters', () => {
  const raw = 'Internationalisation infrastructure modernisation configuration improvements discussion';
  const title = tidyTitle(raw);
  assert.ok([...title].length <= 80);
  assert.ok(raw.startsWith(title));
  assert.equal(title, 'Internationalisation infrastructure modernisation configuration improvements');
});

test('a fallback drops heading marks and keeps a heading brief\'s Area - task line', () => {
  assert.equal(fallbackTitle('# Server - Let a chip set its effort\n## Goal\nI want a field on the tool.'), 'Server - Let a chip set its effort');
  assert.equal(fallbackTitle('## Fix the sidebar\n\nIt flickers.'), 'Fix the sidebar');
});

test('a fallback skips a Goal heading and a Goal label', () => {
  assert.equal(fallbackTitle('## Goal\nMake the list faster'), 'Make the list faster');
  assert.equal(fallbackTitle('Goal: make the list faster'), 'make the list faster');
  assert.equal(fallbackTitle('# Goal:\n\nMake the list faster'), 'Make the list faster');
});

test('a fallback prefers a heading shaped Area - task among the first lines', () => {
  assert.equal(fallbackTitle('Hello there\n# UI - Tidy the header\nMore'), 'UI - Tidy the header');
  assert.equal(fallbackTitle('Hello there\nUI - Tidy the header\nMore'), 'Hello there');
  assert.equal(fallbackTitle('Hello there\nline\nline\n# UI - Tidy the header'), 'Hello there');
  assert.equal(fallbackTitle('# Four word area name - task'), 'Four word area name - task');
});

test('a fallback strips markdown and quotes', () => {
  assert.equal(fallbackTitle('**Fix** the `layout` file, see [the notes](https://example.com/n)'), 'Fix the layout file, see the notes');
  assert.equal(fallbackTitle('- Fix the sidebar'), 'Fix the sidebar');
  assert.equal(fallbackTitle('> Fix the sidebar'), 'Fix the sidebar');
  assert.equal(fallbackTitle('"Fix the sidebar"'), 'Fix the sidebar');
  assert.equal(fallbackTitle('3. Fix the sidebar'), 'Fix the sidebar');
});

test('a long first line is cut at a word between 60 and 80 characters', () => {
  const line = 'Please look into why the sidebar flickers whenever a session finishes its turn while another one is still running in the background';
  const title = fallbackTitle(line);
  assert.ok(title.endsWith('…'));
  const body = title.slice(0, -1);
  assert.ok(body.length >= 60 && body.length <= 80, String(body.length));
  assert.ok(line.startsWith(body));
  assert.equal(line[body.length], ' ');
});

test('a first line of 80 characters or fewer is kept whole, and one long word is cut hard', () => {
  const line = 'Please look into why the sidebar flickers whenever a session finishes its turn';
  assert.ok(line.length <= 80);
  assert.equal(fallbackTitle(line), line);
  assert.equal([...fallbackTitle('x'.repeat(200))].length, 81);
});

test('a fallback is never empty when the text has words, and is empty when it has none', () => {
  assert.equal(fallbackTitle('\n\n  Word\n'), 'Word');
  assert.equal(fallbackTitle('## Goal'), '');
  for (const text of ['', '  \n ', undefined, null, '​', '##', '**']) assert.equal(fallbackTitle(text), '', JSON.stringify(text));
});

test('the prompt holds the head of the first message and the first reply', () => {
  const prompt = promptFor({ first: `${'a'.repeat(700)}TAIL`, reply: `${'b'.repeat(900)}TAIL` });
  assert.ok(prompt.startsWith('First message:\naaa'));
  assert.ok(prompt.includes(`${'a'.repeat(600)}\n\nFirst reply:\n${'b'.repeat(800)}`));
  assert.ok(!prompt.includes('TAIL'));
  assert.equal(promptFor({ first: 'Do a thing', reply: '' }), 'First message:\nDo a thing');
});

function chatWith() {
  return { id: 's1', listeners: new Set(), emit(type, data = {}) { for (const fn of [...this.listeners]) fn({ type, data }); } };
}

test('the first turn is heard as its replies and the listener leaves when it ends', () => {
  const chat = chatWith();
  const heard = [];
  watchFirstTurn(chat, got => heard.push(got));
  chat.emit('delta', { text: 'Hello ' });
  chat.emit('delta', { text: 'there' });
  chat.emit('state', { state: 'idle' });
  assert.deepEqual(heard, []);
  chat.emit('turn-end', { error: false });
  chat.emit('turn-end', { error: false });
  assert.deepEqual(heard, [{ reply: 'Hello there' }]);
  assert.equal(chat.listeners.size, 0);
});

test('a first turn that ended in an error, or in an exit, has no reply', () => {
  for (const [type, data] of [['turn-end', { error: true }], ['exit', { code: 1 }]]) {
    const chat = chatWith();
    const heard = [];
    watchFirstTurn(chat, got => heard.push(got));
    chat.emit('delta', { text: 'Half an answer' });
    chat.emit(type, data);
    assert.deepEqual(heard, [{ reply: '' }]);
    assert.equal(chat.listeners.size, 0);
  }
});

test('a first turn that ended before the watch began is read from the chat\'s events and leaves no listener', () => {
  for (const [events, expected] of [
    [[{ type: 'init', data: {} }, { type: 'delta', data: { text: 'Done ' } }, { type: 'delta', data: { text: 'now' } }, { type: 'turn-end', data: { error: false } }], 'Done now'],
    [[{ type: 'init', data: {} }, { type: 'delta', data: { text: 'Half' } }, { type: 'turn-end', data: { error: true } }], ''],
    [[{ type: 'init', data: {} }, { type: 'delta', data: { text: 'First' } }, { type: 'turn-end', data: { error: false } }, { type: 'delta', data: { text: 'Second turn' } }, { type: 'turn-end', data: { error: false } }], 'First'],
  ]) {
    const chat = { ...chatWith(), events };
    const heard = [];
    watchFirstTurn(chat, got => heard.push(got));
    assert.deepEqual(heard, [{ reply: expected }]);
    assert.equal(chat.listeners.size, 0);
  }
});

test('a chat whose events hold no turn end yet is listened to, and keeps the reply heard so far', () => {
  const chat = { ...chatWith(), events: [{ type: 'init', data: {} }, { type: 'delta', data: { text: 'So far' } }] };
  const heard = [];
  watchFirstTurn(chat, got => heard.push(got));
  assert.deepEqual(heard, []);
  assert.equal(chat.listeners.size, 1);
  chat.emit('delta', { text: ' and more' });
  chat.emit('turn-end', { error: false });
  assert.deepEqual(heard, [{ reply: 'So far and more' }]);
  assert.equal(chat.listeners.size, 0);
});

test('a very long reply stops being collected', () => {
  const chat = chatWith();
  const heard = [];
  watchFirstTurn(chat, got => heard.push(got));
  for (let n = 0; n < 100; n++) chat.emit('delta', { text: 'x'.repeat(500) });
  chat.emit('turn-end', { error: false });
  assert.ok(heard[0].reply.length < 3000);
});

function titler({ ask = async () => 'Server - Generated title', ...over } = {}) {
  const own = {};
  const saved = [];
  const asked = [];
  const t = makeTitler({
    ask: (prompt, opts) => { asked.push({ prompt, opts }); return ask(prompt, opts); },
    own: id => own[id] ?? '',
    record: (id, title) => { saved.push([id, title]); own[id] = title; },
    log: () => {},
    ...over,
  });
  return { t, own, saved, asked };
}

test('a session is named once, from the first message and the first reply, with the injected model', async () => {
  const { t, saved, asked } = titler();
  assert.equal(await t.name({ id: 's1', first: 'Add effort to chips', reply: 'I will add the field.' }), 'Server - Generated title');
  assert.deepEqual(saved, [['s1', 'Server - Generated title']]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].prompt, 'First message:\nAdd effort to chips\n\nFirst reply:\nI will add the field.');
  assert.ok(asked[0].opts.signal instanceof AbortSignal);
});

test('a session is tried once in a process, even when its turn ends again', async () => {
  const { t, saved, asked } = titler();
  await Promise.all([t.name({ id: 's1', first: 'One' }), t.name({ id: 's1', first: 'One' })]);
  await t.name({ id: 's1', first: 'One' });
  assert.equal(asked.length, 1);
  assert.equal(saved.length, 1);
});

test('a session the owner has titled is never asked about', async () => {
  const { t, own, saved, asked } = titler();
  own.s1 = 'Mine';
  assert.equal(await t.name({ id: 's1', first: 'One' }), null);
  assert.equal(asked.length, 0);
  assert.deepEqual(saved, []);
  assert.equal(own.s1, 'Mine');
});

test('a title the owner sets while the model is asked wins', async () => {
  let release;
  const { t, own, saved } = titler({ ask: () => new Promise(resolve => { release = resolve; }) });
  const named = t.name({ id: 's1', first: 'One' });
  own.s1 = 'Mine';
  release('Server - Generated title');
  assert.equal(await named, null);
  assert.deepEqual(saved, []);
  assert.equal(own.s1, 'Mine');
});

test('a title the owner sets while the fallback is chosen wins too', async () => {
  const { t, own, saved } = titler({ ask: async () => { own.s1 = 'Mine'; throw new Error('down'); } });
  await t.name({ id: 's1', first: 'One' });
  assert.deepEqual(saved, []);
});

test('an answer that is no title is asked again once, and then the first line is recorded', async () => {
  let calls = 0;
  const { t, saved } = titler({ ask: async () => { calls++; return "Sorry, I can't title this"; } });
  await t.name({ id: 's1', first: '# Docs - Explain the layout\n## Goal\nMore' });
  assert.equal(calls, 2);
  assert.deepEqual(saved, [['s1', 'Docs - Explain the layout']]);
});

test('a failed ask is asked again once, and the second answer is used', async () => {
  let calls = 0;
  const { t, saved } = titler({ ask: async () => { if (++calls === 1) throw new Error('down'); return 'Docs - Second try'; } });
  await t.name({ id: 's1', first: 'One' });
  assert.equal(calls, 2);
  assert.deepEqual(saved, [['s1', 'Docs - Second try']]);
});

test('an ask that throws, in either way, never throws out and logs one line', async () => {
  const lines = [];
  for (const ask of [() => { throw new Error('sync'); }, async () => { throw new Error('async'); }, () => Promise.reject(undefined)]) {
    const { t, saved } = titler({ ask, log: line => lines.push(line) });
    await assert.doesNotReject(t.name({ id: `s${lines.length}`, first: 'Fix the sidebar' }));
    assert.deepEqual(saved.at(-1)?.[1], 'Fix the sidebar');
  }
  assert.equal(lines.length, 3);
  assert.ok(lines.every(line => !line.includes('\n') && !line.includes('Fix the sidebar')));
});

test('a record that throws never throws out', async () => {
  const lines = [];
  const { t } = titler({ record: () => { throw new Error('disk full'); }, log: line => lines.push(line) });
  await assert.doesNotReject(t.name({ id: 's1', first: 'One' }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /disk full/);
});

test('a model that never answers is stopped, asked once more, and then the first line is recorded', async () => {
  const signals = [];
  const { t, saved } = titler({ timeoutMs: 20, ask: (prompt, { signal }) => { signals.push(signal); return new Promise(() => {}); } });
  await t.name({ id: 's1', first: 'Fix the sidebar' });
  assert.equal(signals.length, 2);
  assert.ok(signals.every(s => s.aborted));
  assert.deepEqual(saved, [['s1', 'Fix the sidebar']]);
});

test('with nothing to read from, nothing is asked or recorded', async () => {
  const { t, saved, asked } = titler();
  assert.equal(await t.name({ id: 's1', first: '  ', reply: '' }), null);
  assert.equal(asked.length, 0);
  assert.deepEqual(saved, []);
});

test('with only a reply, the model is asked, and when it fails the session keeps the title it has', async () => {
  const failing = titler({ ask: async () => { throw new Error('down'); } });
  await failing.t.name({ id: 's1', first: '', reply: 'A reply' });
  assert.equal(failing.asked.length, 2);
  assert.deepEqual(failing.saved, []);
  const working = titler();
  await working.t.name({ id: 's2', first: '', reply: 'A reply' });
  assert.equal(working.asked[0].prompt, 'First message:\n\n\nFirst reply:\nA reply');
  assert.deepEqual(working.saved, [['s2', 'Server - Generated title']]);
});

test('a chat with a title given is titled at once with no call, clipped to the title limit', () => {
  const { t, saved, asked } = titler();
  const chat = chatWith();
  t.start(chat, { title: '  A chip   title\n', first: 'x' });
  assert.deepEqual(saved, [['s1', 'A chip title']]);
  assert.equal(chat.listeners.size, 0);
  const long = titler();
  long.t.start(chatWith(), { title: 'w'.repeat(300), first: 'x' });
  assert.equal([...long.saved[0][1]].length, 120);
  assert.equal(asked.length, 0);
});

test('a given title that shows nothing is treated as none, and the first turn names the session', async () => {
  const { t, saved, asked } = titler();
  const chat = chatWith();
  t.start(chat, { title: '​  ', first: 'Add a field' });
  assert.deepEqual(saved, []);
  chat.emit('delta', { text: 'Done' });
  chat.emit('turn-end', { error: false });
  await wait(10);
  assert.deepEqual(saved, [['s1', 'Server - Generated title']]);
  assert.equal(asked.length, 1);
});

test('a chat with no title is named when its first turn ends, not before, and the chat is not waited on', async () => {
  let release;
  const { t, saved, asked } = titler({ ask: () => new Promise(resolve => { release = resolve; }) });
  const chat = chatWith();
  t.start(chat, { first: 'Add a field' });
  assert.equal(asked.length, 0);
  chat.emit('delta', { text: 'On it' });
  chat.emit('turn-end', { error: false });
  assert.equal(asked.length, 1);
  assert.match(asked[0].prompt, /First reply:\nOn it$/);
  assert.deepEqual(saved, []);
  release('Server - Late title');
  await wait(10);
  assert.deepEqual(saved, [['s1', 'Server - Late title']]);
});

test('a first turn that failed still names the session, from the first message alone', async () => {
  const { t, asked } = titler();
  const chat = chatWith();
  t.start(chat, { first: 'Add a field' });
  chat.emit('delta', { text: 'Half' });
  chat.emit('turn-end', { error: true });
  await wait(10);
  assert.equal(asked[0].prompt, 'First message:\nAdd a field');
});

test('a second turn ending does not ask again', async () => {
  const { t, asked } = titler();
  const chat = chatWith();
  t.start(chat, { first: 'Add a field' });
  chat.emit('turn-end', { error: false });
  chat.emit('turn-end', { error: false });
  await wait(10);
  assert.equal(asked.length, 1);
});

test('a titler that is turned off does nothing', async () => {
  const { t, saved, asked } = titler({ enabled: false });
  const chat = chatWith();
  t.start(chat, { title: 'Given', first: 'x' });
  t.start(chat, { first: 'x' });
  assert.equal(chat.listeners.size, 0);
  assert.deepEqual(saved, []);
  assert.equal(asked.length, 0);
});
