// Everything the person has is kept in this browser's localStorage, never anywhere else.
// Every read and write is guarded: private windows, full storage or blocked storage just mean "not saved".

const KEY = "shelfscreen:v1";
const EMPTY = () => ({ entries: [], hidden: [], picksKind: "all", updated: null, sample: false });

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY();
    const s = JSON.parse(raw);
    return { ...EMPTY(), ...s, entries: Array.isArray(s.entries) ? s.entries : [], hidden: Array.isArray(s.hidden) ? s.hidden : [] };
  } catch { return EMPTY(); }
}

/** Returns true if saved. */
export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, updated: new Date().toISOString() }));
    return true;
  } catch { return false; }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
