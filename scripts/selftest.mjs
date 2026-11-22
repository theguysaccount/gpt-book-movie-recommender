// End-to-end self-test in headless Chrome, against the local build or the live site:
//   node scripts/selftest.mjs                 builds nothing; serves dist/ the way Pages does
//   node scripts/selftest.mjs https://…/      tests the live site
// It imports a Goodreads CSV and a Letterboxd ZIP through the real file input, checks that picks appear with
// reasons, exercises the tracker, sharing and filters on desktop and phone, and records every network request:
// the run fails if the page contacts any other origin or sends anything (no POST, no request bodies).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/chrome.mjs";
import { createServer } from "./serve.mjs";
import { makeZip } from "./lib/zipmaker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "selftest-out");
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); else console.log("  ok  " + msg); };

let base = process.argv[2], server;
if (!base) {
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, process.env.SS_OUT || "dist", "build-info.json"), "utf8"));
  const bp = new URL(info.siteUrl + "/").pathname;
  server = createServer(bp);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}${bp}`;
}
base = base.replace(/\/?$/, "/");
const origin = new URL(base).origin;
console.log("self-test against " + base);

// Fixtures: a real-format Goodreads export and a Letterboxd ZIP with titles most libraries share.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-fixtures-"));
const goodreads = path.join(ROOT, "tests", "fixtures", "goodreads_library_export.csv");
const zipPath = path.join(tmp, "letterboxd-someone-2026-11-22-utc.zip");
const films = [["The Godfather", 1972, 5], ["Pulp Fiction", 1994, 4.5], ["Spirited Away", 2001, 5], ["The Dark Knight", 2008, 4], ["Arrival", 2016, 4.5],
  ["Mamma Mia!", 2008, 1.5], ["Inception", 2010, 4], ["Parasite", 2019, 5], ["Titanic", 1997, 2.5], ["Alien", 1979, 4.5], ["Fargo", 1996, 4], ["Amélie", 2001, 3.5]];
fs.writeFileSync(zipPath, makeZip([
  { name: "ratings.csv", text: "Date,Name,Year,Letterboxd URI,Rating\n" + films.map(([n, y, r], i) => `2025-0${(i % 9) + 1}-1${i % 9},"${n}",${y},https://boxd.it/x${i},${r}`).join("\n") + "\n" },
  { name: "watchlist.csv", text: "Date,Name,Year,Letterboxd URI\n2025-02-01,Heat,1995,https://boxd.it/w1\n2025-02-02,Seven Samurai,1954,https://boxd.it/w2\n", store: true },
  { name: "profile.csv", text: "Date Joined,Username\n2020-01-01,someone\n" },
]));

const chrome = await launch();
const sameOrigin = (u) => u.startsWith(origin + "/") || u.startsWith("data:") || u.startsWith("blob:") || u === "about:blank";
function privacy(page, label) {
  const foreign = page.requests.filter((r) => !sameOrigin(r.url));
  const sending = page.requests.filter((r) => r.method !== "GET" || r.hasBody);
  check(!foreign.length, `${label}: no request to any other site${foreign.length ? " (saw " + foreign.slice(0, 3).map((r) => r.url).join(", ") + ")" : ""}`);
  check(!sending.length, `${label}: nothing sent (only GETs, no bodies)${sending.length ? " (saw " + sending.slice(0, 3).map((r) => r.method + " " + r.url).join(", ") + ")" : ""}`);
}
const noErrors = (page, label) => { check(!page.errors.length, `${label}: no console errors${page.errors.length ? ": " + page.errors.slice(0, 3).join(" | ") : ""}`); page.errors.length = 0; };
const click = (page, sel) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("missing ${sel.replace(/"/g, "")}"); el.click(); return true; })()`);
const clickText = (page, sel, re) => page.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${re}.test(e.textContent)); if (!el) throw new Error("no ${sel} matching ${String(re).replace(/"/g, "")}"); el.click(); return true; })()`);
const overflow = (page) => page.eval("document.documentElement.scrollWidth - window.innerWidth");

try {
  // ---------- desktop: import, picks, tracker, share ----------
  const page = await chrome.newPage({ width: 1280, height: 900 });
  await page.goto(base, 500);
  check(await page.eval(`!!document.querySelector("#file") && /own ratings/.test(document.querySelector("h1").textContent)`), "home page shows the promise and the file input");
  await page.setFiles("#file", [goodreads, zipPath]);
  await page.waitFor(`document.querySelectorAll("#picks .pick").length >= 10`, 30000);
  const status = await page.eval(`document.querySelector("#status").textContent`);
  check(/Read .*Goodreads.*Letterboxd|Read .*Letterboxd.*Goodreads/.test(status) && /We recognized \d+/.test(status), `import status names both sources: "${status.slice(0, 140)}"`);
  const cards = await page.eval(`[...document.querySelectorAll("#picks .pick")].map((c) => ({ title: c.querySelector("h3 a")?.textContent, kind: c.querySelector(".kind")?.textContent, href: c.querySelector("h3 a")?.getAttribute("href"), why: c.querySelector(".why")?.textContent || "" }))`);
  check(cards.length >= 10, `${cards.length} picks shown`);
  check(cards.every((c) => c.why.length > 20), "every pick carries a reason");
  check(cards.filter((c) => /Because (you rated|of)/.test(c.why)).length >= cards.length / 2, "most picks name titles from the imported library");
  check(cards.every((c) => /-like\//.test(c.href || "")), "every pick links to its own page");
  const libBooks = ["The Name of the Wind", "The Final Empire", "The Great Gatsby", "The Kite Runner", "The Shining"];
  const libFilms = films.map(([n]) => n).concat(["Heat", "Seven Samurai"]);
  check(!cards.some((c) => (c.kind === "Book" && libBooks.includes(c.title)) || (c.kind === "Film" && libFilms.includes(c.title))), "nothing already in the library is picked (a book of a film you rated is fair game)");
  await page.screenshot(path.join(OUT, "desktop-picks.png"));
  // + Want, Read it (rate), Not for me
  const first = cards[0].title;
  await click(page, `#picks .pick [data-act="want"]`);
  await page.waitFor(`![...document.querySelectorAll("#picks .pick h3")].some((h) => h.textContent === ${JSON.stringify(first)})`);
  check(await page.eval(`/Want list \\(\\d+\\)/.test(document.querySelector('[data-tab="want"]').textContent)`), "“+ Want” moves a pick to the want list");
  const second = await page.eval(`document.querySelector("#picks .pick h3").textContent`);
  await click(page, `#picks .pick [data-act="seen"]`);
  await click(page, `#picks .pick .rate-inline .star:nth-child(4)`);
  await page.waitFor(`/Saved/.test(document.querySelector("#status").textContent)`);
  check(!(await page.eval(`[...document.querySelectorAll("#picks .pick h3")].some((h) => h.textContent === ${JSON.stringify(second)})`)), "rating a pick saves it and re-ranks");
  const third = await page.eval(`document.querySelector("#picks .pick h3").textContent`);
  await click(page, `#picks .pick [data-act="hide"]`);
  check(!(await page.eval(`[...document.querySelectorAll("#picks .pick h3")].some((h) => h.textContent === ${JSON.stringify(third)})`)), "“Not for me” removes a pick");
  // Filters
  await clickText(page, ".seg button", /^Films$/);
  check(await page.eval(`[...document.querySelectorAll("#picks .pick .kind")].every((k) => k.textContent === "Film") && document.querySelectorAll("#picks .pick").length >= 5`), "Films filter shows only films");
  await clickText(page, ".seg button", /^Books$/);
  check(await page.eval(`[...document.querySelectorAll("#picks .pick .kind")].every((k) => k.textContent === "Book")`), "Books filter shows only books");
  await clickText(page, ".seg button", /^Both$/);
  await clickText(page, ".chip-btn", /lighter/);
  check(await page.eval(`document.querySelectorAll("#picks .pick").length >= 5`), "a mood refines the picks");
  await clickText(page, ".chip-btn", /lighter/);
  // Want list ranked
  await click(page, `[data-tab="want"]`);
  check(await page.eval(`document.querySelectorAll("#panel-want .row").length >= 3`), "want list shows imported and added titles");
  await page.screenshot(path.join(OUT, "desktop-want.png"));
  // Persistence
  await page.goto(base, 400);
  await page.waitFor(`document.querySelectorAll("#picks .pick").length >= 10`, 30000);
  check(true, "library survives a reload (stored only in this browser)");
  // Library tab
  await click(page, `[data-tab="library"]`);
  check(await page.eval(`document.querySelectorAll("#panel-library .row").length >= 15`), "library lists the imported titles");
  // Profile and share
  await click(page, `[data-tab="profile"]`);
  const name = await page.eval(`document.querySelector(".archetype")?.textContent || ""`);
  check(name.length > 3, `taste profile has a name: "${name}"`);
  await page.screenshot(path.join(OUT, "desktop-profile.png"));
  await page.eval(`window.__copied = ""; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }`);
  await clickText(page, ".share button", /Copy link/);
  const shareUrl = await page.eval(`window.__copied`);
  check(/\/p\/#[A-Za-z0-9_-]{20,}$/.test(shareUrl), "share link carries the profile in the #fragment only");
  privacy(page, "import, ranking, tracker and profile");
  noErrors(page, "app");
  // Shared profile page
  const shared = await chrome.newPage({ width: 1280, height: 900 });
  await shared.goto(shareUrl.replace(/^https?:\/\/[^/]+/, origin), 300);
  await shared.waitFor(`document.querySelector(".archetype")`);
  check((await shared.eval(`document.querySelector(".archetype").textContent`)) === name, "shared profile page shows the same taste name");
  privacy(shared, "shared profile page");
  noErrors(shared, "shared profile page");
  await shared.close();
  // Clear everything, then sample library
  await click(page, `[data-tab="library"]`);
  await page.eval(`window.confirm = () => true`);
  await clickText(page, ".lib-actions button", /Clear everything/);
  check(await page.eval(`(() => { try { return !localStorage.getItem("shelfscreen:v1"); } catch { return false; } })()`), "“Clear everything” deletes the stored library");
  await click(page, "#sample-start");
  await page.waitFor(`document.querySelectorAll("#picks .pick").length >= 10`, 20000);
  check(true, "sample library gives picks with no export");
  noErrors(page, "sample library");
  await page.close();

  // ---------- like pages, browse pages, guides ----------
  const sitemap = await (await fetch(base + "sitemap.xml")).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+(\/[^?]*)?/, (all, p) => origin + (p || "/")));
  check(urls.length > 20, `sitemap lists ${urls.length} pages`);
  const books = urls.filter((u) => u.includes("/books-like/")), movies = urls.filter((u) => u.includes("/movies-like/"));
  const sample = [books[0], books[Math.floor(books.length / 2)], books[books.length - 1], movies[0], movies[Math.floor(movies.length / 2)], movies[movies.length - 1]].filter(Boolean);
  const lp = await chrome.newPage({ width: 1280, height: 900 });
  for (const u of sample) {
    await lp.goto(u, 150);
    const info = await lp.eval(`({ h1: document.querySelector("h1")?.textContent || "", picks: document.querySelectorAll(".pick-list li").length,
      canonical: document.querySelector('link[rel=canonical]')?.href || "", ld: [...document.querySelectorAll('script[type="application/ld+json"]')].every((s) => { try { JSON.parse(s.textContent); return true; } catch { return false; } }) })`);
    check(/^(Books|Movies) like /.test(info.h1) && info.picks >= 2 && info.canonical && info.ld, `${u.replace(origin, "")}: "${info.h1}", ${info.picks} picks, canonical, valid JSON-LD`);
  }
  // "Start from this title": with a library it adds a "More like" panel; with none it seeds the library
  await lp.goto(sample[0], 150);
  const startHref = await lp.eval(`document.querySelector('.cta-box a.btn').href`);
  const seedTitle = await lp.eval(`document.querySelector("h1").textContent.replace(/^(Books|Movies) like /, "")`);
  await lp.goto(startHref, 400);
  await lp.waitFor(`document.querySelector(".seed h2")`, 20000);
  check((await lp.eval(`document.querySelector(".seed h2").textContent`)) === "More like " + seedTitle, "“Start from” with a library shows titles like that one first");
  await lp.eval(`localStorage.clear()`);
  await lp.goto(startHref, 400);
  await lp.waitFor(`document.querySelectorAll("#picks .pick").length >= 5`, 20000);
  check(/Starting from/.test(await lp.eval(`document.querySelector("#status").textContent`)), "“Start from” with no library seeds picks from that title");
  for (const p of ["books/", "movies/", "how-it-works/", "how-to-export-goodreads/", "how-to-export-letterboxd/", "how-to-export-storygraph-imdb/"]) {
    await lp.goto(base + p, 100);
    check(await lp.eval(`document.querySelector("h1")?.textContent.length > 5`), `${p} renders`);
  }
  privacy(lp, "title, browse and guide pages");
  noErrors(lp, "title, browse and guide pages");
  await lp.close();

  // ---------- phone ----------
  const phone = await chrome.newPage({ width: 390, height: 844, mobile: true });
  await phone.goto(base, 400);
  check((await overflow(phone)) <= 1, "phone: home page has no sideways scroll");
  await phone.screenshot(path.join(OUT, "phone-home.png"));
  await phone.eval(`document.querySelector("#sample-start").click()`);
  await phone.waitFor(`document.querySelectorAll("#picks .pick").length >= 10`, 20000);
  check((await overflow(phone)) <= 1, "phone: picks have no sideways scroll");
  await phone.screenshot(path.join(OUT, "phone-picks.png"));
  for (const tab of ["want", "library", "profile", "rate"]) {
    await click(phone, `[data-tab="${tab}"]`);
    check((await overflow(phone)) <= 1, `phone: ${tab} tab has no sideways scroll`);
  }
  await phone.goto(sample[0], 200);
  check((await overflow(phone)) <= 1, "phone: a title page has no sideways scroll");
  await phone.screenshot(path.join(OUT, "phone-title-page.png"));
  privacy(phone, "phone");
  noErrors(phone, "phone");
  await phone.close();
} catch (e) {
  problems.push("self-test crashed: " + (e.stack || e.message));
} finally {
  await chrome.close();
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

fs.writeFileSync(path.join(OUT, "report.txt"), problems.length ? problems.join("\n") + "\n" : "all checks passed\n");
if (problems.length) {
  console.error("\nFAILED:\n" + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log("\nself-test passed");
