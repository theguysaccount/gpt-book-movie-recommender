// The catalog files and the verification results. Expectations come from the data itself, never from launch-day
// counts, so these keep passing as titles are added, verified or dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFiles } from "../tools/validate-slice.mjs";
import { loadRaw, mergeItems, RAW_DIR } from "../pipeline/catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "vocab.json"), "utf8"));

test("every catalog slice is valid on its own (tags from the vocabulary, counts, lengths, no repeats)", () => {
  for (const f of fs.readdirSync(RAW_DIR).filter((x) => x.endsWith(".jsonl"))) {
    const { errs, count } = validateFiles([path.join(RAW_DIR, f)]);
    assert.ok(count > 0, `${f} is empty`);
    assert.deepEqual(errs, [], `${f}:\n${errs.slice(0, 10).join("\n")}`);
  }
});

test("vocabulary: every facet has tags and no label repeats within a facet", () => {
  for (const facet of ["g", "th", "m", "s", "w", "p"]) {
    const entries = Object.entries(vocab[facet]).filter(([k]) => !k.startsWith("_"));
    assert.ok(entries.length > 0, facet);
    const labels = entries.map(([, v]) => v);
    assert.equal(new Set(labels).size, labels.length, `${facet} has a repeated label`);
  }
});

test("titles appearing in several slices merge into one, keeping links from each", () => {
  const raw = loadRaw();
  const merged = mergeItems(raw);
  assert.ok(merged.length <= raw.length);
  assert.equal(new Set(merged.map((m) => m.key)).size, merged.length);
  for (const m of merged) assert.ok(m.like.length >= 2 && m.like.length <= 6, m.t);
});

test("verification covers the catalog, and most of it verified", () => {
  const vf = path.join(ROOT, "data", "catalog", "verified.json");
  if (!fs.existsSync(vf)) return; // first run before verification: the build refuses to run anyway
  const { entries, generated } = JSON.parse(fs.readFileSync(vf, "utf8"));
  assert.match(generated, /^\d{4}-\d{2}-\d{2}$/);
  const merged = mergeItems(loadRaw());
  const covered = merged.filter((m) => entries[m.key]);
  const ok = merged.filter((m) => entries[m.key]?.s === "ok");
  // New titles added since the last monthly run are verified next month; a large gap means the run broke.
  assert.ok(covered.length >= merged.length * 0.8, `only ${covered.length} of ${merged.length} catalog titles were checked`);
  assert.ok(ok.length >= merged.length * 0.75, `only ${ok.length} of ${merged.length} catalog titles verified`);
  for (const [key, e] of Object.entries(entries)) {
    if (e.s !== "ok") continue;
    assert.ok(e.id, `${key} verified without a source id`);
    assert.ok(e.src === "ol" ? /^OL\d+W$/.test(e.id) : /^Q\d+$/.test(e.id), `${key}: bad id ${e.id}`);
  }
});
