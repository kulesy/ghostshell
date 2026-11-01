// Run with `npm test`. Quoting a selection into the next message, with no page: how selected text is tidied into a quote, how quotes are
// sent ahead of the message's text as markdown blockquotes and read back for the transcript, where the Quote button goes, and the quotes in the draft.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addQuote, attachedTo, attachments, quoted, removeQuote, setAttached } from '../public/ui/draft.js';
import { messageFor, placeButton, quotedMessage, quoteText, splitQuotes, titleText } from '../public/ui/quote-rules.js';

const here = { id: 's1', title: 'This one' };
const other = { id: 's2', title: 'Plan the launch' };
const quote = (text, from = here) => ({ key: text, text, from });

test('selected text keeps its words and its single line breaks', () => {
  assert.equal(quoteText('one line'), 'one line');
  assert.equal(quoteText('first\nsecond\nthird'), 'first\nsecond\nthird');
  assert.equal(quoteText('first\n\nsecond'), 'first\n\nsecond');
});

test('selected text has LF line ends, plain spaces and no trailing spaces on any line', () => {
  assert.equal(quoteText('a\r\nb\r\n\r\nc'), 'a\nb\n\nc');
  assert.equal(quoteText('a\rb'), 'a\nb');
  assert.equal(quoteText('a b  c'), 'a b  c');
  assert.equal(quoteText('a   \nb\t\t\nc  '), 'a\nb\nc');
});

test('three or more line breaks in a row become one blank line, and lines of spaces count as empty', () => {
  assert.equal(quoteText('a\n\n\nb'), 'a\n\nb');
  assert.equal(quoteText('a\n\n\n\n\n\nb'), 'a\n\nb');
  assert.equal(quoteText('a\n  \n   \n\nb'), 'a\n\nb');
});

test('a single line is trimmed, and blank lines at either end of several lines go', () => {
  assert.equal(quoteText('\n\n  hello \n\n'), 'hello');
  assert.equal(quoteText('  hello'), 'hello');
  assert.equal(quoteText('\n\n  one\n  two\n\n'), '  one\n  two');
});

test('the first of several lines keeps its indent, as do the lines after it', () => {
  assert.equal(quoteText('if (x) {\n  y();\n}'), 'if (x) {\n  y();\n}');
  assert.equal(quoteText('    y();\n  z();'), '    y();\n  z();');
  assert.equal(quoteText(' \n  y();\n    z();  \n '), '  y();\n    z();');
});

test('text with nothing in it is no quote', () => {
  for (const raw of ['', ' ', '\n\n', ' \n \t', undefined, null]) assert.equal(quoteText(raw), '', JSON.stringify(raw));
});

test('a message with no quotes is its text, as typed', () => {
  assert.equal(quotedMessage([], 'hello', 's1'), 'hello');
  assert.equal(quotedMessage([], '', 's1'), '');
});

test('a quote from the session the message goes to is a blockquote ahead of the text, with a blank line between', () => {
  assert.equal(quotedMessage([quote('the build failed')], 'why?', 's1'), '> the build failed\n\nwhy?');
  assert.equal(quotedMessage([quote('line one\nline two')], 'why?', 's1'), '> line one\n> line two\n\nwhy?');
});

test('several quotes are separate blocks, a blank line apart, in the order they were added', () => {
  assert.equal(quotedMessage([quote('first'), quote('second'), quote('third')], 'which?', 's1'), '> first\n\n> second\n\n> third\n\nwhich?');
});

test('an empty line in a quote is written as > so the quote stays one block', () => {
  assert.equal(quotedMessage([quote('para one\n\npara two')], 'ok', 's1'), '> para one\n>\n> para two\n\nok');
  assert.equal(quotedMessage([quote('  indented\n\n    more')], 'ok', 's1'), '>   indented\n>\n>     more\n\nok');
});

test('a quote from another session says which, by its title', () => {
  assert.equal(quotedMessage([quote('a', other)], 'b', 's1'), 'From the session "Plan the launch":\n> a\n\nb');
  assert.equal(quotedMessage([quote('a'), quote('b', other), quote('c')], 'd', 's1'), '> a\n\nFrom the session "Plan the launch":\n> b\n\n> c\n\nd');
});

test('a quote from a session with no title says another session', () => {
  for (const title of [null, undefined, '', '   ']) {
    assert.equal(quotedMessage([quote('a', { id: 's2', title })], 'b', 's1'), 'From another session:\n> a\n\nb', JSON.stringify(title));
  }
});

test('a title with quote marks or line breaks still makes one From line', () => {
  assert.equal(quotedMessage([quote('a', { id: 's2', title: 'Fix "the" bug' })], 'b', 's1'), 'From the session "Fix "the" bug":\n> a\n\nb');
  assert.equal(quotedMessage([quote('a', { id: 's2', title: 'one\ntwo  three' })], 'b', 's1'), 'From the session "one two three":\n> a\n\nb');
});

test('every quote is from another session in the new-session window, which has no id', () => {
  assert.equal(quotedMessage([quote('a')], 'b', null), 'From the session "This one":\n> a\n\nb');
});

test('quotes with no text of their own end the message with no blank line after them', () => {
  assert.equal(quotedMessage([quote('only this')], '', 's1'), '> only this');
  assert.equal(quotedMessage([quote('a'), quote('b', other)], '', 's1'), '> a\n\nFrom the session "Plan the launch":\n> b');
  assert.equal(quotedMessage([quote('')], 'x', 's1'), '>\n\nx');
});

test('a slash command goes alone, with or without spaces before it, and the quotes stay in the draft', () => {
  const quotes = [quote('the build failed'), quote('a', other)];
  for (const text of ['/compact', '/review-pr 12', '  /model opus', '/plugin:skill args\nmore']) {
    assert.deepEqual(messageFor(quotes, text, 's1'), { message: text, kept: quotes }, text);
  }
});

test('anything else goes with its quotes ahead of it and leaves none in the draft, a path and a slash in the middle included', () => {
  const quotes = [quote('the build failed')];
  for (const text of ['why?', '/etc/hosts look', 'look at /compact', '']) {
    assert.deepEqual(messageFor(quotes, text, 's1'), { message: quotedMessage(quotes, text, 's1'), kept: [] }, text);
  }
});

test('a slash command with no quotes is the text alone, and nothing is kept', () => {
  assert.deepEqual(messageFor([], '/compact', 's1'), { message: '/compact', kept: [] });
});

const SHAPES = [
  [[quote('one')], 'why?', 's1'],
  [[quote('one\ntwo')], 'why?\nand also this\n\nand this', 's1'],
  [[quote('para one\n\npara two\n\n\n')], 'ok', 's1'],
  [[quote('a'), quote('b'), quote('c')], 'which?', 's1'],
  [[quote('a', other)], 'ok', 's1'],
  [[quote('a'), quote('b', other), quote('c', { id: 's3', title: null })], 'ok', 's1'],
  [[quote('a', { id: 's2', title: 'Fix "the": bug' })], 'ok', 's1'],
  [[quote('  indented\n    more\n>already a quote\nFrom the session "x":')], 'ok', 's1'],
  [[quote('only this')], '', 's1'],
  [[quote('a'), quote('b', other)], '', 's1'],
  [[quote('a')], 'b', null],
];

test('splitQuotes reads back what quotedMessage wrote: the quotes, where each came from, and the text', () => {
  for (const [quotes, text, to] of SHAPES) {
    const read = splitQuotes(quotedMessage(quotes, text, to));
    assert.deepEqual(read.quotes, quotes.map(q => ({ text: q.text, from: q.from.id === to ? null : q.from.title?.trim() || '' })), JSON.stringify([quotes, text, to]));
    assert.equal(read.text, text, JSON.stringify([quotes, text, to]));
  }
});

test('splitQuotes strips > and one space after it, and an empty line is a bare >', () => {
  assert.deepEqual(splitQuotes('> one\n>\n>   two\n>three\n\nafter'), { quotes: [{ text: 'one\n\n  two\nthree', from: null }], text: 'after' });
});

test('splitQuotes reads the title from a From line, and an empty title from a quote from an untitled session', () => {
  assert.deepEqual(splitQuotes('From the session "Plan the launch":\n> a\n\nFrom another session:\n> b\n\n> c\n\ntext'), {
    quotes: [{ text: 'a', from: 'Plan the launch' }, { text: 'b', from: '' }, { text: 'c', from: null }],
    text: 'text',
  });
});

test('a session started with quotes is named by the words after them, else by the first quote, else by its text as it is', () => {
  assert.equal(titleText('> the build failed\n\nWhy did it fail?'), 'Why did it fail?');
  assert.equal(titleText('From the session "Plan":\n> a\n\n> b\n\n  Which one?  '), 'Which one?');
  assert.equal(titleText('> first\n> still first\n\n> second'), 'first\nstill first');
  assert.equal(titleText('From another session:\n> a\n\n  \n'), 'a');
  for (const text of ['Fix the build', '', '  spaced  ', 'Fix\n> not at the start', ' > not at the start', '/compact']) assert.equal(titleText(text), text, JSON.stringify(text));
});

test('a message that does not start with a quote comes back as it is', () => {
  for (const text of ['hello', '', ' > not at the start', 'hello\n> later\n\nmore', '\n> after a blank line', '/compact']) {
    assert.deepEqual(splitQuotes(text), { quotes: [], text }, JSON.stringify(text));
  }
});

test('a From line with no quote under it is part of the text', () => {
  const text = 'From the session "Plan":\nnot a quote\n\n> later';
  assert.deepEqual(splitQuotes(text), { quotes: [], text });
  assert.deepEqual(splitQuotes('> a\n\nFrom another session:\nnot a quote'), { quotes: [{ text: 'a', from: null }], text: 'From another session:\nnot a quote' });
});

test('after the quotes, the text is everything left, with its own blank lines', () => {
  assert.deepEqual(splitQuotes('> a\n\nline one\n\nline two\n> not a quote'), { quotes: [{ text: 'a', from: null }], text: 'line one\n\nline two\n> not a quote' });
  assert.deepEqual(splitQuotes('> a\nno blank line'), { quotes: [{ text: 'a', from: null }], text: 'no blank line' });
  assert.deepEqual(splitQuotes('> a\n\n'), { quotes: [{ text: 'a', from: null }], text: '' });
});

test('splitQuotes reads CRLF line ends', () => {
  assert.deepEqual(splitQuotes('> a\r\n> b\r\n\r\ntext'), { quotes: [{ text: 'a\nb', from: null }], text: 'text' });
});

const view = { left: 100, right: 700, top: 50, bottom: 450 };
const size = { width: 80, height: 32 };
const lines = { first: { left: 140, top: 200 }, last: { right: 320, bottom: 260 } };

test('the button goes below the last line of the selection, its left edge at the end of that line', () => {
  assert.deepEqual(placeButton({ ...lines, view }, size), { left: 320, top: 266 });
});

test('the button goes above the first line, at the start of the selection, when there is no room below', () => {
  const low = { first: { left: 140, top: 380 }, last: { right: 320, bottom: 440 } };
  assert.deepEqual(placeButton({ ...low, view }, size), { left: 140, top: 342 });
});

test('the room below leaves out the strip where the transcript fades out', () => {
  const ending = bottom => placeButton({ first: { left: 140, top: 330 }, last: { right: 320, bottom }, view }, size).top;
  assert.equal(ending(372), 378, '372 + 6 + 32 reaches 410, where the strip begins, and still fits');
  assert.equal(ending(373), 292, 'one more pixel does not fit, so the button goes above the first line');
});

test('the button stays inside the transcript at either side', () => {
  assert.equal(placeButton({ first: { left: 140, top: 200 }, last: { right: 690, bottom: 260 }, view }, size).left, 614);
  assert.equal(placeButton({ first: { left: 90, top: 380 }, last: { right: 320, bottom: 440 }, view }, size).left, 106);
});

test('the button stays inside the transcript when the selection runs out of sight', () => {
  const above = { first: { left: 140, top: -500 }, last: { right: 320, bottom: -440 } };
  assert.equal(placeButton({ ...above, view }, size).top, 56, 'the end of the selection is above the box');
  const below = { first: { left: 140, top: 900 }, last: { right: 320, bottom: 960 } };
  assert.equal(placeButton({ ...below, view }, size).top, 378, 'the start of the selection is below the box');
});

test('a transcript too short for the button still gets one at its top', () => {
  const short = { left: 0, right: 300, top: 0, bottom: 50 };
  assert.deepEqual(placeButton({ first: { left: 10, top: 10 }, last: { right: 100, bottom: 30 }, view: short }, size), { left: 10, top: 6 });
});

beforeEach(() => { quoted.set({ quotes: [] }); attachments.set({ s1: undefined }); });

test('a quote is added to the draft with a key of its own and the session it came from', () => {
  addQuote('first', here);
  addQuote('second', other);
  const { quotes } = quoted.get();
  assert.deepEqual(quotes.map(({ text, from }) => ({ text, from })), [{ text: 'first', from: here }, { text: 'second', from: other }]);
  assert.equal(new Set(quotes.map(q => q.key)).size, 2);
});

test('the same words from the same session are not added twice, and from another session they are', () => {
  addQuote('same', here);
  addQuote('same', here);
  addQuote('same', other);
  addQuote('different', here);
  assert.deepEqual(quoted.get().quotes.map(q => [q.text, q.from.id]), [['same', 's1'], ['same', 's2'], ['different', 's1']]);
});

test('a quote is taken out by its key, and the rest keep their order', () => {
  addQuote('a', here);
  addQuote('b', here);
  addQuote('c', here);
  removeQuote(quoted.get().quotes[1].key);
  assert.deepEqual(quoted.get().quotes.map(q => q.text), ['a', 'c']);
  removeQuote('nothing');
  assert.equal(quoted.get().quotes.length, 2);
});

test('a quote does not disturb a session\'s images and files, and removing it leaves them', () => {
  setAttached('s1', { images: [{ id: 'i1' }], files: [{ key: 'f1' }] });
  addQuote('a', here);
  removeQuote(quoted.get().quotes[0].key);
  assert.deepEqual(attachedTo(attachments.get(), 's1').images, [{ id: 'i1' }]);
  assert.deepEqual(attachedTo(attachments.get(), 's1').files, [{ key: 'f1' }]);
});
