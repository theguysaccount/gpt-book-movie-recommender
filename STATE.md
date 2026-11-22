# State (2026-11-22)

- Starting point: one line in Jack's notes ("GPT can do amazing recommendations for books and movies…") and a
  bookmark to Margins. No code, design or data existed; nothing to run or reuse from the idea itself.
- Reused from wave 1 (patterns, not code dependencies): the Pages deploy workflow, IndexNow by changed-page
  manifest, the keep-alive script, headless-Chrome self-tests over the DevTools protocol, OPERATIONS.md layout.
- Works now: import (Goodreads, StoryGraph, Letterboxd CSV or ZIP, IMDb, any CSV), matching against the curated
  catalog plus ~5,800 Open Library works and ~10,900 Wikidata films, explained ranked picks with filters and moods,
  want / in progress / done tracking, taste profile, share link and card, sample library, manual rating, title
  pages and guides. Verified end to end in headless Chrome on desktop and phone.
- Known limits: catalog titles that Open Library or Wikidata can't confirm are left out (see
  `data/catalog/verify-report.json`); recognition tags for non-catalog titles come from open-data subjects and
  genres and are coarser than the catalog's; no covers or posters by design.
