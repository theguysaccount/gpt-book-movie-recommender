// Recognition list for books: the works Open Library readers have logged most, with authors, first year and
// the subjects mapped onto our vocabulary. Open Library data is open (CC0 for the catalog records).
// Output: data/index/books.json
//   node pipeline/index-books.mjs
// Fails without touching the existing file if Open Library is unreachable or the result looks wrong.
import { fetchJson, sleep, writeJson, readJson, today, note, warn } from "./lib.mjs";
import { norm, surname } from "../src/engine/normalize.js";

const READ_DEPTH = Number(process.env.SS_BOOK_READ_DEPTH || 6000);   // top N by "already read"
const LOG_DEPTH = Number(process.env.SS_BOOK_LOG_DEPTH || 3000);     // plus top N by total reading-log entries
const PAGE = 200;
const PACE_MS = 1300;                                                // Open Library asks for about one request a second
const map = readJson("data/maps/ol-subjects.json");
const rules = map.rules.map(([re, tag]) => [new RegExp(re), tag]);
const FIELDS = "key,title,author_name,first_publish_year,subject,already_read_count,readinglog_count,language,editions,editions.title,editions.language";

const JUNK = /^(accessible book|protected daisy|in library|lending library|large type books|overdrive|internet archive wishlist|open library staff picks|reading level|new york times|nyt:|award:|series:|place:|person:|time:|collectionid:|[a-z ]+ language materials|translations? into|long now manual|fiction in [a-z]+|readers\b|textbooks|study guides)/;
const NONFICTION_GENRES = new Set(["g:history", "g:science", "g:psychology", "g:self-help", "g:business", "g:politics", "g:philosophy", "g:travel", "g:essays", "g:journalism", "g:true-crime", "g:nature", "g:biography", "g:memoir"]);

/**
 * Map a work's subject strings onto vocabulary tags. A tag needs two matching subjects (one is enough for works
 * with few subjects), which filters out the noise of one-off subjects added by a single edition. Works that are
 * clearly fiction never get nonfiction genres.
 */
export function tagsFromSubjects(subjects) {
  const usable = (subjects || []).slice(0, 150).map((s) => String(s).toLowerCase().trim())
    .filter((s) => s && s.length <= 70 && !JUNK.test(s));
  const counts = new Map();
  for (const s of usable) {
    const hit = new Set();
    for (const [re, tag] of rules) if (re.test(s)) hit.add(tag);
    for (const t of hit) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const need = usable.length < 6 ? 1 : 2;
  const fiction = usable.some((s) => /\bfiction\b|\bnovels?\b/.test(s) && !/nonfiction|non-fiction/.test(s));
  return [...counts.entries()].filter(([t, n]) => n >= need && !(fiction && NONFICTION_GENRES.has(t)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([t]) => t);
}

async function page(sort, offset) {
  const url = `https://openlibrary.org/search.json?q=first_publish_year:%5B1+TO+2030%5D&sort=${sort}&limit=${PAGE}&offset=${offset}&lang=en&fields=${FIELDS}`;
  return (await fetchJson(url, { timeout: 90000 })).docs || [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const works = new Map();
  for (const [sort, depth] of [["already_read", READ_DEPTH], ["readinglog", LOG_DEPTH]]) {
    for (let offset = 0; offset < depth; offset += PAGE) {
      const docs = await page(sort, offset);
      for (const d of docs) {
        const key = (d.key || "").replace("/works/", "");
        if (!key || works.has(key) || !d.title || !d.author_name?.length) continue;
        const enEdition = d.editions?.docs?.find((e) => (e.language || []).includes("eng"))?.title;
        const title = enEdition && norm(enEdition) !== norm(d.title) && !(d.language || []).slice(0, 1).includes("eng") ? enEdition : d.title;
        works.set(key, {
          key, t: title.trim(), ...(norm(title) !== norm(d.title) ? { alt: d.title.trim() } : enEdition && norm(enEdition) !== norm(d.title) ? { alt: enEdition.trim() } : {}),
          a: d.author_name.slice(0, 2), y: d.first_publish_year || null, x: tagsFromSubjects(d.subject),
          pop: d.readinglog_count || 0, read: d.already_read_count || 0,
        });
      }
      if (offset % 1000 === 0) console.log(`${sort} ${offset + docs.length}/${depth} (${works.size} works)`);
      if (docs.length < PAGE) break;
      await sleep(PACE_MS);
    }
  }
  // One entry per title + author: Open Library has duplicate work records; keep the most-logged.
  const best = new Map();
  for (const w of works.values()) {
    const k = `${norm(w.t)}|${surname(w.a[0])}`;
    const cur = best.get(k);
    if (!cur || w.pop + w.read * 5 > cur.pop + cur.read * 5) best.set(k, w);
  }
  const out = [...best.values()].filter((w) => w.x.length || w.read >= 40)
    .sort((a, b) => b.read - a.read || b.pop - a.pop || a.key.localeCompare(b.key));
  const prev = readJson("data/index/books.json", null);
  const tagged = out.filter((w) => w.x.length).length;
  if (out.length < 3000) throw new Error(`only ${out.length} books came back; keeping the existing list`);
  if (tagged / out.length < 0.7) throw new Error(`only ${tagged} of ${out.length} books got a tag; keeping the existing list`);
  if (prev && out.length < prev.books.length * 0.7) throw new Error(`book list shrank from ${prev.books.length} to ${out.length}; keeping the existing list`);
  if (prev && JSON.stringify(prev.books) === JSON.stringify(out)) { note(`books: no change (${out.length})`); process.exit(0); }
  writeJson("data/index/books.json", { generated: today(), source: "Open Library search API, openlibrary.org", depth: [READ_DEPTH, LOG_DEPTH], books: out });
  note(`books: ${out.length} written (${tagged} with at least one tag)`);
  if (out.length < 5000) warn(`book list is smaller than expected (${out.length})`);
}
