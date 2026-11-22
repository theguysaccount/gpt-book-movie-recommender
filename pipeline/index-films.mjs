// Recognition list for films: every film on Wikidata that at least MIN_SITELINKS language editions of Wikipedia
// write about, with year, directors, genres, countries, IMDb id and English aliases. Wikidata is CC0.
// Output: data/index/films.json (raw labels; the site build maps them onto the vocabulary).
//   node pipeline/index-films.mjs
// Two steps keep every query small: list the films per type (a cheap scan), then read details for 300 at a time.
// Fails without touching the existing file if Wikidata is unreachable or the result looks wrong.
import { sparql, sleep, writeJson, readJson, today, note, warn } from "./lib.mjs";

const MIN_SITELINKS = Number(process.env.SS_FILM_MIN_SITELINKS || 18);
// film, animated feature film, anime film, silent film, documentary film, 3D film
const TYPES = ["Q11424", "Q29168811", "Q20650540", "Q226730", "Q93204", "Q229390"];
const CHUNK = 300;
const qid = (uri) => uri.slice(uri.lastIndexOf("/") + 1);
const films = new Map();

for (const type of TYPES) {
  const rows = await sparql(`SELECT ?f ?sl WHERE { ?f wdt:P31 wd:${type}; wikibase:sitelinks ?sl. FILTER(?sl >= ${MIN_SITELINKS}) }`);
  for (const r of rows) { const q = qid(r.f); if (!films.has(q)) films.set(q, { q, sl: +r.sl }); }
  console.log(`type ${type}: ${rows.length} (total ${films.size})`);
  await sleep(1500);
}

const values = (list) => list.map((q) => "wd:" + q).join(" ");
const ids = [...films.keys()];
const push = (q, field, v, max) => { const f = films.get(q); if (!f || !v || /^Q\d+$/.test(v)) return; const a = (f[field] ||= []); if (!a.includes(v) && a.length < max) a.push(v); };
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = values(ids.slice(i, i + CHUNK));
  for (const r of await sparql(`SELECT ?f ?fLabel (MIN(YEAR(?d)) AS ?y) (SAMPLE(?im) AS ?imdb) WHERE { VALUES ?f { ${chunk} }
      OPTIONAL { ?f wdt:P577 ?d } OPTIONAL { ?f wdt:P345 ?im }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } } GROUP BY ?f ?fLabel`)) {
    const f = films.get(qid(r.f));
    if (r.fLabel && !/^Q\d+$/.test(r.fLabel)) f.t = r.fLabel;
    if (r.y) f.y = +r.y;
    if (/^tt\d+$/.test(r.imdb || "")) f.imdb = r.imdb;
  }
  await sleep(1200);
  for (const [prop, field, max] of [["P57", "d", 3], ["P136", "g", 8], ["P495", "co", 3]]) {
    for (const r of await sparql(`SELECT ?f ?vLabel WHERE { VALUES ?f { ${chunk} } ?f wdt:${prop} ?v.
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }`)) push(qid(r.f), field, r.vLabel, max);
    await sleep(1200);
  }
  for (const r of await sparql(`SELECT ?f ?v WHERE { VALUES ?f { ${chunk} } ?f wdt:P364 ?v. }`)) push(qid(r.f), "lang", qid(r.v).replace(/^/, "L"), 4);
  await sleep(1200);
  for (const r of await sparql(`SELECT ?f ?alt WHERE { VALUES ?f { ${chunk} } ?f skos:altLabel ?alt. FILTER(LANG(?alt) = "en") }`)) push(qid(r.f), "aka", r.alt, 5);
  await sleep(1200);
  console.log(`details ${Math.min(i + CHUNK, ids.length)}/${ids.length}`);
}

const out = [...films.values()].filter((f) => f.t && f.y)
  .sort((a, b) => b.sl - a.sl || a.q.localeCompare(b.q, "en", { numeric: true }))
  .map(({ lang, ...f }) => ({ ...f, ...(lang && !lang.includes("LQ1860") ? { en: false } : {}) }));

// Sanity checks before replacing last month's file.
const prev = readJson("data/index/films.json", null);
const withDirector = out.filter((f) => f.d?.length).length;
if (out.length < 3000) throw new Error(`only ${out.length} films came back; keeping the existing list`);
if (withDirector / out.length < 0.8) throw new Error(`only ${withDirector} of ${out.length} films have a director; keeping the existing list`);
if (prev && out.length < prev.films.length * 0.7) throw new Error(`film list shrank from ${prev.films.length} to ${out.length}; keeping the existing list`);
if (prev && JSON.stringify(prev.films) === JSON.stringify(out)) { note(`films: no change (${out.length})`); process.exit(0); }
writeJson("data/index/films.json", { generated: today(), source: "Wikidata (CC0), query.wikidata.org", minSitelinks: MIN_SITELINKS, films: out });
note(`films: ${out.length} written (${withDirector} with a director)`);
if (out.length < 6000) warn(`film list is smaller than expected (${out.length})`);
