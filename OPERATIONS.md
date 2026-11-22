# Operations

Shelf & Screen runs with no human in the loop. This file lists every automated job, how each one fails safely,
what to watch, and the keys a human can turn later.

**Live:** https://theguysaccount.github.io/gpt-book-movie-recommender/ (GitHub Pages, deployed by Actions from `main`).
**Base URL setting:** the repository variable `SITE_URL` (unset = the github.io URL above). It is the only setting
that moves the site; see key 1.

## Automated jobs

| Job | File | When | What it does | How it fails safely |
|---|---|---|---|---|
| Build, test and deploy | `.github/workflows/deploy.yml` | every push to `main`; dispatched by the monthly refresh; by hand | unit, data and build tests → build → **end-to-end self-test in headless Chrome** (imports a Goodreads CSV and a Letterboxd ZIP through the real file input, checks every pick has a reason, exercises want/seen/hide, filters, moods, reload persistence, sharing, clear-all, the sample library, phone layout, and **fails if any request leaves the site's origin or carries a body**) → deploy (a second attempt if Pages stalls) → live link check → IndexNow for changed pages | Any failed test or build step stops before `deploy`; the last good site stays live. The live check and IndexNow run after deploy and never roll back; IndexNow errors are ignored. |
| Monthly data refresh | `.github/workflows/refresh.yml` | **the 3rd of each month, 07:23 UTC** (GitHub may start it hours late); by hand; dispatched by the weekly self-test when data is stale | re-downloads the most-read Open Library works and Wikidata films, **re-verifies every catalog title and every recommended title** (Open Library for books, Wikidata for films; API lookups paced at about one a second), runs all tests, commits changed data, then dispatches the deploy, which rebuilds every page | A source that is down keeps last month's list (warning). Verification refuses to write if under 85% of catalog titles verify or 25+ lookups fail (a source problem, not bad titles). A failing test means no commit and no deploy. Failure opens or updates one `ops-alert` issue; the next good run closes it. |
| Weekly self-test | `.github/workflows/selftest.yml` | **Wednesdays 09:41 UTC**; by hand | runs the tests, the full browser self-test **against the live site**, a link check of the fixed pages plus a rotating 150 title pages (all pages are covered over a few weeks), and a staleness check that dispatches the monthly refresh if verification is over 40 days old | Never changes the site. Opens or updates one `site-health` issue on failure; closes it on recovery. Screenshots are kept 14 days as an artifact. |
| Keep-alive | `.github/scripts/keepalive.sh`, in both scheduled workflows | every scheduled run, even when the job failed | re-enables workflows GitHub disabled for inactivity (never ones disabled by hand); pushes an empty commit if the last commit is 45+ days old, so the 60-day rule never stops the schedules | Pushes made with `GITHUB_TOKEN` never trigger workflows, so it cannot loop. |

All jobs are safe to re-run: the refresh commits only when data changed, the deploy is idempotent, and IndexNow
submits only pages whose content hash changed since the live deploy (`manifest.json`).

## What to watch

- **Actions:** https://github.com/theguysaccount/gpt-book-movie-recommender/actions. GitHub emails scheduled-run
  failures to the account owner.
- **Issues labelled `site-health` or `ops-alert`:** an open one means the live site or the monthly refresh is failing.
- **`data/catalog/verify-report.json`:** titles that failed verification (left out of the site) and year mismatches
  between the catalog and the source, for the content routine to fix.
- **Analytics** (after key 3): activation is `import_done`, `sample_loaded` or `rate_mode` followed by picks;
  follow-through is `pick_want`, `pick_seen`, `pick_hide`, `share_copy`, `share_native`, `card_download`. Events
  carry no titles or library data.

## Recovering by hand

- A bad deploy that passed every test: re-run the last good "Build, test and deploy" run, or `git revert` and push.
- A schedule GitHub disabled anyway: Actions → the workflow → "Enable workflow", then "Run workflow".
- Locally: `npm test && node scripts/build.mjs && node scripts/selftest.mjs` (Node 22+, Chrome installed).
- Refresh by hand: `node pipeline/index-books.mjs && node pipeline/index-films.mjs && node pipeline/verify.mjs`.

## Keys Jack can turn later

### 1. A custom domain (the "domain rollout" session does this)

The site reads its address from one setting, the repository variable `SITE_URL`. Use a domain or subdomain that
serves nothing today: never point a name that already serves a site here, because that would replace it. If the apex
is in use, take a subdomain, as Startups 101 did with `learn.startupcollege.io`. Moving it:

1. DNS at the registrar. For an apex domain: four `A` records for `@` → `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153`; four `AAAA` → `2606:50c0:8000::153`, `2606:50c0:8001::153`,
   `2606:50c0:8002::153`, `2606:50c0:8003::153`; and `CNAME www` → `theguysaccount.github.io`. For a subdomain
   (for example `picks.example.com`): one `CNAME` → `theguysaccount.github.io`.
2. `gh variable set SITE_URL --body https://<domain> --repo theguysaccount/gpt-book-movie-recommender`
3. `gh api -X PUT repos/theguysaccount/gpt-book-movie-recommender/pages -f cname=<domain>`
4. `gh workflow run deploy.yml --repo theguysaccount/gpt-book-movie-recommender` (steps 2–4 back to back: until the
   deploy finishes, links on one of the two addresses point at the other path).
5. When the certificate is issued: `gh api -X PUT repos/theguysaccount/gpt-book-movie-recommender/pages -F https_enforced=true`.
6. About 20 minutes later, send every page to IndexNow once. A new host answers 403 at first, and later deploys send
   only changed pages:
   `curl -s https://<domain>/sitemap.xml | grep -o '<loc>[^<]*' | sed 's/<loc>//' > urls.txt && SITE_URL=https://<domain> node scripts/indexnow.mjs --file urls.txt`

The build moves every canonical URL, the sitemap, robots.txt, IndexNow and all asset paths with it (covered by a
test that builds for a root domain). GitHub redirects the old github.io URLs to the domain.
Name ideas checked by RDAP on 2026-11-22: shelfandscreen.org and shelfandscreen.app unregistered;
shelfandscreen.com registered by someone else (parked).

### 2. Money

GitHub Pages is for non-commercial sites, so both slots are **off**.

- **Bookshop.org affiliate links (the first revenue event).** Move hosting to a host that allows commercial use
  (Cloudflare Pages: connect this repo, build command `node scripts/build.mjs`, output `dist`, environment variable
  `SITE_URL=https://<domain>`, Node 22+). Join the Bookshop.org affiliate program, then set `SS_BOOKSHOP_ID` (the
  affiliate id) as a variable there. Every book page and pick then shows "Find it at Bookshop.org" with
  `rel="sponsored"`. Bookshop.org's terms require disclosure: add a line to the footer when turning it on.
- **Donations, fine on Pages.** Set `SS_SUPPORT_URL` (a GitHub Sponsors or Buy Me a Coffee page) with
  `gh variable set SS_SUPPORT_URL --body <url> --repo theguysaccount/gpt-book-movie-recommender` and redeploy; the
  footer shows "Support this free tool".

### 3. Privacy-respecting analytics

Create a free GoatCounter site (no cookies), then
`gh variable set SS_GOATCOUNTER --body https://<code>.goatcounter.com/count --repo theguysaccount/gpt-book-movie-recommender`
and redeploy. The build adds that origin to the CSP's `img-src` only; counts are image pixels sent by the site's
own script, skipped when Do Not Track or Global Privacy Control is on. No library data is ever in a count.

### 4. Content routine (catalog growth and fixes)

AI writing can't run inside Actions (no API key). Schedule a monthly Claude Code routine on this repository:

> In theguysaccount/gpt-book-movie-recommender, read tools/CATALOG-BRIEF.md and data/catalog/verify-report.json.
> (1) Fix entries in data/catalog/raw/*.jsonl whose titles failed verification or whose year is flagged, using the
> source's title and year. (2) Add a new slice file `data/catalog/raw/<next-letter>-<topic>-<yyyy-mm>.jsonl` with
> 40 widely read books or widely watched films from the past 12 months or from a gap in the catalog (check the
> /books/ and /movies/ pages), following the brief exactly. Run `node tools/validate-slice.mjs` on it, then
> `node pipeline/verify.mjs`, `npm test`, `node scripts/build.mjs` and `node scripts/selftest.mjs`. Open a pull
> request with the verification summary.

### 5. Search Console

Verify the domain in Google Search Console with a DNS `TXT` record once a custom domain exists, and submit
`/sitemap.xml`. Bing, Yandex and other IndexNow engines are already notified on every deploy, and the account's
host-root robots.txt (theguysaccount.github.io, rebuilt daily) lists this site's sitemap.

## Configuration reference

| Variable | Where | Effect |
|---|---|---|
| `SITE_URL` | repo variable | public base URL; default `https://theguysaccount.github.io/gpt-book-movie-recommender` |
| `SS_GOATCOUNTER` | repo variable | cookieless counts (off when empty) |
| `SS_SUPPORT_URL` | repo variable | footer donation link (off when empty) |
| `SS_BOOKSHOP_ID` | variable on a commercial host | Bookshop.org affiliate links (keep off on Pages) |
| `SS_FILM_MIN_SITELINKS`, `SS_BOOK_READ_DEPTH`, `SS_BOOK_LOG_DEPTH` | env, refresh | size of the recognition lists (defaults 18, 6000, 3000) |
| `SS_TODAY`, `SS_OUT`, `SS_VERIFY_BUDGET_MS` | env, local | build as of another date; build folder; time budget for verification lookups |
