// Run with `npm test`. Capcom's own tools are answered by a plain function, so the list the CLI is given and what each call returns
// are checked here without a server. The widget guide is a file the model reads, so it is held to what the frame does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EFFORTS, GROUP_READ_NAMES, GROUP_START_NAME, handleMcp, makeChips, TOOL_NAMES } from '../lib/tools.mjs';
import {
  ACTIVE_MS, CDNS, HEIGHT_MAX, LINK_MAX, parseGlyphs, PROMPT_MAX,
} from '../public/ui/widget-frame.js';
import { hostCss, tokenCss } from '../public/ui/widget-theme.js';
import { guideFor } from '../lib/groups.mjs';

const GUIDE_URL = new URL('../lib/widget-guide.md', import.meta.url);
const guide = fs.readFileSync(GUIDE_URL, 'utf8');

const call = (method, params) => handleMcp({ jsonrpc: '2.0', id: 7, method, params }, {});
const listed = () => Object.fromEntries(call('tools/list').result.tools.map(t => [t.name, t]));

// `--{bg,text}-{a,b}` stands for the four names it spells out.
function expand(name) {
  const open = name.indexOf('{');
  if (open < 0) return [name];
  const close = name.indexOf('}', open);
  const [head, tail] = [name.slice(0, open), name.slice(close + 1)];
  return name.slice(open + 1, close).split(',').flatMap(part => expand(head + part + tail));
}

const section = heading => new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(guide)?.[1] ?? '';
const declared = new Set([...tokenCss().matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));

test('the list the CLI is given has a guide tool that takes no input', () => {
  const guideTool = listed().widget_guide;
  assert.ok(guideTool, 'widget_guide is not listed');
  assert.deepEqual(guideTool.inputSchema.properties, {});
  assert.ok(!guideTool.inputSchema.required?.length, 'widget_guide asks for an input');
  assert.match(guideTool.description, /once per chat/);
});

test('the widget tool takes loading messages first and still needs only a title and the code', () => {
  const { inputSchema, description } = listed().show_widget;
  assert.deepEqual(Object.keys(inputSchema.properties), ['loading_messages', 'title', 'widget_code']);
  assert.deepEqual(inputSchema.required, ['title', 'widget_code']);
  assert.equal(inputSchema.properties.loading_messages.type, 'array');
  assert.equal(inputSchema.properties.loading_messages.items.type, 'string');
  assert.match(inputSchema.properties.loading_messages.description, /a few words/);
  assert.match(description, /widget_guide/, 'the description does not send the model to the guide');
  assert.ok(description.length < 400, 'the description is sent with every request, so it stays short');
});

test('the tools Capcom serves are all allowed without asking, the guide included', () => {
  assert.ok(TOOL_NAMES.includes('mcp__capcom__widget_guide'));
  assert.deepEqual(TOOL_NAMES, Object.keys(listed()).map(name => `mcp__capcom__${name}`));
});

test('the guide and every description call the app GhostShell, and the guide says once that its tools come from the capcom server', () => {
  const texts = [guide, ...Object.values(listed()).map(t => t.description)];
  for (const text of texts) assert.doesNotMatch(text, /Capcom/);
  assert.equal(texts.join('\n').split("GhostShell's tools come from the `capcom` MCP server").length - 1, 1);
});

test('asking for the guide returns its text as the tool result', () => {
  const { result } = call('tools/call', { name: 'widget_guide', arguments: {} });
  assert.deepEqual(result, { content: [{ type: 'text', text: guide }] });
  assert.ok(guide.length > 1000);
});

test('a guide that is missing from the install is an error result the model can read, not a crash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-tools-'));
  try {
    // The code without its guides, in the same layout, since tools.mjs imports the modules beside it and above.
    fs.cpSync(new URL('../lib/', import.meta.url), path.join(dir, 'lib'), { recursive: true, filter: file => !file.endsWith('.md') });
    fs.cpSync(new URL('../public/ui/', import.meta.url), path.join(dir, 'public', 'ui'), { recursive: true });
    const copy = await import(pathToFileURL(path.join(dir, 'lib', 'tools.mjs')).href);
    const { result } = copy.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'widget_guide', arguments: {} } }, {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /could not be read \(ENOENT\)/);
    assert.ok(!result.content[0].text.includes(dir), 'the folder it looked in is not handed to the model');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the other tools answer as before', () => {
  assert.equal(call('tools/call', { name: 'show_widget', arguments: { title: 'x', widget_code: '<p></p>' } }).result.content[0].text, 'The widget is showing in the chat.');
  assert.equal(call('tools/call', { name: 'mark_chapter', arguments: { title: 'x' } }).result.content[0].text, 'Chapter marked.');
  assert.equal(call('tools/call', { name: 'nothing_here', arguments: {} }).result.isError, true);
  assert.equal(call('tools/call', { name: 'nothing_here', arguments: {} }).result.content[0].text, 'GhostShell has no tool called nothing_here.');
});

test('chips map each session a chip started to the session that made it, and leave out a chip that is open, dismissed, or missing either session', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-chips-'));
  try {
    const chips = makeChips(dir);
    assert.deepEqual([...chips.links()], []);
    chips.put({ toolUseId: 'open', sessionId: 'maker', startedId: 'a', status: 'open' });
    chips.put({ toolUseId: 'dismissed', sessionId: 'maker', startedId: 'b', status: 'dismissed' });
    chips.put({ toolUseId: 'unstarted', sessionId: 'maker', status: 'started' });
    chips.put({ toolUseId: 'unowned', startedId: 'd', status: 'started' });
    assert.deepEqual([...chips.links()], [], 'none of these makes a link');
    chips.put({ toolUseId: 'open', status: 'started' });
    chips.put({ toolUseId: 'second', sessionId: 'other', startedId: 'e', status: 'started' });
    assert.deepEqual([...chips.links()], [['a', 'maker'], ['e', 'other']]);
    assert.deepEqual([...makeChips(dir).links()], [['a', 'maker'], ['e', 'other']], 'a restart reads them from chips.json');
    assert.deepEqual(fs.readdirSync(dir), ['chips.json']);
    assert.deepEqual([...chips.titles()], [], 'a chip with no title names nothing');
    chips.put({ toolUseId: 'open', title: 'Review - dialogs' });
    chips.put({ toolUseId: 'second', title: '  ' });
    chips.put({ toolUseId: 'dismissed', title: 'Dismissed one' });
    assert.deepEqual([...chips.titles()], [['a', 'Review - dialogs']], 'the title of each started chip, by the session it started');
    assert.deepEqual([...makeChips(dir).titles()], [['a', 'Review - dialogs']]);

    const written = [];
    const write = fs.writeFileSync;
    t.mock.method(fs, 'writeFileSync', (file, ...rest) => { written.push(file); return write(file, ...rest); });
    chips.put({ toolUseId: 'third', sessionId: 'maker', startedId: 'f', status: 'started' });
    assert.equal(written.length, 1);
    assert.ok(written.every(file => file !== path.join(dir, 'chips.json')), 'a save is written beside the file and renamed into place, so a cut-off write cannot leave it unreadable');
    assert.deepEqual(fs.readdirSync(dir), ['chips.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the guide names every host a widget can load from, and Google Fonts', () => {
  for (const cdn of CDNS) assert.ok(guide.includes(new URL(cdn).host), `the guide leaves out ${cdn}`);
  assert.ok(guide.includes('fonts.googleapis.com') && guide.includes('fonts.gstatic.com'));
});

test('every variable the guide offers is one the host defines, and the guide offers every one the host defines', () => {
  const offered = [...section('Variables').matchAll(/`(--[^`]+)`/g)].flatMap(m => expand(m[1]));
  assert.ok(offered.length > 150, `only ${offered.length} names were read from the guide`);
  assert.deepEqual(offered.filter(name => !declared.has(name)), [], 'the guide offers a name the host does not define');
  assert.deepEqual([...declared].filter(name => !offered.includes(name)), [], 'the host defines a name the guide does not offer');
});

test('a variable used without a fallback anywhere in the guide is defined, and the one example name that is not defined has a fallback', () => {
  const bare = [...guide.matchAll(/var\((--[a-z0-9-]+)\)|['"](--[a-z0-9-]+)['"]/g)].map(m => m[1] ?? m[2]);
  assert.ok(bare.length >= 5, `only ${bare.length} uses were read from the guide`);
  assert.deepEqual(bare.filter(name => !declared.has(name)), []);
  const fallbacks = [...guide.matchAll(/var\((--[a-z0-9-]+)\s*,/g)].map(m => m[1]);
  assert.ok(fallbacks.length > 0 && fallbacks.every(name => !declared.has(name)), 'the fallback example should show a name the host does not define');
});

test('every class and icon the guide tells a widget to use is one the host styles define', () => {
  const css = hostCss();
  const ramps = ['purple', 'teal', 'coral', 'pink', 'gray', 'blue', 'green', 'amber', 'red'].map(name => `c-${name}`);
  for (const name of ['sr-only', 'ti', 't', 'ts', 'th', 'box', 'arr', 'leader', 'node', ...ramps]) {
    assert.match(css, new RegExp(`\\.${name}(?![\\w-])`), `the host styles do not define .${name}`);
    assert.match(guide, new RegExp(`(?:\`|class="[^"]*\\b)${name}(?![\\w-])`), `the guide does not mention ${name}`);
  }
  const glyphs = parseGlyphs(fs.readFileSync(new URL('../public/vendor/tabler-icons.min.css', import.meta.url), 'utf8'));
  const icons = [...guide.matchAll(/\bti-([a-z0-9][a-z0-9-]*)/g)].map(m => m[1]);
  assert.ok(icons.length > 0);
  assert.deepEqual(icons.filter(name => !(name in glyphs)), [], 'the guide shows an icon the vendored font does not have');
});

test('the limits the guide states are the ones the frame enforces', () => {
  assert.ok(guide.includes(`up to ${HEIGHT_MAX} px`) && guide.includes(`Past that the content scrolls`));
  assert.ok(guide.includes(`text over ${PROMPT_MAX} characters`));
  assert.equal(ACTIVE_MS, 5000);
  assert.ok(guide.includes('within five seconds of a send'));
  assert.ok(guide.includes(`at most ${LINK_MAX} characters`));
});

test('the guide holds no em dash or en dash', () => {
  assert.doesNotMatch(guide, /[\u2013\u2014]/);
});

const GROUP_TOOLS = ['list_group_sessions', 'read_group_session', 'start_group_session'];
const inGroup = (method, params, group) => handleMcp({ jsonrpc: '2.0', id: 7, method, params }, { group, cwd: '/tmp/group', chips: null });
const asked = (name, args, group) => inGroup('tools/call', { name, arguments: args }, group);

test('the group tools are listed to a group\'s chat alone, and no tool the other chats are given changes', () => {
  const names = reply => reply.result.tools.map(t => t.name);
  assert.deepEqual(names(call('tools/list')).filter(n => GROUP_TOOLS.includes(n)), []);
  assert.deepEqual(names(inGroup('tools/list', {}, {})).filter(n => GROUP_TOOLS.includes(n)), GROUP_TOOLS);
  assert.deepEqual(names(inGroup('tools/list', {}, {})).filter(n => !GROUP_TOOLS.includes(n)), names(call('tools/list')));
  for (const tool of inGroup('tools/list', {}, {}).result.tools) assert.ok(tool.description.length < 420, `${tool.name} is sent with every request, so its description stays short`);
});

test('only the two group tools that read are allowed without asking, and the one that starts a session is left to ask', () => {
  assert.deepEqual(GROUP_READ_NAMES, ['mcp__capcom__list_group_sessions', 'mcp__capcom__read_group_session']);
  assert.equal(GROUP_START_NAME, 'mcp__capcom__start_group_session');
  for (const name of [...GROUP_READ_NAMES, GROUP_START_NAME]) assert.ok(!TOOL_NAMES.includes(name), `${name} would be allowed in every chat`);
});

test('a chat that is no group\'s is told the group tools do not exist, and is handed nothing from a group', () => {
  for (const name of GROUP_TOOLS) {
    const { result } = call('tools/call', { name, arguments: { cwd: '/tmp', prompt: 'x', session_id: 'x' } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, `GhostShell has no tool called ${name}.`);
  }
});

test('a group\'s chat is made to name the folder of a chip, since it has no folder of its own to start one in', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-tools-chip-'));
  const work = path.join(base, 'work');
  const stateDir = path.join(base, 'state');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(stateDir, 'groups', 'cg-a'), { recursive: true });
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const spawn = inGroup('tools/list', {}, {}).result.tools.find(t => t.name === 'spawn_task');
  assert.deepEqual(spawn.inputSchema.required, ['title', 'prompt', 'cwd']);
  assert.deepEqual(call('tools/list').result.tools.find(t => t.name === 'spawn_task').inputSchema.required, ['title', 'prompt']);
  const spawnIn = (arguments_, ctx) => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', ...arguments_ } } }, { chips, cwd: '/tmp/group', ...ctx });
  const refused = spawnIn({}, { group: { stateDir } });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /needs a cwd/);
  const named = spawnIn({ cwd: work }, { group: { stateDir } });
  assert.equal(named.result.isError, undefined);
  assert.equal(made.length, 1);
  const other = spawnIn({}, {});
  assert.equal(other.result.isError, undefined, 'any other chat still starts a chip in its own folder');
  assert.equal(made.length, 2);
});

test('a chip from a group\'s chat is refused for a folder that is missing, relative or Capcom\'s own, and is made for none of them', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-tools-chip-'));
  const stateDir = path.join(base, 'state');
  fs.mkdirSync(path.join(stateDir, 'groups', 'cg-a'), { recursive: true });
  const link = path.join(base, 'link');
  fs.symlinkSync(stateDir, link);
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const reasons = [
    ['relative/dir', /absolute folder/],
    [path.join(base, 'missing'), /does not exist/],
    [stateDir, /belongs to GhostShell/],
    [path.join(stateDir, 'groups', 'cg-a'), /belongs to GhostShell/],
    [link, /belongs to GhostShell/],
    [`${stateDir}/../state/groups`, /belongs to GhostShell/],
  ];
  for (const [cwd, why] of reasons) {
    const { result } = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', cwd } } }, { group: { stateDir }, chips, cwd: '/tmp/group' });
    assert.equal(result.isError, true, cwd);
    assert.match(result.content[0].text, why, cwd);
  }
  assert.deepEqual(made, []);
});

test('spawn_task offers an optional effort level in the ordinary and the group schema', () => {
  const ordinary = call('tools/list').result.tools.find(t => t.name === 'spawn_task').inputSchema;
  const group = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { group: { stateDir: '/tmp/state' } }).result.tools.find(t => t.name === 'spawn_task').inputSchema;
  for (const schema of [ordinary, group]) {
    assert.deepEqual(schema.properties.effort.enum, EFFORTS);
    assert.equal(schema.required.includes('effort'), false);
  }
});

test('a chip keeps the effort level it names, and one with none is stored without the key', () => {
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const spawn = args => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', ...args } } }, { chips, cwd: '/tmp/work' }).result;
  assert.equal(spawn({ effort: 'xhigh' }).isError, undefined);
  assert.equal(made[0].effort, 'xhigh');
  assert.equal(spawn({}).isError, undefined);
  assert.equal(Object.hasOwn(made[1], 'effort'), false);
  const refused = spawn({ effort: 'extreme' });
  assert.equal(refused.isError, true);
  for (const level of EFFORTS) assert.match(refused.content[0].text, new RegExp(level));
  assert.equal(made.length, 2, 'an unknown level makes no chip');
});

test('spawn_task offers an optional model in the ordinary and the group schema, free of an enum', () => {
  const ordinary = call('tools/list').result.tools.find(t => t.name === 'spawn_task').inputSchema;
  const group = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { group: { stateDir: '/tmp/state' } }).result.tools.find(t => t.name === 'spawn_task').inputSchema;
  for (const schema of [ordinary, group]) {
    assert.equal(schema.properties.model.type, 'string');
    assert.equal(Object.hasOwn(schema.properties.model, 'enum'), false);
    assert.equal(schema.required.includes('model'), false);
  }
});

test('a chip keeps the model it names, one with none is stored without the key, and a model that is not a model id makes no chip', () => {
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const spawn = args => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', ...args } } }, { chips, cwd: '/tmp/work' }).result;
  assert.equal(spawn({ model: 'claude-sonnet-5-5' }).isError, undefined);
  assert.equal(made[0].model, 'claude-sonnet-5-5');
  assert.equal(spawn({}).isError, undefined);
  assert.equal(Object.hasOwn(made[1], 'model'), false);
  for (const model of ['bad model!', ['sonnet'], { id: 'sonnet' }, 5]) {
    const refused = spawn({ model });
    assert.equal(refused.isError, true, JSON.stringify(model));
    assert.match(refused.content[0].text, /claude-sonnet-5-5/);
  }
  assert.equal(made.length, 2, 'a bad model makes no chip');
});

test('spawn_task offers an optional group in the ordinary and the group schema', () => {
  const ordinary = call('tools/list').result.tools.find(t => t.name === 'spawn_task').inputSchema;
  const group = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { group: { stateDir: '/tmp/state' } }).result.tools.find(t => t.name === 'spawn_task').inputSchema;
  for (const schema of [ordinary, group]) {
    assert.equal(schema.properties.group.type, 'string');
    assert.equal(schema.required.includes('group'), false);
  }
});

test('a chip stores the id of the group it names, matched by name without regard to case or spacing, and says the group\'s name', () => {
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const groups = () => [{ id: 'cg-progress', name: 'In Progress' }, { id: 'cg-review', name: 'Reviewing' }];
  const spawn = args => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', ...args } } }, { chips, groups, cwd: '/tmp/work' }).result;
  for (const named of ['Reviewing', 'reviewing', '  REVIEWING ']) {
    const reply = spawn({ group: named });
    assert.equal(reply.isError, undefined, named);
    assert.match(reply.content[0].text, /to open in the group "Reviewing"/);
  }
  assert.deepEqual(made.map(c => c.group), ['cg-review', 'cg-review', 'cg-review']);
  assert.equal(Object.hasOwn(made.at(-1), 'groupName'), false, 'the id is stored, never the name');
  assert.equal(spawn({}).isError, undefined);
  assert.equal(spawn({ group: '  ' }).isError, undefined, 'a blank group is no group');
  assert.equal(Object.hasOwn(made[3], 'group'), false);
  assert.equal(Object.hasOwn(made[4], 'group'), false);
});

test('a chip that names an unknown group is refused with the groups listed and nothing stored, and so is one that names a name two groups share', () => {
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const list = [{ id: 'a', name: 'Work' }, { id: 'b', name: 'Reviewing' }, { id: 'c', name: 'work' }];
  const spawn = (args, groups = () => list) => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', ...args } } }, { chips, groups, cwd: '/tmp/work' }).result;
  const unknown = spawn({ group: 'Done' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /no group called "Done"\. The groups are "Work", "Reviewing", "work"\./);
  const ambiguous = spawn({ group: 'WORK' });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /matches 2 groups/);
  assert.match(spawn({ group: 'Done' }, () => []).content[0].text, /There are no groups\./);
  assert.match(handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', group: 'Done' } } }, { chips, cwd: '/tmp/work' }).result.content[0].text, /There are no groups\./, 'a chat with no lookup knows none');
  assert.equal(spawn({ group: ['Work'] }).isError, true);
  assert.deepEqual(made, []);
});

test('a null group is no group, and a section that cannot hold a session refuses a chip before it looks at the group', () => {
  const made = [];
  const chips = { put: chip => { made.push(chip); return chip; } };
  const spawn = (args, ctx = {}) => handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spawn_task', arguments: { title: 't', prompt: 'p', ...args } } }, { chips, groups: () => [], cwd: '/tmp/work', ...ctx }).result;
  assert.equal(spawn({ group: null }).isError, undefined);
  assert.equal(Object.hasOwn(made[0], 'group'), false);
  const refused = spawn({ group: 'Nowhere', cwd: '/tmp/work' }, { group: { stateDir: '/tmp/state', section: { id: 'ungrouped', name: 'Ungrouped', place: null } } });
  assert.equal(refused.isError, true);
  assert.doesNotMatch(refused.content[0].text, /no group called/);
});

test('in a group\'s chat the group field does not promise to nest', () => {
  const schema = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { group: { stateDir: '/tmp/state' } }).result.tools.find(t => t.name === 'spawn_task').inputSchema;
  assert.doesNotMatch(schema.properties.group.description, /nest/);
});

test('a group tool that throws something unexpected tells the model a bare failure, and one that refuses tells it why', async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const broke = asked('list_group_sessions', {}, { lookup() { throw Object.assign(new Error('/secret/path exploded'), { code: 'EBROKEN' }); } });
    assert.deepEqual(broke.result, { content: [{ type: 'text', text: 'list_group_sessions could not finish (EBROKEN).' }], isError: true });
    const gone = asked('list_group_sessions', {}, { lookup: () => null });
    assert.deepEqual(gone.result, { content: [{ type: 'text', text: 'This group no longer exists.' }], isError: true });
    const late = await asked('start_group_session', { cwd: '/tmp', prompt: 'x' }, { lookup: () => null });
    assert.equal(late.result.content[0].text, 'This group no longer exists.');
  } finally {
    console.error = quiet;
  }
});

test('the group guide names every group tool and the rules the owner set, fills in the group\'s name, and holds no em dash or en dash', () => {
  const text = fs.readFileSync(new URL('../lib/group-guide.md', import.meta.url), 'utf8');
  for (const name of GROUP_TOOLS) assert.ok(text.includes(name), name);
  assert.doesNotMatch(text, /[\u2013\u2014]/);
  assert.match(text, /only when the owner asks/);
  assert.match(text, /never permission/);
  assert.match(text, /Bash or Monitor, editing or writing a file, messaging another session and starting a session each show the owner a card/);
  assert.equal(guideFor('Work $& {{group}}').includes('Work $& {{group}}'), true, 'a name is put in as it is');
  assert.doesNotMatch(guideFor('Work'), /\{\{group\}\}/);
});

test('a group\'s guide says the owner can rename it and that the name list_group_sessions opens with wins, and a section\'s guide says neither', () => {
  assert.match(guideFor('Work'), /^The owner can rename this group, so the name in this prompt may be out of date\. The name list_group_sessions opens with is current, and wins over it\.$/m);
  for (const id of ['pinned', 'routines', 'started']) assert.doesNotMatch(guideFor('x', id), /can rename this group|\[group\]/, id);
});
