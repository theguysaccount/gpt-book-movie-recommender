// Draw the Open Graph share cards (1200×630) and the touch icon with headless Chrome. Run after a design
// change; the PNGs are committed in src/og/ and copied into every build.
//   node scripts/og.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/chrome.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cards = [
  ["home", "Your next book or film,", "picked from your own ratings, with the reasons.", "Goodreads · StoryGraph · Letterboxd · IMDb · nothing uploaded"],
  ["books", "Books like the ones you love", "Hand-picked next reads and films, each with the reason.", "Verified against Open Library"],
  ["movies", "Movies like the ones you love", "Hand-picked next films and books, each with the reason.", "Verified against Wikidata"],
];
const html = (a, b, c) => `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#1f3a34;font-family:Georgia,'Iowan Old Style',serif">
<div style="position:absolute;inset:36px;background:#f7f1e3;border-radius:22px;padding:70px 80px;box-sizing:border-box">
<div style="display:flex;align-items:center;gap:18px;font:700 34px Georgia,serif;color:#1f2a27"><span style="display:inline-block;width:44px;height:44px;border-radius:8px;background:linear-gradient(90deg,#1f3a34 0 46%,transparent 46% 54%,#b8492a 54%)"></span>Shelf &amp; Screen</div>
<div style="font:700 66px/1.1 Georgia,serif;color:#1f2a27;margin-top:56px">${a}</div>
<div style="font:400 40px/1.25 Georgia,serif;color:#b8492a;margin-top:18px">${b}</div>
<div style="position:absolute;left:80px;bottom:60px;font:600 26px system-ui,-apple-system,sans-serif;color:#5d5a52">${c}</div>
</div></body></html>`;
const chrome = await launch();
try {
  const page = await chrome.newPage({ width: 1200, height: 630 });
  fs.mkdirSync(path.join(ROOT, "src", "og"), { recursive: true });
  for (const [name, a, b, c] of cards) {
    await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(html(a, b, c)), 200);
    await page.screenshot(path.join(ROOT, "src", "og", `${name}.png`));
    console.log("drew og/" + name + ".png");
  }
  await page.viewport(180, 180);
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(`<body style="margin:0;width:180px;height:180px;background:#f7f1e3"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180">${fs.readFileSync(path.join(ROOT, "src", "favicon.svg"), "utf8").replace(/^<svg[^>]*>|<\/svg>\s*$/g, "")}</svg></body>`), 200);
  await page.screenshot(path.join(ROOT, "src", "apple-touch-icon.png"));
  console.log("drew apple-touch-icon.png");
} finally {
  await chrome.close();
}
