// Run with `npm test`. What Capcom builds around a widget and what it decides about a widget's requests is plain strings and
// functions, so it runs here without a browser. The widgets in these tests are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  CDNS, clampHeight, CSP, frameBoot, frameDoc, humanTitle, isCard, linkGate, linkTarget, parseGlyphs, promptGate, viewBoxRatio,
} from '../public/ui/widget-frame.js';
import { CARD_CLASS, hostCss, TOKENS, tokenCss } from '../public/ui/widget-theme.js';

const read = relative => fs.readFileSync(fileURLToPath(new URL(`../public/${relative}`, import.meta.url)), 'utf8');

const directives = Object.fromEntries(CSP.split(';').map(d => d.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));

// ---- the policy -------------------------------------------------------------------------------------------------------------

test('the policy allows nothing by default and opens no directive to a wildcard or to plain http', () => {
  assert.deepEqual(directives['default-src'], ["'none'"]);
  for (const [name, sources] of Object.entries(directives)) {
    assert.ok(!sources.includes('*') && !sources.some(s => s.startsWith('http:')), `${name} is open to everything`);
  }
});

test('a widget may load scripts from the four CDNs and may call out to those four and nowhere else', () => {
  assert.deepEqual(CDNS, ['https://cdnjs.cloudflare.com', 'https://esm.sh', 'https://cdn.jsdelivr.net', 'https://unpkg.com']);
  for (const cdn of CDNS) assert.ok(directives['script-src'].includes(cdn), `script-src lacks ${cdn}`);
  assert.ok(directives['script-src'].includes("'unsafe-inline'") && directives['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(directives['connect-src'], CDNS);
});

test('a widget cannot post a form anywhere or move the base address its links resolve against', () => {
  assert.deepEqual(directives['form-action'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'none'"]);
});

// ---- the document -----------------------------------------------------------------------------------------------------------

test('the root names the colour mode and sets the one colour scheme that matches it', () => {
  for (const mode of ['light', 'dark']) {
    const doc = frameDoc('<p>hi</p>', { mode });
    assert.ok(doc.startsWith(`<!doctype html><html data-mode="${mode}" style="color-scheme:${mode}">`), doc.slice(0, 120));
  }
});

test('a frame built with no mode carries neither attribute, so the colour-scheme media query decides', () => {
  assert.ok(frameDoc('<p>hi</p>').startsWith('<!doctype html><html><head>'));
  assert.ok(frameDoc('<p>hi</p>', { mode: 'sepia' }).startsWith('<!doctype html><html><head>'));
});

test('only an SVG card puts the card class on the body', () => {
  assert.match(frameDoc('<svg></svg>', { mode: 'light', card: true }), new RegExp(`<body class="${CARD_CLASS}"><svg></svg>`));
  assert.match(frameDoc('<div></div>', { mode: 'light' }), /<body><div><\/div>/);
});

test('the widget code sits in the body as it was written, even when it is a whole document', () => {
  const page = '<!doctype html><html><head><style>p{color:red}</style></head><body><p onclick="sendPrompt(\'a & b\')">x</p><script>var n = 1 < 2;</script></body></html>';
  const doc = frameDoc(page, { mode: 'dark' });
  assert.equal(doc.split(page).length, 2);
  assert.ok(doc.indexOf(page) > doc.indexOf('<body'));
});

test('the head holds the policy, then the referrer and DNS prefetch rules, the viewport, the host styles and the boot script, before the widget', () => {
  const code = '<h2>Mark</h2>';
  const doc = frameDoc(code, { mode: 'light' });
  const at = needle => doc.indexOf(needle);
  const order = ['Content-Security-Policy', 'name="referrer" content="no-referrer"', 'http-equiv="x-dns-prefetch-control" content="off"', 'name="viewport"', '<style>', '<script>', '</head>', code];
  assert.deepEqual(order.map(at), order.map(at).toSorted((a, b) => a - b));
  assert.ok(order.every(needle => at(needle) >= 0));
  assert.ok(at('Content-Security-Policy') < at('<style>') && at('Content-Security-Policy') < at('<script>'));
  assert.equal(doc.split('<script>').length, 2);
});

test('the boot script is written into the frame as text, so it cannot close the script tag or open an HTML comment', () => {
  const source = frameBoot.toString();
  assert.ok(!/<\/script/i.test(source) && !source.includes('<!--') && !source.includes('-->'));
  assert.ok(frameDoc('', { mode: 'light' }).includes(`<script>(${source})()</script>`));
});

// ---- the boot script, run against a stand-in window ------------------------------------------------------------------------

// The boot script as `frameDoc` writes it, run in a context of its own. The window has only what the script touches. `fire` calls the
// listeners the script registered, as the browser would, and `posted` is what the script sent up to the page. `page.focusable` is
// whether the page holds anything to focus, and `changed` runs the script's mutation observers.
function boot({ focusable = false } = {}) {
  const clock = { t: 1_000 };
  const listeners = [];
  const posted = [];
  const observers = [];
  const page = { focusable };
  class Element {}
  const window = {
    Element,
    Date: { now: () => clock.t },
    innerHeight: 150,
    ResizeObserver: class { observe() {} },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    // Messages are made in the script's own realm, so they are copied to be compared.
    parent: { postMessage: message => posted.push(JSON.parse(JSON.stringify(message))) },
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    document: {
      readyState: 'complete',
      body: { scrollHeight: 120, getBoundingClientRect: () => ({ height: 100 }) },
      documentElement: { setAttribute() {}, style: {} },
      addEventListener() {},
      querySelector: () => (page.focusable ? new Element() : null),
    },
  };
  window.window = window;
  vm.runInNewContext(`(${frameBoot})()`, window);
  const atBoot = posted.splice(0);
  return {
    window, clock, listeners, posted, atBoot, page,
    fire: (type, event) => listeners.filter(l => l.type === type).forEach(l => l.fn({ isTrusted: true, ...event })),
    changed: () => observers.forEach(fn => fn([])),
  };
}

test('the boot script runs in a bare window and reports at once the height of the page and that it holds nothing to focus', () => {
  assert.deepEqual(boot().atBoot, [{ capcom: 'height', h: 120 }, { capcom: 'tabbable', yes: false }]);
});

test('the frame says whether Tab can reach anything in it, and says it again only when that changes', () => {
  const t = boot({ focusable: true });
  assert.deepEqual(t.atBoot.filter(m => m.capcom === 'tabbable'), [{ capcom: 'tabbable', yes: true }]);
  t.changed();
  assert.deepEqual(t.posted, []);
  t.page.focusable = false;
  t.changed();
  t.changed();
  assert.deepEqual(t.posted, [{ capcom: 'tabbable', yes: false }]);
});

test('sendPrompt and openLink post their text and address up to the page, and window.open posts a link and opens nothing', () => {
  const t = boot();
  t.window.sendPrompt('What changed?');
  t.window.openLink('https://example.com/a');
  assert.equal(t.window.open('https://example.com/b'), null);
  assert.deepEqual(t.posted, [
    { capcom: 'prompt', text: 'What changed?' },
    { capcom: 'link', url: 'https://example.com/a' },
    { capcom: 'link', url: 'https://example.com/b' },
  ]);
});

test('a click, a key press or a finger lifted in the frame is reported to the page, and a mouse button lifted is not', () => {
  for (const [type, event] of [['pointerdown', { pointerType: 'mouse' }], ['pointerdown', { pointerType: 'touch' }], ['pointerup', { pointerType: 'touch' }], ['click', {}], ['keydown', { key: 'a' }]]) {
    const t = boot();
    t.fire(type, event);
    assert.deepEqual(t.posted, [{ capcom: 'acted' }], `${type} ${event.pointerType ?? ''}`);
  }
  const t = boot();
  t.fire('pointerup', { pointerType: 'mouse' });
  assert.deepEqual(t.posted, []);
});

test('an event that a script of the widget made up is not reported', () => {
  const t = boot();
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) t.fire(type, { isTrusted: false, pointerType: 'touch' });
  assert.deepEqual(t.posted, []);
});

test('the frame reports at most once in 250 ms, and a widget that replaces the clock cannot change that', () => {
  const t = boot();
  const press = at => {
    t.clock.t = at;
    t.fire('pointerdown', { pointerType: 'mouse' });
  };
  press(1_000);
  press(1_100);
  press(1_249);
  assert.equal(t.posted.length, 1);
  t.window.Date.now = () => 0;
  press(1_250);
  assert.equal(t.posted.length, 2);
  press(1_300);
  assert.equal(t.posted.length, 2);
});

test('the listeners that report a click and that stop a link are on the window in the capture phase, so none of the widget\'s own comes first', () => {
  const kinds = ['pointerdown', 'pointerup', 'click', 'auxclick', 'keydown'];
  const ours = boot().listeners.filter(l => kinds.includes(l.type));
  assert.deepEqual(new Set(ours.map(l => l.type)), new Set(kinds));
  assert.ok(ours.every(l => l.capture === true));
});

// ---- the host's tokens and styles -------------------------------------------------------------------------------------------

const CONTRACT = [
  '--surface-0', '--surface-1', '--surface-2', '--surface-3', '--surface-panel', '--surface-popover', '--page-bg',
  '--text-primary', '--text-secondary', '--text-muted', '--text-disabled',
  ...['accent', 'danger', 'success', 'warning', 'pro'].flatMap(r => [`--bg-${r}`, `--text-${r}`, `--border-${r}`, `--fill-${r}`, `--fill-${r}-hover`, `--on-${r}`]),
  '--bg-neutral', '--bg-accent-muted', '--bg-highlight',
  ...['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'violet', 'magenta'].flatMap(h => [`--bg-tint-${h}`, `--text-tint-${h}`]),
  '--border', '--border-strong', '--border-stronger',
  '--fill-primary', '--fill-primary-hover', '--on-primary', '--fill-secondary', '--fill-secondary-hover', '--fill-secondary-ring',
  '--fill-ghost-hover', '--fill-ghost-selected', '--fill-field', '--fill-field-ring', '--fill-control', '--fill-control-hover', '--fill-disabled',
  '--fill-brand', '--fill-brand-hover', '--on-brand', '--focus-shadow',
  '--font-sans', '--font-mono', '--font-voice',
  '--font-size-caption', '--font-size-footnote', '--font-size-body', '--font-size-prose', '--font-size-code', '--font-size-heading', '--font-size-title',
  '--radius', '--pad-sm', '--pad-md', '--pad-lg', '--pad-xl', '--gap-xs', '--gap-sm', '--gap-md', '--gap-lg', '--gap-xl', '--h-control',
  '--shadow-color', '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-popover',
  '--dur-fast', '--dur-snap', '--dur-base', '--dur-slow', '--ease-out', '--ease-snap', '--ease-overshoot',
  '--p', '--s', '--t', '--bg2', '--b',
];

const defined = block => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
const blockOf = (css, opener) => css.slice(css.indexOf(opener) + opener.length, css.indexOf('}', css.indexOf(opener)));
const css = tokenCss();
const light = blockOf(css, ':root{');
const dark = blockOf(css, ':root[data-mode="dark"]{');
const fallback = blockOf(css, '@media (prefers-color-scheme:dark){:root:not([data-mode]){');

test('every name in the contract is defined on the root for light', () => {
  const names = defined(light);
  assert.deepEqual(CONTRACT.filter(name => !names.has(name)), []);
});

test('every colour the light set defines is defined again for dark, and dark never defines one light lacks', () => {
  const colours = Object.keys(TOKENS.light);
  assert.deepEqual(Object.keys(TOKENS.dark), colours);
  assert.ok(colours.length > 100);
});

test('the dark values are written under both the data-mode selector and the media query, and are the same text in each', () => {
  assert.ok(dark.length > 1000);
  assert.equal(fallback, dark);
  assert.ok(!light.includes('color-scheme:dark'));
  assert.equal(css.split('{color-scheme:dark;').length, 3);
  for (const [name, value] of Object.entries(TOKENS.dark)) assert.ok(dark.includes(`${name}:${value}`), name);
});

test('the four surfaces get lighter from 0 to 3 in both modes', () => {
  for (const mode of ['light', 'dark']) {
    const lightness = [0, 1, 2, 3].map(n => Number(/^oklch\(([\d.]+)/.exec(TOKENS[mode][`--surface-${n}`])[1]));
    assert.deepEqual(lightness, lightness.toSorted((a, b) => a - b), mode);
    assert.equal(new Set(lightness).size, 4, mode);
  }
});

test('the names a widget reaches for with its own fallback are left undefined, so the fallback is used', () => {
  const everything = hostCss();
  assert.ok(!/--series-/.test(everything));
  assert.ok(!/--border-default/.test(everything));
});

// A selector with its :where() groups taken out, which is all that counts towards specificity.
function withoutWhere(selector) {
  let out = '';
  for (let i = 0; i < selector.length; i++) {
    if (!selector.startsWith(':where(', i)) {
      out += selector[i];
      continue;
    }
    i += ':where'.length;
    for (let depth = 0; i < selector.length; i++) {
      if (selector[i] === '(') depth++;
      if (selector[i] === ')' && --depth === 0) break;
    }
  }
  return out;
}

test('no host rule for a button, a field or a state has any specificity, so a widget rule of any weight beats it', () => {
  const selectors = hostCss().replace(/@media[^{]*\{/g, '').replace(/\{[^{}]*\}/g, '|').split('|').map(s => s.trim()).filter(Boolean);
  const weighty = selectors.map(withoutWhere).filter(r => /\b(button|input|select|textarea)\b/.test(r) || /:(hover|active|focus|focus-visible|disabled)\b/.test(r));
  assert.deepEqual(weighty, []);
  assert.ok(selectors.some(r => r.startsWith(':where(button')));
});

test('the host fills in the box, arrow and leader looks only where the widget has not set that property itself', () => {
  const everything = hostCss();
  for (const [cls, props] of Object.entries({ box: ['fill', 'stroke', 'stroke-width'], arr: ['fill', 'stroke', 'stroke-width'], leader: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray'] })) {
    for (const prop of props) assert.ok(everything.includes(`:where(svg .${cls}:not([${prop}])){${prop}:`), `${cls} ${prop}`);
  }
  for (const cls of ['t', 'ts', 'th']) assert.ok(everything.includes(`:where(svg .${cls}:not([fill])){fill:`), cls);
});

test('an SVG card keeps the width its author gave it and only shrinks to fit, scaling its height with it', () => {
  const css = hostCss();
  assert.ok(css.includes(`body.${CARD_CLASS}>svg{display:block;max-width:100%}`));
  assert.ok(css.includes(`body.${CARD_CLASS}>svg[viewBox]{height:auto}`));
  assert.doesNotMatch(css, new RegExp(`body\\.${CARD_CLASS}>svg[^{]*\\{(?:[^}]*;)?width\\s*:`));
});

test('arrowheads that take their colour from the line get a fallback for a browser that cannot', () => {
  assert.match(hostCss(), /@supports not \(stroke:context-stroke\)\{marker \[stroke="context-stroke"\]\{stroke:[^}]+\}marker \[fill="context-stroke"\]\{fill:[^}]+\}\}/);
});

test('each of the nine colour ramps colours its direct children and itself, and never a path', () => {
  const everything = hostCss();
  const names = ['purple', 'teal', 'coral', 'pink', 'gray', 'blue', 'green', 'amber', 'red'];
  for (const name of names) {
    const rule = new RegExp(`\\.c-${name}>rect,\\.c-${name}>circle,\\.c-${name}>ellipse,rect\\.c-${name},circle\\.c-${name},ellipse\\.c-${name}\\{fill:var\\(--c-${name}-fill\\);stroke:var\\(--c-${name}-stroke\\)\\}`);
    assert.match(everything, rule, name);
    assert.match(everything, new RegExp(`\\.c-${name}>\\.th,\\.c-${name}>\\.t\\{fill:var\\(--c-${name}-title\\)\\}`), name);
    assert.match(everything, new RegExp(`\\.c-${name}>\\.ts\\{fill:var\\(--c-${name}-sub\\)\\}`), name);
    assert.ok(!new RegExp(`\\.c-${name}[^{]*path`).test(everything), name);
  }
  assert.ok(!/\.c-[a-z]+ [a-z]/.test(everything), 'a ramp must not reach into descendants');
});

test('a ramp lights a box with its lightest stop and darkens it to the 800 stop in dark, with the title and subtitle readable on it', () => {
  const lightness = value => Number(/^oklch\(([\d.]+)/.exec(value)[1]);
  for (const name of ['purple', 'teal', 'coral', 'pink', 'gray', 'blue', 'green', 'amber', 'red']) {
    assert.equal(lightness(TOKENS.light[`--c-${name}-fill`]), 0.965, name);
    assert.equal(lightness(TOKENS.light[`--c-${name}-stroke`]), 0.52, name);
    assert.equal(lightness(TOKENS.light[`--c-${name}-title`]), 0.37, name);
    assert.equal(lightness(TOKENS.light[`--c-${name}-sub`]), 0.52, name);
    assert.equal(lightness(TOKENS.dark[`--c-${name}-fill`]), 0.37, name);
    assert.equal(lightness(TOKENS.dark[`--c-${name}-stroke`]), 0.85, name);
    assert.equal(lightness(TOKENS.dark[`--c-${name}-title`]), 0.92, name);
    assert.equal(lightness(TOKENS.dark[`--c-${name}-sub`]), 0.85, name);
  }
});

test('the icon font class is always in the styles, whether or not the font has arrived', () => {
  assert.match(hostCss(), /\.ti\{font-family:"tabler-icons";font-style:normal;font-weight:normal;line-height:1;text-transform:none/);
});

// WCAG contrast from the oklch text the tokens are written in.
function rgb(value) {
  const [l, c, h] = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(value).slice(1).map(Number);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const cube = v => v ** 3;
  const [x, y, z] = [cube(l + 0.3963377774 * a + 0.2158037573 * b), cube(l - 0.1055613458 * a - 0.0638541728 * b), cube(l - 0.0894841775 * a - 1.291485548 * b)];
  const linear = [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z];
  return linear.map(v => Math.min(1, Math.max(0, v)));
}
const luminance = value => { const [r, g, b] = rgb(value); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

test('text keeps a contrast of 4.5 or more on the surfaces and washes it is drawn on, in both modes', () => {
  for (const mode of ['light', 'dark']) {
    const t = TOKENS[mode];
    for (const surface of ['--surface-1', '--surface-2']) {
      for (const text of ['--text-primary', '--text-secondary', '--text-muted']) {
        assert.ok(contrast(t[text], t[surface]) >= 4.5, `${mode} ${text} on ${surface}`);
      }
    }
    for (const role of ['accent', 'danger', 'success', 'warning', 'pro']) {
      assert.ok(contrast(t[`--text-${role}`], t[`--bg-${role}`]) >= 4.5, `${mode} text-${role} on bg-${role}`);
      assert.ok(contrast(t[`--text-${role}`], t['--surface-2']) >= 4.5, `${mode} text-${role} on surface-2`);
    }
    for (const hue of ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'violet', 'magenta']) {
      assert.ok(contrast(t[`--text-tint-${hue}`], t[`--bg-tint-${hue}`]) >= 4.5, `${mode} tint ${hue}`);
    }
  }
});

test('the text on a solid fill keeps a contrast of 4.5 or more, resting and under the pointer', () => {
  for (const mode of ['light', 'dark']) {
    const t = TOKENS[mode];
    for (const role of ['accent', 'danger', 'success', 'warning', 'pro', 'brand']) {
      assert.ok(contrast(t[`--on-${role}`], t[`--fill-${role}`]) >= 4.5, `${mode} on-${role}`);
      assert.ok(contrast(t[`--on-${role}`], t[`--fill-${role}-hover`]) >= 4.5, `${mode} on-${role} hover`);
    }
    assert.ok(contrast(t['--on-primary'], t['--fill-primary']) >= 4.5, `${mode} on-primary`);
    assert.ok(contrast(t['--on-primary'], t['--fill-primary-hover']) >= 4.5, `${mode} on-primary hover`);
  }
});

test('a ramp keeps its title readable on its fill in both modes', () => {
  for (const mode of ['light', 'dark']) {
    for (const name of ['purple', 'teal', 'coral', 'pink', 'gray', 'blue', 'green', 'amber', 'red']) {
      const t = TOKENS[mode];
      assert.ok(contrast(t[`--c-${name}-title`], t[`--c-${name}-fill`]) >= 7, `${mode} ${name} title`);
      assert.ok(contrast(t[`--c-${name}-sub`], t[`--c-${name}-fill`]) >= 4, `${mode} ${name} subtitle`);
    }
  }
});

// ---- the places the page and the frame must agree ---------------------------------------------------------------------------

const appCss = read('app.css');
const darkOfApp = appCss.slice(appCss.indexOf('@media (prefers-color-scheme: dark)'));
const variable = (source, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(source)?.[1].trim();

// Each pair is a value the frame repeats from the page's own stylesheet: the frame's name in widget-theme.js, then the page's in app.css.
// The page's dark block redefines only what changes in dark, and the frame's `common` holds what does not change with the mode.
const SHARED = [
  ['--surface-2', '--widget-card'],
  ['--fill-accent', '--primary'],
  ['--font-sans', '--font-sans'],
  ['--font-mono', '--font-mono'],
];

test('every value the frame repeats from the page is the page\'s own, in light and in dark', () => {
  for (const [framed, paged] of SHARED) {
    for (const mode of ['light', 'dark']) {
      const frame = TOKENS[mode][framed] ?? TOKENS.common[framed];
      const page = (mode === 'dark' ? variable(darkOfApp, paged) : undefined) ?? variable(appCss, paged);
      assert.ok(frame && page, `${framed} against ${paged} in ${mode}`);
      assert.equal(frame, page, `${framed} against ${paged} in ${mode}`);
    }
  }
});

// ---- the icons --------------------------------------------------------------------------------------------------------------

test('parseGlyphs reads each icon name and its code, including a rule that names several icons', () => {
  const css = '/*! made up */@font-face{font-family:"tabler-icons";src:url("./x.woff2")}.ti{font-family:"tabler-icons" !important}'
    + '.ti-alpha:before{content:"\\e001"}.ti-beta::before,.ti-beta-alias:before{content:"\\E002"}.ti-gamma-2:before{content:"\\10255"}.other:before{content:"\\e999"}.ti-spin{animation:none}';
  assert.deepEqual(parseGlyphs(css), { alpha: 'e001', beta: 'e002', 'beta-alias': 'e002', 'gamma-2': '10255' });
});

test('parseGlyphs finds the icons Capcom ships, five-digit codes among them', () => {
  const glyphs = parseGlyphs(read('vendor/tabler-icons.min.css'));
  assert.ok(Object.keys(glyphs).length > 4000);
  for (const name of ['home', 'check', 'grip-vertical', 'external-link', 'inbox', 'clock', 'mood-smile']) assert.match(glyphs[name], /^[0-9a-f]{4,5}$/, name);
  assert.ok(Object.values(glyphs).some(code => code.length === 5));
});

// ---- the gate on a prompt ---------------------------------------------------------------------------------------------------

const click = { text: 'What happens in the cart step?', active: true, focused: true, now: 10_000, last: 0, pending: false };

test('a prompt is sent at once only after a click on this widget, five seconds since the last send, a quiet page and a short text', () => {
  assert.equal(promptGate(click), 'send');
  for (const none of [undefined, null, -Infinity]) {
    assert.equal(promptGate({ ...click, last: none, pageActed: none, othersActed: none }), 'send', String(none));
  }
});

test('a prompt that follows no click on this widget is put to the owner instead, and a browser that cannot tell never counts as a click', () => {
  assert.equal(promptGate({ ...click, active: false }), 'ask');
  assert.equal(promptGate({ ...click, active: undefined }), 'ask');
  assert.equal(promptGate({ ...click, active: 'yes' }), 'ask');
  assert.equal(promptGate({ ...click, focused: false }), 'ask');
  assert.equal(promptGate({ ...click, focused: undefined }), 'ask');
  assert.equal(promptGate({ ...click, now: undefined }), 'ask');
});

test('a second prompt within five seconds of the last send is put to the owner, and one at exactly five seconds is sent', () => {
  assert.equal(promptGate({ ...click, now: 11_000, last: 10_000 }), 'ask');
  assert.equal(promptGate({ ...click, now: 14_999, last: 10_000 }), 'ask');
  assert.equal(promptGate({ ...click, now: 15_000, last: 10_000 }), 'send');
});

// The page has to be quiet for longer than the five seconds a browser keeps a click active, and one second more.
test('a click or key press on the page in the last six seconds puts a prompt to the owner, whatever holds the focus', () => {
  assert.equal(promptGate({ ...click, pageActed: 9_999 }), 'ask');
  assert.equal(promptGate({ ...click, pageActed: 4_001 }), 'ask');
  assert.equal(promptGate({ ...click, pageActed: 4_000 }), 'ask');
  assert.equal(promptGate({ ...click, pageActed: 3_999 }), 'send');
  assert.equal(promptGate({ ...click, pageActed: 0 }), 'send');
});

test('a click or key press in another widget in the last six seconds puts a prompt to the owner, even with the focus on this one', () => {
  assert.equal(promptGate({ ...click, othersActed: 9_999 }), 'ask');
  assert.equal(promptGate({ ...click, othersActed: 4_001 }), 'ask');
  assert.equal(promptGate({ ...click, othersActed: 4_000 }), 'ask');
  assert.equal(promptGate({ ...click, othersActed: 3_999 }), 'send');
  assert.equal(promptGate({ ...click, othersActed: 0 }), 'send');
});

test('the page and every other widget must both have been quiet, and a time that makes no sense never counts as quiet', () => {
  assert.equal(promptGate({ ...click, pageActed: 3_999, othersActed: 4_000 }), 'ask');
  assert.equal(promptGate({ ...click, pageActed: 4_000, othersActed: 3_999 }), 'ask');
  assert.equal(promptGate({ ...click, pageActed: 3_999, othersActed: 3_999 }), 'send');
  for (const odd of [10_001, NaN, 'soon', {}]) {
    assert.equal(promptGate({ ...click, pageActed: odd }), 'ask', String(odd));
    assert.equal(promptGate({ ...click, othersActed: odd }), 'ask', String(odd));
  }
});

test('a prompt over 4000 characters is put to the owner however it was clicked, and one of exactly 4000 is sent', () => {
  assert.equal(promptGate({ ...click, text: 'x'.repeat(4000) }), 'send');
  assert.equal(promptGate({ ...click, text: 'x'.repeat(4001) }), 'ask');
});

test('a prompt that is not text, says nothing, or arrives while the bar is already showing a request is dropped', () => {
  for (const text of [undefined, null, 42, {}, ['a'], '', '   ', '\n\t ']) assert.equal(promptGate({ ...click, text }), 'drop', JSON.stringify(text));
  assert.equal(promptGate({ ...click, pending: true }), 'drop');
  assert.equal(promptGate({ ...click, pending: true, active: false }), 'drop');
  assert.equal(promptGate({ ...click, pending: true, pageActed: 9_999 }), 'drop');
});

// ---- the links --------------------------------------------------------------------------------------------------------------

// ---- the gate on a link -----------------------------------------------------------------------------------------------------

const linkClick = { active: true, focused: true, now: 10_000, last: 0 };

test('a link opens at once after a click on this widget with a quiet page, and anything else is put to the owner', () => {
  assert.equal(linkGate(linkClick), 'open');
  assert.equal(linkGate({ ...linkClick, active: false }), 'ask');
  assert.equal(linkGate({ ...linkClick, active: undefined }), 'ask');
  assert.equal(linkGate({ ...linkClick, focused: false }), 'ask');
  assert.equal(linkGate({ ...linkClick, now: undefined }), 'ask');
  assert.equal(linkGate({ ...linkClick, pageActed: 4_000 }), 'ask');
  assert.equal(linkGate({ ...linkClick, othersActed: 4_000 }), 'ask');
  assert.equal(linkGate({ ...linkClick, pageActed: 3_999, othersActed: 3_999 }), 'open');
});

test('a second link within a second of the last one opened is put to the owner, and one at exactly a second opens', () => {
  assert.equal(linkGate({ ...linkClick, last: 9_001 }), 'ask');
  assert.equal(linkGate({ ...linkClick, last: 9_000 }), 'open');
  assert.equal(linkGate({ ...linkClick, last: undefined }), 'open');
});

test('a web address comes back normalised and absolute', () => {
  assert.equal(linkTarget('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d');
  assert.equal(linkTarget('HTTPS://Example.COM'), 'https://example.com/');
  assert.equal(linkTarget('  http://example.com:8080/x y  '), 'http://example.com:8080/x%20y');
  assert.equal(linkTarget('https://example.com/a/../b'), 'https://example.com/b');
});

test('an address that is not a plain web address is refused', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<p>x</p>', 'blob:https://example.com/abc', 'file:///etc/hosts', 'about:blank', 'ftp://example.com/x', 'mailto:a@example.com', 'tel:123']) {
    assert.equal(linkTarget(url), null, url);
  }
  for (const url of ['/relative/path', '//example.com/x', 'example.com', 'not a url', '', 'https://', undefined, null, 42, {}]) assert.equal(linkTarget(url), null, String(url));
});

test('an address that names a user, or runs past 2048 characters, is refused', () => {
  assert.equal(linkTarget('https://user:secret@example.com/'), null);
  assert.equal(linkTarget('https://user@example.com/'), null);
  assert.equal(linkTarget('https://:secret@example.com/'), null);
  const room = 2048 - 'https://example.com/'.length;
  assert.equal(linkTarget(`https://example.com/${'a'.repeat(room)}`)?.length, 2048);
  assert.equal(linkTarget(`https://example.com/${'a'.repeat(room + 1)}`), null);
});

// ---- the smaller decisions --------------------------------------------------------------------------------------------------

test('a tool title written as an identifier becomes words with a capital to start', () => {
  assert.equal(humanTitle('q4_revenue_by_product_line'), 'Q4 revenue by product line');
  assert.equal(humanTitle('weekly_support_summary'), 'Weekly support summary');
  assert.equal(humanTitle('__loan__calculator_'), 'Loan calculator');
  assert.equal(humanTitle('Checkout flow'), 'Checkout flow');
  assert.equal(humanTitle('e-commerce funnel'), 'E-commerce funnel');
});

test('a tool with no usable title is named plainly', () => {
  for (const title of [undefined, null, '', '   ', '___', 42, {}]) assert.equal(humanTitle(title), 'Widget', String(title));
});

test('a widget that begins with an SVG is a card, and one that begins with anything else is not', () => {
  for (const code of ['<svg viewBox="0 0 10 10"></svg>', '\n  <svg>', '<SVG width="100%">', '<svg\nviewBox="0 0 1 1">', '  \t<svg/>']) assert.equal(isCard(code), true, code);
  for (const code of ['<div><svg></svg></div>', '<!-- a note --><svg></svg>', '<style>svg{}</style><svg></svg>', '<svgx></svgx>', 'svg', '', undefined, null, 5]) assert.equal(isCard(code), false, String(code));
});

test('the root SVG\'s viewBox gives the place the card holds before the frame has measured itself', () => {
  assert.deepEqual(viewBoxRatio('<svg width="100%" viewBox="0 0 680 300" role="img"><title>x</title></svg>'), { width: 680, height: 300 });
  assert.deepEqual(viewBoxRatio("<svg viewBox='0 0 400.5 250'>"), { width: 400.5, height: 250 });
  assert.deepEqual(viewBoxRatio('<svg role="img" viewBox="0, 0, 320, 180">'), { width: 320, height: 180 });
  assert.deepEqual(viewBoxRatio('\n<svg\n  viewbox="-10 -10 100 50">'), { width: 100, height: 50 });
});

test('an SVG that is as wide as the card holds its place, whether it says so with a percentage or says nothing about width', () => {
  assert.deepEqual(viewBoxRatio('<svg width="100%" height="auto" viewBox="0 0 680 300">'), { width: 680, height: 300 });
  assert.deepEqual(viewBoxRatio('<svg width=" 100% " viewBox="0 0 680 300">'), { width: 680, height: 300 });
  assert.deepEqual(viewBoxRatio('<svg width="auto" viewBox="0 0 680 300">'), { width: 680, height: 300 });
  assert.deepEqual(viewBoxRatio('<svg height="300" viewBox="0 0 680 300">'), { width: 680, height: 300 });
  assert.deepEqual(viewBoxRatio('<svg stroke-width="2" viewBox="0 0 680 300">'), { width: 680, height: 300 });
});

test('an SVG with a width of its own holds no place, because it may be narrower than the card', () => {
  for (const code of ['<svg width="100" height="100" viewBox="0 0 100 100">', '<svg viewBox="0 0 680 300" width="680">', "<svg width='12.5em' viewBox='0 0 5 5'>", '<svg width="0" viewBox="0 0 5 5">']) {
    assert.equal(viewBoxRatio(code), null, code);
  }
});

test('a viewBox that cannot hold a place gives nothing', () => {
  for (const code of ['<svg width="100%">', '<svg viewBox="0 0 0 100">', '<svg viewBox="0 0 -5 100">', '<svg viewBox="0 0 100">', '<svg viewBox="a b c d">', '<svg viewBox="">',
    '<div viewBox="0 0 1 1"><svg viewBox="0 0 680 300"></svg></div>', '<p>no svg</p>', '', undefined, 7]) {
    assert.equal(viewBoxRatio(code), null, String(code));
  }
});

test('the height a frame reports is rounded up and held between 40 and 4000, and anything that is not a number is ignored', () => {
  assert.equal(clampHeight(10), 40);
  assert.equal(clampHeight(300.2), 301);
  assert.equal(clampHeight(9_999), 4000);
  assert.equal(clampHeight(4000), 4000);
  for (const h of [NaN, Infinity, '300', null, undefined, {}]) assert.equal(clampHeight(h), null, String(h));
});
