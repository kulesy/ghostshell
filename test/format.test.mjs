// Run with `npm test`. Small text helpers the page uses, which need no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeTool, duration, fileSize, fullToolLabel, grouped, groupHolds, holdCause, holdEnd, preview, sentAt, serverLabel, thousands, tickIn, tokenCount, toolLabel, toolSource, untilMidnight, when, windowSize } from '../public/ui/format.js';

const MAILBOX = '0f8a1c2e-1111-4a2b-9c3d-123456789abc';
const CALENDAR = '6a1b2c3d-2222-4e5f-8a9b-0c1d2e3f4a5b';
const labels = (name, names) => [serverLabel(name, names), toolSource(name, names), fullToolLabel(name, names)];

test('a timer reads in seconds, then minutes and seconds, then hours and minutes', () => {
  assert.deepEqual([0, 999, 1000, 59_999, 60_000, 65_000, 3_599_000, 3_600_000, 3_725_000].map(duration), ['0s', '0s', '1s', '59s', '1m 00s', '1m 05s', '59m 59s', '1h 00m', '1h 02m']);
  assert.equal(duration(-5), '0s');
});

// What format.js waits past the whole second, so a timer that fires on time reads the new second.
const SLACK = 5;

test('a clock waits for the next whole second of its time, and a little past it', () => {
  assert.equal(tickIn(10_000, 7_000), 1000 + SLACK, 'on a whole second it waits for the next');
  assert.equal(tickIn(10_250, 7_000), 750 + SLACK, 'part way through a second it waits for what is left');
  assert.equal(tickIn(10_999, 7_000), 1 + SLACK, 'a millisecond short of the turn it waits for that millisecond');
  for (let elapsed = 0; elapsed < 130_000; elapsed++) {
    const wait = tickIn(elapsed, 0);
    assert.ok(wait > 0 && wait <= 1000 + SLACK, `${elapsed} ms waits ${wait}`);
    assert.notEqual(duration(elapsed + wait), duration(elapsed), `${elapsed} ms still reads the same after the wait`);
  }
});

test('a clock counting from a start that has not come yet still waits a positive time under a second and a little', () => {
  assert.equal(tickIn(10_000, 12_500), 500 + SLACK);
  assert.equal(tickIn(10_000, 11_000), 1000 + SLACK);
  assert.equal(tickIn(10_000, 10_001), 1 + SLACK);
  for (let elapsed = -5000; elapsed <= 0; elapsed++) {
    const wait = tickIn(elapsed, 0);
    assert.ok(wait > 0 && wait <= 1000 + SLACK, `${elapsed} ms waits ${wait}`);
  }
});

test('a token count is exact below a thousand and then rounds to thousands', () => {
  assert.deepEqual([0, 842, 999, 1000, 1234, 9949, 9999, 10_000, 12_345, 123_456].map(tokenCount), ['0', '842', '999', '1k', '1.2k', '9.9k', '10k', '10k', '12k', '123k']);
});

test('the context meter writes tokens in thousands to one decimal, a window in its shortest round figure, and an exact count with separators', () => {
  assert.deepEqual([0, 40, 500, 14_300, 47_760, 150_000, 267_000].map(thousands), ['0.0k', '0.0k', '0.5k', '14.3k', '47.8k', '150.0k', '267.0k']);
  assert.deepEqual([128_000, 200_000, 267_000, 267_500, 300_000, 999_960, 1_000_000, 1_500_000].map(windowSize), ['128k', '200k', '267k', '267.5k', '300k', '1M', '1M', '1.5M']);
  assert.deepEqual([0, 999, 1000, 47_760, 1_000_000].map(grouped), ['0', '999', '1,000', '47,760', '1,000,000']);
});

test('a thinking preview is one plain line of the start of the text', () => {
  assert.equal(preview('**Checking the divisors**\n\nUp to `45` only.'), 'Checking the divisors Up to 45 only.');
  assert.equal(preview('## Plan\n- one'), 'Plan - one');
  assert.equal(preview('x'.repeat(300)).length, 160);
});

test('a tool label is the tool without its server, with spaces for underscores', () => {
  const labels = {
    'mcp__claude-in-chrome__computer': 'computer',
    'mcp__Claude_Browser__browser_batch': 'browser batch',
    'mcp__ccd_session__spawn_task': 'spawn task',
    'mcp__0d2c4b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d__read': 'read',
    'mcp__PowerPoint__By_Anthropic___add_slide': 'add slide',
    'mcp___foo___tool': 'tool',
    Read: 'Read',
    Bash: 'Bash',
  };
  assert.deepEqual(Object.keys(labels).map(toolLabel), Object.values(labels));
});

test('a server is named as the page names it: Chrome for the extension, Desktop for its app servers, connector for a UUID, else its own name with spaces for separators', () => {
  const servers = {
    'mcp__claude-in-chrome__computer': 'Chrome',
    'mcp__Claude_in_Chrome__browser_batch': 'Chrome',
    'mcp__ccd_session__spawn_task': 'Desktop',
    'mcp__ccd_turn__update_plan': 'Desktop',
    'mcp__ccd_session_mgmt__list_sessions': 'Desktop',
    'mcp__ccd_pr__get_status': 'Desktop',
    'mcp__0d2c4b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d__read': 'connector',
    'mcp__0D2C4B1A-9E8F-4A7B-8C6D-5E4F3A2B1C0D__read': 'connector',
    'mcp__Claude_Browser__computer': 'Claude Browser',
    'mcp__computer-use__screenshot': 'computer use',
    'mcp__Claude_Code_iOS_Simulator__control': 'Claude Code iOS Simulator',
    'mcp__claude_ai_Google_Drive__download_file_content': 'Google Drive',
    'mcp__claude_ai_Gmail__search_threads': 'Gmail',
    mcp__playwright__browser_take_screenshot: 'playwright',
  };
  assert.deepEqual(Object.keys(servers).map(serverLabel), Object.values(servers));
});

test('a built-in tool has no server', () => {
  assert.deepEqual(['Read', 'Bash', 'WebFetch'].map(serverLabel), ['', '', '']);
});

test('a tool of Capcom itself has no server to name, so it reads like a built-in one', () => {
  const name = 'mcp__capcom__show_widget';
  assert.deepEqual([serverLabel(name), toolSource(name), fullToolLabel(name)], ['', 'show widget', 'show widget']);
});

test('a name is split from its tool at the last double underscore, so a server whose name holds one keeps its own words', () => {
  const name = 'mcp__PowerPoint__By_Anthropic___add_slide';
  assert.deepEqual([serverLabel(name), toolLabel(name), toolSource(name), fullToolLabel(name)], ['PowerPoint By Anthropic', 'add slide', 'PowerPoint By Anthropic', 'PowerPoint By Anthropic add slide']);
});

test('a server name of only separators is no server, and one with separators around it is trimmed', () => {
  const bare = ['mcp_____tool', 'mcp__---__tool'];
  assert.deepEqual(bare.map(serverLabel), ['', '']);
  assert.deepEqual(bare.map(toolSource), ['tool', 'tool']);
  assert.deepEqual(bare.map(fullToolLabel), ['tool', 'tool']);
  assert.deepEqual(['mcp___foo___tool', 'mcp__-foo-__tool'].map(serverLabel), ['foo', 'foo']);
});

test('only the whole name claude-in-chrome is Chrome, and only a whole UUID is a connector', () => {
  assert.deepEqual(['mcp__chrome-devtools__take_screenshot', 'mcp__claude-in-chrome-beta__computer', 'mcp__0d2c4b1a-9e8f__read'].map(serverLabel), ['chrome devtools', 'claude in chrome beta', '0d2c4b1a 9e8f']);
});

test('a Chrome tool is named by its own name within its server, whichever id the extension goes by', () => {
  const tools = {
    'mcp__claude-in-chrome__navigate': 'navigate',
    'mcp__Claude_in_Chrome__browser_batch': 'browser_batch',
    'mcp__Claude_in_Chrome__tabs_context_mcp': 'tabs_context_mcp',
  };
  assert.deepEqual(Object.keys(tools).map(chromeTool), Object.values(tools));
});

test('a Chrome tool whose own name holds __ is still Chrome, as the runner and the CLI see it, with all of that name its own', () => {
  const names = ['mcp__claude-in-chrome__tab__close', 'mcp__Claude_in_Chrome__tab__close'];
  assert.deepEqual(names.map(n => [chromeTool(n), serverLabel(n)]), names.map(() => ['tab__close', 'Chrome']));
});

test('a name that ends at the Chrome server is still a Chrome tool, with no name of its own, so a caller tests for null and not for empty', () => {
  assert.equal(chromeTool('mcp__claude-in-chrome__'), '');
});

test('any other tool is not a Chrome tool, and nor is a name that is not a string, even one that reads like a Chrome tool', () => {
  const others = ['mcp__claude-in-chrome-beta__computer', 'mcp__chrome-devtools__take_screenshot', 'mcp__Claude_Browser__computer', 'Bash', '', null, undefined, 42, ['mcp__claude-in-chrome__navigate']];
  assert.deepEqual(others.map(chromeTool), others.map(() => null));
});

test('a server named like a property every object has keeps its own name', () => {
  const names = ['constructor', 'toString', 'hasOwnProperty'];
  assert.deepEqual(names.map(n => serverLabel(`mcp__${n}__x`)), names);
  assert.deepEqual(names.map(n => toolSource(`mcp__${n}__x`)), names);
  assert.deepEqual(names.map(n => fullToolLabel(`mcp__${n}__x`)), names.map(n => `${n} x`));
});

test('where output came from reads in a sentence: its server, a connector for a UUID, or the built-in tool itself', () => {
  const sources = {
    'mcp__claude-in-chrome__computer': 'Chrome',
    'mcp__Claude_Browser__browser_batch': 'Claude Browser',
    'mcp__computer-use__screenshot': 'computer use',
    'mcp__0d2c4b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d__read': 'a connector',
    'mcp__claude_ai_Google_Drive__download_file_content': 'Google Drive',
    'mcp__ccd_turn__update_plan': 'Desktop',
    Read: 'Read',
    Bash: 'Bash',
  };
  assert.deepEqual(Object.keys(sources).map(toolSource), Object.values(sources));
});

test('a full tool label puts the server before the tool, and is the tool alone for a built-in one', () => {
  const labels = {
    'mcp__claude-in-chrome__computer': 'Chrome computer',
    'mcp__Claude_Browser__computer': 'Claude Browser computer',
    'mcp__0d2c4b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d__read': 'connector read',
    'mcp__claude_ai_Gmail__search_threads': 'Gmail search threads',
    'mcp__ccd_session__spawn_task': 'Desktop spawn task',
    'mcp__ccd_turn__update_plan': 'Desktop update plan',
    Read: 'Read',
    Bash: 'Bash',
  };
  assert.deepEqual(Object.keys(labels).map(fullToolLabel), Object.values(labels));
});

test('a name that ends at its server, or has underscores around it, leaves no stray space', () => {
  assert.equal(toolLabel('mcp__Claude_Browser__'), '');
  assert.equal(fullToolLabel('mcp__Claude_Browser__'), 'Claude Browser');
  assert.equal(toolSource('mcp__Claude_Browser__'), 'Claude Browser');
  assert.equal(fullToolLabel('mcp__foo___tool'), 'foo tool');
});

test('a connector the session names shows by that name in the server label, the source and the full tool label, each connector by its own', () => {
  const names = { [MAILBOX]: 'Mailbox', [CALENDAR]: 'Calendar' };
  assert.deepEqual(labels(`mcp__${MAILBOX}__search_threads`, names), ['Mailbox', 'Mailbox', 'Mailbox search threads']);
  assert.deepEqual(labels(`mcp__${CALENDAR}__list_events`, names), ['Calendar', 'Calendar', 'Calendar list events']);
});

test('a connector the session gives no name stays a connector, whether the session has no names, none that match, or a blank one', () => {
  const name = `mcp__${MAILBOX}__search_threads`;
  for (const names of [undefined, null, {}, { [CALENDAR]: 'Calendar' }, { [MAILBOX]: '' }]) {
    assert.deepEqual(labels(name, names), ['connector', 'a connector', 'connector search threads'], JSON.stringify(names));
  }
  assert.deepEqual(labels(name), ['connector', 'a connector', 'connector search threads']);
});

test('only a connector is named from the names, so every other server reads as it does without them, even when the names hold an entry under its id', () => {
  const lures = { claude_ai_Gmail: 'Wrong', 'claude-in-chrome': 'Wrong', ccd_session: 'Wrong', playwright: 'Wrong', capcom: 'Wrong', '0d2c4b1a-9e8f': 'Wrong', [MAILBOX]: 'Mailbox' };
  const servers = {
    mcp__claude_ai_Gmail__search_threads: ['Gmail', 'Gmail', 'Gmail search threads'],
    'mcp__claude-in-chrome__computer': ['Chrome', 'Chrome', 'Chrome computer'],
    mcp__ccd_session__spawn_task: ['Desktop', 'Desktop', 'Desktop spawn task'],
    mcp__playwright__browser_take_screenshot: ['playwright', 'playwright', 'playwright browser take screenshot'],
    'mcp__0d2c4b1a-9e8f__read': ['0d2c4b1a 9e8f', '0d2c4b1a 9e8f', '0d2c4b1a 9e8f read'],
    mcp__capcom__show_widget: ['', 'show widget', 'show widget'],
    Read: ['', 'Read', 'Read'],
  };
  for (const [name, expected] of Object.entries(servers)) {
    assert.deepEqual(labels(name, lures), expected, name);
    assert.deepEqual(labels(name), expected, name);
  }
});

test('only an entry the names object holds itself counts, not one behind its prototype or under a key such as __proto__', () => {
  const name = `mcp__${CALENDAR}__list_events`;
  const unnamed = ['connector', 'a connector', 'connector list events'];
  const parsed = JSON.parse(`{"__proto__":{"${CALENDAR}":"Nested"},"${MAILBOX}":"Mailbox"}`);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true, 'the parsed object has the key of its own');
  assert.deepEqual(labels(name, parsed), unnamed);
  assert.deepEqual(labels(`mcp__${MAILBOX}__search_threads`, parsed), ['Mailbox', 'Mailbox', 'Mailbox search threads']);
  assert.deepEqual(labels(name, Object.create({ [CALENDAR]: 'Inherited' })), unnamed);
});

// The causes and outcomes the CLI's peer_message_hold message lists (checked on CLI 2.1.301).
const CAUSES = ['explicit-setting', 'managed-setting', 'repo-setting', 'invalid-setting', 'bypass-default', 'mode-unknown', 'mode-mismatch', 'no-mode-asserted'];
const OUTCOMES = ['expired', 'refused', 'dropped', 'discarded'];

test('every reason the CLI gives for holding a message, and every way a hold ends, has its own plain sentence', () => {
  const causes = CAUSES.map(holdCause);
  const ends = OUTCOMES.map(holdEnd);
  assert.equal(new Set(causes).size, CAUSES.length, 'no cause falls back to the general sentence');
  assert.equal(new Set(ends).size, OUTCOMES.length);
  for (const text of [...causes, ...ends]) assert.match(text, /^[A-Z][^\u2013\u2014]+\.$/u, 'one sentence with no dash');
});

test('a reason or outcome from a newer CLI, or one a sender made up, falls back to a general sentence and is never shown as sent', () => {
  assert.equal(holdCause('<img src=x>'), 'The CLI gave a reason GhostShell does not know.');
  assert.equal(holdCause(undefined), 'The CLI gave a reason GhostShell does not know.');
  assert.equal(holdEnd('<b>x</b>'), 'The CLI ended the hold without delivering.');
  assert.equal(holdEnd(''), 'The CLI ended the hold without delivering.');
});

test('a name that every object inherits is no reason or outcome, and falls back to the general sentence', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(holdCause(name), 'The CLI gave a reason GhostShell does not know.');
    assert.equal(holdEnd(name), 'The CLI ended the hold without delivering.');
  }
});

test('messages held for the same reason from the same sender make one group, and only the newest groups show', () => {
  const list = [
    { id: 'a', from: 'Worker', cause: 'mode-mismatch' },
    { id: 'b', from: 'Docs', cause: 'mode-mismatch' },
    { id: 'c', from: 'Worker', cause: 'mode-mismatch' },
    { id: 'd', from: 'Worker', cause: 'bypass-default' },
    { id: 'e', from: 'Tests', cause: 'mode-mismatch' },
  ];
  const all = groupHolds(list, h => h.cause, 10);
  assert.deepEqual(all.groups.map(g => [g.from, g.why, g.ids]), [
    ['Docs', 'mode-mismatch', ['b']],
    ['Worker', 'mode-mismatch', ['a', 'c']],
    ['Worker', 'bypass-default', ['d']],
    ['Tests', 'mode-mismatch', ['e']],
  ]);
  assert.equal(all.hidden, 0);
  const newest = groupHolds(list, h => h.cause, 2);
  assert.deepEqual(newest.groups.map(g => g.ids), [['d'], ['e']]);
  assert.equal(newest.hidden, 3, 'a, b and c are in the groups left out');
  assert.deepEqual(groupHolds([], h => h.cause, 3), { groups: [], hidden: 0 });
});

test('a group that has just taken another message is the newest, so it is the last to be left out', () => {
  const list = ['A', 'B', 'C', 'D', 'A'].map((from, i) => ({ id: `m${i}`, from, cause: 'mode-mismatch' }));
  const { groups, hidden } = groupHolds(list, h => h.cause, 3);
  assert.deepEqual(groups.map(g => [g.from, g.ids]), [['C', ['m2']], ['D', ['m3']], ['A', ['m0', 'm4']]]);
  assert.equal(hidden, 1, 'only B is left out');
});

test('a file size reads in bytes, then KB, then MB, and rounds up to the next unit rather than reading 1024 of the last', () => {
  assert.deepEqual([0, 1, 900, 1023].map(fileSize), ['0 bytes', '1 byte', '900 bytes', '1023 bytes']);
  assert.deepEqual([1024, 1536, 10_239, 10_240, 12_345, 1_048_000].map(fileSize), ['1 KB', '1.5 KB', '10 KB', '10 KB', '12 KB', '1023 KB']);
  assert.deepEqual([1_048_576 - 1, 1_048_576, 3_565_158, 20 * 1024 * 1024].map(fileSize), ['1 MB', '1 MB', '3.4 MB', '20 MB']);
});

// A Thursday, at a local time, so the tests read the same in any zone.
const local = (...parts) => new Date(...parts);
const NOW = local(2026, 10, 5, 16, 30).getTime();
const clockOf = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('a message from today shows its time, and an older one adds its day', () => {
  const sent = (...parts) => sentAt(local(...parts).toISOString(), NOW);
  const at = clockOf(local(2026, 10, 5, 9, 5));
  assert.equal(sent(2026, 10, 5, 9, 5), at, 'earlier today');
  assert.equal(sent(2026, 10, 5, 0, 0), clockOf(local(2026, 10, 5, 0, 0)), 'the first minute of today is still today');
  assert.equal(sent(2026, 10, 4, 23, 59), `Yesterday, ${clockOf(local(2026, 10, 4, 23, 59))}`, 'a minute before midnight is yesterday');
  assert.equal(sent(2026, 10, 2, 9, 5), `${local(2026, 10, 2).toLocaleDateString([], { weekday: 'short' })}, ${at}`);
  assert.equal(sent(2026, 9, 20, 9, 5), `${local(2026, 9, 20).toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${at}`);
  assert.equal(sent(2025, 10, 5, 9, 5), `${local(2025, 10, 5).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${at}`, 'another year names it');
});

test('new year\'s eve reads as yesterday on new year\'s day, with no year on it', () => {
  assert.equal(sentAt(local(2026, 11, 31, 22, 0).toISOString(), local(2027, 0, 1, 8, 0).getTime()), `Yesterday, ${clockOf(local(2026, 11, 31, 22, 0))}`);
});

test('a message with no usable time shows none', () => {
  for (const at of [null, undefined, '', 'not a date']) assert.equal(sentAt(at, NOW), '');
});

test('the next midnight is on the calendar, whatever the day\'s length', () => {
  const now = local(2026, 10, 5, 23, 59, 30).getTime();
  assert.equal(untilMidnight(now), 30_000);
  const at = NOW + untilMidnight(NOW);
  assert.equal(new Date(at).getHours(), 0);
  assert.equal(new Date(at).getDate(), 6);
});

test('the sidebar\'s time still reads as it did', () => {
  assert.equal(when(Date.now() - 1000), 'now');
  assert.equal(when(Date.now() - 5 * 60_000), '5 min');
  assert.equal(when(Date.now() - 2 * 86400_000), new Date(Date.now() - 2 * 86400_000).toLocaleDateString([], { weekday: 'short' }));
  assert.equal(when(Date.now() - 30 * 86400_000), new Date(Date.now() - 30 * 86400_000).toLocaleDateString([], { day: 'numeric', month: 'short' }));
  assert.equal(when(null), '');
});
