// From a matched library to a taste profile, ranked picks and the reasons for each pick.
// Deterministic: the same library and catalog always give the same picks in the same order.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Tags too generic to be worth saying out loud in an explanation. */
const QUIET = new Set(["w:contemporary", "p:medium", "g:drama", "g:literary", "s:plot-driven", "s:first-person"]);

/**
 * Turn each library row into a signed weight: how much this title says about what the person likes.
 * Ratings are read relative to the person's own average, so a harsh rater's 4 counts for more than a generous one's.
 */
export function weighRows(rows) {
  const rated = rows.filter((r) => r.entry.rating != null && r.entry.status !== "want");
  const n = rated.length;
  const sum = rated.reduce((a, r) => a + r.entry.rating, 0);
  // Few ratings: lean on a typical average of 3.6 until we know better.
  const mean = (sum + 3.6 * 3) / (n + 3);
  const variance = n ? rated.reduce((a, r) => a + (r.entry.rating - mean) ** 2, 0) / n : 1;
  const sd = Math.max(0.75, Math.sqrt(variance));
  const out = [];
  for (const r of rows) {
    const e = r.entry;
    if (e.status === "want" || e.status === "doing") continue;
    let w;
    if (e.rating != null) w = clamp((e.rating - mean) / sd, -2.2, 2.2) + (e.liked ? 0.4 : 0);
    else if (e.liked) w = 1.3;
    else if (e.status === "dropped") w = -1.2;
    else if (e.status === "notforme") w = -0.5;   // dismissed a pick: a mild "no"
    else w = 0.2;                       // finished and logged, but no rating: a faint yes
    out.push({ ...r, w });
  }
  return { weighted: out, mean: n ? sum / n : null, ratedCount: n };
}

/**
 * The taste profile: for every tag, how the person rates titles that carry it (shrunk toward zero when we have
 * seen only a few), plus a small lift for tags they choose far more often than most people do.
 */
export function buildTaste(model, rows) {
  const { weighted, mean, ratedCount } = weighRows(rows);
  const T = model.tags.length;
  const S = new Float64Array(T), N = new Float64Array(T), R = new Float64Array(T), RN = new Float64Array(T);
  const kindCount = { b: 0, f: 0 };
  const creators = new Map();
  for (const r of weighted) {
    if (!r.tags.length && !r.known) continue;
    kindCount[r.entry.kind]++;
    for (const t of r.tags) {
      S[t] += r.w; N[t] += 1;
      if (r.entry.rating != null) { R[t] += r.entry.rating; RN[t] += 1; }
    }
    if (r.known) for (const ck of model.creatorKey(r.known)) {
      const c = creators.get(ck) || { sum: 0, n: 0 };
      c.sum += r.w; c.n += 1; creators.set(ck, c);
    }
  }
  const used = weighted.filter((r) => r.tags.length || r.known);
  const total = used.length;
  const taste = new Float64Array(T);
  const trust = Math.min(1, total / 8);
  for (let t = 0; t < T; t++) {
    if (!N[t]) continue;
    const pref = S[t] / (N[t] + 2.5);
    // Share of this person's titles with the tag, against the share among everything we recognize.
    let lift = 0;
    for (const k of ["b", "f"]) {
      if (!kindCount[k]) continue;
      const share = N[t] / total;
      lift += (kindCount[k] / total) * clamp(Math.log2((share + 0.02) / (model.base[k][t] + 0.02)), -1.5, 2);
    }
    taste[t] = pref + 0.25 * lift * trust;
  }
  return { taste, S, N, R, RN, mean, ratedCount, weighted: used, creators, kindCount, total };
}

/** Jaccard overlap of two sorted-or-not tag lists. */
function overlap(a, b) {
  let inter = 0;
  const set = a.length < b.length ? new Set(a) : new Set(b);
  for (const t of a.length < b.length ? b : a) if (set.has(t)) inter++;
  return inter / (a.length + b.length - inter || 1);
}

function scoreKnown(model, profile, kn, likedEdges, dislikedEdges) {
  const { taste } = profile;
  let num = 0, den = 0;
  for (const t of kn.x) { const w = model.idf[t]; num += taste[t] * w; den += w * w; }
  let score = den ? num / Math.sqrt(den) : 0;
  let edge = 0;
  if (kn.curated) {
    edge = Math.min(0.9, likedEdges.get(kn.n) || 0) - Math.min(0.5, dislikedEdges.get(kn.n) || 0);
    score += edge;
  }
  let cSum = 0, cN = 0;
  for (const ck of model.creatorKey(kn)) { const c = profile.creators.get(ck); if (c) { cSum += c.sum; cN += c.n; } }
  if (cN) score += clamp(0.25 * (cSum / cN), -0.4, 0.5);
  score += 0.01 * Math.log10(1 + kn.pop);
  return score;
}

/** Curated links, in both directions, from titles the person rated: forward links count for more. */
function edgeMaps(model, profile) {
  const liked = new Map(), disliked = new Map();
  const add = (m, n, v) => m.set(n, (m.get(n) || 0) + v);
  const mine = new Map();
  for (const r of profile.weighted) if (r.known && r.known.curated) mine.set(r.known.n, r.w);
  for (let n = 0; n < model.nCurated; n++) {
    const links = model.known[n].item.l || [];
    const w = mine.get(n);
    for (const [target] of links) {
      if (w !== undefined) {                       // I rated n; n recommends target
        if (w > 0) add(liked, target, 0.45 * w); else if (w < -0.8) add(disliked, target, 0.3);
      }
      const wt = mine.get(target);                 // I rated target; n recommends it, so n is close to it
      if (wt !== undefined && wt > 0) add(liked, n, 0.2 * wt);
    }
  }
  return { liked, disliked };
}

/** Why this title, for this person. */
export function explain(model, profile, kn) {
  const { taste, N } = profile;
  const reasons = [];
  // Titles of theirs that point here, by shared distinctive traits or a hand-written link.
  for (const r of profile.weighted) {
    if (r.w <= 0.15 || !r.tags.length) continue;
    const set = new Set(r.tags);
    let s = 0;
    const shared = [];
    for (const t of kn.x) if (set.has(t)) { s += model.idf[t] * (taste[t] > 0 ? 1 : 0.3); shared.push(t); }
    let link = null;
    if (r.known && r.known.curated) {
      const l = (r.known.item.l || []).find(([target]) => target === kn.n);
      if (l) { link = l[1]; s += 3; }
    }
    if (kn.curated && r.known) {
      const back = (kn.item.l || []).find(([target]) => target === r.known.n);
      if (back && !link) s += 1.2;
    }
    if (s <= 0) continue;
    reasons.push({ strength: s * r.w, title: r.entry.title, kind: r.entry.kind, rating: r.entry.rating, liked: r.entry.liked, link, shared });
  }
  reasons.sort((a, b) => b.strength - a.strength || a.title.localeCompare(b.title));
  const because = reasons.slice(0, 3);
  // The traits to name: what this title has that the person rates highest, spread across facets.
  const cand = kn.x.filter((t) => taste[t] > 0.08 && N[t] >= 1 && !QUIET.has(model.tags[t].key))
    .map((t) => ({ t, v: taste[t] * model.idf[t] }))
    .sort((a, b) => b.v - a.v || a.t - b.t);
  const traits = [];
  const perFacet = {};
  for (const c of cand) {
    const f = model.tags[c.t].facet;
    if ((perFacet[f] || 0) >= 2) continue;
    perFacet[f] = (perFacet[f] || 0) + 1;
    traits.push(c.t);
    if (traits.length === 4) break;
  }
  const caveats = kn.x.filter((t) => taste[t] < -0.3 && N[t] >= 2 && model.tags[t].key !== "p:medium")
    .sort((a, b) => taste[a] - taste[b]).slice(0, 2);
  return { because, traits, caveats };
}

/**
 * Rank catalog titles for this person.
 * @param opts.kind     "b", "f" or null for both
 * @param opts.exclude  Set of known.n the person already has (any status)
 * @param opts.hidden   Set of catalog ids the person dismissed
 * @param opts.limit    how many to return
 */
export function rankPicks(model, profile, opts = {}) {
  const { kind = null, exclude = new Set(), hidden = new Set(), limit = 20, fiction = null, filter = null, adjust = null } = opts;
  const { liked, disliked } = edgeMaps(model, profile);
  const scored = [];
  for (let n = 0; n < model.nCurated; n++) {
    const kn = model.known[n];
    if (kind && kn.k !== kind) continue;
    if (exclude.has(n) || hidden.has(kn.item.id)) continue;
    if (fiction !== null && kn.k === "b" && !!kn.item.nf === fiction) continue;
    if (filter && !filter(kn)) continue;
    scored.push({ kn, score: scoreKnown(model, profile, kn, liked, disliked) + (adjust ? adjust(kn) : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.kn.n - b.kn.n);
  const count = scored.length;
  // Greedy re-rank for variety: one title per creator near the top, and a penalty for near-duplicates.
  const out = [];
  const creatorUse = new Map();
  const pool = scored.slice(0, Math.max(limit * 8, 120));
  const rankOf = new Map(scored.map((s, i) => [s.kn.n, i]));
  while (out.length < limit && pool.length) {
    let bestI = -1, bestV = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const cks = model.creatorKey(s.kn);
      const uses = Math.max(0, ...cks.map((ck) => creatorUse.get(ck) || 0));
      if (uses >= (out.length < 12 ? 1 : 2)) continue;
      let sim = 0;
      for (const o of out) sim = Math.max(sim, overlap(s.kn.x, o.kn.x));
      const v = s.score - 0.35 * sim;
      if (v > bestV) { bestV = v; bestI = i; }
    }
    if (bestI < 0) break;
    const [s] = pool.splice(bestI, 1);
    for (const ck of model.creatorKey(s.kn)) creatorUse.set(ck, (creatorUse.get(ck) || 0) + 1);
    const pct = rankOf.get(s.kn.n) / Math.max(1, count);
    out.push({ kn: s.kn, score: s.score, fit: pct < 0.03 ? "strong" : pct < 0.12 ? "good" : "fair", why: explain(model, profile, s.kn) });
  }
  return out;
}

/**
 * "Outside your usual shelf": titles in a genre the person has never logged that still carry the moods,
 * themes and styles they rate highest.
 */
export function stretchPicks(model, profile, opts = {}) {
  const { kind = null, exclude = new Set(), hidden = new Set(), limit = 4 } = opts;
  const { taste, N } = profile;
  const scored = [];
  for (let n = 0; n < model.nCurated; n++) {
    const kn = model.known[n];
    if (kind && kn.k !== kind) continue;
    if (exclude.has(n) || hidden.has(kn.item.id)) continue;
    const genres = kn.x.filter((t) => model.tags[t].facet === "g");
    if (!genres.length || genres.some((t) => N[t] > 0)) continue;
    let num = 0, den = 0, knownTraits = 0;
    for (const t of kn.x) {
      if (model.tags[t].facet === "g") continue;
      const w = model.idf[t]; num += taste[t] * w; den += w * w;
      if (N[t] > 0 && taste[t] > 0) knownTraits++;
    }
    if (knownTraits < 3 || !den) continue;
    scored.push({ kn, score: num / Math.sqrt(den), newGenre: genres[0] });
  }
  scored.sort((a, b) => b.score - a.score || a.kn.n - b.kn.n);
  const out = [], seenGenre = new Set(), seenCreator = new Set();
  for (const s of scored) {
    const ck = model.creatorKey(s.kn).join("|");
    if (seenGenre.has(s.newGenre) || seenCreator.has(ck) || s.score <= 0) continue;
    seenGenre.add(s.newGenre); seenCreator.add(ck);
    out.push({ ...s, fit: "stretch", why: explain(model, profile, s.kn) });
    if (out.length === limit) break;
  }
  return out;
}

/** Order the person's own want-list by fit. Works for any recognized title, curated or not. */
export function rankWantList(model, profile, rows, limit = 10) {
  const { liked, disliked } = edgeMaps(model, profile);
  const scored = [];
  for (const r of rows) {
    if (r.entry.status !== "want" || !r.known) continue;
    scored.push({ kn: r.known, entry: r.entry, score: scoreKnown(model, profile, r.known, liked, disliked) });
  }
  scored.sort((a, b) => b.score - a.score || a.kn.n - b.kn.n);
  return scored.slice(0, limit).map((s) => ({ ...s, fit: "want", why: explain(model, profile, s.kn) }));
}

/** What to show on the profile: best and worst traits per facet, with the person's own numbers behind each. */
export function summarize(model, profile) {
  const { taste, N, R, RN, mean } = profile;
  const rows = [];
  for (let t = 0; t < model.tags.length; t++) {
    if (N[t] < 2) continue;
    const tag = model.tags[t];
    if (tag.facet === "p" && tag.id === "medium") continue;
    rows.push({ t, tag, n: N[t], avg: RN[t] ? R[t] / RN[t] : null, strength: taste[t] * Math.min(1, N[t] / 4) });
  }
  const top = (facets, k, sign = 1) => rows.filter((r) => facets.includes(r.tag.facet) && sign * r.strength > 0.06)
    .sort((a, b) => sign * (b.strength - a.strength) || a.t - b.t).slice(0, k);
  const loves = {
    genres: top(["g"], 5), themes: top(["th"], 6), moods: top(["m", "p"], 5), styles: top(["s"], 5), worlds: top(["w"], 4),
  };
  const avoids = top(["g", "th", "m", "s", "p"], 5, -1);
  const authors = [...profile.creators.entries()].filter(([, c]) => c.n >= 2 && c.sum / c.n > 0.3)
    .sort((a, b) => b[1].sum - a[1].sum || a[0].localeCompare(b[0])).slice(0, 5).map(([key, c]) => ({ key, n: c.n }));
  return { loves, avoids, authors, mean, name: archetype(model, loves) };
}

const MOOD_WORDS = {
  dark: "Dark", bleak: "Bleak", hopeful: "Hopeful", heartwarming: "Warm-Hearted", funny: "Laughing", witty: "Witty", absurd: "Absurdist",
  whimsical: "Whimsical", melancholic: "Melancholy", nostalgic: "Nostalgic", tense: "Tension-Seeking", creepy: "Unnerved", disturbing: "Unflinching",
  romantic: "Romantic", steamy: "Steamy", cozy: "Cozy", epic: "Epic", intimate: "Intimate", cerebral: "Cerebral", philosophical: "Philosophical",
  gritty: "Gritty", violent: "Hard-Boiled", playful: "Playful", bittersweet: "Bittersweet", uplifting: "Uplifted", angry: "Furious", surreal: "Surreal",
  "mind-bending": "Mind-Bent", tearjerker: "Teary", inspiring: "Inspired", cynical: "Cynical", tender: "Tender", quiet: "Quiet", chaotic: "Chaotic",
  haunting: "Haunted", thrilling: "Thrill-Seeking", charming: "Charmed", raw: "Raw", deadpan: "Deadpan", earnest: "Earnest", slow: "Patient", fast: "Fast-Moving",
};
const NOUN_WORDS = {
  "g:fantasy": "Spellbinder", "g:epic-fantasy": "Quest-Taker", "g:urban-fantasy": "City Sorcerer", "g:romantasy": "Court Romantic", "g:grimdark": "Grim Campaigner",
  "g:sci-fi": "Futurist", "g:hard-sf": "Engineer of Tomorrows", "g:space-opera": "Starfarer", "g:cyberpunk": "Console Cowboy", "g:dystopian": "Dissident",
  "g:post-apocalyptic": "Survivor", "g:horror": "Night Watcher", "g:gothic": "Manor Ghost", "g:mystery": "Sleuth", "g:whodunit": "Armchair Detective",
  "g:cozy-mystery": "Village Sleuth", "g:noir": "Night Owl", "g:crime": "Case Cracker", "g:thriller": "Edge-of-Seat Regular", "g:psychological-thriller": "Mind-Game Player",
  "g:spy": "Double Agent", "g:heist": "Safecracker", "g:romance": "Romantic", "g:rom-com": "Meet-Cute Collector", "g:historical-romance": "Ballroom Regular",
  "g:historical": "Time Traveler", "g:classic": "Classicist", "g:literary": "Close Reader", "g:family-saga": "Saga Keeper", "g:coming-of-age": "Late Bloomer",
  "g:comedy": "Comedian", "g:dark-comedy": "Gallows Humorist", "g:satire": "Satirist", "g:war": "War Correspondent", "g:western": "Drifter", "g:adventure": "Adventurer",
  "g:action": "Stunt Double", "g:ya": "Forever Young Reader", "g:childrens": "Storytime Keeper", "g:animation": "Animator at Heart", "g:musical": "Show-Stopper",
  "g:superhero": "Caped Regular", "g:documentary": "Witness", "g:memoir": "Confidant", "g:biography": "Life Collector", "g:history": "Historian", "g:science": "Curious Mind",
  "g:nature": "Field Naturalist", "g:philosophy": "Philosopher", "g:psychology": "Mind Reader", "g:true-crime": "Cold-Case Reader", "g:essays": "Essayist",
  "g:journalism": "Reporter", "g:magical-realism": "Dreamwalker", "g:myth-retelling": "Myth Keeper", "g:fairy-tale": "Tale Spinner", "g:graphic": "Panel Reader",
  "g:drama": "Character Watcher", "g:legal": "Juror", "g:sports": "Underdog Backer", "g:short-stories": "Short-Form Devotee", "g:poetry": "Poet",
};

/** A short, shareable name for a taste: top mood + top genre, e.g. "Bittersweet Starfarer". */
export function archetype(model, loves) {
  const mood = (loves.moods || []).map((r) => MOOD_WORDS[r.tag.id]).find(Boolean);
  const noun = (loves.genres || []).map((r) => NOUN_WORDS[r.tag.key]).find(Boolean);
  if (!mood && !noun) return "Open-Minded Explorer";
  return `${mood || "Curious"} ${noun || "Explorer"}`;
}
