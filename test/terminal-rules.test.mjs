// Run with `npm test`. What the terminal panel and the code blocks decide with no page: which blocks have a Run button and what it runs,
// the blocks it refuses, when the prompt box is in command mode, how the input recalls commands, and how the page joins a run's output
// with the summaries the server sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendChunks, bangMode, carriedText, endedAloud, ending, folderOf, hasHiddenCharacters, historyOf, inHome, inputTarget, joinBash, KEEP, landedRuns, lastRunning,
  leaveBang, mergeOutput, opensByDefault, PANEL, panelMode, panelName, panelTabs, pendingBangs, pinAfter, recall, replaceRuns, runnableBlock, runOfItem, tabByKey, tabPress,
  tabShown, textOf, took, upsertRun, clampWidth, widestPanel, widthByKey, runStanding, runState,
} from '../public/ui/terminal-rules.js';

const run = (id, extra = {}) => ({ id, key: id, command: 'ls', cwd: '/h/x', source: 'panel', startedAt: 1000, endedAt: null, exitCode: null, signal: null, stopped: false, running: true, truncated: false, delivered: null, output: [], pending: false, ...extra });
const out = text => ({ stream: 'out', text });

test('a bash, sh, zsh or shell block runs as written, whatever its length', () => {
  for (const lang of ['bash', 'sh', 'zsh', 'shell', 'BASH']) assert.deepEqual(runnableBlock(lang, 'ls -la'), { command: 'ls -la', hidden: false }, lang);
  assert.equal(runnableBlock('bash', 'cd app\nnpm test\n').command, 'cd app\nnpm test');
  assert.equal(runnableBlock('bash', '# list\nls\n').command, '# list\nls');
});

test('a block in another language, or an empty one, has no Run button', () => {
  for (const lang of ['python', 'js', 'json', 'diff', 'yaml', 'bash-session', 'shell-session']) assert.equal(runnableBlock(lang, 'ls'), null, lang);
  assert.equal(runnableBlock('bash', ''), null);
  assert.equal(runnableBlock('bash', '  \n\n'), null);
  assert.equal(runnableBlock('', ''), null);
  assert.equal(runnableBlock('bash', undefined), null);
});

test('a block with no language runs when it holds exactly one line that is not empty', () => {
  assert.equal(runnableBlock('', 'echo hello from the panel').command, 'echo hello from the panel');
  assert.equal(runnableBlock('', '\n  ls -la  \n\n').command, 'ls -la');
  assert.equal(runnableBlock('', 'cd app\nnpm test'), null);
  assert.equal(runnableBlock(undefined, 'pwd').command, 'pwd');
});

test('a console block runs its "$ " lines without the prompt, and its output is not run', () => {
  assert.equal(runnableBlock('console', '$ ls\nREADME.md\nserver.mjs').command, 'ls');
  assert.equal(runnableBlock('console', '$ cd app\n$ npm test\n> ok').command, 'cd app\nnpm test');
  assert.equal(runnableBlock('console', '  $ pwd').command, 'pwd', 'an indented prompt still counts');
  assert.equal(runnableBlock('console', 'README.md\nserver.mjs'), null, 'a console block of output alone is not a command');
  assert.equal(runnableBlock('console', '$ \nout'), null, 'an empty prompt is not a command');
});

test('a console command that ends in a backslash takes the next line as its own', () => {
  assert.equal(runnableBlock('console', '$ docker run \\\n  -it app\nstarted').command, 'docker run \\\n  -it app');
  assert.equal(runnableBlock('console', '$ echo a \\').command, 'echo a \\', 'a backslash on the last line takes nothing');
});

test('a shell block whose every line starts with "$ " is read as a console block, and one that has any other line is not', () => {
  assert.equal(runnableBlock('bash', '$ npm install').command, 'npm install');
  assert.equal(runnableBlock('sh', '$ cd app\n$ npm test').command, 'cd app\nnpm test');
  assert.equal(runnableBlock('bash', '$HOME/bin/x\necho "$ x"').command, '$HOME/bin/x\necho "$ x"');
  assert.equal(runnableBlock('', '$ pwd').command, 'pwd');
  assert.equal(runnableBlock('bash', 'echo $ ').command, 'echo $');
});

test('a command longer than the server takes has no Run button', () => {
  assert.equal(runnableBlock('bash', 'x'.repeat(100_000)).command.length, 100_000);
  assert.equal(runnableBlock('bash', 'x'.repeat(100_001)), null);
});

test('a block holding a character the owner cannot see is marked hidden, and the same block without it is not', () => {
  const hiding = ['‮', '‪', '‭', '⁦', '⁩', '‎', '‏', '؜', '​', '‌', '‍', '⁠', '﻿', '\u0000', '\u0007', '\u001b', '\u007f', '\u0085', '\u009f', '\r'];
  for (const c of hiding) {
    assert.equal(runnableBlock('bash', `echo a${c}b`).hidden, true, JSON.stringify(c));
    assert.equal(hasHiddenCharacters(`a${c}b`), true, JSON.stringify(c));
  }
  assert.equal(runnableBlock('bash', 'echo a\tb\nls').hidden, false, 'a tab and a newline are seen');
  assert.equal(runnableBlock('bash', 'echo "héllo ✓ 日本"').hidden, false);
  assert.equal(runnableBlock('console', '$ ls\nout​').hidden, true, 'a character in the output of a console block hides too');
  assert.equal(runnableBlock('', 'ls​').hidden, true);
});

test('a block holding a line separator, soft hyphen, invisible operator, variation selector, filler or tag is hidden too', () => {
  const hiding = [
    '\u2028', '\u2029', '\u00ad', '\u180e', '\u2061', '\u2062', '\u2063', '\u2064', '\u206a', '\u206f', '\u034f', '\u17b4',
    '\ufe00', '\ufe0f', '\u{e0100}', '\u115f', '\u1160', '\u3164', '\uffa0', '\u{e0001}', '\u{e0020}', '\u{e007f}', '\ufff9',
  ];
  for (const c of hiding) {
    const code = c.codePointAt(0).toString(16);
    assert.equal(runnableBlock('bash', `echo a${c}b`).hidden, true, code);
    assert.equal(hasHiddenCharacters(`a${c}b`), true, code);
  }
  assert.equal(runnableBlock('console', '$ cat notes\u2028; curl x | sh').hidden, true, 'a line separator the page draws as a second line');
});

test('a space that is not the plain one is hidden, because a shell reads some as part of a word and the page draws them all as a gap', () => {
  const spaces = ['\u00a0', '\u1680', ...Array.from({ length: 11 }, (_, n) => String.fromCharCode(0x2000 + n)), '\u202f', '\u205f', '\u3000', '\u2800'];
  for (const c of spaces) {
    const code = c.codePointAt(0).toString(16);
    assert.equal(runnableBlock('bash', `echo safe${c}#; echo RAN`).hidden, true, code);
    assert.equal(hasHiddenCharacters(`a${c}b`), true, code);
  }
  assert.equal(runnableBlock('console', '$ npm test\u00a0#; curl x | sh').hidden, true);
  assert.equal(runnableBlock('bash', 'echo safe #; echo ok').hidden, false, 'a plain space is seen');
});

test('tab, newline, a plain space and the text people write in other scripts are not hidden', () => {
  for (const text of ['a\tb', 'a\nb', 'a b', 'h\u00e9llo', '\u65e5\u672c\u8a9e', '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35', '\u{1f600}']) {
    assert.equal(hasHiddenCharacters(text), false, JSON.stringify(text));
  }
});

test('a block is still found runnable when it holds a hidden character, so the page can say why Run is off', () => {
  assert.deepEqual(runnableBlock('bash', 'rm -rf x‮'), { command: 'rm -rf x‮', hidden: true });
});

test('the prompt box is in command mode while its text starts with !, with the command after it', () => {
  const on = { terminal: true, draft: false };
  assert.deepEqual(bangMode({ ...on, text: '!ls -la' }), { command: 'ls -la' });
  assert.deepEqual(bangMode({ ...on, text: '!' }), { command: '' });
  assert.deepEqual(bangMode({ ...on, text: '!  echo hi \n' }), { command: 'echo hi' });
  assert.deepEqual(bangMode({ ...on, text: '!a\nb' }), { command: 'a\nb' });
  assert.equal(bangMode({ ...on, text: ' !ls' }), null, 'a space before the ! is an ordinary message');
  assert.equal(bangMode({ ...on, text: 'hello !ls' }), null);
  assert.equal(bangMode({ ...on, text: '' }), null);
});

test('a new session\'s box and a server with no terminal are never in command mode', () => {
  assert.equal(bangMode({ text: '!ls', terminal: true, draft: true }), null);
  assert.equal(bangMode({ text: '!ls', terminal: false, draft: false }), null);
  assert.equal(bangMode({ text: '!ls', terminal: undefined, draft: false }), null);
  assert.equal(bangMode({ text: undefined, terminal: true, draft: false }), null);
});

test('a message draft goes with you to the next chat, and a command draft does not', () => {
  assert.equal(carriedText('remember to check the logs'), 'remember to check the logs');
  assert.equal(carriedText('line one\nline two'), 'line one\nline two');
  assert.equal(carriedText(''), '');
  assert.equal(carriedText('!git reset --hard'), '');
  assert.equal(carriedText('!'), '');
  assert.equal(carriedText(' !ls'), ' !ls', 'a space first is a message, as it is for the prompt box');
});

test('leaving command mode takes the ! and the spaces after it away and keeps the rest', () => {
  assert.equal(leaveBang('!ls -la'), 'ls -la');
  assert.equal(leaveBang('!  ls'), 'ls');
  assert.equal(leaveBang('!'), '');
  assert.equal(leaveBang('hello'), 'hello');
});

test('the history lists the commands run, oldest first, with a repeat in a row listed once', () => {
  const runs = ['ls', 'ls', 'pwd', 'ls', ''].map((command, n) => run(`r${n}`, { command }));
  assert.deepEqual(historyOf(runs), ['ls', 'pwd', 'ls']);
  assert.equal(historyOf(Array.from({ length: 300 }, (_, n) => run(`r${n}`, { command: `c${n}` }))).length, 200);
});

test('Up walks back through the history from what was typed, and Down walks forward to it again', () => {
  const list = ['a', 'b', 'c'];
  let state = { list, at: null, draft: '' };
  let step = recall(state, 'typed', -1);
  assert.deepEqual(step, { at: 2, draft: 'typed', text: 'c' });
  state = { list, ...step };
  step = recall(state, 'c', -1);
  assert.deepEqual(step, { at: 1, draft: 'typed', text: 'b' });
  state = { list, ...step };
  assert.deepEqual(recall(state, 'b', 1), { at: 2, draft: 'typed', text: 'c' });
  assert.deepEqual(recall({ list, at: 2, draft: 'typed' }, 'c', 1), { at: null, draft: '', text: 'typed' }, 'past the newest comes the draft back');
});

test('Up at the oldest command, Down with nothing recalled, and any key with no history do nothing', () => {
  assert.equal(recall({ list: ['a'], at: 0, draft: '' }, 'a', -1), null);
  assert.equal(recall({ list: ['a'], at: null, draft: '' }, 'x', 1), null);
  assert.equal(recall({ list: [], at: null, draft: '' }, 'x', -1), null);
});

test('a summary\'s output replaces what the page holds only when the page is missing some', () => {
  const held = [out('one\n'), out('two\n'), out('three\n')];
  assert.equal(mergeOutput(held, [out('two\nthree\n')]), held, 'the last words of a longer account leave it as it is');
  assert.equal(mergeOutput(held, [out('one\ntwo\nthree\n')]), held, 'the whole account too');
  const tail = [out('two\nthree\nfour\n')];
  assert.equal(mergeOutput(held, tail), tail, 'an account with more at the end is the better one');
  assert.equal(mergeOutput([], tail), tail);
  assert.equal(mergeOutput(held, []), held, 'a run that has printed nothing yet takes nothing away');
});

test('the page\'s echo of what was typed is left out when two accounts of the output are compared', () => {
  const held = [out('prompt: '), { stream: 'in', text: 'yes\n' }, out('done\n')];
  assert.equal(textOf(held), 'prompt: done\n');
  assert.equal(mergeOutput(held, [out('prompt: done\n')]), held);
});

test('chunks join the last piece when it is the same stream, and the oldest words go past the cap', () => {
  const first = [out('a')];
  const next = appendChunks(first, [out('b'), { stream: 'err', text: 'c' }, { stream: 'err', text: 'd' }, out('')]);
  assert.deepEqual(next, [out('ab'), { stream: 'err', text: 'cd' }]);
  assert.deepEqual(first, [out('a')], 'the list it was given is not changed');
  assert.deepEqual(appendChunks([out('abcdef')], [out('gh')], 5), [out('defgh')]);
  assert.deepEqual(appendChunks([out('ab'), { stream: 'err', text: 'cd' }], [out('ef')], 4), [{ stream: 'err', text: 'cd' }, out('ef')]);
  assert.equal(KEEP, 256 * 1024);
});

test('a summary of a run the page holds updates it and keeps the output it has', () => {
  const held = run('r1', { key: 'local-1', output: [out('a\nb\n')] });
  const [now] = upsertRun([held], run('r1', { running: false, exitCode: 0, endedAt: 2000, output: [out('b\n')] }));
  assert.equal(now.running, false);
  assert.equal(now.exitCode, 0);
  assert.equal(now.key, 'local-1', 'the row keeps its key, so it is not drawn again');
  assert.deepEqual(now.output, [out('a\nb\n')]);
});

test('an older summary of a run that has ended does not make it run again', () => {
  const ended = run('r1', { running: false, exitCode: 0, endedAt: 2000 });
  assert.equal(upsertRun([ended], run('r1')).at(0), ended);
});

test('a summary of a run the page does not know takes the place of the run drawn while the server was asked', () => {
  const waiting = run('local-1', { pending: true, command: 'sleep 30', source: 'panel' });
  const other = run('local-2', { pending: true, command: 'sleep 30', source: 'bang' });
  const [a, b] = upsertRun([waiting, other], run('abc', { command: 'sleep 30', source: 'panel' }));
  assert.equal(a.id, 'abc');
  assert.equal(a.key, 'local-1');
  assert.equal(a.pending, false);
  assert.equal(b, other, 'a run with another source is not taken for it');
});

test('a summary of a run nobody waited for is added at the end, and only the newest hundred are kept', () => {
  const runs = upsertRun([run('r1')], run('r2'));
  assert.deepEqual(runs.map(r => r.id), ['r1', 'r2']);
  assert.equal(runs[1].key, 'r2');
  const many = Array.from({ length: 100 }, (_, n) => run(`m${n}`));
  const next = upsertRun(many, run('new'));
  assert.equal(next.length, 100);
  assert.deepEqual([next[0].id, next.at(-1).id], ['m1', 'new']);
});

test('the server\'s whole list of runs replaces the page\'s, joined to what the page holds, and keeps the runs still waiting', () => {
  const held = [run('r1', { key: 'k1', output: [out('a\nb\n')] }), run('gone'), run('local-1', { pending: true })];
  const list = replaceRuns(held, [run('r1', { output: [out('b\n')] }), run('r2', { output: [out('z')] })]);
  assert.deepEqual(list.map(r => r.id), ['r1', 'r2', 'local-1']);
  assert.equal(list[0].key, 'k1');
  assert.deepEqual(list[0].output, [out('a\nb\n')]);
  assert.equal(list[1].key, 'r2');
});

test('the run that input and Ctrl+C are for is the newest one the server says is running', () => {
  assert.equal(lastRunning([run('a'), run('b', { running: false }), run('c', { pending: true })]).id, 'a');
  assert.equal(lastRunning([run('a', { running: false })]), null);
  assert.equal(lastRunning([]), null);
});

test('an empty input follows the newest running run, and the first text typed pins it to the run it shows then', () => {
  const runs = [run('a'), run('b')];
  assert.deepEqual(inputTarget(runs, null), { run: runs[1], ended: false });
  assert.deepEqual(inputTarget([run('a', { running: false })], null), { run: null, ended: false });
  assert.deepEqual(pinAfter(null, runs, 'h'), { run: 'b' });
  assert.deepEqual(pinAfter(null, [run('a', { running: false })], 'h'), { run: null }, 'shown no run, so pinned to none');
  assert.deepEqual(pinAfter({ run: 'a' }, runs, 'he'), { run: 'a' }, 'more text keeps the pin');
  assert.equal(pinAfter({ run: 'a' }, runs, ''), null, 'an empty box lets go');
});

test('a run that starts while the owner is typing does not take his Enter or Ctrl+C', () => {
  const typedToA = pinAfter(null, [run('a')], 'yes');
  const withNewer = [run('a'), run('b')];
  assert.deepEqual(inputTarget(withNewer, typedToA), { run: withNewer[0], ended: false }, 'a newer run leaves the input on the run it showed');
  const typedAsCommand = pinAfter(null, [], 'ls -la');
  assert.deepEqual(inputTarget(withNewer, typedAsCommand), { run: null, ended: false }, 'text typed as a command stays one, so Ctrl+C clears it and Enter runs it');
});

test('text for a run that has ended is for nothing, and is not run as a command', () => {
  const pinned = { run: 'a' };
  assert.deepEqual(inputTarget([run('a', { running: false }), run('b')], pinned), { run: null, ended: true });
  assert.deepEqual(inputTarget([run('b')], pinned), { run: null, ended: true }, 'a run cleared away has ended too');
  assert.deepEqual(inputTarget([run('a', { running: false })], pinned), { run: null, ended: true });
  assert.deepEqual(inputTarget([run('a')], pinned), { run: run('a'), ended: false });
});

test('the home folder is written ~ only where the path starts with it', () => {
  assert.equal(inHome('/Users/eli', '/Users/eli'), '~');
  assert.equal(inHome('/Users/eli/code/app', '/Users/eli'), '~/code/app');
  assert.equal(inHome('/Users/elias/app', '/Users/eli'), '/Users/elias/app');
  assert.equal(inHome('/tmp/Users/eli/x', '/Users/eli'), '/tmp/Users/eli/x');
  assert.equal(inHome('/tmp/x', ''), '/tmp/x');
  assert.equal(inHome('', '/Users/eli'), '');
});

test('a run\'s prompt names the last folder of where it ran, with the home folder as ~ and the root as /', () => {
  assert.equal(folderOf('/Users/eli/code/app', '/Users/eli'), 'app');
  assert.equal(folderOf('/Users/eli', '/Users/eli'), '~');
  assert.equal(folderOf('/Users/eli/code/app/', '/Users/eli'), 'app');
  assert.equal(folderOf('/', '/Users/eli'), '/');
  assert.equal(folderOf('', '/Users/eli'), '');
});

test('a run\'s time is in tenths of a second under ten seconds and in whole units after that', () => {
  assert.deepEqual([took(0), took(240), took(9940), took(9950), took(10_000), took(59_999), took(61_000), took(3_661_000)], ['0.0s', '0.2s', '9.9s', '9s', '10s', '59s', '1m 01s', '1h 01m']);
  assert.equal(took(NaN), '');
});

test('a run\'s ending is its exit code, or that it was stopped or ended by a signal, and it is spoken the same way', () => {
  assert.equal(ending(run('a', { running: false, exitCode: 0 })), 'Exit 0');
  assert.equal(ending(run('a', { running: false, exitCode: 2 })), 'Exit 2');
  assert.equal(ending(run('a', { running: false, stopped: true, signal: 'SIGTERM' })), 'Stopped');
  assert.equal(ending(run('a', { running: false, signal: 'SIGKILL' })), 'Ended by SIGKILL');
  assert.equal(endedAloud(run('a', { command: 'ls -la', exitCode: 0 })), 'Command finished with exit code 0: ls -la');
  assert.equal(endedAloud(run('a', { command: 'sleep 30', stopped: true })), 'Command was stopped: sleep 30');
  assert.equal(endedAloud(run('a', { command: 'x'.repeat(100), exitCode: 1 })), `Command finished with exit code 1: ${'x'.repeat(80)}...`);
});

test('two bash items from an older CLI, the second with no command, read as one', () => {
  const input = { kind: 'bash', key: 'i1', command: 'ls', stdout: '', stderr: '', at: 't' };
  const output = { kind: 'bash', key: 'i2', command: '', stdout: 'a\nb', stderr: 'warn' };
  const user = { kind: 'user', key: 'i3', text: 'ok' };
  const rows = joinBash([user, input, output, user]);
  assert.equal(rows.length, 3);
  assert.deepEqual({ ...rows[1] }, { kind: 'bash', key: 'i1', command: 'ls', stdout: 'a\nb', stderr: 'warn', at: 't' });
  assert.equal(joinBash([user, input, output, user])[1], rows[1], 'joining again gives the same item, so its row is not drawn again');
});

test('bash items that are whole, or an output item with nothing before it, are left as they are', () => {
  const whole = { kind: 'bash', command: 'ls', stdout: 'a', stderr: '' };
  const items = [whole, { kind: 'bash', command: 'pwd', stdout: '/', stderr: '' }];
  assert.equal(joinBash(items), items, 'a list with no output-only item is returned as it is');
  const alone = { kind: 'bash', command: '', stdout: 'a', stderr: '' };
  assert.deepEqual(joinBash([alone, whole]), [alone, whole]);
  assert.deepEqual(joinBash([{ kind: 'user', text: 'x' }, alone]), [{ kind: 'user', text: 'x' }, alone]);
});

test('a bash item in the transcript takes the earliest run with its command that started before it, once', () => {
  const runs = [
    run('a', { source: 'bang', command: 'echo hi', startedAt: 1000 }),
    run('b', { source: 'bang', command: 'echo hi', startedAt: 5000 }),
    run('c', { source: 'panel', command: 'echo hi', startedAt: 1000 }),
  ];
  const item = (command, at) => ({ kind: 'bash', command, stdout: '', stderr: '', at: new Date(at).toISOString() });
  assert.deepEqual([...landedRuns(runs, [item('echo hi', 6000)])], ['a']);
  assert.deepEqual([...landedRuns(runs, [item('echo hi', 6000), item('echo hi', 7000)])], ['a', 'b']);
  assert.deepEqual([...landedRuns(runs, [item('echo hi', 3000)])], ['a'], 'an item written before the second run began is not for it');
  assert.deepEqual([...landedRuns(runs, [item('echo ho', 6000)])], []);
  assert.deepEqual([...landedRuns(runs, [item('  echo hi\n', 6000)])], ['a'], 'a command is compared without the space round it');
  assert.deepEqual([...landedRuns(runs, [item('echo hi', -10_000)])], [], 'an item that came before any run began is for none');
});

test('a bash item with no time still takes a run by its command', () => {
  const runs = [run('a', { source: 'bang', command: 'ls', startedAt: 9e12 })];
  assert.deepEqual([...landedRuns(runs, [{ kind: 'bash', command: 'ls', stdout: '', stderr: '' }])], ['a']);
});

test('the runs shown after the transcript are the ! runs it does not hold yet', () => {
  const runs = [run('a', { source: 'bang', command: 'ls', startedAt: 1000 }), run('b', { source: 'bang', command: 'pwd', startedAt: 2000 }), run('c', { source: 'block', command: 'ls' })];
  const items = [{ kind: 'bash', command: 'ls', stdout: '', stderr: '', at: new Date(3000).toISOString() }];
  assert.deepEqual(pendingBangs({ runs, items, hasEarlier: false }).map(r => r.id), ['b']);
  assert.deepEqual(pendingBangs({ runs, items: [], hasEarlier: false }).map(r => r.id), ['a', 'b']);
});

test('with earlier messages not loaded, a run that began before the oldest message on show is left out', () => {
  const runs = [run('old', { source: 'bang', startedAt: 1000 }), run('new', { source: 'bang', command: 'pwd', startedAt: 9000 })];
  const items = [{ kind: 'assistant', text: 'hi', at: new Date(5000).toISOString() }];
  assert.deepEqual(pendingBangs({ runs, items, hasEarlier: true }).map(r => r.id), ['new']);
  assert.deepEqual(pendingBangs({ runs, items, hasEarlier: false }).map(r => r.id), ['old', 'new']);
  assert.deepEqual(pendingBangs({ runs, items: [{ kind: 'assistant', text: 'hi' }], hasEarlier: true }).map(r => r.id), ['old', 'new'], 'with no time to compare, none is left out');
});

test('the run a bash item came from is the latest ! run with its command that began before it', () => {
  const runs = [run('a', { source: 'bang', command: 'ls', startedAt: 1000 }), run('b', { source: 'bang', command: 'ls', startedAt: 5000 }), run('c', { source: 'panel', command: 'ls', startedAt: 6000 })];
  const item = at => ({ kind: 'bash', command: 'ls', at: new Date(at).toISOString() });
  assert.equal(runOfItem(runs, item(6000)).id, 'b');
  assert.equal(runOfItem(runs, item(2500)).id, 'a');
  assert.equal(runOfItem(runs, item(-10_000)), null);
  assert.equal(runOfItem(runs, { kind: 'bash', command: 'pwd', at: new Date(6000).toISOString() }), null);
});

test('the panel sits beside the chat when the session has room for both, and covers it when it does not', () => {
  assert.equal(panelMode(PANEL.overBelow), 'side');
  assert.equal(panelMode(PANEL.overBelow - 1), 'over');
  assert.equal(panelMode(390), 'over');
  assert.equal(panelMode(1200), 'side');
  assert.ok(PANEL.min + PANEL.chatMin <= PANEL.overBelow, 'the smallest session that has a side panel fits the smallest panel and the smallest chat');
});

test('the width is kept between the smallest panel and what leaves the chat its room, and an unreadable one is the default', () => {
  assert.equal(clampWidth(448, 1000), 448);
  assert.equal(clampWidth(100, 1000), PANEL.min);
  assert.equal(clampWidth(900, 1000), 1000 - PANEL.chatMin);
  assert.equal(clampWidth(undefined, 1000), PANEL.fallback);
  assert.equal(clampWidth('wide', 1000), PANEL.fallback);
  assert.equal(clampWidth(400.6, 1000), 401);
  assert.equal(widestPanel(500), PANEL.min, 'a session too narrow for both still gets the smallest panel');
});

test('the resize handle\'s keys move the edge: left widens, right narrows, Shift steps further, Home and End go to the ends', () => {
  assert.equal(widthByKey('ArrowLeft', false, 400, 1000), 400 + PANEL.step);
  assert.equal(widthByKey('ArrowRight', false, 400, 1000), 400 - PANEL.step);
  assert.equal(widthByKey('ArrowLeft', true, 400, 1000), 400 + PANEL.bigStep);
  assert.equal(widthByKey('Home', false, 400, 1000), PANEL.min);
  assert.equal(widthByKey('End', false, 400, 1000), 1000 - PANEL.chatMin);
  assert.equal(widthByKey('ArrowLeft', true, 650, 1000), 1000 - PANEL.chatMin, 'a step stops at the widest');
  assert.equal(widthByKey('ArrowRight', true, 300, 1000), PANEL.min, 'and at the narrowest');
  assert.equal(widthByKey('a', false, 400, 1000), null);
  assert.equal(widthByKey('ArrowUp', false, 400, 1000), null);
});

test('the panel offers the sub sessions first, the terminal when the server has one and the file while one is open, and shows the tab asked for if it can', () => {
  assert.deepEqual(panelTabs({ subs: true, terminal: true, file: true }), ['subs', 'terminal', 'file']);
  assert.deepEqual(panelTabs({ subs: true, terminal: false, file: false }), ['subs']);
  assert.deepEqual(panelTabs({ subs: true, terminal: false, file: true }), ['subs', 'file']);
  assert.deepEqual(panelTabs({ subs: false, terminal: true, file: true }), ['terminal', 'file']);
  assert.deepEqual(panelTabs({ terminal: true, file: true }), ['terminal', 'file']);
  assert.deepEqual(panelTabs({ terminal: true, file: false }), ['terminal']);
  assert.deepEqual(panelTabs({ terminal: false, file: true }), ['file']);
  assert.deepEqual(panelTabs({ terminal: false, file: false }), []);
  assert.deepEqual(panelTabs({ subs: true, agents: true, terminal: true, file: true }), ['subs', 'agents', 'terminal', 'file'], 'Subagents sit between the sub sessions and the terminal');
  assert.deepEqual(panelTabs({ agents: true, terminal: true }), ['agents', 'terminal']);
  assert.deepEqual(panelTabs({ agents: true }), ['agents']);
  assert.deepEqual(panelTabs({ agents: false, terminal: true }), ['terminal'], 'a chat with no helper has no tab');
  assert.equal(tabShown('file', ['terminal', 'file']), 'file');
  assert.equal(tabShown('file', ['terminal']), 'terminal', 'a closed file leaves the terminal');
  assert.equal(tabShown('terminal', ['file']), 'file');
  assert.equal(tabShown('terminal', []), null);
  assert.equal(tabShown('terminal', ['subs', 'terminal']), 'terminal');
  assert.equal(tabShown('file', ['subs', 'terminal']), 'subs', 'a closed file leaves the first tab when there is no terminal');
});

test('the panel is named for the tabs it holds', () => {
  assert.equal(panelName(['subs', 'terminal', 'file']), 'Sub sessions, terminal and file');
  assert.equal(panelName(['subs', 'terminal']), 'Sub sessions and terminal');
  assert.equal(panelName(['terminal', 'file']), 'Terminal and file');
  assert.equal(panelName(['subs']), 'Sub sessions');
  assert.equal(panelName(['subs', 'agents', 'terminal']), 'Sub sessions, subagents and terminal');
  assert.equal(panelName(['agents']), 'Subagents');
  assert.equal(panelName(['file']), 'File');
  assert.equal(panelName([]), '');
});

test('a header button or Ctrl+` closes the panel only when its own tab is on show, and otherwise shows that tab', () => {
  assert.equal(tabPress(null, 'subs'), 'show', 'closed, it opens on the tab');
  assert.equal(tabPress('terminal', 'subs'), 'show', 'open on another tab, it switches');
  assert.equal(tabPress('file', 'terminal'), 'show');
  assert.equal(tabPress('subs', 'subs'), 'close');
  assert.equal(tabPress('terminal', 'terminal'), 'close');
});

test('the panel opens by itself only for a chat that offers the sub sessions, has nothing saved, and has room beside the chat', () => {
  const ready = { saved: false, offered: true, mode: 'side' };
  assert.equal(opensByDefault(ready), true);
  assert.equal(opensByDefault({ ...ready, saved: true }), false, 'a panel the owner opened or closed is left as it was');
  assert.equal(opensByDefault({ ...ready, offered: false }), false);
  assert.equal(opensByDefault({ ...ready, mode: 'over' }), false, 'a panel that would cover the chat waits to be asked for');
  assert.equal(opensByDefault({ saved: false, offered: true, mode: panelMode(PANEL.overBelow - 1) }), false);
  assert.equal(opensByDefault({ saved: false, offered: true, mode: panelMode(PANEL.overBelow) }), true);
});

test('the arrows move between tabs and wrap, Home and End go to the ends, and any other key is not a tab key', () => {
  const tabs = ['terminal', 'file'];
  assert.equal(tabByKey('ArrowRight', 'terminal', tabs), 'file');
  assert.equal(tabByKey('ArrowRight', 'file', tabs), 'terminal');
  assert.equal(tabByKey('ArrowLeft', 'terminal', tabs), 'file');
  assert.equal(tabByKey('Home', 'file', tabs), 'terminal');
  assert.equal(tabByKey('End', 'terminal', tabs), 'file');
  assert.equal(tabByKey('Enter', 'terminal', tabs), null);
  assert.equal(tabByKey('ArrowRight', 'gone', tabs), null);
  const four = ['subs', 'agents', 'terminal', 'file'];
  assert.deepEqual(four.map(tab => tabByKey('ArrowRight', tab, four)), ['agents', 'terminal', 'file', 'subs'], 'Subagents are one step from each neighbour');
  assert.equal(tabByKey('ArrowLeft', 'terminal', four), 'agents');
  assert.equal(opensByDefault({ saved: false, offered: false, mode: 'side' }), false, 'helpers alone never open the panel');
});

test('a run is running, stopped, ok on exit 0, or failed, and its footer says how long and what became of its result', () => {
  assert.equal(runState(run('a')), 'running');
  assert.equal(runState(run('a', { running: false, stopped: true })), 'stopped');
  assert.equal(runState(run('a', { running: false, signal: 'SIGTERM' })), 'stopped');
  assert.equal(runState(run('a', { running: false, exitCode: 0 })), 'ok');
  assert.equal(runState(run('a', { running: false, exitCode: 2 })), 'failed');
  assert.equal(runStanding(run('a', { pending: true })), 'Starting');
  assert.equal(runStanding(run('a', { startedAt: 1000 }), 3500), 'Running 2.5s');
  assert.equal(runStanding(run('a', { running: false, exitCode: 0, startedAt: 1000, endedAt: 1400 })), 'Exit 0 · 0.4s');
  assert.equal(runStanding(run('a', { running: false, exitCode: 1, startedAt: 0, endedAt: 75_000, truncated: true, delivered: 'sent' })), 'Exit 1 · 1m 15s · Output cut · Sent to Claude');
  assert.equal(runStanding(run('a', { running: false, stopped: true, startedAt: 0, endedAt: 2000, delivered: 'held' })), 'Stopped · 2.0s · Added to your next message');
});
