export const local = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(`capcom.${k}`)) ?? fallback; } catch { return fallback; } },
  // Whether the value was kept. A full or blocked store drops it, which the file editor needs to know.
  set(k, v) { try { localStorage.setItem(`capcom.${k}`, JSON.stringify(v)); return true; } catch { return false; } },
};
