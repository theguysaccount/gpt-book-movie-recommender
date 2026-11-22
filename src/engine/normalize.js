// Text normalization shared by the browser, the build and the data pipeline.
// Everything here is pure and deterministic.

const ARTICLES = /^(the|a|an) /;

/** Lowercase, strip accents and punctuation, "&" → "and", drop a leading article. */
export function norm(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(ARTICLES, "");
}

/** URL slug: "The Name of the Wind" → "the-name-of-the-wind". */
export function slugify(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70).replace(/-+$/g, "");
}

/**
 * The different ways one title gets written, most specific first.
 * "The Name of the Wind (The Kingkiller Chronicle, #1)" → the full string, then without the series note,
 * then without a subtitle. Used on both sides of a match.
 */
export function titleKeys(title) {
  const out = [];
  const add = (s) => { const k = norm(s); if (k && !out.includes(k)) out.push(k); };
  const raw = String(title ?? "").trim();
  add(raw);
  const noParen = raw.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/g, "").trim();
  add(noParen);
  for (const sep of [": ", " - ", " – ", " — ", "; "]) {
    const i = noParen.indexOf(sep);
    if (i > 2) add(noParen.slice(0, i));
  }
  // "Star Wars: Episode IV – A New Hope" is also logged as "Star Wars"; "Seven" as "Se7en".
  add(noParen.replace(/\bepisode [ivx]+\b.*$/i, ""));
  return out;
}

/** People's names: "J.R.R. Tolkien", "Tolkien, J. R. R.", "Gabriel García Márquez" → comparable surname keys. */
export function surname(name) {
  let n = String(name ?? "").trim();
  if (!n) return "";
  if (n.includes(",")) n = n.split(",")[0];            // "Tolkien, J.R.R."
  n = n.replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "");
  const parts = norm(n).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** All surnames in a credit such as "Terry Pratchett & Neil Gaiman" or "Joel Coen, Ethan Coen". */
export function surnames(credit) {
  const s = String(credit ?? "");
  const people = s.includes(" & ") || s.includes(" and ") || s.includes(";")
    ? s.split(/\s+&\s+|\s+and\s+|;/)
    : (s.match(/,/g) || []).length >= 2 || /,\s*\S+\s+\S+/.test(s) ? s.split(",") : [s];
  return [...new Set(people.map(surname).filter(Boolean))];
}

/** True when two credits share a surname ("Le Guin, Ursula K." vs "Ursula K. Le Guin"). */
export function sameCreator(a, b) {
  const A = new Set(surnames(a));
  if (!A.size) return false;
  const nb = " " + norm(b) + " ";
  for (const s of surnames(b)) if (A.has(s)) return true;
  for (const s of A) if (s.length > 3 && nb.includes(" " + s + " ")) return true;
  return false;
}

/** Stable 32-bit hash (FNV-1a) for seeds and cache keys. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
