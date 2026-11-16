// Run with `npm test`. What the model menu offers and what its button says: the four models and their keys, the effort sub-menu, More
// models from the CLI's list, a row for a model or effort the lists do not hold, the fast mode switch, and the words on the button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonLabel, buttonOf, effortName, MAX_TIP, modelMenu, modelName, takesFast } from '../public/ui/model-rules.js';

const LISTED = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', fast: false },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', fast: false },
  { id: 'claude-opus-5', label: 'Opus 5', fast: true },
  { id: 'claude-fable-5', label: 'Fable 5', fast: false },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', fast: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', fast: false },
];
const picked = [];
const menu = (over = {}) => modelMenu({ model: 'claude-opus-5-5', effort: 'high', fast: false, listed: LISTED, pick: (kind, value) => picked.push([kind, value]), ...over });
const group = (items, name) => items.find(i => i.group === name);
const row = (items, label) => items.find(i => i.label === label);
const labels = items => items.map(i => i.label);
const checked = items => items.filter(i => i.checked).map(i => i.label);
const press = item => { picked.length = 0; item.run?.(); return [...picked]; };
const main = over => group(menu(over), 'Model').items;
const efforts = over => row(menu(over), 'Effort').items;
const more = over => row(menu(over), 'More models').items;

test('the four main models come first in a group named Model with no visible heading, keyed 1 to 4 with the same numbers as hints', () => {
  const items = menu();
  assert.equal(items[0].group, 'Model');
  assert.equal(items[0].heading, false);
  assert.deepEqual(labels(items[0].items), ['Opus 5.5', 'Fable 5.2', 'Sonnet 5.5', 'Haiku 5.5']);
  assert.deepEqual(items[0].items.map(i => i.key), ['1', '2', '3', '4']);
  assert.deepEqual(items[0].items.map(i => i.hint), ['1', '2', '3', '4']);
  assert.deepEqual(items[1], { separator: true });
});

test('the menu runs Model, Effort, More models and then Fast mode, with a separator before each after the first', () => {
  const items = menu();
  assert.deepEqual(items.map(i => i.group || i.label || 'separator'), ['Model', 'separator', 'Effort', 'separator', 'More models', 'separator', 'Fast mode']);
});

test('the model in use is the one checked, and a main model picks its own id unless it is the checked one', () => {
  assert.deepEqual(checked(main()), ['Opus 5.5']);
  assert.deepEqual(checked(main({ model: 'claude-sonnet-5-5' })), ['Sonnet 5.5']);
  assert.deepEqual(main().map(press), [
    [], [['model', 'claude-fable-5-2']], [['model', 'claude-sonnet-5-5']], [['model', 'claude-haiku-5-5']],
  ]);
});

test('no main model is checked when the model in use is another one', () => {
  assert.deepEqual(checked(main({ model: 'claude-opus-4-8' })), []);
  assert.deepEqual(checked(main({ model: null })), []);
});

test('the Effort row names the effort in use, and opens Low, Medium, High, Extra and Max with xhigh named Extra', () => {
  const effort = row(menu(), 'Effort');
  assert.equal(effort.value, 'High');
  assert.equal(effort.warn, false);
  assert.deepEqual(labels(effort.items), ['Low', 'Medium', 'High', 'Extra', 'Max']);
  assert.deepEqual(checked(effort.items), ['High']);
  assert.deepEqual(effort.items.map(press), [[['effort', 'low']], [['effort', 'medium']], [], [['effort', 'xhigh']], [['effort', 'max']]]);
  assert.equal(row(menu({ effort: 'xhigh' }), 'Effort').value, 'Extra');
});

test('Max is the one effort with the warning icon and Desktop\'s tip, and it shows on the Effort row while max is in use', () => {
  assert.deepEqual(efforts().map(i => i.warn), [undefined, undefined, undefined, undefined, true]);
  assert.deepEqual(efforts().map(i => i.tip), [undefined, undefined, undefined, undefined, MAX_TIP]);
  assert.equal(MAX_TIP, 'May use excessive tokens resulting in long response times and may hit token limits. Use sparingly for the hardest tasks.');
  const max = row(menu({ effort: 'max' }), 'Effort');
  assert.deepEqual([max.value, max.warn], ['Max', true]);
  assert.deepEqual(checked(max.items), ['Max']);
});

test('an effort the list does not hold gets its own checked row at the end, with its raw value, and no effort checks nothing', () => {
  const odd = efforts({ effort: 'ludicrous' });
  assert.deepEqual(labels(odd), ['Low', 'Medium', 'High', 'Extra', 'Max', 'ludicrous']);
  assert.deepEqual(checked(odd), ['ludicrous']);
  assert.equal(odd[5].run, undefined, 'the row records nothing the server would refuse');
  assert.equal(row(menu({ effort: 'ludicrous' }), 'Effort').value, 'ludicrous');
  const none = row(menu({ effort: null }), 'Effort');
  assert.equal(none.value, null);
  assert.deepEqual(labels(none.items), ['Low', 'Medium', 'High', 'Extra', 'Max']);
  assert.deepEqual(checked(none.items), []);
});

test('More models is Opus 5.5 (1M) and then the CLI\'s other models in its order, leaving out the four main ones', () => {
  assert.deepEqual(labels(more()), ['Opus 5.5 (1M)', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5', 'Opus 4.8']);
  assert.deepEqual(more().map(press).flat().map(p => p[1]), [
    'claude-opus-5-5[1m]', 'claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-opus-4-8',
  ]);
  assert.deepEqual(checked(more()), [], 'a main model is checked in the main group, not here');
});

test('a model in More models is checked there, and so is the 1M one', () => {
  assert.deepEqual(checked(more({ model: 'claude-opus-4-8' })), ['Opus 4.8']);
  assert.deepEqual(checked(more({ model: 'claude-opus-5-5[1m]' })), ['Opus 5.5 (1M)']);
  assert.deepEqual(checked(main({ model: 'claude-opus-5-5[1m]' })), [], 'the 1M model is not the plain one');
  assert.deepEqual(labels(more({ model: 'claude-opus-4-8' })), labels(more()), 'a listed model gets no second row');
});

test('a model the lists do not hold gets its own checked row at the end of More models, named by modelLabel, and picks nothing', () => {
  const odd = more({ model: 'claude-opus-4-1' });
  assert.deepEqual(labels(odd), ['Opus 5.5 (1M)', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5', 'Opus 4.8', 'Opus 4.1']);
  assert.deepEqual(checked(odd), ['Opus 4.1']);
  assert.equal(odd.at(-1).run, undefined);
  assert.deepEqual(checked(main({ model: 'claude-opus-4-1' })), []);
});

test('an alias such as opus[1m] is not resolved, so it gets a row of its own and no listed model is checked', () => {
  const alias = more({ model: 'opus[1m]' });
  assert.deepEqual(checked(alias), ['Opus (1M)']);
  assert.equal(alias.length, 7);
  assert.deepEqual(checked(main({ model: 'opus[1m]' })), []);
  assert.deepEqual(checked(more({ model: 'default' })), ['default']);
});

test('the row for a model the lists do not hold comes before the Loading or error row', () => {
  assert.deepEqual(labels(more({ model: 'claude-opus-4-1', listed: null })), ['Opus 5.5 (1M)', 'Opus 4.1', 'Loading models']);
  assert.deepEqual(labels(more({ model: 'claude-opus-4-1', listed: null, error: 'No models came back.' })), ['Opus 5.5 (1M)', 'Opus 4.1', 'No models came back.']);
});

test('a row\'s id is its kind and value, and stays the same when the CLI\'s list arrives, so the menu keeps the focus on that row', () => {
  const ids = items => items.map(i => i.id);
  assert.deepEqual(ids(main()), ['model:claude-opus-5-5', 'model:claude-fable-5-2', 'model:claude-sonnet-5-5', 'model:claude-haiku-5-5']);
  assert.deepEqual(ids(efforts()), ['effort:low', 'effort:medium', 'effort:high', 'effort:xhigh', 'effort:max']);
  for (const model of ['opus[1m]', 'claude-opus-4-8']) {
    const before = more({ model, listed: null }).find(i => i.checked);
    const after = more({ model }).find(i => i.checked);
    assert.equal(before.id, `model:${model}`, model);
    assert.equal(after.id, before.id, `${model}: the same row, though it moved`);
  }
  assert.equal(more({ model: 'claude-opus-4-1' }).at(-1).id, 'model:claude-opus-4-1');
  assert.equal(efforts({ effort: 'ludicrous' }).at(-1).id, 'effort:ludicrous');
});

test('while the CLI\'s models load, More models shows Opus 5.5 (1M) and a disabled Loading models row', () => {
  const loading = more({ listed: null });
  assert.deepEqual(labels(loading), ['Opus 5.5 (1M)', 'Loading models']);
  assert.equal(loading[1].disabled, true);
  assert.equal(loading[1].run, undefined);
  assert.equal(labels(more()).includes('Loading models'), false);
});

test('when the CLI\'s models cannot be loaded, More models shows the error in a disabled row and Opus 5.5 (1M) still works', () => {
  const failed = more({ listed: null, error: 'Claude did not answer in time.' });
  assert.deepEqual(labels(failed), ['Opus 5.5 (1M)', 'Claude did not answer in time.']);
  assert.equal(failed[1].disabled, true);
  assert.deepEqual(press(failed[0]), [['model', 'claude-opus-5-5[1m]']]);
});

test('an empty list from the CLI leaves only Opus 5.5 (1M)', () => {
  assert.deepEqual(labels(more({ listed: [] })), ['Opus 5.5 (1M)']);
});

test('the fast mode switch shows for a model that takes it, off or on, and a press asks for the other', () => {
  const [, fast] = menu().slice(-2);
  assert.equal(fast.group, 'Fast mode');
  assert.notEqual(fast.heading, false, 'its heading shows');
  assert.equal(fast.items.length, 1);
  assert.equal(fast.items[0].label, 'Enable fast mode');
  assert.equal(fast.items[0].switch, false);
  assert.deepEqual(press(fast.items[0]), [['fast', true]]);
  const on = group(menu({ fast: true }), 'Fast mode').items[0];
  assert.equal(on.switch, true);
  assert.deepEqual(press(on), [['fast', false]]);
  assert.equal(on.checked, undefined, 'a switch is a checkbox item, not a radio item');
});

test('the fast mode section is left out for a model that cannot take it', () => {
  assert.equal(group(menu({ model: 'claude-fable-5-2' }), 'Fast mode'), undefined);
  assert.equal(group(menu({ model: 'claude-haiku-4-5-20251001' }), 'Fast mode'), undefined);
  assert.equal(group(menu({ model: null }), 'Fast mode'), undefined);
  assert.deepEqual(menu({ model: 'claude-fable-5-2' }).at(-1).label, 'More models', 'no separator is left hanging at the end');
});

test('the fast mode section shows for a listed model whose flag is set', () => {
  assert.ok(group(menu({ model: 'claude-opus-4-8' }), 'Fast mode'));
  assert.ok(group(menu({ model: 'claude-opus-5' }), 'Fast mode'));
});

test('before the CLI\'s list arrives only Opus 5.5 is known to take fast mode, and the 1M one counts as it', () => {
  assert.ok(group(menu({ listed: null }), 'Fast mode'));
  assert.ok(group(menu({ listed: null, model: 'claude-opus-5-5[1m]' }), 'Fast mode'));
  assert.equal(group(menu({ listed: null, model: 'claude-opus-4-8' }), 'Fast mode'), undefined);
  assert.equal(group(menu({ listed: null, model: 'claude-sonnet-5-5' }), 'Fast mode'), undefined);
});

test('once the CLI\'s list holds a model its flag decides, even for Opus 5.5', () => {
  const none = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', fast: false }];
  assert.equal(group(menu({ listed: none }), 'Fast mode'), undefined);
  assert.ok(group(menu({ listed: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', fast: true }] }), 'Fast mode'));
});

test('takesFast strips a trailing [1m] before it asks the list, and a model the list lacks falls back to what is known', () => {
  assert.equal(takesFast('claude-opus-4-8[1m]', LISTED), true);
  assert.equal(takesFast('claude-opus-4-8[1M]', LISTED), true);
  assert.equal(takesFast('claude-fable-5[1m]', LISTED), false);
  assert.equal(takesFast('claude-opus-5-5', LISTED), true);
  assert.equal(takesFast('claude-opus-5-5', null), true);
  assert.equal(takesFast('claude-opus-5-5', [{ id: 'claude-opus-5-5', label: 'Opus 5.5', fast: false }]), false, 'the list decides once it holds the model');
  assert.equal(takesFast('claude-opus-4-8', null), false);
  assert.equal(takesFast('opus', LISTED), false, 'an alias is not resolved');
  assert.equal(takesFast('', LISTED), false);
  assert.equal(takesFast(null, null), false);
});

test('modelName gives Desktop\'s name for the main models, the CLI\'s for a listed one and modelLabel\'s for any other', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(modelName('claude-fable-5-1'), 'Fable 5.1', 'a chat started on the old Fable keeps its name');
  assert.equal(modelName('claude-opus-5-5[1m]'), 'Opus 5.5 (1M)');
  assert.equal(modelName('claude-opus-4-8', LISTED), 'Opus 4.8');
  assert.equal(modelName('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(modelName('claude-haiku-4-5-20251001', [{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (CLI)', fast: false }]), 'Haiku 4.5 (CLI)');
  assert.equal(modelName('opus[1m]'), 'Opus (1M)');
  assert.equal(modelName('some-other-model'), 'some-other-model');
  assert.equal(modelName(null), '');
});

test('effortName gives Desktop\'s name for an effort, the raw value for any other and nothing for none', () => {
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map(effortName), ['Low', 'Medium', 'High', 'Extra', 'Max']);
  assert.equal(effortName('ludicrous'), 'ludicrous');
  assert.equal(effortName(null), '');
  assert.equal(effortName(undefined), '');
});

test('the button shows the model, Fast when it is on and the model takes it, the effort, and whether it is max', () => {
  assert.deepEqual(buttonOf({ model: 'claude-opus-5-5', effort: 'high', fast: true, listed: null }), { model: 'Opus 5.5', fast: true, effort: 'High', max: false });
  assert.deepEqual(buttonOf({ model: 'claude-opus-5-5', effort: 'max', fast: false, listed: LISTED }), { model: 'Opus 5.5', fast: false, effort: 'Max', max: true });
  assert.deepEqual(buttonOf({ model: 'claude-sonnet-5-5', effort: 'xhigh', fast: false, listed: LISTED }), { model: 'Sonnet 5.5', fast: false, effort: 'Extra', max: false });
});

test('the button leaves Fast out when the model cannot take it, so a recorded fast mode never shows against it', () => {
  assert.equal(buttonOf({ model: 'claude-fable-5-2', effort: 'high', fast: true, listed: LISTED }).fast, false);
  assert.equal(buttonOf({ model: 'claude-opus-4-8', effort: 'high', fast: true, listed: null }).fast, false);
  assert.equal(buttonOf({ model: 'claude-opus-4-8', effort: 'high', fast: true, listed: LISTED }).fast, true);
  assert.equal(buttonOf({ model: 'claude-opus-5-5[1m]', effort: 'high', fast: true, listed: null }).fast, true);
  assert.equal(buttonOf({ model: null, effort: 'high', fast: true, listed: null }).fast, false);
});

test('the button shows the same truth as the menu for a model or effort the lists do not hold', () => {
  assert.deepEqual(buttonOf({ model: 'opus[1m]', effort: 'ludicrous', fast: false, listed: LISTED }), { model: 'Opus (1M)', fast: false, effort: 'ludicrous', max: false });
  assert.deepEqual(buttonOf({ model: 'claude-opus-4-1', effort: null, fast: false, listed: LISTED }), { model: 'Opus 4.1', fast: false, effort: null, max: false });
});

test('with no model the button has no model or effort to show', () => {
  assert.deepEqual(buttonOf({ model: null, effort: null, fast: false, listed: null }), { model: null, fast: false, effort: null, max: false });
  assert.deepEqual(buttonOf({ model: '', effort: undefined, fast: undefined, listed: undefined }), { model: null, fast: false, effort: null, max: false });
});

test('the button\'s name for assistive technology begins with the words it shows', () => {
  assert.equal(buttonLabel({ model: 'Opus 5.5', fast: true, effort: 'Max' }), 'Opus 5.5 Fast, Max effort');
  assert.equal(buttonLabel({ model: 'Opus 5.5', fast: false, effort: 'High' }), 'Opus 5.5, High effort');
  assert.equal(buttonLabel({ model: 'Sonnet 5.5', fast: false, effort: null }), 'Sonnet 5.5');
  assert.equal(buttonLabel({ model: null, fast: false, effort: null }), 'Model');
  assert.equal(buttonLabel(buttonOf({ model: 'claude-opus-5-5', effort: 'max', fast: true, listed: null })), 'Opus 5.5 Fast, Max effort');
});
