// Check the live site: pages in the sitemap answer 200, and every internal link, script, stylesheet, image and
// data file they use exists. Exits 1 with a list of what is broken.
//   node scripts/linkcheck.mjs https://owner.github.io/gpt-book-movie-recommender [--sample N]
const base = (process.argv[2] || process.env.SITE_URL || "").replace(/\/$/, "");
if (!base) throw new Error("usage: linkcheck.mjs <base url> [--sample N]");
const si = process.argv.indexOf("--sample");
const sampleN = si > 0 ? Number(process.argv[si + 1]) : 0;
const origin = new URL(base).origin;
const problems = [];
const seen = new Map();
const UA = "shelf-and-screen-linkcheck (+https://github.com/theguysaccount/gpt-book-movie-recommender)";

async function get(url, wantText = false) {
  if (seen.has(url) && !wantText) return seen.get(url);
  let res, text = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000), headers: { "user-agent": UA } });
      if (wantText) text = await res.text(); else await res.arrayBuffer();
      if (res.status < 500) break;
    } catch (e) { res = { status: 0, statusText: e.message }; }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  const out = { status: res.status, type: res.headers?.get?.("content-type") || "", text };
  seen.set(url, out);
  return out;
}

const sm = await get(base + "/sitemap.xml", true);
if (sm.status !== 200) { console.error("sitemap missing:", sm.status); process.exit(1); }
let pages = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (sampleN && pages.length > sampleN) {
  // A rotating sample: fixed pages plus a slice that moves with the day of the year, so every page gets checked over time.
  const fixed = pages.filter((p) => !/-like\//.test(p));
  const like = pages.filter((p) => /-like\//.test(p));
  const day = Math.floor(Date.now() / 86400000);
  const start = (day * sampleN) % like.length;
  pages = [...fixed, ...like.slice(start, start + sampleN), ...like.slice(0, Math.max(0, start + sampleN - like.length))];
}
const refs = new Set([base + "/robots.txt", base + "/favicon.svg", base + "/apple-touch-icon.png", base + "/data/catalog.json", base + "/data/recog.json"]);
for (const p of pages) {
  const r = await get(p, true);
  if (r.status !== 200 || !/text\/html/.test(r.type)) { problems.push(`${r.status} ${p}`); continue; }
  for (const m of r.text.matchAll(/(?:href|src|content)="([^"#]+)"/g)) {
    let u = m[1].replace(/&amp;/g, "&");
    if (u.startsWith("/")) u = origin + u;
    if (!u.startsWith(base + "/") || u.includes("?from=")) continue;
    refs.add(u.split("?")[0]);
  }
}
const list = [...refs];
for (let i = 0; i < list.length; i += 8) {
  await Promise.all(list.slice(i, i + 8).map(async (u) => { const r = await get(u); if (r.status !== 200) problems.push(`${r.status} ${u}`); }));
}
const robots = await get(base + "/robots.txt", true);
if (!/Sitemap: \S+/.test(robots.text)) problems.push("robots.txt has no Sitemap line");
console.log(`checked ${pages.length} pages and ${list.length} linked files`);
if (problems.length) { console.error("broken:\n" + problems.map((p) => " - " + p).join("\n")); process.exit(1); }
console.log("all good");
