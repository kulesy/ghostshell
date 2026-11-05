// Run with `npm test`. Playing the audio a reply links to, in the real page against the real server: a click playing the clip, pause and seek,
// Previous and Next moving between the chat's clips with the transcript, the File tab and the focus left alone, closing stopping the sound,
// a file that only looks like audio, a clip that is missing, a path the chat does not link, and the buttons within reach on a phone 390 and
// 320 px wide. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let browser;
let said = 0;

const says = (id, text) => {
  const file = path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}-${++said}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })}\n`);
  const old = (Date.now() - 600_000) / 1000;
  fs.utimesSync(file, old, old);
};

// Five seconds of a tone at 8 kHz, long enough to seek in. `hertz` makes each clip sound different.
function tone(hertz, seconds = 5) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * hertz * i / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const CLIPS = ['one', 'two', 'missing', 'four', 'five'];
const TAKES = Array.from({ length: 26 }, (_, i) => `take-${String(i).padStart(2, '0')}`);
const GONE = 'take-24';
const files = {};

before(async () => {
  if (skip) return;
  app = await start({ sessions: [{ id: 'chat', title: 'Chat', ago: 10 }, { id: 'solo', title: 'Solo', ago: 20 }, { id: 'texty', title: 'Texty', ago: 30 }, { id: 'long', title: 'Long', ago: 40 }], claude: true });
  const dir = path.join(app.home, 'work');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [...CLIPS, 'secret', 'solo', 'text']) files[name] = path.join(dir, `${name}.wav`);
  for (const [i, name] of CLIPS.entries()) if (name !== 'missing') fs.writeFileSync(files[name], tone(300 + i * 100));
  fs.writeFileSync(files.secret, tone(900));
  fs.writeFileSync(files.solo, tone(500));
  fs.writeFileSync(files.text, 'This is only text that has a .wav name.\n');
  for (const name of TAKES) {
    files[name] = path.join(dir, `${name}.wav`);
    if (name !== GONE) fs.writeFileSync(files[name], tone(400, 2));
  }
  for (let i = 0; i < 40; i++) says('chat', `Filler paragraph ${i} so the chat is taller than the screen.`);
  says('chat', `${CLIPS.map(name => `- [${name}.wav](<${files[name]}>)`).join('\n')}`);
  for (let i = 0; i < 6; i++) says('chat', `More filler ${i} after the clips.`);
  says('solo', `Only [one clip](<${files.solo}>) here.`);
  says('texty', `Only [text.wav](<${files.text}>) here.`);
  says('long', TAKES.map(name => `- [${name}.wav](<${files[name]}>)`).join('\n'));
  browser = await launch(chromium);
});

after(async () => { await browser?.close(); });

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

async function appPage(t, { phone = false, chat = 'chat' } = {}) {
  const page = await browser.open(`${app.origin}/`, { phone });
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  if (await page.evaluate(`localStorage.getItem('capcom.panels') !== null`)) {
    await page.evaluate(`window.stale = true; localStorage.removeItem('capcom.panels'); location.reload()`);
    await page.until(`!window.stale && document.readyState === 'complete' && ${LIST}`, 10_000);
  }
  await page.evaluate(`location.hash = '#/'`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await page.evaluate(`location.hash = '#/s/${chat}'`);
  await page.until(`!!document.querySelector('.msg.claude a[data-file]')`, 15_000);
  return page;
}

const link = name => `a[data-file="${files[name]}"]`;
const urlOf = (name, chat = 'chat') => `api/sessions/${chat}/file?path=${encodeURIComponent(files[name])}`;
const AUDIO = `document.querySelector('.file-audio audio')`;
const state = page => page.evaluate(`(a => a && ({ paused: a.paused, t: a.currentTime, src: a.getAttribute('src'), end: a.seekable.length ? a.seekable.end(0) : 0, seeking: a.seeking, error: !!a.error }))(${AUDIO})`);
const current = page => page.evaluate(`document.querySelector('.file-clip[aria-current]')?.textContent`);
const count = page => page.evaluate(`document.querySelector('.file-clips-count')?.textContent`);
const button = label => `.file-view button[aria-label="${label}"]`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function playing(page, name, chat) {
  await page.until(`!!${AUDIO} && ${AUDIO}.getAttribute('src') === ${JSON.stringify(urlOf(name, chat))} && !${AUDIO}.paused && ${AUDIO}.currentTime > 0.2`, 10_000);
}

test('a click on a clip plays it in the panel, and pause and seek work', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.click(link('one'));
  await playing(page, 'one');
  assert.equal(await page.evaluate(`!!document.querySelector('.file-view .file-audio audio[controls]')`), true);
  assert.equal(await page.evaluate(`document.querySelector('.file-name').textContent`), 'one.wav');
  assert.equal(await page.evaluate(`document.querySelector('.file-size').textContent`), '78 KB');
  await page.evaluate(`window.a = ${AUDIO}; window.a.pause()`);
  const held = (await state(page)).t;
  await wait(400);
  assert.equal((await state(page)).t, held, 'paused');
  await page.evaluate(`window.a.currentTime = 3.5; window.a.play()`);
  await page.until(`window.a.currentTime >= 3.5 && !window.a.seeking`);
  const after = await state(page);
  assert.ok(after.end > 4, `seekable to ${after.end}`);
  assert.equal(after.error, false);
  assert.deepEqual(page.problems, []);
});

test('Next and Previous move between the chat\'s clips and wrap, a row jumps, and the count and the current row follow', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.click(link('one'));
  await playing(page, 'one');
  assert.deepEqual([await count(page), await current(page)], ['1 of 5', 'one.wav']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.file-clip')].map(b => [b.textContent, b.title])`), CLIPS.map(name => [`${name}.wav`, files[name]]));
  await page.click('.file-clips-nav button:first-child');
  await page.until(`document.querySelector('.file-clips-count').textContent === '5 of 5'`);
  await playing(page, 'five');
  assert.equal(await current(page), 'five.wav', 'Previous wraps to the last');
  await page.click('.file-clips-nav button:last-child');
  await page.until(`document.querySelector('.file-clips-count').textContent === '1 of 5'`);
  await playing(page, 'one');
  await page.evaluate(`[...document.querySelectorAll('.file-clip')].find(b => b.textContent === 'four.wav').click()`);
  await page.until(`document.querySelector('.file-clips-count').textContent === '4 of 5'`);
  await playing(page, 'four');
  assert.equal(await current(page), 'four.wav');
  assert.equal(await page.evaluate(`document.querySelector('.file-name').textContent`), 'four.wav');
  assert.deepEqual(page.problems, []);
});

test('a move leaves the transcript where it is, keeps the File tab and the focused button, and a missing clip shows the error while Next still works', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.click(link('one'));
  await playing(page, 'one');
  await page.evaluate(`document.querySelector('#transcript').scrollTop = 150`);
  await wait(100);
  const top = await page.evaluate(`document.querySelector('#transcript').scrollTop`);
  assert.ok(top > 0);
  await page.evaluate(`window.gone = 0; window.tab = document.querySelector('.file-view'); new MutationObserver(list => { for (const m of list) for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches('.file-view') || n.querySelector('.file-view'))) window.gone++; }).observe(document.body, { subtree: true, childList: true })`);
  await page.evaluate(`window.next = document.querySelector('.file-clips-nav button:last-child'); window.previous = document.querySelector('.file-clips-nav button:first-child')`);
  await page.click('.file-clips-nav button:last-child');
  await playing(page, 'two');
  assert.equal(await page.evaluate(`document.activeElement === window.next`), true, 'the button pressed keeps the focus');
  await page.click('.file-clips-nav button:last-child');
  await page.until(`!!document.querySelector('.file-note[role="alert"]')`);
  assert.equal(await page.evaluate(`document.querySelector('.file-note[role="alert"]').textContent`), 'There is no file at that path.');
  assert.equal(await page.evaluate(`!!${AUDIO}`), false);
  assert.equal(await count(page), '3 of 5', 'the list is still there');
  assert.equal(await page.evaluate(`document.activeElement === window.next`), true);
  await page.click('.file-clips-nav button:last-child');
  await playing(page, 'four');
  await page.click('.file-clips-nav button:first-child');
  await page.until(`document.querySelector('.file-clips-count').textContent === '3 of 5'`);
  await page.click('.file-clips-nav button:first-child');
  await playing(page, 'two');
  assert.equal(await page.evaluate(`document.activeElement === window.previous && window.previous.isConnected && window.next.isConnected`), true, 'the buttons are the same ones throughout');
  assert.equal(await page.evaluate(`window.gone`), 0, 'the File tab never left the page');
  assert.equal(await page.evaluate(`window.tab.isConnected`), true);
  assert.equal(await page.evaluate(`document.querySelector('#transcript').scrollTop`), top);
  assert.deepEqual(page.problems.filter(p => !/404/.test(p)), []);
});

test('closing the panel stops the sound and puts the focus on the link, and opening the panel again returns to the same clip, paused', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.click(link('two'));
  await playing(page, 'two');
  await page.evaluate(`window.a = ${AUDIO}; window.a.pause(); window.a.currentTime = 2`);
  await page.click('.panel-head button[aria-label="Close panel"]');
  await page.until(`!document.querySelector('#panel')`);
  assert.equal(await page.evaluate(`window.a.paused`), true);
  await page.click(link('two'));
  await page.until(`!!${AUDIO}`);
  const back = await state(page);
  assert.equal(back.src, urlOf('two'));
  assert.ok(back.t >= 1.9 && back.t < 2.5, `back at ${back.t}`);
  await page.evaluate(`window.a.play()`);
  await page.click(button('Close file'));
  await page.until(`!document.querySelector('.file-view')`);
  assert.equal(await page.evaluate(`window.a.paused && !window.a.getAttribute('src')`), true, 'closing the file stops it');
  assert.equal(await page.evaluate(`document.activeElement.matches(${JSON.stringify(link('two'))})`), true, 'the focus is back on the link');
  assert.deepEqual(page.problems, []);
});

test('a chat with one clip shows the player and no navigation', { skip, timeout }, async t => {
  const page = await appPage(t, { chat: 'solo' });
  await page.click(link('solo'));
  await page.until(`!!${AUDIO}`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.file-clips-nav, .file-clip').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a .wav that holds text opens as text and makes no sound', { skip, timeout }, async t => {
  const page = await appPage(t, { chat: 'texty' });
  await page.evaluate(`window.players = []; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.players.push(this); return play.call(this); }`);
  await page.click(link('text'));
  await page.until(`!!document.querySelector('.file-lines')`);
  assert.equal(await page.evaluate(`document.querySelector('.file-text').textContent`), 'This is only text that has a .wav name.');
  assert.equal(await page.evaluate(`!!${AUDIO}`), false);
  assert.equal(await page.evaluate(`window.players.length`), 1, 'the tap started it');
  assert.equal(await page.evaluate(`window.players[0].paused && !window.players[0].getAttribute('src')`), true, 'and the answer stopped it');
  assert.deepEqual(page.problems.filter(p => !/Failed to load resource/.test(p)), []);
});

test('a path the chat does not link is refused from the page, with a range or without one', { skip, timeout }, async t => {
  const page = await appPage(t);
  const asked = await page.evaluate(`Promise.all([{}, { headers: { range: 'bytes=0-1' } }].map(init => fetch('api/sessions/chat/file?path=' + encodeURIComponent(${JSON.stringify(files.secret)}), init).then(async r => [r.status, (await r.arrayBuffer()).byteLength])))`);
  assert.deepEqual(asked.map(([status]) => status), [403, 403]);
  assert.equal(asked.every(([, size]) => size < 100), true, 'a sentence and no audio');
  assert.deepEqual(page.problems.filter(p => !/403/.test(p)), []);
});

test('on a phone, 390 and 320 px wide, nothing scrolls sideways and the player and buttons are on screen', { skip, timeout }, async t => {
  const page = await appPage(t, { phone: true });
  await page.tap(link('one'));
  await playing(page, 'one');
  for (const width of [390, 320]) {
    await page.resize(width, 700);
    const box = await page.evaluate(`(() => {
      const within = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; };
      const body = document.querySelector('.file-body');
      return {
        page: document.documentElement.scrollWidth <= innerWidth,
        body: body.scrollWidth <= body.clientWidth,
        player: within(${AUDIO}),
        nav: [...document.querySelectorAll('.file-clips-nav button')].map(b => [b.textContent, within(b), b.getBoundingClientRect().height]),
        rows: [...document.querySelectorAll('.file-clip')].map(b => [within(b), b.getBoundingClientRect().height]),
        head: [...document.querySelectorAll('.file-actions button, .file-actions a')].map(within),
      };
    })()`);
    assert.equal(box.page, true, `${width}: the page does not scroll sideways`);
    assert.equal(box.body, true, `${width}: nor the file`);
    assert.equal(box.player, true, `${width}: the player`);
    assert.deepEqual(box.nav.map(([, ok]) => ok), [true, true], `${width}: Previous and Next`);
    assert.ok(box.nav.every(([, , h]) => h >= 44), `${width}: the nav buttons are 44 px tall`);
    assert.ok(box.rows.every(([ok, h]) => ok && h >= 44), `${width}: ${JSON.stringify(box.rows)}`);
    assert.ok(box.head.every(Boolean), `${width}: the head buttons`);
  }
  await page.tap('.file-clips-nav button:last-child');
  await playing(page, 'two');
  assert.deepEqual(page.problems, []);
});

test('in a long list the buttons stay on screen, the current row comes into view, and the player leaves the resize handle free', { skip, timeout }, async t => {
  const page = await appPage(t, { chat: 'long' });
  await page.resize(1280, 500);
  await page.click(link('take-25'));
  await playing(page, 'take-25', 'long');
  const facts = await page.evaluate(`(() => {
    const body = document.querySelector('.file-body').getBoundingClientRect();
    const bar = document.querySelector('.file-bar').getBoundingClientRect();
    const row = document.querySelector('.file-clip[aria-current]').getBoundingClientRect();
    const player = ${AUDIO}.getBoundingClientRect();
    const hit = document.elementFromPoint(document.querySelector('.panel-resize').getBoundingClientRect().left + 2, player.top + player.height / 2);
    const next = document.querySelector('.file-clips-nav button:last-child').getBoundingClientRect();
    return { scrolled: document.querySelector('.file-body').scrollTop > 0, rowShown: row.top >= bar.bottom && row.bottom <= body.bottom, nextShown: next.top >= body.top && next.bottom <= bar.bottom, handle: hit?.className };
  })()`);
  assert.deepEqual(facts, { scrolled: true, rowShown: true, nextShown: true, handle: 'panel-resize' });
  const scrollTop = `document.querySelector('.file-body').scrollTop`;
  const shown = selector => `(() => {
    const bar = document.querySelector('.file-bar').getBoundingClientRect();
    const body = document.querySelector('.file-body').getBoundingClientRect();
    const box = document.querySelector('${selector}')?.getBoundingClientRect();
    return !!box && box.top >= bar.bottom && box.bottom <= body.bottom;
  })()`;
  const stayed = await page.evaluate(scrollTop);
  await page.click(`.file-clips-list li:nth-child(${TAKES.indexOf('take-23') + 1}) .file-clip`);
  await playing(page, 'take-23', 'long');
  assert.equal(await page.evaluate(scrollTop), stayed);
  await page.click(`.file-clips-list li:nth-child(${TAKES.indexOf(GONE) + 1}) .file-clip`);
  await page.until(shown('.file-note[role="alert"]'));
  await page.click('.file-clips-nav button:last-child');
  await playing(page, 'take-25', 'long');
  await page.until(shown('.file-clip[aria-current]'));
  await page.click('.file-clips-nav button:last-child');
  await playing(page, 'take-00', 'long');
  await page.until(shown('.file-clip[aria-current]'));
  assert.deepEqual(page.problems.filter(p => !/404/.test(p)), []);
});

test('audio has Download and no Open in new tab, because Chrome\'s media page cannot load a clip under the sandbox the server sends', { skip, timeout }, async t => {
  const page = await appPage(t);
  await page.click(link('one'));
  await playing(page, 'one');
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.file-actions a, .file-actions button')].map(b => b.getAttribute('aria-label'))`), ['Download', 'Close file']);
  assert.equal(await page.evaluate(`document.querySelector('.file-actions a[download]').getAttribute('href')`), `${urlOf('one')}&download=1`);
});
