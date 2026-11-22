// Ranking logic on a small synthetic catalog, so the expectations follow from the data in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, matchLibrary, matchEntry, searchCatalog } from "../src/engine/model.js";
import { buildTaste, rankPicks, rankWantList, summarize, stretchPicks } from "../src/engine/taste.js";
import { similarTo, listPhrase } from "../src/engine/similar.js";
import { titleKeys, sameCreator, slugify } from "../src/engine/normalize.js";

const TAGS = [["g", "fantasy", "fantasy"], ["g", "romance", "romance"], ["g", "sci-fi", "science fiction"], ["g", "horror", "horror"], ["g", "memoir", "memoir"],
  ["m", "dark", "dark"], ["m", "funny", "funny"], ["m", "cozy", "cozy"], ["s", "world-building", "deep world-building"], ["s", "slow-burn", "a slow burn"],
  ["th", "found-family", "found family"], ["th", "magic", "magic"], ["th", "love", "love stories"], ["p", "slow", "slow"], ["p", "fast", "fast"], ["p", "medium", "steady"]];
const T = Object.fromEntries(TAGS.map(([f, id], i) => [`${f}:${id}`, i]));
const item = (id, k, t, c, y, tags, links = [], extra = {}) => ({ id, k, t, c, y, x: tags.map((x) => T[x]).sort((a, b) => a - b), h: `Hook for ${t}.`, l: links, pop: 10, ...extra });
const CATALOG = {
  tags: TAGS,
  items: [
    item("wind", "b", "The Name of the Wind", "Patrick Rothfuss", 2007, ["g:fantasy", "s:world-building", "th:magic", "p:slow", "m:dark"], [[1, "Another magic school with a heavier world."]]),
    item("empire", "b", "The Final Empire", "Brandon Sanderson", 2006, ["g:fantasy", "s:world-building", "th:magic", "th:found-family", "p:fast"]),
    item("hobbit", "b", "The Hobbit", "J. R. R. Tolkien", 1937, ["g:fantasy", "th:found-family", "m:cozy", "p:medium"]),
    item("legends", "b", "Legends & Lattes", "Travis Baldree", 2022, ["g:fantasy", "th:found-family", "m:cozy", "p:slow"]),
    item("bride", "b", "A Romance Novel", "Some Writer", 2015, ["g:romance", "th:love", "m:funny", "p:fast"]),
    item("bride2", "b", "Another Romance", "Other Writer", 2018, ["g:romance", "th:love", "m:funny", "p:fast"]),
    item("dune", "b", "Dune", "Frank Herbert", 1965, ["g:sci-fi", "s:world-building", "s:slow-burn", "p:slow"]),
    item("it", "b", "It", "Stephen King", 1986, ["g:horror", "m:dark", "th:found-family", "p:slow"]),
    item("memoir", "b", "A Memoir", "Real Person", 2010, ["g:memoir", "m:funny", "p:medium"], [], { nf: 1 }),
    item("dune-film", "f", "Dune", "Denis Villeneuve", 2021, ["g:sci-fi", "s:world-building", "s:slow-burn", "p:slow"], [], { imdb: "tt1160419" }),
    item("dune-84", "f", "Dune", "David Lynch", 1984, ["g:sci-fi", "s:world-building", "m:dark", "p:medium"]),
    item("rings", "f", "The Fellowship of the Ring", "Peter Jackson", 2001, ["g:fantasy", "s:world-building", "th:found-family", "p:slow"], [], { aka: ["Lord of the Rings"] }),
  ],
};
const model = buildModel(CATALOG, { books: [["Recognized Fantasy Book", "Jane Writer", 2001, [T["g:fantasy"], T["th:magic"]], 50]], films: [["A Romance Film", "Some Director", 1999, [T["g:romance"], T["th:love"]], 20, "tt0000001"]] });
const e = (kind, title, creator, year, rating, status = "done", extra = {}) => ({ kind, title, creator, year, rating, status, liked: false, shelves: [], ...extra });

test("normalization: series notes, subtitles, articles, accents and name order", () => {
  assert.ok(titleKeys("The Name of the Wind (The Kingkiller Chronicle, #1)").includes("name of the wind"));
  assert.ok(titleKeys("Sapiens: A Brief History of Humankind").includes("sapiens"));
  assert.ok(sameCreator("Le Guin, Ursula K.", "Ursula K. Le Guin"));
  assert.ok(sameCreator("Terry Pratchett & Neil Gaiman", "Neil Gaiman"));
  assert.ok(!sameCreator("Stephen King", "Joe Hill"));
  assert.equal(slugify("Amélie: Le fabuleux destin"), "amelie-le-fabuleux-destin");
});

test("matching: books need a shared surname, films a year within one, IMDb ids match directly", () => {
  assert.equal(matchEntry(model, e("b", "The Name of the Wind (Kingkiller, #1)", "Rothfuss, Patrick", 2007, 5))?.item?.id, "wind");
  assert.equal(matchEntry(model, e("b", "The Name of the Wind", "Somebody Else", 2007, 5)), null);
  assert.equal(matchEntry(model, e("f", "Dune", "", 2021, 5))?.item?.id, "dune-film");
  assert.equal(matchEntry(model, e("f", "Dune", "", 1984, 5))?.item?.id, "dune-84");
  assert.equal(matchEntry(model, e("f", "Dune", "", 2022, 5))?.item?.id, "dune-film", "one year of slack");
  assert.equal(matchEntry(model, e("f", "Anything", "", 1990, 5, "done", { imdb: "tt1160419" }))?.item?.id, "dune-film");
  assert.equal(matchEntry(model, e("f", "Lord of the Rings", "", 2001, 4))?.item?.id, "rings", "aliases match");
  const rec = matchEntry(model, e("b", "Recognized Fantasy Book", "Jane Writer", 2001, 4));
  assert.ok(rec && !rec.curated, "recognition titles are understood but not curated");
});

const FANTASY_FAN = [
  e("b", "The Name of the Wind", "Patrick Rothfuss", 2007, 5),
  e("b", "The Hobbit", "J.R.R. Tolkien", 1937, 4.5),
  e("b", "A Romance Novel", "Some Writer", 2015, 1.5),
  e("b", "Recognized Fantasy Book", "Jane Writer", 2001, 4.5),
  e("f", "A Romance Film", "", 1999, 2),
  e("b", "Dune", "Frank Herbert", 1965, null, "want"),
  e("b", "It", "Stephen King", 1986, null, "want"),
];

test("picks follow the ratings, skip what you have, and explain themselves", () => {
  const { rows } = matchLibrary(model, FANTASY_FAN);
  const profile = buildTaste(model, rows);
  const exclude = new Set(rows.filter((r) => r.known).map((r) => r.known.n));
  const picks = rankPicks(model, profile, { exclude, limit: 5 });
  const ids = picks.map((p) => p.kn.item.id);
  const fantasy = new Set(["empire", "legends", "rings"]);
  assert.ok(fantasy.has(ids[0]), `top pick should be fantasy, got ${ids[0]}`);
  assert.ok(ids.indexOf("bride2") === -1 || ids.indexOf("bride2") > ids.indexOf(ids.find((i) => fantasy.has(i))), "romance ranks below fantasy");
  for (const id of ["wind", "hobbit", "bride", "dune", "it"]) assert.ok(!ids.includes(id), `${id} is already in the library`);
  const top = picks[0];
  assert.ok(top.why.because.length > 0, "the top pick names titles from the library");
  assert.ok(top.why.traits.length > 0, "and the traits behind it");
  const empire = picks.find((p) => p.kn.item.id === "empire");
  assert.ok(empire.why.because.some((b) => b.link), "a hand-written link from a loved title is quoted");
  const again = rankPicks(model, buildTaste(model, matchLibrary(model, FANTASY_FAN).rows), { exclude, limit: 5 }).map((p) => p.kn.item.id);
  assert.deepEqual(again, ids, "deterministic");
});

test("filters: books only, films only, nonfiction, hidden titles and custom adjustments", () => {
  const { rows } = matchLibrary(model, FANTASY_FAN);
  const profile = buildTaste(model, rows);
  assert.ok(rankPicks(model, profile, { kind: "f", limit: 10 }).every((p) => p.kn.k === "f"));
  assert.ok(rankPicks(model, profile, { kind: "b", fiction: false, limit: 10 }).every((p) => p.kn.item.nf));
  const hidden = new Set(["empire"]);
  assert.ok(!rankPicks(model, profile, { hidden, limit: 20 }).some((p) => p.kn.item.id === "empire"));
  const cozyFirst = rankPicks(model, profile, { limit: 3, adjust: (kn) => (kn.x.includes(T["m:cozy"]) ? 5 : 0), exclude: new Set() });
  assert.ok(cozyFirst[0].kn.x.includes(T["m:cozy"]));
  const classics = rankPicks(model, profile, { limit: 20, filter: (kn) => kn.y < 1970 });
  assert.ok(classics.length && classics.every((p) => p.kn.y < 1970));
});

test("want list is ordered by fit; stretch picks come from genres you haven't logged", () => {
  const { rows } = matchLibrary(model, FANTASY_FAN);
  const profile = buildTaste(model, rows);
  const want = rankWantList(model, profile, rows);
  assert.equal(want.length, 2);
  assert.ok(want.every((w) => w.entry.status === "want"));
  for (const s of stretchPicks(model, profile, { limit: 3 })) {
    const genres = s.kn.x.filter((t) => TAGS[t][0] === "g");
    assert.ok(genres.every((g) => profile.N[g] === 0), "a stretch pick's genres are new to you");
  }
});

test("profile summary names what you rate highly and what you rate low", () => {
  const profile = buildTaste(model, matchLibrary(model, FANTASY_FAN).rows);
  const s = summarize(model, profile);
  assert.equal(typeof s.name, "string");
  assert.ok(s.name.length > 3);
  assert.ok(s.loves.genres.some((r) => r.tag.key === "g:fantasy"));
  assert.ok(s.avoids.some((r) => ["g:romance", "th:love", "m:funny"].includes(r.tag.key)));
});

test("an empty library still ranks (popular, balanced picks) without errors", () => {
  const profile = buildTaste(model, []);
  assert.equal(rankPicks(model, profile, { limit: 5 }).length, 5);
});

test("similar titles share tags and skip the same creator; search finds by prefix", () => {
  const n = model.known.findIndex((k) => k.item?.id === "wind");
  const sims = similarTo(model, n, { limit: 4 });
  assert.ok(sims.length > 0);
  assert.ok(sims.every((s) => s.kn.c !== "Patrick Rothfuss"));
  assert.ok(sims[0].shared.length > 0);
  assert.equal(searchCatalog(model, "name of")[0].item.id, "wind");
  assert.equal(listPhrase(["a", "b", "c"]), "a, b and c");
});
