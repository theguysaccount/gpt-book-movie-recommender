// "More with the same DNA": nearest catalog titles by shared, distinctive tags. Used by the static
// "books like X" pages at build time and by "more like this" in the browser.

const QUIET = new Set(["w:contemporary", "p:medium", "g:drama", "g:literary", "s:plot-driven", "s:first-person"]);

/** idf-weighted cosine between two tag lists. */
export function tagCosine(a, b, idf) {
  const B = new Set(b);
  let dot = 0, na = 0, nb = 0;
  for (const t of a) { const w = idf[t]; na += w * w; if (B.has(t)) dot += w * w; }
  for (const t of b) { const w = idf[t]; nb += w * w; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Up to `limit` titles most like item `n` (an index into model.known, curated only), excluding `skip` (Set of n),
 * at most one per creator. Each result carries the shared tags worth naming.
 */
export function similarTo(model, n, { limit = 8, skip = new Set(), kind = null } = {}) {
  const me = model.known[n];
  const myCreators = new Set(model.creatorKey(me));
  const scored = [];
  for (let i = 0; i < model.nCurated; i++) {
    if (i === n || skip.has(i)) continue;
    const kn = model.known[i];
    if (kind && kn.k !== kind) continue;
    const s = tagCosine(me.x, kn.x, model.idf);
    if (s > 0) scored.push([s, i]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out = [];
  const used = new Set();
  for (const [s, i] of scored) {
    const kn = model.known[i];
    const cks = model.creatorKey(kn);
    if (cks.some((c) => used.has(c) || myCreators.has(c))) continue;
    cks.forEach((c) => used.add(c));
    const mine = new Set(me.x);
    const shared = kn.x.filter((t) => mine.has(t) && !QUIET.has(model.tags[t].key))
      .sort((a, b) => model.idf[b] - model.idf[a] || a - b).slice(0, 3);
    out.push({ kn, score: s, shared });
    if (out.length >= limit) break;
  }
  return out;
}

/** "a slow burn, found family and lyrical writing" */
export function listPhrase(labels) {
  if (labels.length <= 1) return labels.join("");
  return labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
}
