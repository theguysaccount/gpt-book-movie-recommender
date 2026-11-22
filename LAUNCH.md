# Launch

## Where it runs

- Preview and production today: https://theguysaccount.github.io/gpt-book-movie-recommender/ (GitHub Pages, free).
- Production deploy: push to `main` (or run "Build, test and deploy"). Tests and the browser self-test gate every deploy.
- Custom domain: one repository variable (`SITE_URL`) plus the Pages custom-domain setting and DNS records; exact
  steps in OPERATIONS.md, key 1. DNS is changed only by the domain rollout session.

## Distribution (machine channels only)

Running now:
- **Search pages that answer real queries.** One "Books like X" / "Movies like X" page per verified catalog title,
  each with an original hook, hand-picked next titles with reasons, a computed "same DNA" list with the shared
  traits named, and structured data (ItemList, BreadcrumbList). Browse pages group them by genre.
- **How-to pages people search for:** exporting a Goodreads library, Letterboxd data, StoryGraph and IMDb.
- **Sitemap, robots.txt, canonical URLs, Open Graph cards** on every page; the account's host-root robots.txt lists
  the sitemap daily.
- **IndexNow** on every deploy, for pages whose content changed.
- **Share loop built into the output:** a taste-profile link (contents shown before sharing) and a downloadable
  1200×630 card image; the shared page invites the viewer to make their own.
- **Repository:** description and topics set for GitHub search; the catalog is CC BY 4.0 open data.

Search terms the pages target: "books like <title>", "movies like <title>", "<title> similar books",
"how to export goodreads library", "letterboxd export", "goodreads to letterboxd", "book recommendations based on
goodreads", "movie recommendations based on letterboxd ratings".

## First 1,000 users (what a human could add later; nothing here is sent or posted)

No social posting or outreach is part of machine-driven mode. If Jack wants to accelerate later, the natural
communities are r/books, r/suggestmeabook, r/Letterboxd, r/movies' recommendation threads, StoryGraph's and
Letterboxd's own forums, and BookTok/Bookstagram creators who post "if you liked X" lists. A neutral post would
show one explained pick from a real export and link to the matching "books like" page. Draft only; send nothing.

## 14-day calendar (machine)

- Day 0: deploy, IndexNow for every page, host-root robots.txt rebuild.
- Days 1–7: weekly self-test; Search engines crawl the sitemap.
- Day 3 of each month: refresh and re-verify, redeploy, IndexNow for changed pages.
- Day 14: check Search Console (after key 5) for impressions on "books like" queries; the content routine adds
  titles for the queries that show up.
