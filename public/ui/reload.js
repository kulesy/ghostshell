// Reloads the open page once the server restarts onto a new commit, which a restart does not reach by itself. See https://github.com/kulesy/ghostshell/issues/168.
import { approvalsOpen } from './approvals.js';
import { Banner } from './banner.js';
import { Button } from './banners.js';
import { hasUnsent } from './draft.js';
import { html, useEffect, useRef, useState } from './html.js';
import { noticeCommit, RELOAD_TITLE, reloadStep } from './reload-rules.js';

// True once the bar should show. `ix` is the session list, which carries the server's commit and is read again every 15 seconds and when the page comes back into view.
// `open` is the draft key of the prompt box on screen, or null when there is none.
export function useReload(ix, open) {
  const seen = useRef(null);
  const box = useRef(null);
  box.current = open;
  const [bar, setBar] = useState(false);
  useEffect(() => {
    const next = noticeCommit(seen.current, ix);
    seen.current = next.seen;
    const step = reloadStep({ changed: next.changed, unsent: hasUnsent(box.current), approving: approvalsOpen() });
    if (step === 'now') location.reload();
    else if (step === 'bar') setBar(true);
  }, [ix]);
  return bar;
}

export function ReloadBar() {
  return html`<div class="reload-bar"><${Banner} id="banner-reload" title=${RELOAD_TITLE} text="" actions=${html`<${Button} action=${{ label: 'Reload' }} onClick=${() => location.reload()} />`} /></div>`;
}
