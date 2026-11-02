// The sign-in and update banners: what the server last worked out, read from api/banners, and the buttons that act on it.
import { api } from './api.js';
import { Banner } from './banner.js';
import { keptWhileRestarting, loginBanner, pollMs, updateBanner } from './banner-rules.js';
import { html, useCallback, useEffect, useRef, useState } from './html.js';

// A reading older than the one on screen is dropped, so a slow answer cannot put an earlier state back. `act` resolves with the server's
// refusal, or an empty string.
export function useBanners(on) {
  const [banners, setBanners] = useState(null);
  const count = useRef({ asked: 0, drawn: 0 });
  const load = useCallback(async () => {
    if (!on) return;
    const mine = ++count.current.asked;
    try {
      const got = await api('api/banners');
      if (mine > count.current.drawn) { count.current.drawn = mine; setBanners(got); }
    } catch {
      setBanners(keptWhileRestarting);
    }
  }, [on]);
  const act = useCallback(async step => {
    try {
      const mine = ++count.current.asked;
      const got = await api(`api/banners/${step}`, {});
      if (mine > count.current.drawn) { count.current.drawn = mine; setBanners(got); }
      return '';
    } catch (e) {
      return e.message;
    }
  }, []);

  const every = pollMs(banners);
  useEffect(() => {
    if (!on) return undefined;
    const refresh = () => { if (!document.hidden) load(); };
    load();
    const timer = setInterval(refresh, every);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [on, every, load]);
  return { banners, act, load };
}

// A button that its own press makes busy keeps the focus, so it is marked aria-disabled rather than disabled.
export function Button({ action, onClick }) {
  const [sending, setSending] = useState(false);
  const waiting = sending || action.busy;
  const press = async () => {
    if (waiting) return;
    setSending(true);
    try { await onClick(); } finally { setSending(false); }
  };
  return html`<button class="btn" data-variant=${action.variant || null} type="button" disabled=${action.blocked} aria-disabled=${waiting ? 'true' : null} data-disabled=${waiting || null} onClick=${press}>${action.label}</button>`;
}

// A refusal answers one press, so it goes at the next press or once the server's state moves on.
export function useRefusal(...moved) {
  const [refused, setRefused] = useState('');
  useEffect(() => setRefused(''), moved);
  return [refused, setRefused];
}

export function LoginBanner({ banners, act }) {
  const view = loginBanner(banners?.login);
  const [refused, setRefused] = useRefusal(banners?.login?.stage, banners?.login?.signedOut);
  if (!view) return null;
  const start = async () => { setRefused(''); setRefused(await act('sign-in')); };
  return html`<${Banner} ...${view} problem=${refused || view.problem} actions=${html`<${Button} action=${view.action} onClick=${start} />`} />`;
}

export function UpdateBanner({ banners, act }) {
  const view = updateBanner(banners?.update);
  const [refused, setRefused] = useRefusal(banners?.update?.stage, banners?.update?.count, banners?.update?.kind);
  if (!view) return null;
  const go = async () => { setRefused(''); setRefused(await act('update')); };
  const list = view.changes.length
    ? html`<ul class="offer-list">
        ${view.changes.map(c => html`<li>${c.url ? html`<a href=${c.url} target="_blank" rel="noopener noreferrer">${c.title}</a>` : c.title}</li>`)}
        ${view.more ? html`<li>and ${view.more} more</li>` : null}
      </ul>`
    : null;
  return html`<${Banner} ...${view} problem=${refused || view.problem} actions=${html`<${Button} action=${view.action} onClick=${go} />`}>${list}<//>`;
}
