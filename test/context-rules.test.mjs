// Run with `npm test`. What the context meter says about a figure from the server, and which figure it keeps when a reply comes in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFigure, mergeContext, parts, planLabel, planReset, planRows, readout } from '../public/ui/context-rules.js';

const figure = (over = {}) => ({ source: 'process', total: 47_760, window: 300_000, autoCompactAt: 267_000, model: 'claude-haiku-5-5', ...over });
const full = (over = {}) => figure({
  categories: [{ id: 'messages', name: 'Messages', tokens: 30_000 }, { id: 'system_prompt', name: 'System prompt', tokens: 14_300 }, { id: 'skills', name: 'Skills', tokens: 500 }],
  buffer: { name: 'Autocompact buffer', tokens: 33_000 },
  free: { name: 'Free space', tokens: 219_240 },
  ...over,
});

test('a count in a window of known size reads as a percentage in the tooltip, the label, the bar and the line under it, and the ring stands alone on the button', () => {
  const r = readout(figure());
  assert.deepEqual([r.pct, r.text, r.size], ['16%', null, '47.8k of 300k tokens']);
  assert.equal(r.tip, 'Context: 47.8k of 300k tokens, 16% used');
  assert.equal(r.label, 'Context: 47,760 of 300,000 tokens, 16% used');
  assert.equal(r.line, '16% used · auto-compact at 89%');
  assert.deepEqual([Math.round(r.fill * 100) / 100, r.tick, r.severity], [15.92, 89, null]);
});

test('with auto-compact off the line says so and the bar has no tick', () => {
  const r = readout(figure({ autoCompactAt: null }));
  assert.equal(r.line, '16% used · auto-compact off');
  assert.equal(r.tick, null);
});

test('a window that is not known leaves the count alone: no ring, no bar and no line, and the button shows the count', () => {
  const r = readout(figure({ source: 'transcript', window: null, autoCompactAt: null }));
  assert.deepEqual([r.pct, r.fill, r.tick, r.line, r.severity], [null, null, null, null, null]);
  assert.deepEqual([r.text, r.size, r.tip, r.label], ['47.8k', '47.8k tokens', 'Context: 47.8k tokens', 'Context: 47.8k tokens']);
});

test('the name of the button contains the words it shows, so a voice command that says them finds it', () => {
  for (const total of [0, 999, 1_000, 47_760, 99_950, 1_200_000]) {
    const r = readout(figure({ source: 'transcript', total, window: null, autoCompactAt: null }));
    assert.ok(r.label.includes(r.text), `${r.text} is in ${r.label}`);
  }
  assert.equal(readout(figure()).text, null, 'with the ring alone there are no words to match');
});

test('a count under half a percent is less than 1%, an empty one is 0%, and a count past the window stops at the end of the bar', () => {
  assert.deepEqual([1_200, 0, 1_500, 299_999, 310_000].map(total => readout(figure({ total })).pct), ['<1%', '0%', '1%', '100%', '100%']);
  assert.equal(readout(figure({ total: 310_000 })).fill, 100);
  assert.equal(readout(figure({ autoCompactAt: 400_000 })).tick, 100);
});

test('the meter turns amber nine tenths of the way to the auto-compact point, and to the end of the window where there is none', () => {
  const at = (total, over) => readout(figure({ total, ...over })).severity;
  assert.deepEqual([240_299, 240_300, 267_000].map(total => at(total)), [null, 'warning', 'warning']);
  assert.deepEqual([269_999, 270_000].map(total => at(total, { autoCompactAt: null })), [null, 'warning']);
  assert.equal(readout(figure({ source: 'transcript', total: 290_000, window: null, autoCompactAt: null })).severity, null, 'a window that is not known has no end to near');
});

test('only a count from the process or the transcript is a figure', () => {
  assert.deepEqual([figure(), figure({ source: 'transcript' })].map(hasFigure), [true, true]);
  assert.deepEqual([null, undefined, {}, { source: 'none' }, { source: 'none', compacted: true }, figure({ total: NaN }), figure({ total: '5' })].map(hasFigure), Array(7).fill(false));
});

test('the table lists the parts as the server sent them, with their share of the window, and then the free space and the buffer', () => {
  const p = parts(full());
  assert.deepEqual(p.used, [
    { key: 'messages', name: 'Messages', size: '30.0k', share: '10.0%' },
    { key: 'system_prompt', name: 'System prompt', size: '14.3k', share: '4.8%' },
    { key: 'skills', name: 'Skills', size: '0.5k', share: '0.2%' },
  ]);
  assert.deepEqual(p.rest, [
    { key: 'Free space', name: 'Free space', size: '219.2k', share: '73.1%' },
    { key: 'Autocompact buffer', name: 'Autocompact buffer', size: '33.0k', share: '11.0%' },
  ]);
});

test('a missing free space or buffer leaves its row out, and no window leaves out the shares', () => {
  const p = parts(full({ buffer: null, window: null }));
  assert.deepEqual(p.rest.map(r => [r.name, r.share]), [['Free space', '']]);
  assert.deepEqual(parts(full({ free: null, buffer: null })).rest, []);
});

test('a reply that is not a figure changes nothing', () => {
  const held = figure();
  for (const reply of [null, undefined, 'x', {}, { items: [], start: 0 }, { source: 7 }, { error: 'No.' }]) assert.equal(mergeContext(held, reply, 'summary'), held);
  assert.equal(mergeContext(null, { items: [] }, 'summary'), null);
});

test('a figure is kept the first time, and a reply that says what is held already returns what is held', () => {
  const first = figure();
  assert.equal(mergeContext(null, first, 'summary'), first);
  assert.equal(mergeContext(first, { ...first }, 'summary'), first);
  const later = { ...first, total: 48_000 };
  assert.equal(mergeContext(first, later, 'summary'), later);
  const transcript = { source: 'transcript', total: 47_760, model: null, at: null, window: null, autoCompactAt: null };
  assert.equal(mergeContext(first, transcript, 'summary'), transcript, 'a transcript figure takes the place of one from the process');
  assert.equal(mergeContext(transcript, { ...transcript }, 'summary'), transcript);
});

test('a summary of the same count keeps the parts of the last full count, and a different total, window or auto-compact point drops them', () => {
  const held = full();
  const kept = mergeContext(held, figure(), 'summary');
  assert.equal(kept, held, 'nothing differs, so the same object comes back');
  for (const over of [{ total: 50_000 }, { window: 1_000_000 }, { autoCompactAt: 800_000 }, { autoCompactAt: null }]) {
    assert.deepEqual(mergeContext(held, figure(over), 'summary'), figure(over), `${JSON.stringify(over)} changes what the parts were counted against`);
  }
});

test('a full count replaces the figure with its parts', () => {
  const summary = figure();
  const counted = full();
  assert.equal(mergeContext(summary, counted, 'full'), counted);
  const recounted = full({ total: 52_000 });
  assert.equal(mergeContext(counted, recounted, 'full'), recounted);
});

test('a full count that came back from the transcript leaves the process figure in place, and a summary that does takes its place', () => {
  const held = figure();
  const transcript = { source: 'transcript', total: 40_000, model: null, at: null, window: null, autoCompactAt: null };
  assert.equal(mergeContext(held, transcript, 'full'), held);
  assert.equal(mergeContext(held, { source: 'none' }, 'full'), held);
  assert.equal(mergeContext(held, transcript, 'summary'), transcript);
  assert.deepEqual(mergeContext(held, { source: 'none', compacted: true }, 'summary'), { source: 'none', compacted: true });
  assert.equal(mergeContext(transcript, { source: 'none' }, 'full').source, 'none', 'with no process figure to keep, the reply stands');
});

// ---- plan usage -------------------------------------------------------------------------------------

const NOW = Date.parse('2026-11-01T10:00:00Z');
const after = ms => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

test('a row is labelled by its kind, and a kind the page does not know by its group and scope', () => {
  assert.equal(planLabel({ kind: 'session', group: 'session', scope: null }), 'Current session');
  assert.equal(planLabel({ kind: 'weekly_all', group: 'weekly', scope: null }), 'Weekly · All models');
  assert.equal(planLabel({ kind: 'weekly_scoped', group: 'weekly', scope: 'Fable' }), 'Weekly · Fable');
  assert.equal(planLabel({ kind: 'weekly_scoped', group: 'weekly', scope: null }), 'Weekly');
  assert.equal(planLabel({ kind: 'monthly_scoped', group: 'monthly', scope: 'Fable' }), 'Monthly · Fable');
  assert.equal(planLabel({ kind: 'extra', group: 'weekly', scope: null }), 'Weekly');
  assert.equal(planLabel({ kind: 'session', group: 'weekly', scope: 'Fable' }), 'Current session', 'the kind decides, and a label from the server would not');
});

test('a reset under a day away is a count down, and a later one is the weekday and the clock', () => {
  assert.equal(planReset(after(3 * HOUR + 20 * MIN), NOW), 'Resets in 3 hr 20 min');
  assert.equal(planReset(after(45 * MIN), NOW), 'Resets in 45 min');
  assert.equal(planReset(after(2 * HOUR), NOW), 'Resets in 2 hr');
  assert.equal(planReset(after(3 * HOUR + 20 * MIN - 1000), NOW), 'Resets in 3 hr 20 min', 'a part of a minute counts as the minute');
  assert.equal(planReset(after(1000), NOW), 'Resets in 1 min');
  assert.equal(planReset(after(23 * HOUR + 59 * MIN), NOW), 'Resets in 23 hr 59 min');
  assert.equal(planReset('2026-11-04T01:59:59.864Z', NOW, 'UTC'), 'Resets Wed 1:59 am');
  assert.equal(planReset('2026-11-04T12:59:00Z', NOW, 'UTC'), 'Resets Wed 12:59 pm');
  assert.equal(planReset('2026-11-04T12:59:00Z', NOW, 'Australia/Brisbane'), 'Resets Wed 10:59 pm', 'the clock is the page\'s zone');
  assert.equal(planReset(after(24 * HOUR), NOW, 'UTC'), 'Resets Mon 10:00 am', 'a whole day away is a weekday');
});

test('a reset that has passed says so, and one that is not a date says nothing', () => {
  assert.equal(planReset(after(-5 * MIN), NOW), 'Resets now');
  assert.equal(planReset('soon', NOW), null);
  assert.equal(planReset(null, NOW), null);
});

test('a row reads as a label, a percent, a reset and the words a meter speaks, and a normal severity is no mark', () => {
  const rows = planRows([
    { kind: 'session', group: 'session', percent: 34, resetsAt: after(2 * HOUR), scope: null, severity: 'normal' },
    { kind: 'weekly_all', group: 'weekly', percent: 71, resetsAt: '2026-11-04T12:59:00Z', scope: null, severity: 'warning' },
    { kind: 'weekly_scoped', group: 'weekly', percent: 99, resetsAt: null, scope: 'Fable', severity: 'critical' },
  ], NOW, 'UTC');
  assert.deepEqual(rows.map(r => [r.label, r.percent, r.severity, r.reset, r.text]), [
    ['Current session', 34, null, 'Resets in 2 hr', '34% used, resets in 2 hr'],
    ['Weekly · All models', 71, 'warning', 'Resets Wed 12:59 pm', '71% used, resets Wed 12:59 pm'],
    ['Weekly · Fable', 99, 'critical', null, '99% used'],
  ]);
  assert.equal(new Set(rows.map(r => r.key)).size, 3);
  assert.deepEqual(planRows(null), []);
});
