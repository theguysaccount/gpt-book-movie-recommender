import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, toCsv } from "../src/engine/csv.js";
import { parseExport, detectFormat, mergeEntries, entryKey } from "../src/engine/importers.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");

test("CSV: BOM, CRLF, quoted commas, doubled quotes and line breaks inside quotes", () => {
  const { headers, rows } = parseCsv('﻿Title,Note\r\n"A, B","He said ""hi"""\r\n"Multi\nline",x\r\n');
  assert.deepEqual(headers, ["Title", "Note"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Title, "A, B");
  assert.equal(rows[0].Note, 'He said "hi"');
  assert.equal(rows[1].Title, "Multi\nline");
  const back = parseCsv(toCsv([["t", "n"], ["A, B", 'q"q']])).rows[0];
  assert.deepEqual(back, { t: "A, B", n: 'q"q' });
});

test("Goodreads export: shelves become statuses, 0 stars means unrated, favorites count as liked", () => {
  const { format, entries } = parseExport(read("goodreads_library_export.csv"), "goodreads_library_export.csv");
  assert.equal(format, "goodreads");
  const by = Object.fromEntries(entries.map((e) => [e.title.split(" (")[0], e]));
  assert.equal(by["The Name of the Wind"].rating, 5);
  assert.equal(by["The Name of the Wind"].liked, true);
  assert.equal(by["The Name of the Wind"].status, "done");
  assert.equal(by["The Name of the Wind"].year, 2007);
  assert.equal(by["The Great Gatsby"].year, 1925, "original publication year wins over the edition year");
  assert.equal(by["The Kite Runner"].status, "want");
  assert.equal(by["The Kite Runner"].rating, null);
  assert.equal(by["The Shining"].status, "doing");
  assert.equal(by["A Book Nobody Has Heard Of"].status, "dropped");
  assert.ok(entries.every((e) => e.kind === "b"));
});

test("Letterboxd ratings: names with commas, half stars, years", () => {
  const { format, entries } = parseExport(read("letterboxd-ratings.csv"), "ratings.csv");
  assert.equal(format, "letterboxd-ratings");
  const ct = entries.find((e) => e.title.startsWith("Crouching"));
  assert.equal(ct.title, "Crouching Tiger, Hidden Dragon");
  assert.equal(ct.year, 2000);
  assert.equal(entries.find((e) => e.title === "Blade Runner").rating, 4.5);
  assert.ok(entries.every((e) => e.kind === "f" && e.status === "done"));
});

test("Letterboxd watchlist, watched and likes files are told apart by name", () => {
  const head = "Date,Name,Year,Letterboxd URI\n2024-01-01,Heat,1995,https://boxd.it/x\n";
  assert.equal(parseExport(head, "watchlist.csv").entries[0].status, "want");
  assert.equal(parseExport(head, "watched.csv").entries[0].status, "done");
  assert.equal(parseExport(head, "likes/films.csv").entries[0].liked, true);
  assert.equal(detectFormat(["Date", "Name", "Year", "Letterboxd URI", "Rating", "Rewatch", "Tags", "Watched Date"]), "letterboxd-diary");
});

test("StoryGraph export", () => {
  const csv = "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Star Rating,Review,Tags,Owned?\n" +
    "Piranesi,Susanna Clarke,,123,digital,read,2024/01/01,2024/02/01,,1,,slow,4.75,,favorites,No\n" +
    "Circe,\"Madeline Miller, Someone Else\",,456,print,to-read,2024/01/02,,,0,,,,,,No\n";
  const { format, entries } = parseExport(csv, "storygraph.csv");
  assert.equal(format, "storygraph");
  assert.equal(entries[0].rating, 5, "4.75 rounds to the nearest half star");
  assert.equal(entries[0].liked, true);
  assert.equal(entries[1].creator, "Madeline Miller");
  assert.equal(entries[1].status, "want");
});

test("IMDb export: ratings out of 10 halve, TV series are skipped", () => {
  const csv = "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\n" +
    "tt2543164,9,2024-01-01,Arrival,Arrival,https://www.imdb.com/title/tt2543164/,Movie,7.9,116,2016,Drama,1,2016-11-11,Denis Villeneuve\n" +
    "tt0903747,10,2024-01-02,Breaking Bad,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,49,2008,Crime,1,2008-01-20,\n";
  const { format, entries } = parseExport(csv, "ratings.csv");
  assert.equal(format, "imdb");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rating, 4.5);
  assert.equal(entries[0].imdb, "tt2543164");
  assert.equal(entries[0].creator, "Denis Villeneuve");
});

test("Any CSV with a title column works; a director column means films; 10-point ratings are scaled", () => {
  const { format, entries } = parseExport("title,director,year,rating\nHeat,Michael Mann,1995,8\nAlien,Ridley Scott,1979,10\n", "list.csv");
  assert.equal(format, "generic");
  assert.equal(entries[0].kind, "f");
  assert.equal(entries[1].rating, 5);
});

test("A file we can't read explains itself", () => {
  assert.throws(() => parseExport("foo,bar\n1,2\n", "weird.csv"), /isn't an export we recognize/);
});

test("Merging: ratings, likes and further-along statuses win; nothing duplicates", () => {
  const a = [{ kind: "b", title: "Dune", creator: "Frank Herbert", year: 1965, rating: null, status: "want", liked: false, shelves: [] }];
  const b = [{ kind: "b", title: "Dune", creator: "Herbert, Frank", year: null, rating: 4, status: "done", liked: false, shelves: ["sci-fi"] }];
  const m = mergeEntries(a, b);
  assert.equal(m.length, 1);
  assert.equal(m[0].rating, 4);
  assert.equal(m[0].status, "done");
  assert.deepEqual(m[0].shelves, ["sci-fi"]);
  assert.equal(entryKey(a[0]), entryKey(b[0]));
  const f1 = { kind: "f", title: "Dune", creator: "", year: 1984, rating: 2, status: "done", shelves: [] };
  const f2 = { kind: "f", title: "Dune", creator: "", year: 2021, rating: 5, status: "done", shelves: [] };
  assert.equal(mergeEntries([f1, f2]).length, 2, "films with the same title and different years stay separate");
});
