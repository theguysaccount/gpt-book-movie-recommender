# Decisions

Each entry: what was decided, why, and what would change it.

1. **Books and films, together.** The open question was "books, movies, or both?" Both: Goodreads and Letterboxd
   users overlap heavily, a combined profile is the wedge, and cross-medium links ("the novel behind it", "the film
   adaptation that stands on its own") are where explanations shine. Revisit if analytics show one side unused.

2. **No runtime LLM; a pre-generated, verified catalog instead.** Machine-driven mode forbids a server and an API
   key, and a chatbot invents titles. The catalog (hooks, tags from a fixed vocabulary, 2–6 hand-picked links with
   reasons per title) was written by AI agents in this session and is verified monthly against Open Library and
   Wikidata. Unverifiable titles and links are dropped by the build. The "chat" in the original v1 became mood
   chips ("something lighter", "slow and immersive", "outside my usual shelf") that re-rank instantly.

3. **Static site on GitHub Pages; everything in the browser.** Import parsing (CSV and ZIP), matching, ranking and
   explanations run client-side. A Content-Security-Policy on every page allows connections only to the site's own
   origin, and the end-to-end test fails if any request leaves the origin or carries a body. That makes "your
   library never leaves your device" a tested property, not a slogan.

4. **Ratings are read relative to the person.** Each rating becomes a z-score against the person's own mean and
   spread (shrunk toward a typical 3.6 for small libraries), favorites and likes add weight, did-not-finish and
   "not for me" subtract. Tag preferences are shrunk toward zero by count, so one five-star outlier can't define a
   taste. Picks are diversified (one per creator near the top, near-duplicates penalized).

5. **Two layers of recognition.** Curated titles (~1,700) carry rich tags and are the only possible picks. To
   understand more of an imported library, ~5,800 most-read Open Library works and ~10,000 Wikidata films (18+
   Wikipedia editions) are matched too, with tags mapped from subjects and genres. Book subject tags need two
   matching subjects to count (one-off edition subjects were noise), and fiction never gets nonfiction genres.

6. **Matching rules.** Books need a shared author surname; films need the year within one (festival vs release
   dates) or the IMDb id. Series notes, subtitles, articles and accents are normalized. Wrong matches are worse
   than misses, so ambiguous titles without a creator or year don't match.

7. **No covers or posters.** Loading them would send third-party requests from a page built from the person's
   library, and most cover and poster art is copyrighted. Kind badges and typography instead.

8. **Shareable profile in the URL fragment.** The share link carries only a name, up to six traits, up to five
   favorites from the catalog and two counts, shown in full before sharing. Fragments are never sent to servers.
   The /p/ page is `noindex`.

9. **Search pages are real content.** One "books like X" / "movies like X" page per verified catalog title, each
   with the original hook, hand-written reasons, a computed "same DNA" list with the shared traits named, and links
   to Open Library / Letterboxd / Wikipedia. No thin tag pages in v1.

10. **Money stays off on Pages.** GitHub Pages is non-commercial. The Bookshop.org affiliate slot
    (`SS_BOOKSHOP_ID`) and a donation link (`SS_SUPPORT_URL`) are built and off; OPERATIONS.md has the steps.

11. **Name: Shelf & Screen.** Says both media and fits the promise. shelfandscreen.com is registered by someone
    else and parked (DirectNIC, registered 2025-03-10); shelfandscreen.org and shelfandscreen.app were unregistered
    on 2026-11-22 (RDAP).

12. **Monthly verification, weekly live test, staleness dispatch.** GitHub starts schedules late on this account
    and sometimes skips them, so the weekly self-test re-dispatches the monthly refresh when verification is more
    than 40 days old. Every job is safe to re-run and leaves the last good deploy live on failure.
