// Run with `npm test`. How a command's output is drawn: colours and weight from SGR sequences, \r writing over the line, the escape
// sequences that are dropped, and the colours that keep 4.5:1 on the block they are drawn on in the light look and in the dark one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_PIECES, plainOf, readable, renderAnsi } from '../public/ui/ansi.js';

const out = text => ({ stream: 'out', text });
const err = text => ({ stream: 'err', text });
const draw = (...chunks) => renderAnsi(chunks).lines.map(line => line.map(({ text, cls }) => (cls ? `${cls}|${text}` : text)));
const plain = (...chunks) => plainOf(chunks);
const ESC = '\x1b';

test('plain text is one piece a line, with a trailing newline making no empty line after it', () => {
  assert.deepEqual(draw(out('one\ntwo\n')), [['one'], ['two']]);
  assert.deepEqual(draw(out('one\ntwo')), [['one'], ['two']]);
  assert.deepEqual(draw(out('a\n\nb')), [['a'], [], ['b']], 'a blank line in the middle stays');
  assert.deepEqual(draw(), [[]]);
  assert.deepEqual(draw(out('')), [[]]);
});

test('an SGR colour from the palette is a class, until it is reset', () => {
  assert.deepEqual(draw(out(`${ESC}[31mred${ESC}[0m plain`)), [['ansi-fg-1|red', ' plain']]);
  assert.deepEqual(draw(out(`${ESC}[1;32mgo${ESC}[39m!`)), [['ansi-fg-2 ansi-bold|go', 'ansi-bold|!']]);
  assert.deepEqual(draw(out(`${ESC}[91mbright${ESC}[m`)), [['ansi-fg-9|bright']], 'an empty sequence resets');
  assert.deepEqual(draw(out(`${ESC}[44mon blue${ESC}[49m`)), [['ansi-bg-4|on blue']]);
  assert.deepEqual(draw(out(`${ESC}[4mu${ESC}[24m${ESC}[3mi${ESC}[23m${ESC}[9ms`)), [['ansi-underline|u', 'ansi-italic|i', 'ansi-strike|s']]);
});

test('a colour carries from one line to the next, and from one chunk to the next of the same stream', () => {
  assert.deepEqual(draw(out(`${ESC}[33mone\ntwo${ESC}[0m`)), [['ansi-fg-3|one'], ['ansi-fg-3|two']]);
  assert.deepEqual(draw(out(`${ESC}[33mone`), out(' two')), [['ansi-fg-3|one two']]);
  assert.deepEqual(draw(out(`${ESC}[33mone`), err('x'), out('two')), [['ansi-fg-3|one', 'x', 'ansi-fg-3|two']], 'the other stream has its own colour');
});

test('dim text takes the muted colour only when it has no colour of its own, so it keeps its contrast', () => {
  assert.deepEqual(draw(out(`${ESC}[2mdim${ESC}[0m`)), [['ansi-dim|dim']]);
  assert.deepEqual(draw(out(`${ESC}[2;31mdim red${ESC}[0m`)), [['ansi-fg-1|dim red']]);
});

test('a reversed pair of colours swaps them, and reversed default colours use the page\'s own', () => {
  assert.deepEqual(draw(out(`${ESC}[7mswap${ESC}[0m`)), [['ansi-inverse-fg ansi-inverse-bg|swap']]);
  assert.deepEqual(draw(out(`${ESC}[31;7mswap${ESC}[0m`)), [['ansi-inverse-fg ansi-bg-1|swap']]);
  assert.deepEqual(draw(out(`${ESC}[31;44;7mswap${ESC}[0m`)), [['ansi-fg-4 ansi-bg-1|swap']]);
});

test('a 256 colour below 16 is a palette class, and a higher one or an rgb colour is a style with a colour for each look', () => {
  assert.deepEqual(draw(out(`${ESC}[38;5;9mx`)), [['ansi-fg-9|x']]);
  const [[high]] = renderAnsi([out(`${ESC}[38;5;196mx`)]).lines;
  assert.equal(high.cls, '');
  assert.match(high.css, /^color:light-dark\(rgb\(\d+ \d+ \d+\), rgb\(\d+ \d+ \d+\)\)$/);
  const [[rgb]] = renderAnsi([out(`${ESC}[38;2;10;200;30mx`)]).lines;
  assert.match(rgb.css, /^color:light-dark\(/);
  const [[back]] = renderAnsi([out(`${ESC}[48;2;10;200;30mx`)]).lines;
  assert.equal(back.css, 'background-color:color-mix(in srgb, rgb(10 200 30) 30%, transparent)', 'a background is a tint, so the text over it stays readable');
  assert.deepEqual(draw(out(`${ESC}[38;5;300mx`)), [['x']], 'an index out of range is dropped');
  assert.deepEqual(draw(out(`${ESC}[38;2;1;2mx`)), [['x']], 'a colour cut short is dropped');
  assert.deepEqual(draw(out(`${ESC}[38:5:2mx`)), [['ansi-fg-2|x']], 'the colon form too');
});

test('a carriage return goes back to the start of the line and writes over it', () => {
  assert.equal(plain(out('10%\r50%\r100%\n')), '100%');
  assert.equal(plain(out('abcdef\rxy')), 'xycdef', 'what is not written over stays');
  assert.equal(plain(out('a\r\nb')), 'a\nb', 'a \\r before \\n is a line end');
  assert.equal(plain(out('progress: 1\rprogress: 2'), out('\rprogress: 3\n')), 'progress: 3');
});

test('writing over a coloured line keeps the colours of the parts that remain', () => {
  assert.deepEqual(draw(out(`${ESC}[31mabcdef${ESC}[0m\rXY`)), [['XY', 'ansi-fg-1|cdef']]);
});

test('erase to the end of the line, and erase the whole line, empty what the cursor is on', () => {
  assert.equal(plain(out('loading...\r\x1b[Kdone\n')), 'done');
  assert.equal(plain(out('abcdef\r\x1b[2Kxy')), 'xy');
  assert.equal(plain(out('abcdef\b\b\x1b[K')), 'abcd');
});

test('a backspace moves back one column, and a tab goes to the next stop of eight', () => {
  assert.equal(plain(out('abc\bX')), 'abX');
  assert.equal(plain(out('a\tb')), 'a       b');
  assert.equal(plain(out('12345678\tb')), '12345678        b');
});

test('cursor moves, titles, the bell and other controls are dropped, and the text round them stays', () => {
  assert.equal(plain(out(`a${ESC}[2Ab${ESC}[?25lc${ESC}]0;title\x07d\x07e`)), 'abcde');
  assert.equal(plain(out(`a${ESC}]8;;http://x\x1b\\link${ESC}]8;;\x1b\\`)), 'alink');
  assert.equal(plain(out(`a${ESC}(Bb${ESC}=c`)), 'abc');
  assert.equal(plain(out('a\x00b\x1fc\x7fd')), 'abcd');
});

test('an escape sequence split between two chunks of one stream is finished by the next', () => {
  assert.deepEqual(draw(out(`a${ESC}[3`), out('1mb')), [['a', 'ansi-fg-1|b']]);
  assert.deepEqual(draw(out(`a${ESC}`), out('[1mb')), [['a', 'ansi-bold|b']]);
  assert.deepEqual(draw(out(`a${ESC}]0;ti`), out('tle\x07b')), [['ab']]);
  assert.equal(plain(out(`a${ESC}[3`)), 'a', 'one never finished shows nothing');
});

test('the stream a piece came from stays with it, and a line can hold both', () => {
  const [line] = renderAnsi([out('out '), err('err'), out(' out')]).lines;
  assert.deepEqual(line.map(p => [p.stream, p.text]), [['out', 'out '], ['err', 'err'], ['out', ' out']]);
});

test('only the last lines are drawn, and the number before them is reported', () => {
  const lines = Array.from({ length: 10 }, (_, n) => `line ${n}`).join('\n');
  const got = renderAnsi([out(lines)], { maxLines: 3 });
  assert.equal(got.cut, 7);
  assert.deepEqual(got.lines.map(l => l[0].text), ['line 7', 'line 8', 'line 9']);
  assert.equal(renderAnsi([out('a\nb')]).cut, 0);
});

test('a line that changes colour at every character keeps all its text in no more than the most pieces a line holds', () => {
  const text = Array.from({ length: 1000 }, (_, n) => `${ESC}[${31 + (n % 2)}m${n % 10}`).join('');
  const [line] = renderAnsi([out(text)]).lines;
  assert.equal(line.length, MAX_PIECES);
  assert.equal(line.map(p => p.text).join(''), Array.from({ length: 1000 }, (_, n) => n % 10).join(''));
  assert.deepEqual(line.slice(0, 3).map(p => [p.cls, p.text]), [['ansi-fg-1', '0'], ['ansi-fg-2', '1'], ['ansi-fg-1', '2']], 'the pieces before the limit keep their colours');
  assert.equal(plain(out(text), out('\rXY')), `XY${Array.from({ length: 998 }, (_, n) => (n + 2) % 10).join('')}`, 'writing over a full line still keeps the rest');
});

test('256 KB of alternating colours on one line, fed in 4 KB chunks, is drawn in well under half a second with every character kept', () => {
  let text = '';
  for (let n = 0; text.length < 256 * 1024; n++) text += `${ESC}[${31 + (n % 2)}mx`;
  const chunks = [];
  for (let at = 0; at < text.length; at += 4096) chunks.push(out(text.slice(at, at + 4096)));
  const started = performance.now();
  const { lines } = renderAnsi(chunks);
  const took = performance.now() - started;
  assert.ok(took < 500, `drawing took ${Math.round(took)} ms`);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].reduce((n, p) => n + p.text.length, 0), text.replace(/\x1b\[\d+m/g, '').length);
});

// The fastest of three draws, so a runner busy with other files does not fail a limit that only a slow algorithm should break.
function drawnIn(chunks) {
  let took = Infinity;
  let lines;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    ({ lines } = renderAnsi(chunks));
    took = Math.min(took, performance.now() - started);
  }
  return { took, text: lines.map(l => l.map(p => p.text).join('')).join('\n') };
}

test('writing over a 400K line 200K times with \\r is drawn in well under half a second, with the rest of the line kept', () => {
  const { took, text } = drawnIn([out('a'.repeat(400000)), out('\rX'.repeat(200000))]);
  assert.ok(took < 500, `drawing took ${Math.round(took)} ms`);
  assert.equal(text, `X${'a'.repeat(399999)}`);
});

test('writing over the end of a 400K line 200K times with \\b is drawn in well under half a second, and so is walking back along it', () => {
  const end = drawnIn([out('a'.repeat(400000)), out('\bX'.repeat(200000))]);
  assert.ok(end.took < 500, `drawing took ${Math.round(end.took)} ms`);
  assert.equal(end.text, `${'a'.repeat(399999)}X`);
  const back = drawnIn([out('a'.repeat(400000)), out('\b\bX'.repeat(100000))]);
  assert.ok(back.took < 500, `walking back took ${Math.round(back.took)} ms`);
  assert.equal(back.text, `${'a'.repeat(299999)}${'X'.repeat(100000)}a`);
});

test('writing and cutting at the end of a 400K line 200K times is drawn in well under half a second', () => {
  const { took, text } = drawnIn([out('a'.repeat(400000)), out('X\b\x1b[K'.repeat(200000))]);
  assert.ok(took < 500, `drawing took ${Math.round(took)} ms`);
  assert.equal(text, 'a'.repeat(400000), 'what was written and cut again leaves nothing');
});

test('a long line written over in a colour keeps each colour where it was written, and a gap after an erased line is plain', () => {
  assert.deepEqual(draw(out(`${'a'.repeat(1000)}\r${ESC}[31mXY${ESC}[0m`)), [['ansi-fg-1|XY', 'a'.repeat(998)]]);
  assert.deepEqual(draw(out(`${'a'.repeat(1000)}\r${ESC}[31mXY${ESC}[32m\b\bZ`)), [['ansi-fg-2|Z', 'ansi-fg-1|Y', 'a'.repeat(998)]]);
  assert.deepEqual(draw(out(`${ESC}[31mabc\rX${ESC}[0m\tY`)), [['ansi-fg-1|X', '       Y']]);
  assert.deepEqual(draw(out(`${ESC}[31mabc${ESC}[2K${ESC}[32mx`)), [['   ', 'ansi-fg-2|x']]);
});

test('a colour keeps 4.5:1 on the block it is drawn on, by being moved towards black on the light look and white on the dark one', () => {
  assert.deepEqual(readable([0, 0, 0], 'light'), [0, 0, 0], 'a colour that already reads is left alone');
  assert.deepEqual(readable([255, 255, 255], 'dark'), [255, 255, 255]);
  const light = readable([255, 255, 0], 'light');
  const dark = readable([0, 0, 120], 'dark');
  assert.ok(light[0] < 255 && light[1] < 255, 'yellow on light is darkened');
  assert.ok(dark[2] > 120, 'dark blue on dark is lightened');
  for (const c of [[255, 255, 255], [200, 200, 200], [255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]]) {
    for (const [scheme, surface] of [['light', 0.79], ['dark', 0.02]]) {
      const [r, g, b] = readable(c, scheme).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const ratio = scheme === 'dark' ? (l + 0.05) / (surface + 0.05) : (surface + 0.05) / (l + 0.05);
      assert.ok(ratio >= 4.5, `${c} on ${scheme} is ${ratio.toFixed(2)}`);
    }
  }
});

// The 16 palette colours are tokens in app.css, one set for each look, and the text they colour is 4.5:1 on --muted in both.
const css = fs.readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
const encode = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminanceOf(text) {
  const [l, c, h] = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(text).slice(1, 4).map(Number);
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  const [x, y, z] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(v => v ** 3);
  const linear = [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z];
  const [r, g, bl] = linear.map(v => decode(encode(Math.min(1, Math.max(0, v)))));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

const tokens = body => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))/g)].map(([, name, value]) => [name, value]));
const lightBlock = /^:root \{([^}]*)\}/m.exec(css)[1];
const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(css)[1];
const ghostCss = fs.readFileSync(new URL('../public/ghost.css', import.meta.url), 'utf8');
const ghostLight = tokens(/^:root\[data-look="ghost"\] \{([^}]*)\}/m.exec(ghostCss)[1]);
const ghostDark = tokens(/@media \(prefers-color-scheme: dark\) \{\s*:root\[data-look="ghost"\] \{([^}]*)\}/.exec(ghostCss)[1]);

const LOOKS = {
  'default light': { ...tokens(lightBlock) },
  'default dark': { ...tokens(lightBlock), ...tokens(darkBlock) },
  'ghost light': { ...tokens(lightBlock), ...ghostLight },
  'ghost dark': { ...tokens(lightBlock), ...tokens(darkBlock), ...ghostLight, ...ghostDark },
};

test('the 16 palette colours are set for each look, and each keeps 4.5:1 on the block the output is drawn on', () => {
  for (const [name, set] of Object.entries(LOOKS)) {
    const surface = luminanceOf(set['--muted']);
    for (let n = 0; n < 16; n++) {
      assert.ok(set[`--ansi-${n}`], `--ansi-${n} is set in the ${name} look`);
      const ratio = (Math.max(surface, luminanceOf(set[`--ansi-${n}`])) + 0.05) / (Math.min(surface, luminanceOf(set[`--ansi-${n}`])) + 0.05);
      assert.ok(ratio >= 4.5, `--ansi-${n} is ${ratio.toFixed(2)}:1 on --muted in the ${name} look`);
    }
  }
});

function encodedOf(text) {
  const [l, c, h] = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(text).slice(1, 4).map(Number);
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  const [x, y, z] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(v => v ** 3);
  return [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z].map(v => encode(Math.min(1, Math.max(0, v))));
}

const luminanceOfEncoded = ([r, g, b]) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

test('the page\'s text keeps 4.5:1 over a background of each palette colour, which is drawn as a 30% tint on the block', () => {
  for (const [name, set] of Object.entries(LOOKS)) {
    const surface = encodedOf(set['--muted']);
    const ink = luminanceOf(set['--foreground']);
    for (let n = 0; n < 16; n++) {
      const mixed = encodedOf(set[`--ansi-${n}`]).map((v, i) => v * 0.3 + surface[i] * 0.7);
      const l = luminanceOfEncoded(mixed);
      const ratio = (Math.max(l, ink) + 0.05) / (Math.min(l, ink) + 0.05);
      assert.ok(ratio >= 4.5, `text on a tint of --ansi-${n} is ${ratio.toFixed(2)}:1 in the ${name} look`);
    }
  }
});
