// Build the real site into temporary folders (project path and a root custom domain) and check the output.
// Everything is compared with the data the build itself used, so the checks hold as the catalog changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hasVerified = fs.existsSync(path.join(ROOT, "data", "catalog", "verified.json"));

function buildInto(siteUrl) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ss-build-"));
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs")], { env: { ...process.env, SS_OUT: out, SITE_URL: siteUrl }, stdio: "pipe" });
  return out;
}
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

test("project-path build: every page is complete and every internal link resolves", { skip: !hasVerified && "run pipeline/verify.mjs first" }, () => {
  const site = "https://theguysaccount.github.io/gpt-book-movie-recommender";
  const out = buildInto(site);
  try {
    const info = JSON.parse(fs.readFileSync(path.join(out, "build-info.json"), "utf8"));
    const catalog = JSON.parse(fs.readFileSync(path.join(out, "data", "catalog.json"), "utf8"));
    const recog = JSON.parse(fs.readFileSync(path.join(out, "data", "recog.json"), "utf8"));
    assert.equal(info.titles, catalog.items.length);
    const T = catalog.tags.length;
    for (const [i, it] of catalog.items.entries()) {
      assert.ok(it.x.length >= 5 && it.x.every((t) => t >= 0 && t < T), `${it.t}: tags`);
      assert.ok(it.l.every(([j, r]) => j >= 0 && j < catalog.items.length && j !== i && typeof r === "string"), `${it.t}: links`);
      assert.ok(it.k === "b" ? /^OL\d+W$/.test(it.ol) : /^Q\d+$/.test(it.wd), `${it.t}: verified id`);
    }
    for (const row of [...recog.books, ...recog.films]) assert.ok(row[3].every((t) => t >= 0 && t < T), `recognition tags for ${row[0]}`);
    const htmlFiles = walk(out).filter((f) => f.endsWith(".html"));
    const sitemap = fs.readFileSync(path.join(out, "sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locs.length, catalog.items.length + 7, "sitemap: every title page plus home, two browse pages, how-it-works and three guides");
    assert.ok(locs.every((u) => u.startsWith(site + "/")));
    const robots = fs.readFileSync(path.join(out, "robots.txt"), "utf8");
    assert.match(robots, new RegExp(`Sitemap: ${site}/sitemap.xml`));
    const key = fs.readFileSync(path.join(ROOT, "src", "indexnow-key.txt"), "utf8").trim();
    assert.equal(fs.readFileSync(path.join(out, `${key}.txt`), "utf8").trim(), key);
    const basePath = "/gpt-book-movie-recommender/";
    const missing = new Set();
    for (const f of htmlFiles) {
      const html = fs.readFileSync(f, "utf8");
      const rel = path.relative(out, f);
      if (rel !== "404.html") {
        assert.match(html, /<link rel="canonical" href="https:\/\/theguysaccount\.github\.io\/gpt-book-movie-recommender\//, `${rel}: canonical`);
        assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\.png">/, `${rel}: og:image`);
      }
      assert.match(html, /<title>[^<]{10,}<\/title>/, `${rel}: title`);
      assert.match(html, /<meta name="description" content="[^"]{40,}">/, `${rel}: description`);
      assert.match(html, /Content-Security-Policy" content="default-src 'self'; script-src 'self';[^"]*connect-src 'self';/, `${rel}: CSP blocks other origins`);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)) JSON.parse(m[1]);
      for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
        const p = m[1];
        if (!p.startsWith(basePath)) { missing.add(`${rel}: ${p} is outside the site path`); continue; }
        let file = path.join(out, p.slice(basePath.length));
        if (p.endsWith("/")) file = path.join(file, "index.html");
        if (!fs.existsSync(file)) missing.add(`${rel}: ${p}`);
      }
    }
    assert.deepEqual([...missing].slice(0, 20), [], "internal links resolve");
    assert.ok(!fs.readFileSync(path.join(out, "index.html"), "utf8").includes("<script>"), "no inline scripts (the CSP would block them)");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("custom-domain build moves every URL to the root with one setting", { skip: !hasVerified && "run pipeline/verify.mjs first" }, () => {
  const out = buildInto("https://books.example.org");
  try {
    const home = fs.readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(home, /<link rel="canonical" href="https:\/\/books\.example\.org\/">/);
    assert.match(home, /data-base="\/"/);
    assert.ok(!home.includes("/gpt-book-movie-recommender/"));
    assert.match(fs.readFileSync(path.join(out, "robots.txt"), "utf8"), /Sitemap: https:\/\/books\.example\.org\/sitemap\.xml/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
