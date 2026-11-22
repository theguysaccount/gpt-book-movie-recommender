// Turn export files from Goodreads, StoryGraph, Letterboxd and IMDb (or any simple CSV) into one list of
// library entries. Pure functions: text in, entries out. Nothing here touches the network.
//
// Entry: { kind: "b"|"f", title, creator, year, rating (0.5–5 or null), status: "done"|"doing"|"want"|"dropped",
//          liked, shelves: [], imdb, date, source }

import { parseCsv } from "./csv.js";
import { norm, surname } from "./normalize.js";

const has = (headers, ...names) => names.every((n) => headers.includes(n));
const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };
const year = (v) => { const m = String(v ?? "").match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? +m[1] : null; };
const isoDate = (v) => {
  const m = String(v ?? "").match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};
const clampRating = (r) => (r == null || r <= 0 ? null : Math.max(0.5, Math.min(5, Math.round(r * 2) / 2)));

/** Which export is this? Decided from the header row, with the file name as a tiebreak. */
export function detectFormat(headers, fileName = "") {
  const f = fileName.toLowerCase();
  if (has(headers, "Title", "Author", "Exclusive Shelf") || has(headers, "Book Id", "Title", "My Rating")) return "goodreads";
  if (has(headers, "Title", "Authors", "Read Status")) return "storygraph";
  if (has(headers, "Const", "Title") && (headers.includes("Your Rating") || headers.includes("Title Type"))) return "imdb";
  if (has(headers, "Name", "Year", "Letterboxd URI")) {
    if (headers.includes("Watched Date")) return "letterboxd-diary";
    if (headers.includes("Rating")) return "letterboxd-ratings";
    if (/watchlist/.test(f)) return "letterboxd-watchlist";
    if (/like/.test(f)) return "letterboxd-likes";
    if (/watched|films/.test(f)) return "letterboxd-watched";
    return "letterboxd-watched";
  }
  if (headers.some((h) => /^(title|name|book|film|movie)s?$/i.test(h))) return "generic";
  return null;
}

export const FORMAT_NAMES = {
  goodreads: "Goodreads library", storygraph: "StoryGraph library", imdb: "IMDb ratings or watchlist",
  "letterboxd-ratings": "Letterboxd ratings", "letterboxd-diary": "Letterboxd diary", "letterboxd-watched": "Letterboxd watched films",
  "letterboxd-watchlist": "Letterboxd watchlist", "letterboxd-likes": "Letterboxd likes", generic: "Simple list",
};

function fromGoodreads(rows) {
  return rows.map((r) => {
    const shelf = (r["Exclusive Shelf"] || "").toLowerCase();
    const status = shelf === "to-read" ? "want" : shelf === "currently-reading" ? "doing"
      : /dnf|did-not-finish|abandon|gave-up|unfinished/.test(shelf) ? "dropped" : "done";
    const shelves = (r["Bookshelves"] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return {
      kind: "b", title: r["Title"] || "", creator: r["Author"] || (r["Author l-f"] || "").split(",").reverse().join(" ").trim(),
      year: year(r["Original Publication Year"]) || year(r["Year Published"]),
      rating: status === "want" ? null : clampRating(num(r["My Rating"])),
      status, liked: shelves.some((s) => /^(favou?rites?|all-time-favou?rites?|loved)$/.test(s)), shelves,
      imdb: null, date: isoDate(r["Date Read"]) || isoDate(r["Date Added"]), source: "goodreads",
    };
  }).filter((e) => e.title);
}

function fromStoryGraph(rows) {
  return rows.map((r) => {
    const rs = (r["Read Status"] || "").toLowerCase();
    const status = rs === "to-read" ? "want" : rs === "currently-reading" || rs === "paused" ? "doing" : rs === "did-not-finish" ? "dropped" : "done";
    const tags = (r["Tags"] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return {
      kind: "b", title: r["Title"] || "", creator: (r["Authors"] || "").split(",")[0].trim(), year: null,
      rating: status === "want" ? null : clampRating(num(r["Star Rating"])),
      status, liked: tags.some((s) => /^favou?rites?$/.test(s)), shelves: tags,
      imdb: null, date: isoDate(r["Last Date Read"]) || isoDate(r["Date Added"]), source: "storygraph",
    };
  }).filter((e) => e.title);
}

function fromLetterboxd(rows, format) {
  return rows.map((r) => ({
    kind: "f", title: r["Name"] || "", creator: "", year: year(r["Year"]),
    rating: format === "letterboxd-ratings" || format === "letterboxd-diary" ? clampRating(num(r["Rating"])) : null,
    status: format === "letterboxd-watchlist" ? "want" : "done",
    liked: format === "letterboxd-likes", shelves: [], imdb: null,
    date: isoDate(r["Watched Date"]) || isoDate(r["Date"]), source: "letterboxd",
  })).filter((e) => e.title);
}

function fromImdb(rows) {
  return rows.filter((r) => {
    const t = (r["Title Type"] || "movie").toLowerCase().replace(/[^a-z]/g, "");
    return t === "movie" || t === "tvmovie" || t === "feature" || t === "video";
  }).map((r) => {
    const raw = num(r["Your Rating"]);
    return {
      kind: "f", title: r["Title"] || r["Original Title"] || "", creator: (r["Directors"] || "").split(",")[0].trim(), year: year(r["Year"]) || year(r["Release Date"]),
      rating: raw ? clampRating(raw / 2) : null, status: raw ? "done" : "want", liked: false, shelves: [],
      imdb: /^tt\d+$/.test(r["Const"] || "") ? r["Const"] : null, date: isoDate(r["Date Rated"]) || isoDate(r["Created"]), source: "imdb",
    };
  }).filter((e) => e.title);
}

function fromGeneric(rows, headers) {
  const col = (re) => headers.find((h) => re.test(h));
  const cTitle = col(/^(title|name|book|film|movie)s?$/i);
  const cCreator = col(/^(author|authors|director|directors|creator|by|writer)$/i);
  const cYear = col(/year|published|released/i);
  const cRating = col(/rating|stars|score/i);
  const cKind = col(/^(type|kind|medium|format)$/i);
  const cStatus = col(/status|shelf|list/i);
  const ratings = rows.map((r) => (cRating ? num(r[cRating]) : null)).filter((x) => x != null);
  const max = ratings.length ? Math.max(...ratings) : 5;
  const scale = max > 10 ? 20 : max > 5 ? 2 : 1;
  const directorCol = cCreator && /director/i.test(cCreator);
  return rows.map((r) => {
    const k = cKind ? (r[cKind] || "").toLowerCase() : "";
    const st = cStatus ? (r[cStatus] || "").toLowerCase() : "";
    const raw = cRating ? num(r[cRating]) : null;
    return {
      kind: /film|movie/.test(k) || (!k && directorCol) ? "f" : /book|novel/.test(k) ? "b" : (/film|movie/i.test(cTitle) ? "f" : "b"),
      title: r[cTitle] || "", creator: cCreator ? r[cCreator] || "" : "", year: cYear ? year(r[cYear]) : null,
      rating: raw ? clampRating(raw / scale) : null,
      status: /want|to-?read|watchlist|tbr|queue/.test(st) ? "want" : /reading|watching|progress|current/.test(st) ? "doing" : /dnf|dropped|abandon/.test(st) ? "dropped" : "done",
      liked: false, shelves: [], imdb: null, date: null, source: "list",
    };
  }).filter((e) => e.title);
}

/** Parse one CSV text. Returns { format, entries } or throws an Error with a message meant for the person. */
export function parseExport(text, fileName = "") {
  const { headers, rows } = parseCsv(text);
  const format = detectFormat(headers, fileName);
  if (!format) {
    throw new Error(`"${fileName || "That file"}" isn't an export we recognize. We read Goodreads, StoryGraph, Letterboxd and IMDb exports, or any CSV with a "title" column.`);
  }
  let entries;
  if (format === "goodreads") entries = fromGoodreads(rows);
  else if (format === "storygraph") entries = fromStoryGraph(rows);
  else if (format === "imdb") entries = fromImdb(rows);
  else if (format === "generic") entries = fromGeneric(rows, headers);
  else entries = fromLetterboxd(rows, format);
  return { format, entries };
}

const STATUS_RANK = { want: 0, dropped: 1, doing: 2, done: 3 };

/** Identity of an entry for merging: same kind, same normalized title, and same year (films) or surname (books). */
export function entryKey(e) {
  return `${e.kind}|${norm(e.title)}|${e.kind === "f" ? e.year || "" : surname(e.creator)}`;
}

/**
 * Merge entries from several files (and from what is already saved) into one list.
 * A rating, a "liked" flag or a further-along status from any file wins; nothing is ever duplicated.
 */
export function mergeEntries(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const e of list || []) {
      const key = entryKey(e);
      const cur = map.get(key);
      if (!cur) { map.set(key, { ...e, shelves: [...(e.shelves || [])] }); continue; }
      if (e.rating != null) cur.rating = e.rating;
      if (e.liked) cur.liked = true;
      if ((STATUS_RANK[e.status] ?? 0) > (STATUS_RANK[cur.status] ?? 0)) cur.status = e.status;
      if (!cur.creator && e.creator) cur.creator = e.creator;
      if (!cur.year && e.year) cur.year = e.year;
      if (!cur.imdb && e.imdb) cur.imdb = e.imdb;
      if (e.date && (!cur.date || e.date > cur.date)) cur.date = e.date;
      for (const s of e.shelves || []) if (!cur.shelves.includes(s)) cur.shelves.push(s);
    }
  }
  return [...map.values()];
}
