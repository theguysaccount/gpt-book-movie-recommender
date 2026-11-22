#!/usr/bin/env node
// Validate one or more catalog files (JSON Lines, one title per line) against data/vocab.json.
//   node tools/validate-slice.mjs data/catalog/books.jsonl [more.jsonl ...]
// Exits 1 and lists every problem if anything is wrong. Used by tests, by the build and by anyone adding titles.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "vocab.json"), "utf8"));
const LIMITS = { g: [1, 3], th: [2, 5], m: [2, 4], s: [1, 4], w: [0, 3] };

export const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|a|an) /, "");

export function validateItem(it, where = "") {
  const errs = [];
  const bad = (msg) => errs.push(`${where}${msg}`);
  if (!it || typeof it !== "object") return [`${where}not an object`];
  if (!["b", "f"].includes(it.k)) bad(`k must be "b" or "f"`);
  for (const f of ["t", "c", "h"]) if (typeof it[f] !== "string" || !it[f].trim()) bad(`${f} is missing`);
  if (!Number.isInteger(it.y) || it.y < -800 || it.y > 2026) bad(`y (year) is not a sensible integer: ${it.y}`);
  for (const [facet, [lo, hi]] of Object.entries(LIMITS)) {
    const v = it[facet];
    if (!Array.isArray(v)) { bad(`${facet} must be an array`); continue; }
    if (v.length < lo || v.length > hi) bad(`${facet} needs ${lo} to ${hi} tags, has ${v.length}`);
    if (new Set(v).size !== v.length) bad(`${facet} repeats a tag`);
    for (const tag of v) if (tag.startsWith("_") || !(tag in vocab[facet])) bad(`${facet} tag "${tag}" is not in data/vocab.json`);
  }
  if (!(it.p in vocab.p) || it.p.startsWith("_")) bad(`p must be slow, medium or fast`);
  if (typeof it.h === "string") {
    if (it.h.length < 50 || it.h.length > 180) bad(`h (hook) should be 50 to 180 characters, is ${it.h.length}`);
    if (/\b(award|oscar|pulitzer|booker|nobel|bestsell|best-sell|million copies|box office)/i.test(it.h)) bad(`h must describe the experience, not awards or sales`);
  }
  if (!Array.isArray(it.like) || it.like.length < 2 || it.like.length > 4) bad(`like needs 2 to 4 entries`);
  else it.like.forEach((l, i) => {
    if (!["b", "f"].includes(l.k)) bad(`like[${i}].k must be "b" or "f"`);
    for (const f of ["t", "c", "r"]) if (typeof l[f] !== "string" || !l[f].trim()) bad(`like[${i}].${f} is missing`);
    if (!Number.isInteger(l.y)) bad(`like[${i}].y (year) is missing`);
    if (typeof l.r === "string" && (l.r.length < 40 || l.r.length > 220)) bad(`like[${i}].r (reason) should be 40 to 220 characters, is ${l.r.length}`);
    if (l.k === it.k && norm(l.t) === norm(it.t) && norm(l.c) === norm(it.c)) bad(`like[${i}] points at the title itself`);
  });
  const extra = Object.keys(it).filter((k) => !["k", "t", "c", "y", "g", "th", "m", "s", "w", "p", "h", "like"].includes(k));
  if (extra.length) bad(`unknown fields: ${extra.join(", ")}`);
  return errs;
}

export function readJsonl(file) {
  const out = [];
  const errs = [];
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try { out.push({ line: i + 1, item: JSON.parse(line) }); } catch (e) { errs.push(`${path.basename(file)}:${i + 1}: not valid JSON (${e.message})`); }
  });
  return { rows: out, errs };
}

export function validateFiles(files) {
  const errs = [];
  const seen = new Map();
  let count = 0;
  for (const file of files) {
    const { rows, errs: e } = readJsonl(file);
    errs.push(...e);
    for (const { line, item } of rows) {
      count++;
      const where = `${path.basename(file)}:${line} (${item?.t || "?"}): `;
      errs.push(...validateItem(item, where));
      const key = `${item.k}|${norm(item.t)}|${norm(item.c)}`;
      if (seen.has(key)) errs.push(`${where}duplicate of ${seen.get(key)}`);
      else seen.set(key, `${path.basename(file)}:${line}`);
    }
  }
  return { errs, count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("usage: validate-slice.mjs <file.jsonl> [...]"); process.exit(2); }
  const { errs, count } = validateFiles(files);
  if (errs.length) {
    console.error(errs.slice(0, 200).join("\n"));
    console.error(`\n${errs.length} problem(s) in ${count} titles`);
    process.exit(1);
  }
  console.log(`OK: ${count} titles, every tag in the vocabulary`);
}
