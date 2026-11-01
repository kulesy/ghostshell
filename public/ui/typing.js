// Tells the server the owner is typing in a group's chat, so it holds back a ranked update for a while. It fires on a change to the text, not on a timer.
import { api } from './api.js';
import { pingDue, typingOffered } from './group-rules.js';
import { useStore } from './hooks.js';
import { useEffect, useRef } from './html.js';
import { sessionIndex } from './subs.js';

export function useTypingPing(id, text) {
  const offered = useStore(sessionIndex, s => typingOffered(s.ix, id));
  const last = useRef(0);
  // A draft the box opens with is not typing, so it sends nothing until the text changes.
  const opened = useRef(text);
  useEffect(() => {
    if (opened.current !== null && text === opened.current) return;
    opened.current = null;
    if (!offered || !text.trim() || !pingDue(last.current)) return;
    last.current = Date.now();
    api(`api/sessions/${encodeURIComponent(id)}/typing`, {}).catch(() => {});
  }, [offered, id, text]);
}
