// Build the static site into dist/ (or $SS_OUT): the app, one "books like X" / "movies like X" page per verified
// catalog title, browse pages, guides, sitemap, robots.txt, IndexNow key and the JSON the browser ranks with.
//   node scripts/build.mjs
// Environment (all optional; GitHub Actions passes repository variables):
//   SITE_URL         public base URL, no trailing slash (default: the github.io project URL). The one setting
//                    that moves the site to a custom domain.
//   SS_GOATCOUNTER   https://<code>.goatcounter.com/count for cookieless page counts (off when empty)
//   SS_SUPPORT_URL   a donation / sponsor page linked in the footer (off when empty)
//   SS_BOOKSHOP_ID   Bookshop.org affiliate id: adds "Find it at Bookshop.org" links to book pages. Only for a
//                    host that allows commercial use (not GitHub Pages); see OPERATIONS.md.
//   SS_TODAY, SS_OUT for local builds.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, readJson, today, REPO_URL } from "../pipeline/lib.mjs";
import { loadRaw, mergeItems, titleIndex, resolveLike, workKey } from "../pipeline/catalog.mjs";
import { slugify, norm, surname } from "../src/engine/normalize.js";
import { buildModel } from "../src/engine/model.js";
import { similarTo, listPhrase } from "../src/engine/similar.js";

export const DEFAULT_SITE_URL = "https://theguysaccount.github.io/gpt-book-movie-recommender";
const SITE_URL = (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const BASE = new URL(SITE_URL + "/").pathname;               // "/gpt-book-movie-recommender/" or "/"
const ORIGIN = new URL(SITE_URL).origin;
const OUT = path.resolve(ROOT, process.env.SS_OUT || "dist");
const GOATCOUNTER = (process.env.SS_GOATCOUNTER || "").trim();
const SUPPORT_URL = (process.env.SS_SUPPORT_URL || "").trim();
const BOOKSHOP_ID = (process.env.SS_BOOKSHOP_ID || "").trim();
const DAY = today();
const NAME = "Shelf & Screen";
const NF = new Set(["memoir", "biography", "history", "science", "nature", "philosophy", "psychology", "self-help", "business", "politics", "true-crime", "essays", "journalism", "travel", "documentary"]);
const QUIET = new Set(["w:contemporary", "p:medium", "g:drama", "g:literary", "s:plot-driven", "s:first-person"]);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const abs = (p) => SITE_URL + "/" + p.replace(/^\//, "");
const rel = (p) => BASE + p.replace(/^\//, "");
const sha = (s, n = 10) => crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
const write = (p, content) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };

// ---------------- data ----------------
export function loadData() {
  const vocab = readJson("data/vocab.json");
  const tags = [];
  for (const facet of ["g", "th", "m", "s", "w", "p"]) for (const [id, label] of Object.entries(vocab[facet])) if (!id.startsWith("_")) tags.push([facet, id, label]);
  const tagIdx = new Map(tags.map(([f, id], i) => [`${f}:${id}`, i]));
  const verified = readJson("data/catalog/verified.json", { entries: {} }).entries;
  const filmsIdx = readJson("data/index/films.json", { films: [] }).films;
  const booksIdx = readJson("data/index/books.json", { books: [] }).books;
  const filmByQ = new Map(filmsIdx.map((f) => [f.q, f]));
  const merged = mergeItems(loadRaw());
  const index = titleIndex(merged);
  const ok = (key) => verified[key]?.s === "ok";
  const items = merged.filter((it) => ok(it.key));
  const dropped = merged.filter((it) => !ok(it.key)).map((it) => `${it.t} (${it.c}, ${it.y})`);
  // Stable order: books then films, most widely read/watched first, then title.
  items.sort((a, b) => (a.k === b.k ? 0 : a.k === "b" ? -1 : 1) || (verified[b.key].pop || 0) - (verified[a.key].pop || 0) || a.t.localeCompare(b.t) || a.key.localeCompare(b.key));
  const pos = new Map(items.map((it, i) => [it.key, i]));
  const used = { b: new Set(), f: new Set() };
  const out = items.map((it) => {
    const v = verified[it.key];
    const y = it.k === "f" && v.y ? v.y : it.y;
    let id = slugify(it.t) || "title";
    if (used[it.k].has(id)) id = `${id}-${it.k === "f" ? y : slugify(surname(it.c))}`;
    if (used[it.k].has(id)) id = `${id}-${sha(it.key, 4)}`;
    used[it.k].add(id);
    const x = [...new Set([...it.g.map((t) => `g:${t}`), ...it.th.map((t) => `th:${t}`), ...it.m.map((t) => `m:${t}`), ...it.s.map((t) => `s:${t}`), ...it.w.map((t) => `w:${t}`), `p:${it.p}`])]
      .map((k) => tagIdx.get(k)).filter((i) => i !== undefined).sort((a, b) => a - b);
    const o = { id, k: it.k, t: it.t, c: it.c, y, x, h: it.h, pop: v.pop || 0, key: it.key, like: it.like };
    if (it.k === "b") { o.ol = v.id; if (it.g.some((g) => NF.has(g))) o.nf = 1; }
    else {
      o.wd = v.id;
      if (v.lb) o.lb = v.lb;
      if (v.wp) o.wp = v.wp;
      if (v.imdb) o.imdb = v.imdb;
      const f = filmByQ.get(v.id);
      const aka = (f?.aka || []).filter((a) => norm(a) !== norm(it.t) && a.length < 80).slice(0, 3);
      if (aka.length) o.aka = aka;
    }
    return o;
  });
  // Links: curated → curated as [index, reason]; anything else verified becomes an "outside" title for pages only.
  for (const o of out) {
    o.l = []; o.ext = [];
    for (const l of o.like) {
      const target = resolveLike(merged, index, l);
      if (target) {
        if (pos.has(target.key) && target.key !== o.key && !o.l.some(([i]) => i === pos.get(target.key))) o.l.push([pos.get(target.key), l.r]);
        continue;
      }
      const key = workKey(l.k, l.t, l.c);
      const v = verified[key];
      if (v?.s === "ok") o.ext.push({ k: l.k, t: l.t, c: l.c, y: l.k === "f" && v.y ? v.y : l.y, r: l.r, ol: l.k === "b" ? v.id : undefined, wd: l.k === "f" ? v.id : undefined, lb: v.lb, wp: v.wp });
    }
    delete o.like;
  }
  // Recognition list: popular titles we don't curate, with tags from their open-data subjects and genres.
  const curatedKeys = new Set(out.map((o) => o.key));
  const curatedIds = new Set(out.map((o) => o.ol || o.wd));
  const filmMap = readJson("data/maps/wd-film.json");
  const genreRules = filmMap.genres.map(([re, tag]) => [new RegExp(re, "i"), tag]);
  const recogBooks = booksIdx.filter((b) => !curatedIds.has(b.key) && !curatedKeys.has(workKey("b", b.t, b.a[0])))
    .map((b) => {
      const x = [...new Set(b.x)].map((k) => tagIdx.get(k)).filter((i) => i !== undefined).sort((a, z) => a - z);
      const row = [b.t, b.a.slice(0, 2).join(" & "), b.y || 0, x, b.pop || 0];
      if (b.alt) row.push(b.alt);
      return row;
    });
  const recogFilms = filmsIdx.filter((f) => !curatedIds.has(f.q) && f.d?.length)
    .map((f) => {
      const tagKeys = new Set();
      for (const g of f.g || []) for (const [re, tag] of genreRules) if (re.test(g)) tagKeys.add(tag);
      for (const c of f.co || []) if (filmMap.countries[c]) tagKeys.add(filmMap.countries[c]);
      if (f.en === false) tagKeys.add("s:world-cinema");
      if (f.y && f.y < 1930) tagKeys.add("s:silent-film");
      const x = [...tagKeys].map((k) => tagIdx.get(k)).filter((i) => i !== undefined).sort((a, z) => a - z);
      const row = [f.t, f.d.slice(0, 2).join(" & "), f.y, x, f.sl || 0, 0];   // IMDb ids only for catalog films: title + year already match imports
      const aka = (f.aka || []).filter((a) => norm(a) !== norm(f.t) && a.length < 80).slice(0, 3);
      if (aka.length) row.push(aka);
      return row;
    });
  return { tags, tagIdx, items: out, dropped, recog: { books: recogBooks, films: recogFilms }, verifiedCount: Object.values(verified).filter((v) => v.s === "ok").length };
}

// ---------------- page shell ----------------
function shell({ title, description, pathname, body, jsonld = [], og = "og/home.png", noindex = false, bodyClass = "", v }) {
  const url = abs(pathname);
  const gcOrigin = GOATCOUNTER ? new URL(GOATCOUNTER).origin : "";
  const csp = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:${gcOrigin ? " " + gcOrigin : ""}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'self'`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(abs(og))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1f3a34">
<link rel="icon" href="${rel("favicon.svg")}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${rel("apple-touch-icon.png")}">
<link rel="stylesheet" href="${rel(`assets/site.css?v=${v}`)}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body class="${bodyClass}" data-base="${esc(BASE)}" data-v="${v}"${GOATCOUNTER ? ` data-gc="${esc(GOATCOUNTER)}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="${rel("")}"><span class="brand-mark" aria-hidden="true"></span>${esc(NAME)}</a>
  <nav aria-label="Main">
    <a href="${rel("")}">Get my picks</a>
    <a href="${rel("books/")}">Books</a>
    <a href="${rel("movies/")}">Movies</a>
    <a href="${rel("how-it-works/")}">How it works</a>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <p><strong>${esc(NAME)}</strong> ranks books and films from your own ratings and says why. Free, no account, and your library never leaves your device.</p>
  <p>Titles verified against <a href="https://openlibrary.org" rel="noopener">Open Library</a> and <a href="https://www.wikidata.org" rel="noopener">Wikidata</a>. Descriptions and reasons are original. <a href="${rel("how-it-works/")}">How it works and privacy</a> · <a href="${REPO_URL}" rel="noopener">Source and corrections</a>${SUPPORT_URL ? ` · <a href="${esc(SUPPORT_URL)}" rel="noopener" data-slot="support">Support this free tool</a>` : ""}</p>
</footer>
<script type="module" src="${rel(`assets/js/app/page.js?v=${v}`)}"></script>
</body>
</html>
`;
}

// ---------------- helpers for pages ----------------
function makeHelpers(data) {
  const { tags, items } = data;
  const model = buildModel({ tags, items });
  const label = (t) => tags[t][2];
  const facetOf = (t) => tags[t][0];
  const pagePath = (o) => `${o.k === "b" ? "books-like" : "movies-like"}/${o.id}/`;
  const kindWord = (k) => (k === "b" ? "Book" : "Film");
  const traits = (o, n = 3, facets = ["s", "th", "m", "g"]) => o.x.filter((t) => !QUIET.has(tags[t][0] + ":" + tags[t][1]) && facets.includes(facetOf(t)))
    .sort((a, b) => model.idf[b] - model.idf[a] || a - b).slice(0, n).map(label);
  const byline = (o) => `${o.k === "b" ? "by " : "directed by "}${o.c}`;
  return { model, label, facetOf, pagePath, kindWord, traits, byline };
}

function linksOut(o) {
  const out = [];
  if (o.ol) out.push(`<a href="https://openlibrary.org/works/${esc(o.ol)}" rel="noopener">Open Library</a>`);
  if (o.lb) out.push(`<a href="https://letterboxd.com/film/${esc(o.lb)}/" rel="noopener">Letterboxd</a>`);
  if (o.wp) out.push(`<a href="https://en.wikipedia.org/wiki/${esc(encodeURIComponent(o.wp.replace(/ /g, "_")))}" rel="noopener">Wikipedia</a>`);
  if (o.wd && !o.wp) out.push(`<a href="https://www.wikidata.org/wiki/${esc(o.wd)}" rel="noopener">Wikidata</a>`);
  if (o.k === "b" && BOOKSHOP_ID) out.push(`<a href="https://bookshop.org/search?keywords=${encodeURIComponent(o.t + " " + o.c)}&affiliate=${encodeURIComponent(BOOKSHOP_ID)}" rel="noopener sponsored" data-slot="bookshop">Find it at Bookshop.org</a>`);
  return out.join(" · ");
}

function likePage(data, H, o, v) {
  const { tags, items } = data;
  const n = items.indexOf(o);
  const hand = o.l.map(([i, r]) => ({ it: items[i], r }));
  const skip = new Set(o.l.map(([i]) => i));
  const sims = similarTo(H.model, n, { limit: 8, skip });
  const what = { m: [], th: [], s: [], w: [], g: [], p: [] };
  for (const t of o.x) what[tags[t][0]].push(tags[t][2]);
  const noun = o.k === "b" ? "Books" : "Movies";
  const h1 = `${noun} like ${o.t}`;
  const tr = H.traits(o, 3);
  const title = `${h1}${o.k === "f" ? ` (${o.y})` : ""}: picks with reasons | ${NAME}`;
  const description = `${noun} like ${o.t}${o.k === "b" ? ` by ${o.c}` : ` (${o.y})`}: ${hand.length + o.ext.length} hand-picked ${o.k === "b" ? "reads and films" : "films and books"} for fans of ${listPhrase(tr)}, each with a reason. Free, no account.`;
  const card = (it, reason, shared) => `<li class="pick-row">
      <div class="pick-head"><span class="kind kind-${it.k}">${H.kindWord(it.k)}</span> ${it.id ? `<a href="${rel(H.pagePath(it))}">${esc(it.t)}</a>` : `<span class="t">${esc(it.t)}</span>`} <span class="meta">${esc(it.c)} · ${esc(it.y)}</span></div>
      ${reason ? `<p>${esc(reason)}</p>` : ""}${shared?.length ? `<p class="shares">Shares ${esc(listPhrase(shared.map(H.label)))}.</p>` : ""}
    </li>`;
  const chips = (label, list) => (list.length ? `<div class="chipline"><span class="chiplabel">${label}</span>${list.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : "");
  const bodyHtml = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="${rel("")}">Home</a> › <a href="${rel(o.k === "b" ? "books/" : "movies/")}">${noun}</a> › <span>${esc(o.t)}</span></nav>
<article class="like-page">
  <header class="like-head">
    <p class="eyebrow"><span class="kind kind-${o.k}">${H.kindWord(o.k)}</span> ${esc(H.byline(o))} · ${esc(o.y)}</p>
    <h1>${esc(h1)}</h1>
    <p class="hook">${esc(o.h)}</p>
  </header>
  <section class="what" aria-labelledby="what-h">
    <h2 id="what-h">What it's like</h2>
    ${chips("Mood", what.m)}${chips("Pace", what.p)}${chips("Themes", what.th)}${chips("Style", what.s)}${chips("Setting", what.w)}${chips("Genre", what.g)}
  </section>
  <section aria-labelledby="hand-h">
    <h2 id="hand-h">Hand-picked next ${o.k === "b" ? "reads" : "watches"}</h2>
    <p class="sub">If you liked ${esc(o.t)}, try these. Each one says what it shares with ${esc(o.t)} and how it differs.</p>
    <ol class="pick-list">${[...hand.map(({ it, r }) => card(it, r)), ...o.ext.map((e) => card({ ...e, id: null }, e.r))].join("")}</ol>
  </section>
  ${sims.length ? `<section aria-labelledby="sim-h">
    <h2 id="sim-h">More with the same DNA</h2>
    <p class="sub">Matched on the traits that make ${esc(o.t)} distinctive, across books and films.</p>
    <ol class="pick-list">${sims.map((s) => card(items[s.kn.n], null, s.shared)).join("")}</ol>
  </section>` : ""}
  <aside class="cta-box">
    <h2>Picks ranked for your own taste</h2>
    <p>Start from ${esc(o.t)}, add a few more you loved, or drop in your Goodreads or Letterboxd export. Every pick comes with the reason. It all runs in your browser.</p>
    <p><a class="btn" href="${rel(`?from=${o.k}:${o.id}`)}">Start from ${esc(o.t)}</a> <a class="btn ghost" href="${rel("#import")}">Import my ratings</a></p>
  </aside>
  <p class="where">Find it: ${linksOut(o)}</p>
</article>`;
  const work = (it, url) => ({ "@type": it.k === "b" ? "Book" : "Movie", name: it.t, ...(it.k === "b" ? { author: { "@type": "Person", name: it.c } } : { director: { "@type": "Person", name: it.c } }), datePublished: String(it.y), ...(url ? { url } : {}) });
  const jsonld = [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: NAME, item: abs("") },
      { "@type": "ListItem", position: 2, name: noun, item: abs(o.k === "b" ? "books/" : "movies/") },
      { "@type": "ListItem", position: 3, name: o.t, item: abs(H.pagePath(o)) }] },
    { "@context": "https://schema.org", "@type": "ItemList", name: h1, about: work(o),
      itemListElement: [...hand.map(({ it }) => it), ...o.ext].map((it, i) => ({ "@type": "ListItem", position: i + 1, item: work(it, it.id ? abs(H.pagePath(it)) : undefined) })) },
  ];
  return shell({ title, description, pathname: H.pagePath(o), body: bodyHtml, jsonld, og: o.k === "b" ? "og/books.png" : "og/movies.png", bodyClass: "page-like", v });
}

function browsePage(data, H, kind, v) {
  const { tags, items } = data;
  const list = items.filter((o) => o.k === kind);
  const groups = new Map();
  for (const o of list) {
    const g = o.x.find((t) => tags[t][0] === "g");
    const name = g !== undefined ? tags[g][2] : "other";
    (groups.get(name) || groups.set(name, []).get(name)).push(o);
  }
  const noun = kind === "b" ? "Books" : "Movies";
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="${rel("")}">Home</a> › <span>${noun}</span></nav>
<h1>${noun} like the ones you love</h1>
<p class="lede">${list.length} ${kind === "b" ? "books" : "films"}, each with hand-picked ${kind === "b" ? "reads and films" : "films and books"} to try next and the reasons. Pick one you loved.</p>
<nav class="toc" aria-label="Genres">${sorted.map(([g]) => `<a href="#${slugify(g)}">${esc(g)}</a>`).join("")}</nav>
${sorted.map(([g, os]) => `<section class="browse-group" id="${slugify(g)}"><h2>${esc(g[0].toUpperCase() + g.slice(1))}</h2><ul class="browse-list">${os.map((o) => `<li><a href="${rel(H.pagePath(o))}">${esc(o.t)}</a> <span class="meta">${esc(o.c)} · ${o.y}</span></li>`).join("")}</ul></section>`).join("\n")}`;
  const title = `${noun} like your favorites: ${list.length} titles with picks and reasons | ${NAME}`;
  return shell({ title, description: `Find ${kind === "b" ? "books" : "movies"} like the ones you loved. ${list.length} titles, each with hand-picked recommendations across books and films and the reason for each.`, pathname: kind === "b" ? "books/" : "movies/", body, og: kind === "b" ? "og/books.png" : "og/movies.png", v, bodyClass: "page-browse" });
}

const GUIDES = [
  { slug: "how-to-export-goodreads", short: "Goodreads", title: "How to export your Goodreads library (and get picks from it)",
    description: "Export your Goodreads library as a CSV in under a minute, then turn your ratings into explained book picks. Nothing is uploaded.",
    steps: [
      "On a computer, sign in at goodreads.com. The Goodreads app can't export.",
      "Open <strong>My Books</strong>, then <strong>Import and export</strong> under Tools in the left column (or go straight to goodreads.com/review/import).",
      "Click <strong>Export Library</strong>. After a few seconds a link appears under it: <em>Your export from (date)</em>. Click it to download <code>goodreads_library_export.csv</code>.",
      "Come back here and drop the file in. Your ratings, shelves and to-read list are read in this tab and never sent anywhere." ],
    reads: "Title, author, your star rating, the shelf (read, currently reading, to-read, or a did-not-finish shelf), your other shelves (such as favorites or fantasy), and dates. We ignore your reviews and private notes." },
  { slug: "how-to-export-letterboxd", short: "Letterboxd", title: "How to export your Letterboxd data (and get film picks from it)",
    description: "Download your Letterboxd ratings, diary and watchlist as one ZIP, then get explained film and book picks from it. Nothing is uploaded.",
    steps: [
      "Sign in at letterboxd.com on the web and open <strong>Settings</strong>.",
      "Choose the <strong>Data</strong> tab and click <strong>Export your data</strong>. A ZIP file downloads.",
      "Drop the ZIP straight in here; there's no need to unzip it. We read <code>ratings.csv</code>, <code>diary.csv</code>, <code>watched.csv</code>, <code>watchlist.csv</code> and your liked films.",
      "Your ratings become a taste profile in this tab. Nothing leaves your device." ],
    reads: "Film name, year, your rating, likes, watch dates and your watchlist. Reviews, comments and lists inside the ZIP are skipped." },
  { slug: "how-to-export-storygraph-imdb", short: "StoryGraph and IMDb", title: "Export from StoryGraph or IMDb, or use any list",
    description: "How to export your StoryGraph library or IMDb ratings as CSV, or make a simple list, and get explained picks from it in your browser.",
    steps: [
      "<strong>StoryGraph:</strong> open your account settings (Manage Account) and choose <strong>Export StoryGraph Library</strong>. When the CSV is ready, download it and drop it in here.",
      "<strong>IMDb:</strong> open <strong>Your Ratings</strong> (or your Watchlist), choose <strong>Export</strong>, then download the CSV from your Exports page when it's ready. Ratings out of 10 become stars out of 5.",
      "<strong>Any list:</strong> a CSV with a <code>title</code> column works. Optional columns: <code>author</code> or <code>director</code>, <code>year</code>, <code>rating</code>, <code>type</code> (book or film) and <code>status</code>.",
      "No file at all? Rate a few titles by hand on the home page instead." ],
    reads: "Titles, creators, years, ratings and reading or watching status. Everything is read in this tab and kept only in this browser." },
];

function guidePage(g, data, v) {
  const others = GUIDES.filter((x) => x.slug !== g.slug);
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="${rel("")}">Home</a> › <span>Export guides</span></nav>
<article class="guide">
<h1>${esc(g.title)}</h1>
<ol class="steps">${g.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
<h2>What we read from it</h2>
<p>${esc(g.reads)}</p>
<h2>What happens next</h2>
<p>Your ratings are compared with your own average, so a harsh rater's four stars count for more than a generous rater's. From that we build a taste profile and rank ${data.items.length} verified books and films against it. Every pick names the titles of yours that led to it and the traits it shares with them.</p>
<p><a class="btn" href="${rel("#import")}">Import my ${esc(g.short)} file</a></p>
<p class="sub">Other exports: ${others.map((x) => `<a href="${rel(x.slug + "/")}">${esc(x.short)}</a>`).join(" · ")}</p>
</article>`;
  return shell({ title: `${g.title} | ${NAME}`, description: g.description, pathname: g.slug + "/", body, v, bodyClass: "page-guide",
    jsonld: [{ "@context": "https://schema.org", "@type": "HowTo", name: g.title, step: g.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s.replace(/<[^>]+>/g, "") })) }] });
}

function howPage(data, v) {
  const nb = data.items.filter((o) => o.k === "b").length, nf = data.items.length - nb;
  const body = `
<article class="guide">
<h1>How ${esc(NAME)} works</h1>
<h2>Your library stays on your device</h2>
<p>When you choose an export file, JavaScript in this tab reads it, matches the titles and ranks picks. Nothing is uploaded: there is no server to upload to. The site is static files on GitHub Pages, and every page carries a Content-Security-Policy that stops it from connecting to any other site. To check, open your browser's developer tools on the Network tab while you import: the only requests are for this site's own files.</p>
<p>Your library is saved in this browser's local storage so it's here next time. <strong>Clear everything</strong> in the Library tab deletes it. A shared taste profile contains only the summary you see before you share it, and it travels in the part of the link after <code>#</code>, which browsers never send to a server.</p>
<h2>How picks are ranked</h2>
<ol class="steps">
<li><strong>Your ratings, read relative to you.</strong> Each rating is compared with your own average and spread. A title you put on a favorites shelf or liked counts extra, a did-not-finish counts against, and a title you finished without rating counts a little for.</li>
<li><strong>A taste profile.</strong> Every catalog title carries tags for genre, themes, mood, style, setting and pace. For each tag we work out how you rate the titles that have it, and lean on it only as far as your library supports.</li>
<li><strong>Hand-written links.</strong> Each catalog title also lists a few titles its fans should try next, with the reason. If you rated a title highly, the titles it points to get a lift.</li>
<li><strong>Ranking and reasons.</strong> ${data.items.length} titles (${nb} books, ${nf} films) are scored against your profile. Near-duplicates are spread out, and every pick names the titles of yours behind it, the traits you rate highly, and any trait you tend to rate low.</li>
</ol>
<p>The picks come from a fixed catalog that was written by an AI model ahead of time and checked by machine. No AI runs while you use the site, and nothing you import trains anything.</p>
<h2>Where the titles come from</h2>
<p>Every title, and every title it recommends, is checked each month against <a href="https://openlibrary.org" rel="noopener">Open Library</a> (books) and <a href="https://www.wikidata.org" rel="noopener">Wikidata</a> (films). A title that can't be found there is left out. ${data.verifiedCount} titles passed the latest check (${esc(DAY)}). To recognize more of your library, we also match it against the most-read books on Open Library and the films most covered on Wikipedia. Those help us understand your taste but are never offered as picks. Both sources publish their data as CC0. Hooks, tags and reasons are original writing.</p>
<h2>Corrections</h2>
<p>Spotted a wrong year, a bad tag or a pick that makes no sense? <a href="${REPO_URL}/issues" rel="noopener">Open an issue</a>. The catalog is plain text in the repository.</p>
<h2>Export guides</h2>
<ul>${GUIDES.map((g) => `<li><a href="${rel(g.slug + "/")}">${esc(g.title)}</a></li>`).join("")}</ul>
</article>`;
  return shell({ title: `How it works and privacy | ${NAME}`, description: `How ${NAME} ranks books and films from your ratings, why your library never leaves your device, and where its ${data.items.length} verified titles come from.`, pathname: "how-it-works/", body, v, bodyClass: "page-guide" });
}

function homePage(data, H, v) {
  const topB = data.items.filter((o) => o.k === "b").slice(0, 12), topF = data.items.filter((o) => o.k === "f").slice(0, 12);
  const body = `
<section class="hero" id="import">
  <input id="file" type="file" accept=".csv,.zip,text/csv,application/zip" multiple class="visually-hidden" aria-label="Choose export files">
  <h1>Your next book or film, picked from your own ratings, with the reasons.</h1>
  <p class="lede">Drop in your Goodreads, StoryGraph, Letterboxd or IMDb export. Everything runs in this browser tab: <strong>your library never leaves your device</strong>.</p>
  <div class="dropzone" id="dropzone">
    <p class="drop-title">Choose or drop your export</p>
    <p class="drop-sub">CSV files, or the Letterboxd ZIP as it downloads. You can add several.</p>
    <label class="btn" for="file">Choose files</label>
    <p class="drop-alt"><button type="button" class="linkish" id="rate-start">No export? Rate a few titles</button> · <button type="button" class="linkish" id="sample-start">Try a sample library</button></p>
    <p class="drop-help">How to export: <a href="${rel("how-to-export-goodreads/")}">Goodreads</a> · <a href="${rel("how-to-export-letterboxd/")}">Letterboxd</a> · <a href="${rel("how-to-export-storygraph-imdb/")}">StoryGraph, IMDb</a></p>
  </div>
  <p class="status" id="status" role="status" aria-live="polite"></p>
</section>
<section id="app" class="app" hidden></section>
<section class="explainer" id="explainer">
  <h2>How it works</h2>
  <ol class="three">
    <li><strong>Import or rate.</strong> Your export is read right here. Ratings are compared with your own average, so a harsh rater's four stars count for more.</li>
    <li><strong>Get explained picks.</strong> ${data.items.length} verified books and films are ranked against your taste. Each pick says which of your titles led to it and what it shares with them.</li>
    <li><strong>Track and share.</strong> Keep a want list, mark what you're reading or watching, and share a taste profile card. No account.</li>
  </ol>
  <div class="browse-cols">
    <div><h2>Books like…</h2><ul>${topB.map((o) => `<li><a href="${rel(H.pagePath(o))}">${esc(o.t)}</a></li>`).join("")}</ul><p><a href="${rel("books/")}">All ${data.items.filter((o) => o.k === "b").length} books</a></p></div>
    <div><h2>Movies like…</h2><ul>${topF.map((o) => `<li><a href="${rel(H.pagePath(o))}">${esc(o.t)}</a></li>`).join("")}</ul><p><a href="${rel("movies/")}">All ${data.items.filter((o) => o.k === "f").length} films</a></p></div>
  </div>
  <h2>Questions</h2>
  <dl class="faq">
    <dt>Is my data uploaded?</dt><dd>No. The file is read by JavaScript in this tab and the library is saved only in this browser. There is no server and no account. <a href="${rel("how-it-works/")}">How to check</a>.</dd>
    <dt>Which exports work?</dt><dd>Goodreads and StoryGraph CSVs, the Letterboxd ZIP (or its CSVs), IMDb ratings and watchlist exports, and any CSV with a title column.</dd>
    <dt>Where do the picks come from?</dt><dd>A catalog of hand-tagged books and films, each with an original description and hand-picked "if you liked this" links. Every title is checked against Open Library or Wikidata each month.</dd>
    <dt>Does it cost anything?</dt><dd>No. It's free, with no ads and no sign-up.</dd>
  </dl>
</section>
<noscript><p class="status">The picks need JavaScript. The <a href="${rel("books/")}">books</a> and <a href="${rel("movies/")}">movies</a> pages work without it.</p></noscript>`;
  return shell({ title: `${NAME}: book and movie picks from your Goodreads or Letterboxd ratings`, description: `Import your Goodreads, StoryGraph, Letterboxd or IMDb export and get book and film picks ranked for your taste, each with the reason. Free, no account, nothing uploaded.`,
    pathname: "", body, v, bodyClass: "page-home",
    jsonld: [{ "@context": "https://schema.org", "@type": "WebApplication", name: NAME, url: abs(""), applicationCategory: "EntertainmentApplication", operatingSystem: "Any (web browser)", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, description: "Book and film recommendations ranked from your own ratings, with an explanation for each pick. Runs in the browser; nothing is uploaded." }] });
}

function profilePage(v) {
  const body = `<section class="shared" id="shared"><h1>A shared taste profile</h1><p class="status" id="status">Loading the profile from the link…</p></section>`;
  return shell({ title: `A taste profile | ${NAME}`, description: "A reading and watching taste profile shared from Shelf & Screen. Make your own from your Goodreads or Letterboxd ratings.", pathname: "p/", body, v, noindex: true, bodyClass: "page-shared" });
}

function notFoundPage(v) {
  const body = `<section class="guide"><h1>That page isn't here</h1><p>It may have moved, or the title was left out after the monthly check.</p><p><a class="btn" href="${rel("")}">Get my picks</a> <a class="btn ghost" href="${rel("books/")}">Browse books</a> <a class="btn ghost" href="${rel("movies/")}">Browse movies</a></p></section>`;
  return shell({ title: `Not found | ${NAME}`, description: "This page isn't here. Get book and film picks from your own ratings, or browse books and movies like the ones you love.", pathname: "404.html", body, v, noindex: true });
}

// ---------------- assets ----------------
function copyAssets(v) {
  const vers = (code) => code.replace(/(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g, (m, a, q, p) => `${a}${q}${p}?v=${v}${q}`);
  for (const dir of ["engine", "app"]) {
    for (const f of fs.readdirSync(path.join(ROOT, "src", dir))) {
      if (!f.endsWith(".js")) continue;
      write(`assets/js/${dir}/${f}`, vers(fs.readFileSync(path.join(ROOT, "src", dir, f), "utf8")));
    }
  }
  write("assets/site.css", fs.readFileSync(path.join(ROOT, "src", "css", "site.css")));
  for (const f of ["favicon.svg"]) write(f, fs.readFileSync(path.join(ROOT, "src", f)));
}

function assetHash() {
  const h = crypto.createHash("sha256");
  for (const dir of ["src/engine", "src/app", "src/css"]) for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) h.update(f).update(fs.readFileSync(path.join(ROOT, dir, f)));
  return h;
}

// ---------------- main ----------------
export function build() {
  const data = loadData();
  if (!data.items.length) throw new Error("no verified titles: run pipeline/verify.mjs first");
  const H = makeHelpers(data);
  const catalogJson = JSON.stringify({ generated: DAY, tags: data.tags, items: data.items.map(({ ext, key, ...o }) => o) });
  const recogJson = JSON.stringify(data.recog);
  const v = assetHash().update(catalogJson).update(recogJson).update(SITE_URL).digest("hex").slice(0, 10);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copyAssets(v);
  write(`data/catalog.json`, catalogJson);
  write(`data/recog.json`, recogJson);
  const pages = new Map();
  const add = (p, html, index = true) => { write(p.endsWith(".html") ? p : p + "index.html", html); if (index) pages.set(abs(p.replace(/index\.html$/, "")), sha(html, 16)); };
  add("", homePage(data, H, v));
  add("books/", browsePage(data, H, "b", v));
  add("movies/", browsePage(data, H, "f", v));
  add("how-it-works/", howPage(data, v));
  for (const g of GUIDES) add(g.slug + "/", guidePage(g, data, v));
  for (const o of data.items) add(H.pagePath(o), likePage(data, H, o, v));
  add("p/", profilePage(v), false);
  write("404.html", notFoundPage(v));
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...pages.keys()].map((u) => `<url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`);
  write("robots.txt", `User-agent: *\nAllow: /\nDisallow: ${BASE}p/\n\nSitemap: ${abs("sitemap.xml")}\n`);
  const key = fs.readFileSync(path.join(ROOT, "src", "indexnow-key.txt"), "utf8").trim();
  write(`${key}.txt`, key + "\n");
  write("manifest.json", JSON.stringify({ generated: DAY, v, pages: Object.fromEntries(pages) }, null, 0) + "\n");
  write("build-info.json", JSON.stringify({ generated: DAY, v, siteUrl: SITE_URL, titles: data.items.length, books: data.items.filter((o) => o.k === "b").length, films: data.items.filter((o) => o.k === "f").length, recognized: data.recog.books.length + data.recog.films.length, dropped: data.dropped.length }) + "\n");
  const ogSrc = path.join(ROOT, "src", "og");
  if (fs.existsSync(ogSrc)) for (const f of fs.readdirSync(ogSrc)) write(`og/${f}`, fs.readFileSync(path.join(ogSrc, f)));
  if (fs.existsSync(path.join(ROOT, "src", "apple-touch-icon.png"))) write("apple-touch-icon.png", fs.readFileSync(path.join(ROOT, "src", "apple-touch-icon.png")));
  return { data, pages: pages.size, v, out: OUT, catalogBytes: catalogJson.length, recogBytes: recogJson.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = build();
  console.log(`built ${r.pages} pages into ${path.relative(ROOT, r.out)}/ (v ${r.v}); ${r.data.items.length} titles; catalog ${(r.catalogBytes / 1024).toFixed(0)} KB, recognition ${(r.recogBytes / 1024).toFixed(0)} KB; ${r.data.dropped.length} unverified titles left out`);
}
