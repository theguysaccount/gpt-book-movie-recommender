// Read the hand-written catalog slices (data/catalog/raw/*.jsonl), merge titles that appear in more than one
// slice, and list the "if you liked this" targets. Pure functions over the files; no network.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { norm, surname, sameCreator } from "../src/engine/normalize.js";

export const RAW_DIR = path.join(ROOT, "data", "catalog", "raw");
const MAX_LINKS = 6;

/** Identity of a work: kind + normalized title + first creator's surname. */
export const workKey = (k, t, c) => `${k}|${norm(t)}|${surname(String(c || "").split(/\s+&\s+|;/)[0])}`;

/** Every raw entry, in file-name order, with its source file and line for error messages. */
export function loadRaw(dir = RAW_DIR) {
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    fs.readFileSync(path.join(dir, file), "utf8").split("\n").forEach((line, i) => {
      if (line.trim()) out.push({ ...JSON.parse(line), _src: `${file}:${i + 1}` });
    });
  }
  return out;
}

/**
 * Merge duplicates. The first occurrence (by file name, then line) keeps its tags and hook; "like" lists are
 * combined without repeats, up to MAX_LINKS. Returns items in a stable order with a `key`.
 */
export function mergeItems(raw) {
  const byKey = new Map();
  for (const it of raw) {
    const key = workKey(it.k, it.t, it.c);
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { ...it, key, like: [...it.like], _also: [] }); continue; }
    cur._also.push(it._src);
    for (const l of it.like) {
      if (cur.like.length >= MAX_LINKS) break;
      if (!cur.like.some((x) => x.k === l.k && norm(x.t) === norm(l.t))) cur.like.push(l);
    }
  }
  return [...byKey.values()];
}

/** Find the catalog item a like entry refers to: same kind and title, and the same creator or a year within 1. */
export function resolveLike(items, index, l) {
  const cands = index.get(`${l.k}|${norm(l.t)}`) || [];
  return cands.find((it) => sameCreator(it.c, l.c)) || cands.find((it) => Math.abs(it.y - l.y) <= 1) || null;
}

export function titleIndex(items) {
  const index = new Map();
  for (const it of items) {
    const k = `${it.k}|${norm(it.t)}`;
    (index.get(k) || index.set(k, []).get(k)).push(it);
  }
  return index;
}

/** Every like target that is not itself a catalog item, de-duplicated, with the items that point to it. */
export function outsideTargets(items) {
  const index = titleIndex(items);
  const out = new Map();
  for (const it of items) {
    for (const l of it.like) {
      if (resolveLike(items, index, l)) continue;
      const key = workKey(l.k, l.t, l.c);
      const cur = out.get(key);
      if (cur) cur.from.push(it.key); else out.set(key, { k: l.k, t: l.t, c: l.c, y: l.y, key, from: [it.key] });
    }
  }
  return [...out.values()];
}
