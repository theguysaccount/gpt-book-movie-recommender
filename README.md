# Shelf & Screen

**Book and film picks ranked from your own ratings, with the reason for each. Nothing is uploaded.**

Live: https://theguysaccount.github.io/gpt-book-movie-recommender/

Drop in a Goodreads, StoryGraph, Letterboxd or IMDb export (or rate a few titles by hand). The page reads it in the
browser, builds a taste profile from your ratings relative to your own average, and ranks a catalog of hand-tagged,
verified books and films against it. Every pick names the titles of yours that led to it, the traits you rate
highly, and anything you tend to rate low. Keep a want list, track what you're reading or watching, and share a
taste-profile card. There's no server and no account: a Content-Security-Policy keeps the page from contacting any
other site, and the automated browser test fails if anything is sent.

It also publishes a "Books like X" or "Movies like X" page for every catalog title, with hand-picked next titles and
the reasons, plus guides to exporting from each tracker.

## How it's built

- `data/catalog/raw/*.jsonl`: the catalog, one title per line: tags from `data/vocab.json`, an original hook, and
  2–6 "if you liked this" links with reasons. Written with AI ahead of time; format in `tools/CATALOG-BRIEF.md`.
- `pipeline/`: downloads the most-read Open Library works and Wikidata films (`index-*.mjs`), and verifies every
  title and every recommended title against those sources (`verify.mjs` → `data/catalog/verified.json`).
  Unverified titles never reach the site.
- `src/engine/`: CSV and ZIP reading, the importers, matching, the taste profile, ranking and explanations. Pure
  JavaScript modules shared by the browser, the build and the tests.
- `src/app/`: the browser app (import, picks, want list, library, taste profile, share card).
- `scripts/build.mjs`: builds `dist/` (app, title pages, browse pages, guides, sitemap, robots.txt, IndexNow key).

## Run, test, deploy

Needs Node 22+ (and Google Chrome for the browser self-test).

```bash
npm test                       # unit, data and build tests
node scripts/build.mjs         # build into dist/
node scripts/serve.mjs 4861    # serve dist/ at http://127.0.0.1:4861/gpt-book-movie-recommender/
node scripts/selftest.mjs      # end-to-end browser test of the build (or pass a live URL)
```

Refresh data: `node pipeline/index-books.mjs && node pipeline/index-films.mjs && node pipeline/verify.mjs`.

Deploy: push to `main`. GitHub Actions tests, builds, runs the browser self-test and deploys to GitHub Pages; a
monthly job re-verifies every title and redeploys; a weekly job tests the live site. See `OPERATIONS.md`.

## Data and credits

Titles are verified against [Open Library](https://openlibrary.org) and [Wikidata](https://www.wikidata.org)
(both CC0). Hooks, tags and reasons are original and released under CC BY 4.0; code is MIT. Corrections welcome as
issues.
