import { test } from "node:test";
import assert from "node:assert/strict";
import { listZip, readZipCsvs } from "../src/engine/zip.js";
import { parseExport } from "../src/engine/importers.js";
import { makeZip, LETTERBOXD_ZIP } from "../scripts/lib/zipmaker.mjs";

test("ZIP: lists entries and reads stored and deflated CSVs, skipping system files", async () => {
  const zip = makeZip(LETTERBOXD_ZIP);
  assert.equal(listZip(zip).length, 5);
  const csvs = await readZipCsvs(zip);
  assert.deepEqual(csvs.map((c) => c.name), ["ratings.csv", "watchlist.csv", "likes/films.csv", "profile.csv"]);
  const parsed = csvs.map((c) => { try { return parseExport(c.text, c.name); } catch { return null; } }).filter(Boolean);
  assert.deepEqual(parsed.map((p) => p.format), ["letterboxd-ratings", "letterboxd-watchlist", "letterboxd-likes"]);
});

test("ZIP: a file that isn't a ZIP gives a readable error", () => {
  assert.throws(() => listZip(new Uint8Array([1, 2, 3, 4, 5])), /doesn't look like a \.zip/);
});
