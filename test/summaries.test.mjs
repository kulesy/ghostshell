// Run with `npm test`. The line a session's latest reply makes, and the summaries kept per session: what is read, how far back, and when it is read again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closingAsk, firstSentence, latestReply, makeSummaries } from '../lib/summaries.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-summaries-'));
const files = new Map();
const transcriptFor = id => files.get(id) ?? null;

const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const said = (text, timestamp) => ({ type: 'assistant', ...(timestamp && { timestamp }), message: { id: `m${Math.random()}`, role: 'assistant', content: [{ type: 'text', text }] } });
const used = (id, name, input) => ({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const thought = thinking => ({ type: 'assistant', message: { id: `t${Math.random()}`, role: 'assistant', content: [{ type: 'thinking', thinking }] } });
const filler = n => Array.from({ length: n }, () => ({ type: 'summary', summary: 'x'.repeat(1000) }));

function transcript(id, entries) {
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, entries.map(e => `${JSON.stringify(e)}\n`).join(''));
  files.set(id, { id, file });
  return file;
}

test('the first sentence ends at a full stop, an exclamation mark or a question mark before a space or the end, and not inside a number or a name', () => {
  assert.equal(firstSentence('The build passes. Nothing else changed.'), 'The build passes.');
  assert.equal(firstSentence('It is done! Ship it.'), 'It is done!');
  assert.equal(firstSentence('Is it done? Yes it is.'), 'Is it done?');
  assert.equal(firstSentence('Version v1.2.3 is out. Next.'), 'Version v1.2.3 is out.');
  assert.equal(firstSentence('Fixed (see the note.) Then more.'), 'Fixed (see the note.)');
  assert.equal(firstSentence('He said "done." Then left.'), 'He said "done."');
  assert.equal(firstSentence('Wait... then go. Done.'), 'Wait...');
  assert.equal(firstSentence('Only one sentence'), 'Only one sentence');
  assert.equal(firstSentence('Use my_var_name and file.js here.'), 'Use my_var_name and file.js here.');
});

test('a line break in the reply also ends the sentence, and only the first line with words in it counts', () => {
  assert.equal(firstSentence('No full stop here\nSecond line. Third.'), 'No full stop here');
  assert.equal(firstSentence('\n\n   \r\nFirst real line\nNext'), 'First real line');
  assert.equal(firstSentence('Soft\u2028break'), 'Soft');
});

test('a code block is skipped, whatever fence opens it, and a block with no end skips the rest', () => {
  assert.equal(firstSentence('```js\nconst a = 1; // a. b\n```\nThe fix is in place. More.'), 'The fix is in place.');
  assert.equal(firstSentence('~~~\nnot this.\n~~~\nBut this. Not this.'), 'But this.');
  assert.equal(firstSentence('````\n```\ninner. text\n```\n````\nAfter it.'), 'After it.');
  assert.equal(firstSentence('```\nnever closed. text\nmore'), '');
  assert.equal(firstSentence('Before.\n```\ncode\n```\nAfter.'), 'Before.');
  assert.equal(firstSentence('   ```sh\n   ls\n   ```\n   Indented fence. Next.'), 'Indented fence.');
});

test('a heading, a list item, a quote and a table row read as their words', () => {
  assert.equal(firstSentence('## Summary\nThe build passes.'), 'Summary');
  assert.equal(firstSentence('###### Tiny heading'), 'Tiny heading');
  assert.equal(firstSentence('- first item. more\n- second'), 'first item.');
  assert.equal(firstSentence('* starred item'), 'starred item');
  assert.equal(firstSentence('1. Do it. Then rest'), 'Do it.');
  assert.equal(firstSentence('2) Second style'), 'Second style');
  assert.equal(firstSentence('- [x] Ticked off. Rest'), 'Ticked off.');
  assert.equal(firstSentence('> A quoted line. More'), 'A quoted line.');
  assert.equal(firstSentence('> > Deep quote'), 'Deep quote');
  assert.equal(firstSentence('| Name | Status |\n|------|--------|\n| a | ok |'), 'Name, Status');
  assert.equal(firstSentence('---\nAfter the rule.'), 'After the rule.');
  assert.equal(firstSentence('| --- | --- |\nText.'), 'Text.');
});

test('a link reads as its text, an image as its alt text, and emphasis and code spans as what is inside them', () => {
  assert.equal(firstSentence('See [the docs](https://example.com/a_b?c=1) for more. Next.'), 'See the docs for more.');
  assert.equal(firstSentence('![a diagram](pic.png) shows it.'), 'a diagram shows it.');
  assert.equal(firstSentence('See [the guide][1] now.'), 'See the guide now.');
  assert.equal(firstSentence('Visit <https://example.com> today.'), 'Visit https://example.com today.');
  assert.equal(firstSentence('**Fixed** `foo.js` and *bar* and __baz__ and ~~old~~.'), 'Fixed foo.js and bar and baz and old.');
  assert.equal(firstSentence('Run `a_b * c_d` first. Then.'), 'Run a_b * c_d first.');
  assert.equal(firstSentence('Call ``a ` b`` now.'), 'Call a ` b now.');
  assert.equal(firstSentence('**Done.** All tests pass.'), 'Done.');
});

test('a long sentence is cut to the limit with an ellipsis, 160 characters unless another is given', () => {
  const long = `${'word '.repeat(100)}end.`;
  const line = firstSentence(long);
  assert.equal(line.length, 160);
  assert.ok(line.endsWith('…'));
  assert.ok(long.startsWith(line.slice(0, -1)));
  assert.equal(firstSentence(long, 20), `${long.slice(0, 19).trimEnd()}…`);
  assert.equal(firstSentence('x'.repeat(160)), 'x'.repeat(160));
  assert.equal(firstSentence('x'.repeat(161)).length, 160);
});

test('nothing in gives nothing out, and so does text that is only markup', () => {
  for (const empty of ['', '   ', '\n\n', null, undefined, 5, {}]) assert.equal(firstSentence(empty), '');
  for (const bare of ['```\ncode only\n```', '---', '-', '#', '> ', '|---|---|']) assert.equal(firstSentence(bare), '', bare);
});

test('the closing ask is the last sentence of the last three lines that ends in a question mark or carries an offer', () => {
  assert.equal(closingAsk('Done. Should I merge it?'), 'Should I merge it?');
  assert.equal(closingAsk('Which branch? Either works. Tell me which.'), 'Which branch?');
  assert.equal(closingAsk('Is it ready? Can you check? Thanks.'), 'Can you check?');
  assert.equal(closingAsk('Is it ready?\nIt is not.'), 'Is it ready?');
  assert.equal(closingAsk('Done.\n\nLet me know if the tests fail.'), 'Let me know if the tests fail.');
  assert.equal(closingAsk('He asked "is it done?" Then left.'), 'He asked "is it done?"');
  assert.equal(closingAsk('Did you mean "this one?"'), 'Did you mean "this one?"');
  assert.equal(closingAsk('Is it done? (Maybe.)'), 'Is it done?');
  assert.equal(closingAsk('One. Two? Three? Four? Five.'), 'Four?');
});

test('only the last three lines of prose are read, and a code block or a heading marker is not a line of them', () => {
  assert.equal(closingAsk('Should I stop?\nOne.\nTwo.\nThree.'), '');
  assert.equal(closingAsk('Should I stop?\nOne.\nTwo.'), 'Should I stop?');
  assert.equal(closingAsk('Want me to run it?\n\n```bash\nnpm test\n```\n\n\nDone.'), 'Want me to run it?');
  assert.equal(closingAsk('Shall I go?\n\n```bash\nwhy not?\n```'), 'Shall I go?');
  assert.equal(closingAsk('```\nIs this code?\n```'), '');
  assert.equal(closingAsk('- Fixed the build.\n- Want me to open a pull request?'), 'Want me to open a pull request?');
  assert.equal(closingAsk('**Should I merge it?**'), 'Should I merge it?');
});

test('an offer is a phrase like want me to or let me know, whole words in any case, and a plain statement is not one', () => {
  for (const offer of ['Want me to add a test.', 'SHALL I go on.', 'Should I continue.', 'Would you like a summary.', 'Do you want it merged.', 'Let me know when.', 'Say the word.', 'I can do more if you want.', "Done, if you'd like more.", 'Happy to help.']) {
    assert.equal(closingAsk(`Finished. ${offer}`), offer, offer);
  }
  for (const plain of ['It was not wanted.', 'The shall-I-not file is gone.', 'Letting me know is not needed.', 'All finished.', 'Unhappy to hear it.']) assert.equal(closingAsk(plain), '', plain);
});

test('a long ask is cut to the limit with an ellipsis, 160 characters unless another is given, and nothing in gives nothing out', () => {
  const long = `${'word '.repeat(60)}ready?`;
  assert.equal(closingAsk(long).length, 160);
  assert.ok(closingAsk(long).endsWith('…'));
  assert.equal(closingAsk('Is it ready or not?', 10), 'Is it rea…');
  for (const empty of ['', '   ', '\n\n', null, undefined, 5, {}]) assert.equal(closingAsk(empty), '');
});

test('the latest reply is the last assistant message with words in it, whatever came after it', () => {
  transcript('plain', [user('go'), said('First reply.'), used('t1', 'Bash', { command: 'ls' }), said('Second reply. With more.'), thought('musing'), used('t2', 'Bash', { command: 'pwd' })]);
  assert.deepEqual(latestReply(files.get('plain'), '/work'), { text: 'Second reply. With more.', at: null });
  transcript('none', [user('go'), used('t1', 'Bash', { command: 'ls' }), thought('musing')]);
  assert.equal(latestReply(files.get('none'), '/work'), null);
  transcript('timed', [user('go'), said('Timed.', '2026-10-23T05:00:00.000Z')]);
  assert.deepEqual(latestReply(files.get('timed'), '/work'), { text: 'Timed.', at: '2026-10-23T05:00:00.000Z' });
});

test('the end of the file is read first, and a reply further back is found by reading more, up to 2 MB and no further', t => {
  const opened = t.mock.method(fs, 'openSync');
  transcript('near', [user('go'), said('Right at the end.')]);
  opened.mock.resetCalls();
  assert.equal(latestReply(files.get('near'), '').text, 'Right at the end.');
  const readsNear = opened.mock.callCount();

  transcript('middle', [user('go'), said('A reply 1.5 MB back.'), ...filler(1500)]);
  assert.equal(latestReply(files.get('middle'), '').text, 'A reply 1.5 MB back.');
  transcript('deep', [user('go'), said('A reply 3 MB back.'), ...filler(3000)]);
  opened.mock.resetCalls();
  assert.equal(latestReply(files.get('deep'), ''), null, 'past the limit it is not found');
  const size = fs.statSync(files.get('deep').file).size;
  assert.ok(size > 3_000_000);
  assert.ok(opened.mock.callCount() < 20, `${opened.mock.callCount()} reads of a ${size} byte file, growing a chunk at a time`);
  assert.ok(readsNear <= 4, `${readsNear} reads for a reply in the last chunk`);
});

test('a line longer than the limit ends the search with nothing found, and no more than the limit is read however long the line is', t => {
  const reads = t.mock.method(fs, 'readSync');
  const read = () => reads.mock.calls.reduce((n, call) => n + call.result, 0);
  const LIMIT = 2 * 1024 * 1024;
  const PROBE = 64 * 1024;
  transcript('huge', [user('go'), said('Before the long line.'), user('x'.repeat(20 * 1024 * 1024))]);
  reads.mock.resetCalls();
  assert.equal(latestReply(files.get('huge'), ''), null, 'the reply before a 20 MB line is out of reach');
  assert.ok(read() <= LIMIT + PROBE, `${read()} bytes read for a 20 MB line`);

  const unfinished = path.join(dir, 'unfinished.jsonl');
  fs.writeFileSync(unfinished, `${JSON.stringify(said('Before the long line.'))}\n${JSON.stringify(user('x'.repeat(20 * 1024 * 1024)))}`);
  reads.mock.resetCalls();
  assert.equal(latestReply({ id: 'unfinished', file: unfinished }, ''), null, 'a line still being written is not found past the limit either');
  assert.ok(read() <= LIMIT, `${read()} bytes read for a 20 MB line with no end yet`);

  transcript('after-huge', [user('go'), user('x'.repeat(20 * 1024 * 1024)), said('After the long line.')]);
  reads.mock.resetCalls();
  assert.equal(latestReply(files.get('after-huge'), '').text, 'After the long line.');
  assert.ok(read() < 3 * PROBE, `${read()} bytes read for a reply at the end`);

  const line = n => JSON.stringify(user('x'.repeat(n))).length + 1;
  const replyLine = JSON.stringify(said('Just inside.')).length + 1;
  transcript('past', [user('go'), said('Just past it.'), user('x'.repeat(LIMIT - replyLine - line(0) + 100))]);
  assert.equal(latestReply(files.get('past'), ''), null, 'a reply that starts a little before the limit is not found');
  transcript('inside', [user('go'), said('Just inside.'), user('x'.repeat(LIMIT - replyLine - line(0) - 1000))]);
  assert.equal(latestReply(files.get('inside'), '').text, 'Just inside.', 'one that starts a little after it is');
  const summaries = makeSummaries({ transcriptFor });
  assert.deepEqual({ ...summaries.get('huge') }, { line: '', ask: '', reply: '', at: null }, 'the summary is the one for a session that has said nothing');
});

test('a summary has the first sentence of the latest reply, the reply cut to 4,000 characters, and when it was said', () => {
  const summaries = makeSummaries({ transcriptFor });
  transcript('one', [user('go'), said('Old reply.'), said(`## Result\n${'detail line. '.repeat(500)}`, '2026-10-23T05:30:00.000Z')]);
  const got = summaries.get('one', '/work');
  assert.equal(got.line, 'Result');
  assert.equal(got.reply.length, 4000);
  assert.ok(got.reply.startsWith('## Result\ndetail line. '));
  assert.ok(got.reply.endsWith('…'));
  assert.equal(got.at, Date.parse('2026-10-23T05:30:00.000Z'));
  transcript('short', [user('go'), said('Short and sweet. Really.')]);
  assert.deepEqual({ ...summaries.get('short') }, { line: 'Short and sweet.', ask: '', reply: 'Short and sweet. Really.', at: null });
});

test('a summary has the ask its reply closes on, empty when it asks nothing', () => {
  const summaries = makeSummaries({ transcriptFor });
  transcript('asks', [user('go'), said('The build passes.\n\nShall I open a pull request?')]);
  assert.equal(summaries.get('asks').ask, 'Shall I open a pull request?');
  transcript('tells', [user('go'), said('The build passes.')]);
  assert.equal(summaries.get('tells').ask, '');
});

test('a session with no reply yet has an empty summary, and one with no transcript or a vanished file has none', () => {
  const summaries = makeSummaries({ transcriptFor });
  transcript('quiet', [user('go')]);
  assert.deepEqual({ ...summaries.get('quiet') }, { line: '', ask: '', reply: '', at: null });
  assert.equal(summaries.get('never-written'), null);
  files.set('gone', { id: 'gone', file: path.join(dir, 'gone.jsonl') });
  assert.equal(summaries.get('gone'), null);
});

test('the same size and modified time are answered from what is kept without reading the file, and a change to either reads it again', t => {
  const opened = t.mock.method(fs, 'openSync');
  const summaries = makeSummaries({ transcriptFor });
  const file = transcript('kept', [user('go'), said('Version one.')]);
  const when = new Date('2026-10-22T10:00:00.000Z');
  fs.utimesSync(file, when, when);
  opened.mock.resetCalls();
  assert.equal(summaries.get('kept').line, 'Version one.');
  const firstRead = opened.mock.callCount();
  assert.ok(firstRead > 0);
  for (let n = 0; n < 5; n++) assert.equal(summaries.get('kept').line, 'Version one.');
  assert.equal(opened.mock.callCount(), firstRead, 'five more asks read nothing');

  // Rewritten at the same size and time, so only a read could tell.
  const size = fs.statSync(file).size;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Version one.', 'Version two.'));
  fs.utimesSync(file, when, when);
  assert.equal(fs.statSync(file).size, size);
  assert.equal(summaries.get('kept').line, 'Version one.', 'size and time are all it goes by');

  const later = new Date('2026-10-22T10:00:05.000Z');
  fs.utimesSync(file, later, later);
  assert.equal(summaries.get('kept').line, 'Version two.', 'a new modified time reads again');
  assert.ok(opened.mock.callCount() > firstRead);

  const reads = opened.mock.callCount();
  fs.appendFileSync(file, `${JSON.stringify(said('Version three, which is longer.'))}\n`);
  fs.utimesSync(file, later, later);
  assert.equal(summaries.get('kept').line, 'Version three, which is longer.', 'a new size reads again');
  assert.ok(opened.mock.callCount() > reads);
});

test('the file is asked for its size and time, not the index, which can be seconds behind', () => {
  const summaries = makeSummaries({ transcriptFor });
  const file = transcript('behind', [user('go'), said('Before.')]);
  files.set('behind', { id: 'behind', file, size: 1, mtime: 1 });
  assert.equal(summaries.get('behind').line, 'Before.');
  fs.appendFileSync(file, `${JSON.stringify(said('After.'))}\n`);
  assert.equal(summaries.get('behind').line, 'After.', 'the index still says size 1 and time 1');
});

test('past the most it keeps, the oldest summary goes and is read again when asked for', t => {
  const opened = t.mock.method(fs, 'openSync');
  const summaries = makeSummaries({ transcriptFor, max: 2 });
  for (const id of ['a', 'b', 'c']) transcript(`ev-${id}`, [user('go'), said(`Reply ${id}.`)]);
  for (const id of ['a', 'b', 'c']) summaries.get(`ev-${id}`);
  const reads = () => opened.mock.callCount();
  let before = reads();
  assert.equal(summaries.get('ev-b').line, 'Reply b.');
  assert.equal(summaries.get('ev-c').line, 'Reply c.');
  assert.equal(reads(), before, 'the two newest are kept');
  assert.equal(summaries.get('ev-a').line, 'Reply a.');
  assert.ok(reads() > before, 'the oldest was dropped, so it is read again');
  before = reads();
  assert.equal(summaries.get('ev-a').line, 'Reply a.');
  assert.equal(reads(), before, 'and is kept again now');
  summaries.get('ev-b');
  assert.ok(reads() > before, 'which pushed out the next oldest');
});

test('a summary is kept for each session on its own, and one that cannot be read does not stop the rest', () => {
  const summaries = makeSummaries({ transcriptFor });
  transcript('s1', [user('go'), said('One.')]);
  transcript('s2', [user('go'), said('Two.')]);
  assert.deepEqual([summaries.get('s1').line, summaries.get('s2').line], ['One.', 'Two.']);
  const file = path.join(dir, 'locked.jsonl');
  fs.writeFileSync(file, `${JSON.stringify(said('Hidden.'))}\n`);
  files.set('locked', { id: 'locked', file });
  fs.chmodSync(file, 0o000);
  const quiet = console.error;
  const logged = [];
  console.error = message => logged.push(message);
  try {
    if (process.getuid?.() !== 0) {
      assert.equal(summaries.get('locked'), null);
      assert.match(logged.join(''), /Could not summarise locked/);
    }
  } finally {
    console.error = quiet;
    fs.chmodSync(file, 0o600);
  }
  assert.equal(summaries.get('s1').line, 'One.');
});
