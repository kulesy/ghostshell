// Playing a linked audio file in the file panel, and moving between the clips a chat links.
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';

// The server's bytes still decide what a file is. This name test only finds a chat's clips and starts sound in the tap.
export const CLIP = /\.(?:wav|mp3|m4a)$/i;

// One element plays every clip: a phone starts sound only inside a tap, so play() runs in the click, before the preview answers, on an element that stays.
const player = new Audio();
player.controls = true;
let loaded = '';

export function playClip(url) {
  if (url !== loaded) {
    loaded = url;
    player.src = url;
  }
  player.play().catch(() => {});
}

export function stopClip() {
  player.pause();
  loaded = '';
  player.removeAttribute('src');
  player.load();
}

// The paths the chat links to as clips, once each and in the order the page shows them.
export function clipsIn(from) {
  const links = from?.closest('#transcript')?.querySelectorAll('a[data-file]') ?? [];
  return [...new Set([...links].map(a => a.dataset.file).filter(path => CLIP.test(path)))];
}

// The player for the clip at `url`. Closing the panel pauses it and keeps its place, so opening it again returns to the same spot.
export function Player({ url, name }) {
  const slot = useRef(null);
  const [failed, setFailed] = useState('');

  useLayoutEffect(() => {
    slot.current.append(player);
    return () => {
      player.pause();
      player.remove();
    };
  }, []);

  useEffect(() => {
    player.setAttribute('aria-label', name);
  }, [name]);

  // A file that is audio by its bytes under another extension was not started in the tap.
  useEffect(() => {
    if (url !== loaded) playClip(url);
    const fail = () => setFailed(url);
    if (player.error) fail();
    player.addEventListener('error', fail);
    return () => player.removeEventListener('error', fail);
  }, [url]);

  return html`<div class="file-audio"><div ref=${slot}></div>${failed === url ? html`<p class="file-note" role="alert">This browser cannot play this file.</p>` : null}</div>`;
}

const base = path => path.split('/').pop();

// Previous and Next wrap around, so neither is ever disabled and the focus never leaves the one pressed.
export function Clips({ clips, path, onPick }) {
  if (clips.length < 2) return null;
  const at = clips.indexOf(path);
  const step = by => onPick(clips[(at + by + clips.length) % clips.length]);
  return html`<div class="file-clips">
    <div class="file-clips-nav">
      <button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${() => step(-1)}>Previous</button>
      <span class="file-clips-count" role="status">${at + 1} of ${clips.length}</span>
      <button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${() => step(1)}>Next</button>
    </div>
    <ol class="file-clips-list">${clips.map(p => html`<li key=${p}><button class="file-clip" type="button" title=${p} aria-current=${p === path ? 'true' : undefined} onClick=${() => onPick(p)}>${base(p)}</button></li>`)}</ol>
  </div>`;
}
