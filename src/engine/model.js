// The data model the browser works with: the curated catalog (every title verified, tagged and explained)
// plus an optional wider "recognition" list (popular books and films from open data, with coarser tags)
// that lets us understand more of what a person has read and watched. Picks only ever come from the catalog.

import { norm, titleKeys, sameCreator, surnames } from "./normalize.js";

/**
 * @param catalog  parsed catalog.json: { tags: [[facet,id,label],…], items: [{id,k,t,c,y,x,h,l,pop,…}] }
 * @param recog    parsed recog.json (optional): { books: [[t,c,y,x,pop,alt]], films: [[t,c,y,x,pop,imdb,alts]] }
 */
export function buildModel(catalog, recog = null) {
  const tags = catalog.tags.map(([facet, id, label], i) => ({ i, facet, id, label, key: `${facet}:${id}` }));
  const tagIndex = new Map(tags.map((t) => [t.key, t.i]));
  /** Every title we can recognize. Catalog titles come first, so index < catalog.items.length means curated. */
  const known = [];
  catalog.items.forEach((it, idx) => {
    known.push({ n: known.length, curated: true, idx, k: it.k, t: it.t, c: it.c, y: it.y, x: it.x, pop: it.pop || 0, item: it });
  });
  const nCurated = known.length;
  const byKey = { b: new Map(), f: new Map() };
  const byImdb = new Map();
  const addKey = (kind, key, n) => {
    if (!key) return;
    const m = byKey[kind];
    const a = m.get(key);
    if (a) { if (!a.includes(n)) a.push(n); } else m.set(key, [n]);
  };
  for (const kn of known) {
    for (const key of titleKeys(kn.t)) addKey(kn.k, key, kn.n);
    for (const alt of kn.item.aka || []) for (const key of titleKeys(alt)) addKey(kn.k, key, kn.n);
    if (kn.item.imdb) byImdb.set(kn.item.imdb, kn.n);
  }
  if (recog) {
    for (const [t, c, y, x, pop, alt] of recog.books || []) {
      const kn = { n: known.length, curated: false, k: "b", t, c, y, x, pop: pop || 0 };
      known.push(kn);
      for (const key of titleKeys(t)) addKey("b", key, kn.n);
      if (alt) for (const key of titleKeys(alt)) addKey("b", key, kn.n);
    }
    for (const [t, c, y, x, pop, imdb, alts] of recog.films || []) {
      const kn = { n: known.length, curated: false, k: "f", t, c, y, x, pop: pop || 0 };
      known.push(kn);
      for (const key of titleKeys(t)) addKey("f", key, kn.n);
      for (const alt of alts || []) for (const key of titleKeys(alt)) addKey("f", key, kn.n);
      if (imdb) byImdb.set(imdb, kn.n);
    }
  }
  // How rare each tag is among curated titles: rare shared traits say more than common ones.
  const df = new Float64Array(tags.length);
  for (let i = 0; i < nCurated; i++) for (const t of known[i].x) df[t]++;
  const idf = Float64Array.from(df, (d) => Math.log(1 + nCurated / (1 + d)));
  // Base rates per kind over everything we recognize, for "you read far more X than most".
  const base = { b: new Float64Array(tags.length), f: new Float64Array(tags.length) };
  const total = { b: 0, f: 0 };
  for (const kn of known) { total[kn.k]++; for (const t of kn.x) base[kn.k][t]++; }
  for (const k of ["b", "f"]) for (let t = 0; t < tags.length; t++) base[k][t] = total[k] ? base[k][t] / total[k] : 0;
  // Who made what, for "you rate this author highly".
  const creatorKey = (kn) => surnames(kn.c).map((s) => `${kn.k}:${s}`);
  return { tags, tagIndex, known, nCurated, byKey, byImdb, idf, base, creatorKey, catalog };
}

/** Prefer curated titles, then the most widely read or watched. */
function best(model, list) {
  let pick = null;
  for (const n of list) {
    const kn = model.known[n];
    if (!pick || (kn.curated && !pick.curated) || (kn.curated === pick.curated && kn.pop > pick.pop)) pick = kn;
  }
  return pick;
}

/**
 * Find the title a library entry refers to. Returns the known title or null.
 * Books must agree on a surname; films on the year (one year of slack for festival vs. release dates).
 */
export function matchEntry(model, e) {
  if (e.imdb && model.byImdb.has(e.imdb)) return model.known[model.byImdb.get(e.imdb)];
  const map = model.byKey[e.kind];
  if (!map) return null;
  for (const key of titleKeys(e.title)) {
    const cands = map.get(key);
    if (!cands) continue;
    let ok;
    if (e.kind === "b") {
      ok = e.creator ? cands.filter((n) => sameCreator(e.creator, model.known[n].c)) : (cands.length === 1 ? cands : []);
    } else {
      if (e.year) {
        ok = cands.filter((n) => model.known[n].y === e.year);
        if (!ok.length) ok = cands.filter((n) => Math.abs(model.known[n].y - e.year) <= 1);
      } else if (e.creator) ok = cands.filter((n) => sameCreator(e.creator, model.known[n].c));
      else ok = cands.length === 1 ? cands : [];
    }
    if (ok.length) return best(model, ok);
  }
  return null;
}

/** Goodreads shelves and StoryGraph tags people use that map straight onto our vocabulary. */
const SHELF_TAGS = {
  fantasy: "g:fantasy", "high-fantasy": "g:epic-fantasy", "epic-fantasy": "g:epic-fantasy", "urban-fantasy": "g:urban-fantasy", romantasy: "g:romantasy",
  "sci-fi": "g:sci-fi", scifi: "g:sci-fi", "science-fiction": "g:sci-fi", sf: "g:sci-fi", dystopian: "g:dystopian", dystopia: "g:dystopian",
  horror: "g:horror", gothic: "g:gothic", mystery: "g:mystery", mysteries: "g:mystery", crime: "g:crime", thriller: "g:thriller", thrillers: "g:thriller",
  suspense: "g:thriller", romance: "g:romance", "historical-fiction": "g:historical", historical: "g:historical", "historical-romance": "g:historical-romance",
  classics: "g:classic", classic: "g:classic", "literary-fiction": "g:literary", literary: "g:literary", ya: "g:ya", "young-adult": "g:ya",
  childrens: "g:childrens", "middle-grade": "g:childrens", memoir: "g:memoir", memoirs: "g:memoir", biography: "g:biography", biographies: "g:biography",
  history: "g:history", science: "g:science", "popular-science": "g:science", nature: "g:nature", philosophy: "g:philosophy", psychology: "g:psychology",
  "self-help": "g:self-help", business: "g:business", economics: "g:business", politics: "g:politics", "true-crime": "g:true-crime", essays: "g:essays",
  travel: "g:travel", "graphic-novels": "g:graphic", "graphic-novel": "g:graphic", comics: "g:graphic", manga: "g:graphic", "short-stories": "g:short-stories",
  poetry: "g:poetry", plays: "g:play", drama: "g:play", humor: "m:funny", humour: "m:funny", funny: "m:funny", "magical-realism": "g:magical-realism",
  lgbt: "th:queer", lgbtq: "th:queer", queer: "th:queer", war: "g:war", western: "g:western", westerns: "g:western", adventure: "g:adventure",
  mythology: "th:gods-myth", feminism: "th:gender", "coming-of-age": "g:coming-of-age", "cozy-mystery": "g:cozy-mystery", satire: "g:satire",
};

/** Tags implied by a person's own shelves, for titles we don't otherwise recognize. */
export function shelfTags(model, shelves) {
  const out = [];
  for (const s of shelves || []) {
    const key = SHELF_TAGS[String(s).toLowerCase().replace(/[\s_]+/g, "-")];
    const i = key ? model.tagIndex.get(key) : undefined;
    if (i !== undefined && !out.includes(i)) out.push(i);
  }
  return out;
}

/**
 * Match a whole library. Returns rows { entry, known (or null), tags } plus counts.
 * A row with no match can still carry tags from the person's shelves.
 */
export function matchLibrary(model, entries) {
  const rows = [];
  let matched = 0, curated = 0;
  for (const entry of entries) {
    const known = matchEntry(model, entry);
    let tags = known ? known.x : shelfTags(model, entry.shelves);
    if (known) { matched++; if (known.curated) curated++; }
    rows.push({ entry, known, tags });
  }
  return { rows, matched, curated, total: entries.length };
}

/** Find catalog titles by what someone types. Returns up to `limit` known curated titles. */
export function searchCatalog(model, query, limit = 8, kind = null) {
  const q = norm(query);
  if (q.length < 2) return [];
  const words = q.split(" ");
  const scored = [];
  for (let i = 0; i < model.nCurated; i++) {
    const kn = model.known[i];
    if (kind && kn.k !== kind) continue;
    const t = norm(kn.t), c = norm(kn.c);
    let s = 0;
    if (t === q) s = 100;
    else if (t.startsWith(q)) s = 60;
    else if ((" " + t).includes(" " + q)) s = 40;
    else if (words.every((w) => (" " + t + " " + c).includes(" " + w))) s = 20;
    if (!s) continue;
    scored.push([s + Math.log10(1 + kn.pop), kn]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].n - b[1].n);
  return scored.slice(0, limit).map((x) => x[1]);
}
