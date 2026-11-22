// The app on the home page: import, explained picks, want list, library and taste profile.
// Everything happens in this tab. The only network requests are for this site's own JSON files.
import { parseExport, mergeEntries, FORMAT_NAMES, entryKey } from "../engine/importers.js";
import { readZipCsvs } from "../engine/zip.js";
import { matchLibrary, searchCatalog } from "../engine/model.js";
import { buildTaste, rankPicks, stretchPicks, rankWantList, summarize } from "../engine/taste.js";
import { similarTo, listPhrase } from "../engine/similar.js";
import { toCsv } from "../engine/csv.js";
import * as store from "./store.js";
import { h, clear, starText, fmt, track } from "./dom.js";
import { loadModel, pagePath, base } from "./data.js";
import { encodeProfile } from "./share.js";
import { drawCard } from "./card.js";

let state = store.load();
let model = null;
let view = "picks";
let rev = 0;
let cache = { rev: -1 };
const ui = { kind: state.picksKind || "all", fiction: "all", mood: null, shown: 20, libFilter: "all", libQuery: "", libShown: 100, seed: null, rateSkip: new Set(), openRate: null };
const $ = (id) => document.getElementById(id);
const todayIso = () => new Date().toISOString().slice(0, 10);

const MOODS = [
  ["lighter", "Something lighter"], ["darker", "Something darker"], ["fast", "Fast-paced"], ["slow", "Slow and immersive"],
  ["short", "Short"], ["classic", "Before 1970"], ["recent", "2010 or later"], ["stretch", "Outside my usual shelf"],
];
const LIGHT = ["m:funny", "m:heartwarming", "m:cozy", "m:uplifting", "m:hopeful", "m:charming", "m:playful", "m:whimsical", "m:witty"];
const DARK = ["m:bleak", "m:disturbing", "m:dark", "m:violent", "m:raw", "m:creepy"];

function setStatus(msg, kind = "") {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

function commit() {
  rev++;
  state.picksKind = ui.kind;
  if (!store.save(state)) setStatus("Your browser isn't letting this site save, so your library will be gone when you close the tab.", "warn");
}

async function ensureModel() {
  if (model) return model;
  setStatus("Loading the catalog…");
  model = await loadModel();
  setStatus("");
  return model;
}

/** Match the library and build the taste profile, once per change. */
function compute() {
  if (cache.rev === rev && cache.model === model) return cache;
  const entries = state.entries;
  const match = matchLibrary(model, entries);
  const hiddenIds = new Set(state.hidden);
  const extra = [];
  for (let i = 0; i < model.nCurated; i++) {
    const kn = model.known[i];
    if (hiddenIds.has(kn.item.id)) extra.push({ entry: { kind: kn.k, title: kn.t, creator: kn.c, year: kn.y, rating: null, status: "notforme", liked: false, shelves: [] }, known: kn, tags: kn.x });
  }
  const profile = buildTaste(model, [...match.rows, ...extra]);
  const exclude = new Set(match.rows.filter((r) => r.known).map((r) => r.known.n));
  cache = { rev, model, match, profile, exclude, hidden: hiddenIds };
  return cache;
}

// ---------------- import ----------------
async function readFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = /\.zip$/i.test(file.name) || (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);
  if (isZip) {
    const csvs = await readZipCsvs(buf);
    const out = [];
    for (const c of csvs) {
      try { out.push({ name: c.name, ...parseExport(c.text, c.name) }); } catch { /* other files in the ZIP (profile, comments, lists) */ }
    }
    if (!out.length) throw new Error(`"${file.name}" has no export files we recognize inside it.`);
    return out;
  }
  const text = new TextDecoder("utf-8").decode(buf);
  return [{ name: file.name, ...parseExport(text, file.name) }];
}

async function handleFiles(files) {
  files = [...files].filter(Boolean);
  if (!files.length) return;
  setStatus(`Reading ${files.length === 1 ? files[0].name : files.length + " files"}…`);
  const parsed = [], errors = [];
  for (const f of files) {
    if (f.size > 80 * 1024 * 1024) { errors.push(`"${f.name}" is too large to read here.`); continue; }
    try { parsed.push(...(await readFile(f))); } catch (e) { errors.push(e.message); }
  }
  if (!parsed.length) { setStatus(errors.join(" ") || "Nothing to import.", "error"); return; }
  const wasSample = state.sample;
  const before = wasSample ? state.entries.filter((e) => e.source !== "sample") : state.entries;
  state.entries = mergeEntries(before, ...parsed.map((p) => p.entries));
  state.sample = false;
  if (wasSample) state.hidden = [];
  commit();
  await ensureModel();
  const c = compute();
  const byFormat = {};
  for (const p of parsed) byFormat[FORMAT_NAMES[p.format]] = (byFormat[FORMAT_NAMES[p.format]] || 0) + p.entries.length;
  const parts = Object.entries(byFormat).map(([k, n]) => `${fmt(n)} from your ${k}`);
  setStatus(`Read ${parts.join(", ")}. We recognized ${fmt(c.match.matched)} of your ${fmt(c.match.total)} titles${wasSample ? " (the sample library was replaced)" : ""}.${errors.length ? " " + errors.join(" ") : ""}`, errors.length ? "warn" : "ok");
  track("import_done");
  view = "picks"; ui.shown = 20;
  render(true);
}

function wireImport() {
  const input = $("file");
  input?.addEventListener("change", () => { handleFiles(input.files); input.value = ""; });
  const dz = $("dropzone");
  if (dz) {
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer?.files || []));
  }
  $("sample-start")?.addEventListener("click", loadSample);
  $("rate-start")?.addEventListener("click", async () => { await ensureModel(); view = "rate"; track("rate_mode"); render(true); });
}

// ---------------- sample library ----------------
const SAMPLE = [
  ["b", "The Left Hand of Darkness", 5], ["b", "Never Let Me Go", 5], ["b", "Station Eleven", 4.5], ["b", "Piranesi", 5], ["b", "The Remains of the Day", 4],
  ["b", "Project Hail Mary", 3.5], ["b", "Dune", 4], ["b", "The Road", 4.5], ["b", "Gone Girl", 2.5], ["b", "The Da Vinci Code", 2], ["b", "Circe", 4],
  ["b", "The Martian", 3], ["b", "Klara and the Sun", 4.5], ["f", "Arrival", 5], ["f", "Blade Runner", 4.5], ["f", "Interstellar", 3.5], ["f", "Her", 4.5],
  ["f", "Lost in Translation", 4], ["f", "Mad Max: Fury Road", 3.5], ["f", "The Matrix", 4], ["f", "Spirited Away", 5], ["f", "Avatar", 2.5],
  ["f", "Moonlight", 4.5], ["f", "Eternal Sunshine of the Spotless Mind", 5], ["f", "Inception", 3.5], ["f", "Fast & Furious", 1.5],
];

async function loadSample() {
  await ensureModel();
  const entries = [];
  for (const [k, title, rating] of SAMPLE) {
    const kn = searchCatalog(model, title, 1, k)[0];
    if (kn && kn.t.toLowerCase() === title.toLowerCase()) entries.push(entryFrom(kn, { rating, status: "done", source: "sample" }));
  }
  state = { ...state, entries, hidden: [], sample: true };
  commit();
  setStatus(`Loaded a sample library of ${entries.length} rated titles. Import your own export any time; it replaces the sample.`, "ok");
  track("sample_loaded");
  view = "picks"; ui.shown = 20;
  render(true);
}

function entryFrom(kn, { rating = null, status = "done", source = "picked", liked = false } = {}) {
  return { kind: kn.k, title: kn.t, creator: kn.c, year: kn.y, rating, status, liked, shelves: [], imdb: kn.item?.imdb || null, date: todayIso(), source };
}

function upsert(entry) {
  const key = entryKey(entry);
  const i = state.entries.findIndex((e) => entryKey(e) === key);
  if (i >= 0) state.entries[i] = { ...state.entries[i], ...entry, shelves: state.entries[i].shelves || [] };
  else state.entries.push(entry);
}

// ---------------- rendering ----------------
function render(scroll = false) {
  const app = $("app");
  if (!app || !model) return;
  const has = state.entries.length > 0;
  if (!has && view !== "rate") view = "rate";
  app.hidden = false;
  document.body.classList.toggle("has-library", has);
  const explainer = $("explainer");
  if (explainer) explainer.hidden = has || view === "rate";
  clear(app);
  const c = compute();
  const want = state.entries.filter((e) => e.status === "want").length;
  const tabs = [["picks", "Picks"], ["want", `Want list${want ? ` (${fmt(want)})` : ""}`], ["library", `Library (${fmt(state.entries.length)})`], ["profile", "Taste profile"], ["rate", "Rate titles"]];
  app.append(h("nav", { class: "tabs", "aria-label": "Your library" },
    tabs.map(([id, label]) => h("button", { type: "button", class: "tab", "data-tab": id, "aria-pressed": String(view === id), onclick: () => { view = id; render(); } }, label))));
  if (state.sample) app.append(h("p", { class: "note" }, "You're looking at a sample library. ", h("button", { type: "button", class: "linkish", onclick: () => $("file")?.click() }, "Import your own export"), " to replace it."));
  const panel = h("div", { class: "panel", id: `panel-${view}` });
  app.append(panel);
  ({ picks: renderPicks, want: renderWant, library: renderLibrary, profile: renderProfile, rate: renderRate }[view] || renderPicks)(panel, c);
  if (scroll) app.scrollIntoView({ behavior: "smooth", block: "start" });
}

function kindBadge(k) { return h("span", { class: `kind kind-${k}` }, k === "b" ? "Book" : "Film"); }
function label(t) { return model.tags[t].label; }

function whyBlock(why) {
  const lines = [];
  if (why.sharesWith) lines.push(h("p", { class: "why-traits" }, "Shares ", h("strong", {}, listPhrase(why.shared.map(label)) || "its overall feel"), ` with ${why.sharesWith}.`));
  if (why.because.length) {
    const names = why.because.map((b) => `${b.title}${b.rating != null ? " " + starText(b.rating) : b.liked ? " (liked)" : ""}`);
    lines.push(h("p", { class: "why-because" }, h("strong", {}, why.because.every((b) => b.rating != null) ? "Because you rated " : "Because of "), listPhrase(names), "."));
    const linked = why.because.find((b) => b.link);
    if (linked) lines.push(h("p", { class: "why-note" }, "From our notes on ", h("em", {}, linked.title), ": “", linked.link, "”"));
  }
  if (why.traits.length) lines.push(h("p", { class: "why-traits" }, "You rate ", h("strong", {}, listPhrase(why.traits.map(label))), " highly."));
  if (why.caveats.length) lines.push(h("p", { class: "why-caveat" }, "Heads-up: it has ", listPhrase(why.caveats.map(label)), ", which you tend to rate lower."));
  if (!lines.length && !why.sharesWith) lines.push(h("p", { class: "why-traits" }, "A widely loved title close to your overall taste."));
  return h("div", { class: "why" }, lines);
}

function starButtons(current, onRate, name) {
  return h("span", { class: "stars", role: "group", "aria-label": `Your rating for ${name}: ${current != null ? current + " stars" : "not rated"}` },
    [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", class: "star" + (current != null && current >= n ? " on" : ""), "aria-label": `Rate ${n} star${n > 1 ? "s" : ""}`, onclick: () => onRate(n) }, "★")));
}

function pickCard(p) {
  const kn = p.kn, it = kn.item;
  const fitText = { strong: "Strong match", good: "Good match", fair: "Worth a look", stretch: "A stretch you may like", want: "On your list" }[p.fit] || "";
  const rateOpen = ui.openRate === it.id;
  return h("article", { class: "pick", "data-id": it.id },
    h("div", { class: "pick-top" }, kindBadge(kn.k), h("span", { class: `fit fit-${p.fit}` }, fitText)),
    h("h3", {}, h("a", { href: pagePath(it) }, kn.t)),
    h("p", { class: "meta" }, `${kn.k === "b" ? "by" : "dir."} ${kn.c} · ${kn.y}`),
    h("p", { class: "hook" }, it.h),
    whyBlock(p.why),
    h("div", { class: "pick-actions" },
      h("button", { type: "button", class: "btn small", "data-act": "want", onclick: () => { upsert(entryFrom(kn, { status: "want", source: "picked" })); commit(); track("pick_want"); render(); } }, "+ Want"),
      h("button", { type: "button", class: "btn small ghost", "data-act": "seen", "aria-expanded": String(rateOpen), onclick: () => { ui.openRate = rateOpen ? null : it.id; render(); } }, kn.k === "b" ? "Read it" : "Seen it"),
      h("button", { type: "button", class: "btn small ghost", "data-act": "hide", onclick: () => { state.hidden.push(it.id); commit(); track("pick_hide"); render(); } }, "Not for me")),
    rateOpen ? h("div", { class: "rate-inline" }, "How was it? ",
      starButtons(null, (n) => { upsert(entryFrom(kn, { rating: n, status: "done", source: "picked" })); ui.openRate = null; commit(); track("pick_seen"); setStatus(`Saved ${kn.t} ${starText(n)}. Picks updated.`, "ok"); render(); }, kn.t)) : null);
}

function renderPicks(panel, c) {
  const { match, profile } = c;
  const head = h("div", { class: "picks-head" },
    h("p", { class: "summary" }, `Ranked from the ${fmt(match.matched)} titles we recognized in your library`, match.total > match.matched ? ` (of ${fmt(match.total)})` : "", "."),
    h("div", { class: "filters" },
      h("div", { class: "seg", role: "group", "aria-label": "Books or films" }, [["all", "Both"], ["b", "Books"], ["f", "Films"]].map(([k, l]) =>
        h("button", { type: "button", "aria-pressed": String(ui.kind === k), onclick: () => { ui.kind = k; ui.shown = 20; state.picksKind = k; store.save(state); render(); } }, l))),
      ui.kind !== "f" ? h("div", { class: "seg", role: "group", "aria-label": "Fiction or nonfiction" }, [["all", "All books"], ["fic", "Fiction"], ["nf", "Nonfiction"]].map(([k, l]) =>
        h("button", { type: "button", "aria-pressed": String(ui.fiction === k), onclick: () => { ui.fiction = k; ui.shown = 20; render(); } }, l))) : null),
    h("div", { class: "moods", role: "group", "aria-label": "In the mood for" }, h("span", { class: "chiplabel" }, "In the mood for"),
      MOODS.map(([k, l]) => h("button", { type: "button", class: "chip-btn", "aria-pressed": String(ui.mood === k), onclick: () => { ui.mood = ui.mood === k ? null : k; ui.shown = 20; render(); } }, l))));
  panel.append(head);
  if (ui.seed != null) {
    const seedN = ui.seed;
    const sims = similarTo(model, seedN, { limit: 6, skip: c.exclude });
    if (sims.length) panel.append(h("section", { class: "seed" }, h("h2", {}, `More like ${model.known[seedN].t}`),
      h("div", { class: "pick-grid" }, sims.map((s) => pickCard({ kn: s.kn, fit: "good", why: { because: [], traits: [], caveats: [], shared: s.shared, sharesWith: model.known[seedN].t } }))),
      h("button", { type: "button", class: "linkish", onclick: () => { ui.seed = null; render(); } }, "Hide this")));
  }
  const kind = ui.kind === "all" ? null : ui.kind;
  const fiction = ui.kind === "f" || ui.fiction === "all" ? null : ui.fiction === "fic";
  let picks;
  const opts = { kind, fiction, exclude: c.exclude, hidden: c.hidden, limit: ui.shown };
  if (ui.mood === "stretch") picks = stretchPicks(model, profile, { ...opts, limit: Math.min(ui.shown, 12) });
  else {
    const has = (kn, keys) => keys.reduce((a, k) => a + (kn.x.includes(model.tagIndex.get(k)) ? 1 : 0), 0);
    const adjust = { lighter: (kn) => 0.35 * has(kn, LIGHT) - 0.5 * has(kn, DARK), darker: (kn) => 0.35 * has(kn, DARK) - 0.5 * has(kn, LIGHT),
      fast: (kn) => 0.6 * has(kn, ["p:fast"]) - 0.6 * has(kn, ["p:slow"]), slow: (kn) => 0.6 * has(kn, ["p:slow", "m:atmospheric"]) - 0.6 * has(kn, ["p:fast"]),
      short: (kn) => 0.7 * has(kn, ["s:short"]) - 0.7 * has(kn, ["s:epic-length"]) }[ui.mood] || null;
    const filter = { classic: (kn) => kn.y < 1970, recent: (kn) => kn.y >= 2010 }[ui.mood] || null;
    picks = rankPicks(model, profile, { ...opts, adjust, filter });
  }
  if (!picks.length) { panel.append(h("p", { class: "empty" }, "Nothing left for these filters. Try another mood or show both books and films.")); return; }
  panel.append(h("div", { class: "pick-grid", id: "picks" }, picks.map(pickCard)));
  if (picks.length >= ui.shown && ui.mood !== "stretch") panel.append(h("p", { class: "more" }, h("button", { type: "button", class: "btn ghost", onclick: () => { ui.shown += 20; render(); } }, "Show 20 more")));
  if (profile.ratedCount < 8) panel.append(h("p", { class: "note" }, "Picks sharpen with more ratings. ", h("button", { type: "button", class: "linkish", onclick: () => { view = "rate"; render(); } }, "Rate a few more titles"), "."));
}

function statusSelect(e, onChange) {
  return h("select", { "aria-label": `Status of ${e.title}`, onchange: (ev) => onChange(ev.target.value) },
    [["want", "Want"], ["doing", e.kind === "b" ? "Reading" : "Watching"], ["done", e.kind === "b" ? "Read" : "Watched"], ["dropped", "Dropped"]].map(([v, l]) => h("option", { value: v, selected: e.status === v }, l)));
}

function renderWant(panel, c) {
  const wants = state.entries.filter((e) => e.status === "want");
  const doing = state.entries.filter((e) => e.status === "doing");
  if (doing.length) {
    panel.append(h("h2", {}, `In progress (${doing.length})`), h("ul", { class: "rows" }, doing.map((e) => h("li", { class: "row" },
      kindBadge(e.kind), h("span", { class: "t" }, e.title), h("span", { class: "meta" }, [e.creator, e.year].filter(Boolean).join(" · ")),
      h("span", { class: "row-actions" }, "Finished? ", starButtons(null, (n) => { e.rating = n; e.status = "done"; e.date = todayIso(); commit(); render(); }, e.title))))));
  }
  panel.append(h("h2", {}, `Want list (${wants.length})`));
  if (!wants.length) { panel.append(h("p", { class: "empty" }, "Nothing here yet. Tap “+ Want” on a pick, or import a to-read shelf or watchlist.")); return; }
  const ranked = rankWantList(model, c.profile, c.match.rows, 1e6);
  const rankedKeys = new Set(ranked.map((r) => entryKey(r.entry)));
  panel.append(h("p", { class: "sub" }, "Ordered by how well each one fits your taste. Titles we couldn't place come last."));
  const rowFor = (e, r) => h("li", { class: "row" + (r ? " ranked" : "") },
    kindBadge(e.kind), r ? h("a", { class: "t", href: r.kn.curated ? pagePath(r.kn.item) : null }, e.title) : h("span", { class: "t" }, e.title),
    h("span", { class: "meta" }, [e.creator, e.year].filter(Boolean).join(" · ")),
    r && r.why.because.length ? h("span", { class: "row-why" }, "Because of " + listPhrase(r.why.because.slice(0, 2).map((b) => b.title))) : null,
    h("span", { class: "row-actions" },
      h("button", { type: "button", class: "btn small ghost", onclick: () => { e.status = "doing"; commit(); render(); } }, "Start"),
      h("button", { type: "button", class: "btn small ghost", onclick: () => { state.entries = state.entries.filter((x) => x !== e); commit(); render(); } }, "Remove")));
  panel.append(h("ol", { class: "rows" }, ranked.map((r) => rowFor(state.entries.find((e) => entryKey(e) === entryKey(r.entry)) || r.entry, r)),
    wants.filter((e) => !rankedKeys.has(entryKey(e))).map((e) => rowFor(e, null))));
}

function renderLibrary(panel, c) {
  const byKey = new Map(c.match.rows.map((r) => [entryKey(r.entry), r]));
  const counts = { all: state.entries.length, done: 0, doing: 0, want: 0, dropped: 0 };
  for (const e of state.entries) counts[e.status] = (counts[e.status] || 0) + 1;
  panel.append(h("div", { class: "lib-tools" },
    h("div", { class: "seg", role: "group", "aria-label": "Filter by status" }, [["all", "All"], ["done", "Finished"], ["doing", "In progress"], ["want", "Want"], ["dropped", "Dropped"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(ui.libFilter === k), onclick: () => { ui.libFilter = k; ui.libShown = 100; render(); } }, `${l} ${fmt(counts[k] || 0)}`))),
    h("input", { type: "search", class: "search", placeholder: "Search your library", "aria-label": "Search your library", value: ui.libQuery,
      oninput: (ev) => { ui.libQuery = ev.target.value; clearTimeout(ui.t); ui.t = setTimeout(() => { render(); const s = document.querySelector(".lib-tools .search"); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }, 250); } })));
  const q = ui.libQuery.trim().toLowerCase();
  const list = state.entries.filter((e) => (ui.libFilter === "all" || e.status === ui.libFilter) && (!q || `${e.title} ${e.creator}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title));
  panel.append(h("ul", { class: "rows lib" }, list.slice(0, ui.libShown).map((e) => {
    const r = byKey.get(entryKey(e));
    return h("li", { class: "row" },
      kindBadge(e.kind),
      r?.known?.curated ? h("a", { class: "t", href: pagePath(r.known.item) }, e.title) : h("span", { class: "t" }, e.title),
      h("span", { class: "meta" }, [e.creator, e.year].filter(Boolean).join(" · ")),
      h("span", { class: "recog", title: r?.known ? (r.known.curated ? "In our catalog" : "Recognized") : "Not recognized; it doesn't affect picks" }, r?.known ? (r.known.curated ? "●" : "○") : "·"),
      e.status === "want" ? null : starButtons(e.rating, (n) => { e.rating = n; commit(); render(); }, e.title),
      statusSelect(e, (s) => { e.status = s; commit(); render(); }));
  })));
  if (list.length > ui.libShown) panel.append(h("p", { class: "more" }, h("button", { type: "button", class: "btn ghost", onclick: () => { ui.libShown += 200; render(); } }, `Show more (${fmt(list.length - ui.libShown)} left)`)));
  panel.append(h("p", { class: "legend" }, "● in our catalog · ○ recognized from open data · · not recognized (doesn't affect picks)"));
  panel.append(h("div", { class: "lib-actions" },
    h("button", { type: "button", class: "btn ghost", onclick: () => $("file")?.click() }, "Add another export"),
    h("button", { type: "button", class: "btn ghost", onclick: exportCsv }, "Download my library (CSV)"),
    h("button", { type: "button", class: "btn ghost danger", onclick: () => {
      if (!confirm("Delete your library, ratings and hidden picks from this browser? This can't be undone.")) return;
      store.clear(); state = store.load(); rev++; view = "picks"; setStatus("Everything was deleted from this browser.", "ok");
      const app = $("app"); if (app) { clear(app); app.hidden = true; } const ex = $("explainer"); if (ex) ex.hidden = false; document.body.classList.remove("has-library");
    } }, "Clear everything")));
}

function exportCsv() {
  const rows = [["title", "creator", "year", "type", "rating", "status", "liked", "date", "source"],
    ...state.entries.map((e) => [e.title, e.creator, e.year || "", e.kind === "b" ? "book" : "film", e.rating ?? "", e.status, e.liked ? "yes" : "", e.date || "", e.source || ""])];
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `shelf-and-screen-library-${todayIso()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function yearInReview() {
  const done = state.entries.filter((e) => e.status === "done" && e.date);
  const years = {};
  for (const e of done) { const y = e.date.slice(0, 4); (years[y] ||= []).push(e); }
  const y = Object.keys(years).filter((k) => years[k].length >= 5 && +k <= new Date().getFullYear()).sort().pop();
  if (!y) return null;
  const list = years[y];
  const rated = list.filter((e) => e.rating != null);
  return { year: y, books: list.filter((e) => e.kind === "b").length, films: list.filter((e) => e.kind === "f").length,
    avg: rated.length ? rated.reduce((a, e) => a + e.rating, 0) / rated.length : null,
    top: rated.sort((a, b) => b.rating - a.rating || (b.date || "").localeCompare(a.date || "")).slice(0, 3) };
}

function renderProfile(panel, c) {
  const s = summarize(model, c.profile);
  const chipRow = (title, rows) => rows.length ? h("div", { class: "trait-row" }, h("h3", {}, title), h("ul", { class: "traits" }, rows.map((r) =>
    h("li", { class: "trait" }, h("span", { class: "trait-name" }, r.tag.label), h("span", { class: "trait-meta" }, `${fmt(r.n)} titles${r.avg != null ? ` · avg ${starText(r.avg) || r.avg.toFixed(1)} (${r.avg.toFixed(1)})` : ""}`))))) : null;
  const nb = c.profile.kindCount.b, nf = c.profile.kindCount.f;
  panel.append(h("section", { class: "profile" },
    h("p", { class: "eyebrow" }, "Your taste, from your own ratings"),
    h("h2", { class: "archetype" }, s.name),
    h("p", { class: "sub" }, `Read from ${fmt(nb)} books and ${fmt(nf)} films we recognized${s.mean != null ? `, average rating ${s.mean.toFixed(2)}` : ""}.`),
    chipRow("Genres you rate highly", s.loves.genres), chipRow("Themes", s.loves.themes), chipRow("Moods and pace", s.loves.moods),
    chipRow("Craft", s.loves.styles), chipRow("Settings", s.loves.worlds), chipRow("You tend to rate lower", s.avoids)));
  const yr = yearInReview();
  if (yr) panel.append(h("section", { class: "year" }, h("h3", {}, `Your ${yr.year}`),
    h("p", {}, `${fmt(yr.books)} books and ${fmt(yr.films)} films finished${yr.avg != null ? `, average ${yr.avg.toFixed(1)} stars` : ""}.`),
    yr.top.length ? h("p", {}, "Top rated: ", listPhrase(yr.top.map((e) => `${e.title} ${starText(e.rating)}`)), ".") : null));
  // Share: exactly what will be shared is shown before sharing.
  const traitKeys = [...s.loves.moods, ...s.loves.genres, ...s.loves.styles, ...s.loves.themes].slice(0, 6);
  const favs = c.match.rows.filter((r) => r.known?.curated && r.entry.rating != null && r.entry.rating >= 4.5).sort((a, b) => b.entry.rating - a.entry.rating || (a.known.n - b.known.n)).slice(0, 5).map((r) => r.known);
  const payload = { n: s.name, t: traitKeys.map((r) => r.tag.key), c: favs.map((k) => `${k.k}:${k.item.id}`), b: nb, f: nf };
  const url = `${location.origin}${base()}p/#${encodeProfile(payload)}`;
  panel.append(h("section", { class: "share" }, h("h3", {}, "Share your taste"),
    h("p", { class: "sub" }, "The link carries only this: your taste name, ", listPhrase(traitKeys.map((r) => r.tag.label)) || "no traits yet", favs.length ? `, and ${favs.length} favorite${favs.length > 1 ? "s" : ""} (${favs.map((k) => k.t).join(", ")})` : "", `, plus your two counts. Nothing else from your library.`),
    h("div", { class: "share-actions" },
      h("button", { type: "button", class: "btn", onclick: async () => { try { await navigator.clipboard.writeText(url); setStatus("Link copied.", "ok"); } catch { prompt("Copy this link:", url); } track("share_copy"); } }, "Copy link"),
      navigator.share ? h("button", { type: "button", class: "btn ghost", onclick: () => { navigator.share({ title: "My reading & watching taste", url }).catch(() => {}); track("share_native"); } }, "Share…") : null,
      h("button", { type: "button", class: "btn ghost", onclick: async () => {
        const blob = await drawCard({ name: s.name, traits: traitKeys.map((r) => r.tag.label), favorites: favs.map((k) => ({ t: k.t, k: k.k })), books: nb, films: nf });
        const a = h("a", { href: URL.createObjectURL(blob), download: "my-taste-card.png" }); document.body.append(a); a.click(); a.remove(); track("card_download");
      } }, "Download card image"))));
}

function renderRate(panel, c) {
  const rated = state.entries.filter((e) => e.rating != null).length;
  panel.append(h("h2", {}, "Rate a few you know"),
    h("p", { class: "sub" }, "Tap stars for titles you've read or seen. Five ratings is enough to start; more makes the picks sharper. Ratings stay in this browser."));
  const results = h("ul", { class: "rows rate-results" });
  const doSearch = (q) => {
    clear(results);
    for (const kn of searchCatalog(model, q, 8)) results.append(rateRow(kn));
  };
  panel.append(h("input", { type: "search", class: "search", placeholder: "Search books and films", "aria-label": "Search books and films", oninput: (ev) => doSearch(ev.target.value) }), results);
  const mine = new Set(c.match.rows.filter((r) => r.known).map((r) => r.known.n));
  const starters = [];
  for (const k of ["b", "f"]) {
    let n = 0;
    for (let i = 0; i < model.nCurated && n < 8; i++) {
      const kn = model.known[i];
      if (kn.k !== k || mine.has(kn.n) || ui.rateSkip.has(kn.n)) continue;
      starters.push(kn); n++;
    }
  }
  starters.sort((a, b) => b.pop - a.pop || a.n - b.n);
  panel.append(h("h3", {}, "Popular titles"), h("ul", { class: "rows rate-grid" }, starters.map(rateRow)));
  panel.append(h("p", { class: "more" }, rated >= 1 ? h("button", { type: "button", class: "btn", onclick: () => { view = "picks"; render(true); } }, `See my picks (${rated} rated)`) : null));
}

function rateRow(kn) {
  const e = state.entries.find((x) => entryKey(x) === entryKey(entryFrom(kn)));
  return h("li", { class: "row" }, kindBadge(kn.k), h("span", { class: "t" }, kn.t), h("span", { class: "meta" }, `${kn.c} · ${kn.y}`),
    starButtons(e?.rating ?? null, (n) => { upsert(entryFrom(kn, { rating: n, status: "done", source: "rated" })); commit(); render(); }, kn.t),
    e ? null : h("button", { type: "button", class: "linkish", onclick: () => { ui.rateSkip.add(kn.n); render(); } }, "Haven't " + (kn.k === "b" ? "read" : "seen")));
}

// ---------------- boot ----------------
export async function boot() {
  wireImport();
  const params = new URLSearchParams(location.search);
  const from = params.get("from");
  if (from) history.replaceState(null, "", location.pathname + location.hash);
  if (!state.entries.length && !from) return;
  try {
    await ensureModel();
  } catch (e) { setStatus(e.message, "error"); return; }
  if (from) {
    const [k, id] = from.split(":");
    let seed = -1;
    for (let i = 0; i < model.nCurated; i++) if (model.known[i].k === k && model.known[i].item.id === id) { seed = i; break; }
    if (seed >= 0) {
      const kn = model.known[seed];
      if (!state.entries.length) {
        upsert(entryFrom(kn, { rating: 5, status: "done", source: "rated", liked: true }));
        commit();
        setStatus(`Starting from ${kn.t} (5 stars, change it any time). Rate a few more for sharper picks, or import your export.`, "ok");
        view = "picks";
      } else { ui.seed = seed; view = "picks"; }
    }
  }
  render(!!from);
}
