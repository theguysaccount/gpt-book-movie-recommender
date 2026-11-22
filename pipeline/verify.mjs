// Verify that every title in the catalog, and every title it recommends, really exists:
//   books against Open Library (first the downloaded list of the most-read works, then its search API),
//   films against Wikidata (first the downloaded film list, then a targeted search).
// Writes data/catalog/verified.json. Titles that cannot be found are left out of the site by the build.
//   node pipeline/verify.mjs [--offline]     (--offline: use only the downloaded lists, no API calls)
// Safe to re-run: results found through an API are kept for 80 days; everything else is re-checked each run.
import { readJson, writeJson, fetchJson, sparql, sleep, today, warn, note, summary } from "./lib.mjs";
import { loadRaw, mergeItems, outsideTargets } from "./catalog.mjs";
import { norm, titleKeys, sameCreator } from "../src/engine/normalize.js";

const OFFLINE = process.argv.includes("--offline");
const RECHECK_DAYS = 80;
const MIN_OK_SHARE = 0.85;          // below this, something is wrong with a source, not with the titles
const TIME_BUDGET_MS = Number(process.env.SS_VERIFY_BUDGET_MS || 50 * 60 * 1000);
const started = Date.now();
const day = today();
const daysSince = (d) => (Date.parse(day) - Date.parse(d)) / 86400000;

/** Keys for matching titles: the usual variants plus the part after a colon ("The Sandman: Preludes" → "preludes"). */
function verifyKeys(title) {
  const keys = titleKeys(title);
  const raw = String(title).replace(/\s*\([^)]*\)\s*$/, "");
  const i = raw.indexOf(": ");
  if (i > 0) { const k = norm(raw.slice(i + 2)); if (k.length > 3 && !keys.includes(k)) keys.push(k); }
  return keys;
}
const keysMeet = (a, b) => { const B = new Set(verifyKeys(b)); return verifyKeys(a).some((k) => B.has(k)); };

// ---------- local lists ----------
const booksIdx = readJson("data/index/books.json", { books: [] }).books;
const filmsIdx = readJson("data/index/films.json", { films: [] }).films;
const bookMap = new Map(), filmMap = new Map();
const add = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
for (const b of booksIdx) { for (const k of verifyKeys(b.t)) add(bookMap, k, b); if (b.alt) for (const k of verifyKeys(b.alt)) add(bookMap, k, b); }
for (const f of filmsIdx) { for (const k of verifyKeys(f.t)) add(filmMap, k, f); for (const a of f.aka || []) for (const k of verifyKeys(a)) add(filmMap, k, f); }

function localBook(w) {
  const seen = new Set();
  for (const k of verifyKeys(w.t)) for (const b of bookMap.get(k) || []) {
    if (seen.has(b.key)) continue; seen.add(b.key);
    if (sameCreator(w.c, b.a.join(" & "))) return { s: "ok", src: "ol", id: b.key, t: b.t, c: b.a[0], y: b.y, pop: b.pop, how: "list" };
  }
  return null;
}

function pickFilm(w, cands) {
  const byDir = cands.filter((f) => f.d?.length && sameCreator(w.c, f.d.join(" & ")));
  const near = (f) => Math.abs(f.y - w.y) <= 1;
  const best = (list) => list.sort((a, b) => Math.abs(a.y - w.y) - Math.abs(b.y - w.y) || b.sl - a.sl)[0];
  // Director and year agree; or the director agrees and the year is off (we take Wikidata's year);
  // or there is no director on record and the year agrees exactly.
  return best(byDir.filter(near)) || best(byDir) || best(cands.filter((f) => !f.d?.length && f.y === w.y)) || null;
}

function localFilm(w) {
  const cands = new Map();
  for (const k of verifyKeys(w.t)) for (const f of filmMap.get(k) || []) cands.set(f.q, f);
  const f = pickFilm(w, [...cands.values()]);
  return f ? { s: "ok", src: "wd", id: f.q, t: f.t, c: (f.d || []).join(" & "), y: f.y, pop: f.sl, imdb: f.imdb, how: "list" } : null;
}

// ---------- APIs ----------
async function searchBook(w) {
  const fields = "key,title,subtitle,author_name,first_publish_year,readinglog_count";
  const tries = [
    `https://openlibrary.org/search.json?title=${encodeURIComponent(w.t)}&author=${encodeURIComponent(w.c.split(/\s+&\s+/)[0])}&fields=${fields}&limit=10`,
    `https://openlibrary.org/search.json?q=${encodeURIComponent(`${w.t} ${w.c.split(/\s+&\s+/)[0]}`)}&fields=${fields}&limit=10`,
  ];
  for (const url of tries) {
    const docs = (await fetchJson(url, { timeout: 60000 })).docs || [];
    await sleep(1200);
    const hit = docs.find((d) => d.author_name?.length && sameCreator(w.c, d.author_name.join(" & ")) &&
      (keysMeet(w.t, d.title) || (d.subtitle && keysMeet(w.t, `${d.title}: ${d.subtitle}`))));
    if (hit) return { s: "ok", src: "ol", id: hit.key.replace("/works/", ""), t: hit.title, c: hit.author_name[0], y: hit.first_publish_year || null, pop: hit.readinglog_count || 0, how: "search" };
  }
  return { s: "missing", src: "ol" };
}

async function searchFilm(w) {
  const q = w.t.replace(/"/g, '\\"');
  const rows = await sparql(`SELECT ?f ?y ?dLabel ?sl ?imdb WHERE {
    SERVICE wikibase:mwapi { bd:serviceParam wikibase:api "EntitySearch"; wikibase:endpoint "www.wikidata.org";
      mwapi:search "${q}"; mwapi:language "en"; mwapi:limit "15". ?f wikibase:apiOutputItem mwapi:item. }
    ?f wdt:P31/wdt:P279* wd:Q11424.
    OPTIONAL { ?f wdt:P577 ?d. BIND(YEAR(?d) AS ?y) }
    OPTIONAL { ?f wdt:P57 ?dir. ?dir rdfs:label ?dLabel. FILTER(LANG(?dLabel) = "en") }
    OPTIONAL { ?f wikibase:sitelinks ?sl } OPTIONAL { ?f wdt:P345 ?imdb }
    ?f rdfs:label ?l. FILTER(LANG(?l) = "en") }`);
  await sleep(1500);
  const films = new Map();
  for (const r of rows) {
    const qid = r.f.slice(r.f.lastIndexOf("/") + 1);
    const f = films.get(qid) || { q: qid, t: w.t, y: Infinity, d: [], sl: +r.sl || 0, imdb: r.imdb };
    if (r.y) f.y = Math.min(f.y, +r.y);
    if (r.dLabel && !f.d.includes(r.dLabel)) f.d.push(r.dLabel);
    films.set(qid, f);
  }
  const f = pickFilm(w, [...films.values()].filter((x) => Number.isFinite(x.y)));
  return f ? { s: "ok", src: "wd", id: f.q, t: w.t, c: f.d.join(" & "), y: f.y, pop: f.sl, imdb: f.imdb, how: "search" } : { s: "missing", src: "wd" };
}

/** Extra film identifiers for links: Letterboxd slug, English Wikipedia article, IMDb id. */
async function filmLinks(qids) {
  const out = {};
  for (let i = 0; i < qids.length; i += 150) {
    const chunk = qids.slice(i, i + 150);
    const rows = await sparql(`SELECT ?f ?lb ?imdb ?wp WHERE { VALUES ?f { ${chunk.map((q) => "wd:" + q).join(" ")} }
      OPTIONAL { ?f wdt:P6127 ?lb } OPTIONAL { ?f wdt:P345 ?imdb }
      OPTIONAL { ?wp schema:about ?f; schema:isPartOf <https://en.wikipedia.org/> } }`);
    for (const r of rows) {
      const q = r.f.slice(r.f.lastIndexOf("/") + 1);
      const o = (out[q] ||= {});
      if (r.lb && !o.lb) o.lb = r.lb;
      if (r.imdb && /^tt\d+$/.test(r.imdb) && !o.imdb) o.imdb = r.imdb;
      if (r.wp && !o.wp) o.wp = decodeURIComponent(r.wp.replace("https://en.wikipedia.org/wiki/", ""));
    }
    await sleep(1500);
  }
  return out;
}

// ---------- run ----------
const items = mergeItems(loadRaw());
const targets = outsideTargets(items);
const prev = readJson("data/catalog/verified.json", { entries: {} }).entries;
const works = [...items.map((it) => ({ k: it.k, t: it.t, c: it.c, y: it.y, key: it.key, catalog: true })), ...targets.map((t) => ({ ...t, catalog: false }))];
const entries = {};
let apiCalls = 0, outOfTime = 0, apiErrors = 0;
for (const w of works) {
  let r = w.k === "b" ? localBook(w) : localFilm(w);
  const old = prev[w.key];
  if (!r && old && old.how === "search" && old.s === "ok" && daysSince(old.at) < RECHECK_DAYS) r = { ...old };
  if (!r && !OFFLINE) {
    if (Date.now() - started > TIME_BUDGET_MS) { outOfTime++; if (old) r = { ...old }; }
    else {
      try { apiCalls++; r = w.k === "b" ? await searchBook(w) : await searchFilm(w); }
      catch (e) { apiErrors++; warn(`lookup failed for "${w.t}": ${e.message}`); if (old) r = { ...old }; }
    }
  }
  if (!r) r = old ? { ...old } : { s: "missing", src: w.k === "b" ? "ol" : "wd", how: OFFLINE ? "offline" : "none" };
  if (r.how !== "search" || !r.at || r.s !== "ok") r.at = day;
  if (r.s === "ok" && r.how === "search" && old?.at && old.how === "search" && old.s === "ok" && daysSince(old.at) < RECHECK_DAYS) r.at = old.at;
  entries[w.key] = { ...r, cat: w.catalog ? 1 : 0, want: { t: w.t, c: w.c, y: w.y } };
  if (apiCalls && apiCalls % 50 === 0) console.log(`  ${apiCalls} lookups so far`);
}
if (apiErrors > 25) throw new Error(`${apiErrors} lookups failed; a source is unreachable. Keeping the previous verified.json`);

// Film links for every verified film (catalog and targets).
const qids = [...new Set(Object.values(entries).filter((e) => e.s === "ok" && e.src === "wd").map((e) => e.id))].sort();
if (!OFFLINE && qids.length) {
  try {
    const links = await filmLinks(qids);
    for (const e of Object.values(entries)) if (e.s === "ok" && e.src === "wd") Object.assign(e, links[e.id] || {});
  } catch (e) {
    warn(`could not read film links (${e.message}); keeping last month's`);
    for (const [k, e] of Object.entries(entries)) if (prev[k]?.id === e.id) for (const f of ["lb", "wp", "imdb"]) if (prev[k][f] && !e[f]) e[f] = prev[k][f];
  }
} else for (const [k, e] of Object.entries(entries)) if (prev[k]?.id === e.id) for (const f of ["lb", "wp", "imdb"]) if (prev[k][f] && !e[f]) e[f] = prev[k][f];

const cat = Object.values(entries).filter((e) => e.cat);
const okCat = cat.filter((e) => e.s === "ok").length;
const okAll = Object.values(entries).filter((e) => e.s === "ok").length;
const share = okCat / cat.length;
const missing = Object.entries(entries).filter(([, e]) => e.s !== "ok").map(([, e]) => `${e.want.t} (${e.want.c}, ${e.want.y})${e.cat ? " [catalog]" : ""}`);
const yearFlags = Object.values(entries).filter((e) => e.s === "ok" && e.y && Math.abs(e.y - e.want.y) > 3).map((e) => `${e.want.t}: catalog says ${e.want.y}, source says ${e.y}`);
console.log(`catalog titles verified: ${okCat}/${cat.length} (${(share * 100).toFixed(1)}%); all titles: ${okAll}/${works.length}; API lookups: ${apiCalls}${outOfTime ? `; ${outOfTime} skipped (time budget)` : ""}`);
if (share < MIN_OK_SHARE && !OFFLINE) throw new Error(`only ${(share * 100).toFixed(1)}% of catalog titles verified; a source is probably down. Keeping the previous verified.json`);

const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
const changed = writeJson("data/catalog/verified.json", { generated: day, sources: { books: "Open Library (openlibrary.org)", films: "Wikidata (wikidata.org)" }, entries: sorted }, { pretty: true });
writeJson("data/catalog/verify-report.json", { generated: day, catalogVerified: okCat, catalogTotal: cat.length, allVerified: okAll, allTotal: works.length, missing, yearFlags }, { pretty: true });
note(`verified.json ${changed ? "updated" : "unchanged"}; ${missing.length} titles not found`);
summary(`### Title verification (${day})\n\n- Catalog titles verified: **${okCat} of ${cat.length}**\n- All titles including recommendations: ${okAll} of ${works.length}\n- Not found (left out of the site): ${missing.length}\n${missing.slice(0, 40).map((m) => `  - ${m}`).join("\n")}\n`);
