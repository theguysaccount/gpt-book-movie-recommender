// Shared helpers for the data pipeline: polite HTTP with retries, JSON files, and tiny logging.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_URL = "https://github.com/theguysaccount/gpt-book-movie-recommender";
// Identifies the project and where to reach it. No personal address, by design.
export const UA = `shelf-and-screen/1.0 (+${REPO_URL})`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET or POST with retries on network errors, 429 and 5xx. Honors Retry-After. Throws after the last attempt. */
export async function fetchRetry(url, { method = "GET", body, headers = {}, tries = 5, timeout = 70000, accept = "application/json" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(Math.min(60000, 2500 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { method, body, headers: { "User-Agent": UA, Accept: accept, ...headers }, signal: AbortSignal.timeout(timeout) });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        lastErr = new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
        if (ra > 0) await sleep(Math.min(120, ra) * 1000);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText} from ${url.slice(0, 140)}`), { fatal: true });
      return res;
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error(`failed: ${url}`);
}

export async function fetchJson(url, opts) { return (await fetchRetry(url, opts)).json(); }

/** Run a SPARQL query against the Wikidata Query Service and return rows as plain objects of strings. */
export async function sparql(query) {
  const res = await fetchRetry("https://query.wikidata.org/sparql", {
    method: "POST", body: new URLSearchParams({ query }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, accept: "application/sparql-results+json", timeout: 90000,
  });
  const json = await res.json();
  return json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

export const readJson = (rel, fallback) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

/** Write JSON only when the content changed, so reruns leave no diff. Returns true if the file changed. */
export function writeJson(rel, value, { pretty = false } = {}) {
  const p = path.join(ROOT, rel);
  const text = (pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value)) + "\n";
  if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return true;
}

export function readJsonl(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export const today = () => (process.env.SS_TODAY || new Date().toISOString().slice(0, 10));

/** GitHub Actions annotations when running there, plain lines elsewhere. */
export const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
export const note = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::notice::${msg}` : msg);
export function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}
