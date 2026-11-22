# How to write catalog entries for Shelf & Screen

Shelf & Screen recommends books and films from a person's own ratings and explains every pick. The catalog is its
whole brain: each title carries tags from a fixed vocabulary, a one-line hook, and a few hand-written "if you
liked this, try that" links. Everything is checked afterwards against Open Library (books) and Wikidata (films);
a title that cannot be found there is dropped, so accuracy of title, creator and year matters more than volume.

## The file you write

One JSON object per line (JSON Lines, UTF-8, no trailing commas, no blank lines, no markdown fences):

```
{"k":"b","t":"Gone Girl","c":"Gillian Flynn","y":2012,"g":["thriller","psychological-thriller","mystery"],"th":["marriage","deception","fame"],"m":["dark","tense","cynical"],"s":["unreliable-narrator","multiple-pov","twist-ending","page-turner"],"w":["contemporary","midwest"],"p":"fast","h":"A marriage narrated by two people who are both lying to you, with a midpoint turn that rewires everything before it.","like":[{"k":"b","t":"Sharp Objects","c":"Gillian Flynn","y":2006,"r":"The same poisoned-family dread from the same author, with a narrator who harms herself more than anyone else."},{"k":"b","t":"Rebecca","c":"Daphne du Maurier","y":1938,"r":"Another marriage haunted by an absent woman, told slower and wrapped in gothic fog instead of cable news."},{"k":"f","t":"Gone Girl","c":"David Fincher","y":2014,"r":"The author's own screenplay keeps the book's structure and adds an icy, precise chill of its own."}]}
{"k":"f","t":"Arrival","c":"Denis Villeneuve","y":2016,"g":["sci-fi","drama"],"th":["first-contact","grief","time","parenthood"],"m":["cerebral","melancholic","hopeful","quiet"],"s":["nonlinear","big-ideas","slow-burn","twist-ending"],"w":["contemporary"],"p":"slow","h":"A linguist learns an alien language and it changes how she experiences time; first contact told as a story about a mother.","like":[{"k":"b","t":"Stories of Your Life and Others","c":"Ted Chiang","y":2002,"r":"The source story sits beside seven others that treat one strange idea each with the same calm rigor."},{"k":"f","t":"Contact","c":"Robert Zemeckis","y":1997,"r":"Another scientist-heroine first contact that cares more about wonder and faith than about invasion."},{"k":"f","t":"Interstellar","c":"Christopher Nolan","y":2014,"r":"Also bends time around a parent and child, but louder, longer and aimed at the tear ducts."}]}
```

Fields:

- `k`: `"b"` for a book, `"f"` for a film (feature films and feature documentaries only: no TV series, no shorts).
- `t`: the title people actually use in English. No series tag ("(Book 1)"), no edition notes. Keep a subtitle only
  for nonfiction where the short title alone is ambiguous. For films, the common English release title
  ("Spirited Away", "Parasite", "Amélie").
- `c`: for a book, the author as "First Last" (two authors: "A & B"). For a film, the director (two: "A & B").
- `y`: year of first publication (original language) or first release. Get this right; it is used to verify.
- `g`, `th`, `m`, `s`, `w`: arrays of tag ids from `data/vocab.json`. Use **only ids that appear in that file**
  (the id is the key, e.g. `"slow-burn"`, not the phrase). Counts: `g` 1–3, `th` 2–5, `m` 2–4, `s` 1–4, `w` 0–3.
- `p`: exactly one of `"slow"`, `"medium"`, `"fast"`.
- `h`: the hook, 50–180 characters. What the experience is and why it lands, in one specific sentence.
- `like`: 2–4 hand-picked titles someone who loved this one should try next. Each has `k`, `t`, `c`, `y` and `r`,
  the reason (40–220 characters).

## What good looks like

**Tags describe taste, not just shelving.** Pick the tags a friend would use to explain why they loved or hated it.
"slow-burn", "unreliable-narrator", "found-family", "bleak" tell us more than "literary". Be honest about pace and
mood: a slow, bleak book must say so, because people who dislike slow, bleak books will be steered away from it.
Choose the most specific genre available (`epic-fantasy` rather than only `fantasy`; `whodunit` rather than only
`mystery`) and add the broad one too when it fits. For films not in English, include `world-cinema` in `s`.
Nonfiction books always carry at least one nonfiction genre (`memoir`, `biography`, `history`, `science`, `nature`,
`philosophy`, `psychology`, `self-help`, `business`, `politics`, `true-crime`, `essays`, `journalism`, `travel`).

**Hooks are specific and spoiler-free.** Say what it feels like to read or watch, in your own words. No plot twists,
no endings, no awards, no sales figures, no "a must-read", no "masterpiece", no quoting blurbs or reviews.
Bad: "A gripping tale of love and loss that will stay with you." Good: "Two timid people fall in love by letter
across a decade of bad timing; quiet, funny, and crueler than it first looks."

**Reasons compare the pair.** Each `r` names what the two share and, where useful, how the second differs
(funnier, slower, shorter, darker, older). It must make sense read alone under the heading "If you liked X".
Bad: "Another great fantasy novel." Good: "The same heist-crew banter in a grimier city, with magic that follows
rules you can learn."

**Likes are real, well-known and varied.** Prefer titles that are themselves famous enough to be in a catalog of the
1,700 most-read books and most-watched films. Do not pick three books by the same author. Sequels are not
recommendations: never point to the next book in the same series or a film's sequel. Where a natural match exists,
make one of the likes cross to the other medium (a film for a book, a book for a film), including the famous
adaptation when it is good in its own right. Never invent a title: if you are not sure a title, its creator and
its year are right, leave it out.

**Coverage.** Cover what people actually log on Goodreads, StoryGraph and Letterboxd in your slice: the widely read
and widely watched first (including popular titles critics dismiss), then the well-loved deep cuts. For a series,
include the first book (tag it `series-starter`) and a later volume only when it is famous in its own right.
One entry per title; no duplicates.

## Before you finish

Run the validator and fix everything it reports, then run it again until it prints OK:

```
node tools/validate-slice.mjs <your file>
```

It checks JSON, tag ids, counts, lengths and duplicates. It cannot check facts: that part is on you.
