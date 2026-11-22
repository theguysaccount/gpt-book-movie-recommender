# Shelf & Screen: product

**The user.** People who log what they read and watch on Goodreads, StoryGraph, Letterboxd or IMDb and want a
better answer to "what next?" than a store's bestseller list or a chatbot that forgets them between questions.

**The painful job.** Picking the next book or film you will actually love. Trackers record history but recommend
poorly; asking a chatbot means retyping your taste every time, getting confident titles that sometimes don't exist,
and handing over your history.

**The promise.** Drop in the export you already have and get picks ranked for your taste, each with the reason
(which of your titles led to it, what it shares with them, and what you might not like). Your library never leaves
your device.

**The wedge.** Two things the incumbents don't do together: (1) explanations grounded in *your own* ratings, read
relative to your own average, and (2) books and films in one taste profile, so a Letterboxd fan gets book picks and
a Goodreads reader gets films. Every title is verified against Open Library or Wikidata, so nothing is invented.

**Why now.** Readers and film fans are moving between trackers (StoryGraph, Letterboxd and Fable growth; Goodreads
stagnation) and all of them export CSVs. Language models can write a deep, well-tagged catalog with hand-picked
"if you liked" links in an afternoon; open data can verify it every month for free.

**Activation metric.** A visitor sees ranked picks from their own data: an import (or five manual ratings) that ends
with picks on screen. Instrumented as the `import_done` / `sample_loaded` / `rate_mode` events once the analytics
key is on; the follow-through events are `pick_want`, `pick_seen`, `share_copy` and `card_download`.

**First revenue event.** A book bought through an affiliate link (Bookshop.org) from a pick or a "books like" page,
after the site moves to a host that allows commercial use. The slot is built and off.

**What v1 deliberately doesn't do.**
- No accounts, sync or server: the library lives in the browser (export and re-import to move it).
- No live AI: the catalog is pre-generated and verified; nothing is generated per visitor.
- No covers or posters: they would mean third-party requests from the picks page, and most are copyrighted.
- No TV series, podcasts or games.
- No social feed. Sharing is a taste card and a link whose contents are shown before sharing.
