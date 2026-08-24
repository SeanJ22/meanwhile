# The expansion log

**Created 2026-08-22 (Discovery Conduct session, item 7). APPEND-ONLY.**

One entry per hunt session. It records the routes that **did not exist at
session start** — RULING 88 — and for each: how it was conceived, the literal
query or URL, what it returned including zero, and whether it generalises.

## Read this before writing an entry

**A route that returned NOTHING belongs here exactly as much as one that
returned four hundred rows.** The invention is the deliverable; the yield is
not. Every other figure in this project rewards rows found, which is why this
sentence is at the top of the file rather than in a rule somewhere.

**An empty expansion section fails the item.** A session that cannot name a
route it invented has found the limit of its imagination, which is a fact about
the session — not about the world.

**Expansion is a new route to a field ALREADY OWED on the item list** (RULING
89). A new capability, a new surface, new infrastructure, or work on a zip that
is not the current zip is a **side quest**: it is forbidden, it becomes a
tracker row, and a session that built one while citing RULING 88 reports the
scope breach.

## The format

Each session appends a `## <session-id> · <date>` heading and, beneath it, one
block per route:

```
### <short name of the route>
- **Conceived:** what question or observation led to it
- **Query:** the literal text typed, or the literal URL fetched
- **Returned:** rows, including zero
- **Generalises:** yes/no, and to what class of entities
```

`tests/expansion-log.test.ts` fails the build when the newest session in
`docs/log.md` has no entry here. **Non-hunt sessions are exempt via an explicit
marker in the session id** — the suffix `-nonhunt`. The test checks for the
marker rather than inferring exemption from what the session did, because
inference is how an exemption becomes a habit.

---

## questionnaire-and-corpora-0823 · 2026-08-23

**Item 2 is a hunt at rung 1 and this is its expansion section.** Four routes
that did not exist at session start. **Two returned rows and two returned zero,
and the two zeros are reported as successes** — the invention is the
deliverable, not the yield (RULING 88).

### The GitHub PAGES host and the GitHub host are different walls

- **Conceived:** the brief declared the environment — no live network except
  `github.com`. `scripts/fetch-official-photos.mts` had exactly ONE route to the
  portraits, `https://unitedstates.github.io/images/congress/450x550/…`, and
  that is a **Pages** host rather than `github.com`. The question that produced
  the route was RULING 90's fourth obligation asked literally: *the wall is
  around a HOST — what other road reaches the same repository?* The two serve
  the same bytes out of the same tree.
- **Query:** both roads, same file, same minute:
  ```
  curl -s -o /dev/null -w "%{http_code}" --max-time 25 \
    https://unitedstates.github.io/images/congress/450x550/C000127.jpg
  git clone --filter=blob:none --no-checkout https://github.com/unitedstates/images.git
  git show HEAD:congress/450x550/C000127.jpg > C000127.jpg
  ```
- **Returned:** the Pages read returned **`000`**. The git read returned
  **114,839 bytes, a valid progressive JPEG, 450x550**. Across the whole owed
  set: **97 of 97 portraits retrieved and verified.**
- **Generalises:** **YES, and widely — to every corpus published as a GitHub
  repository, not to these two.** It is now `lib/hunt/github-corpus.ts` and a
  permanent rung inside the photo fetcher, walked before any absence is
  recorded. It is also strictly better than the HTTP road where both work,
  because a clone is pinned to a commit and a CDN read is not.

### `git ls-tree` is a free count assertion

- **Conceived:** RULING 100 needs a source to state its own count, and a
  portrait corpus does not have a sentence saying how many portraits it holds.
  But a blobless partial clone carries the whole TREE and none of the blobs — so
  the corpus states its size structurally, for nothing, before any image data
  moves.
- **Query:** `git ls-tree -r HEAD --name-only congress/450x550 | wc -l`
- **Returned:** **1,297**, matched exactly by extraction — `MATCHED`, not
  `NOT_ASSERTABLE`. The same shape on the directory:
  `grep -c '^- id:$' legislators-current.yaml` → **537**, extracted 537,
  `MATCHED`.
- **Generalises:** **YES**, to any repository-hosted corpus whose members are
  files. It converts a class of source from "we cannot assert a count" to
  "the count is free", which is the difference RULING 100 exists over.

### Ask the corpus for the fields we are missing, not for the fields we have

- **Conceived:** the obvious use of a fresher directory is to re-read what it
  already gave us. The more useful question is the inverse — *which sitting
  members are we missing a field for, and does this corpus close it?* — because
  that is the only version of the question whose answer is work.
- **Query:** an anti-join of `data/congress-legislators/snapshot.json` and
  `lib/registry/official-photos.json` against the corpus at
  `750c0608efb6ef1fc3257ba72c99af3771d35088` and
  `aec3e4a88af843b282c0576f420b930f6a9a46ad`, per field type.
- **Returned:** **ZERO on every contact field** — phone 537 of 537 held, url
  536 of 537, contact form 88 of 88, and **the corpus at today's commit carries
  no value we do not already hold and none that differs.** Reported as a
  success: the route was conceived, walked and answered, and the answer is that
  the previous pipeline had already closed this. **Non-zero on portraits: 97
  owed and available, 3 owed and genuinely not in the corpus.**
- **Generalises:** **YES.** The anti-join first is the cheap general move for
  any refresh of a source already wired — it turns a re-read of 537 rows into a
  named list of what is actually owed.

### Does the corpus hold what our own manifest calls MISSING?

- **Conceived:** `lib/registry/official-photos.json` carries a `missing` list of
  229 entries, each recording a person we tried and did not ship. Those were
  written by a fetcher with only the HTTP road. If the wall was the host rather
  than the person, some of those absences are not absences.
- **Query:** intersect the 229 recorded `missing` officeholder ids against the
  1,297 bioguides `git ls-tree` enumerates.
- **Returned:** **ZERO.** The 229 recorded misses break down as **181
  `plural:` and 48 `roster:` — and exactly 0 `congress:` rows**, so this corpus
  was never going to answer for any of them. **None of the 97 owed portraits
  appears in the missing list either**, and neither do the 3 the corpus
  genuinely does not carry: all 100 had simply never been attempted. Reported
  as a success, and the finding is the one worth keeping — **a gap that was
  never attempted does not appear in a missing list**, so a missing list is a
  register of ATTEMPTS and can never be read as the denominator of what is
  owed. 100 federal portraits were owed and the register that exists to record
  photo gaps said nothing about any of them.
- **Generalises:** **YES**, and it is a caution rather than a route: any
  "missing" register in this repo records attempts, never owed fields, and the
  two must never be confused for one another.

### What a person with a browser would have typed (RULING 94, move 1)

`unitedstates images congress portraits github` — the first result is the
repository itself, and its `README` states the URL pattern, the three sizes and
the public-domain assurance from GPO in the first screen. **This route was
already walked by an earlier session**, which is why 902 portraits were already
here; what had never been asked is what happens when that URL pattern is
refused.

---

## discovery-conduct-0823-nonhunt · 2026-08-23

**This session is marked `-nonhunt` and hunted nothing.** It has no expansion
routes, and that is the honest entry rather than a blank one. Its two network
calls were build inputs, both inside named items and both stated in the brief as
exceptions: `pnpm credentials` called every credential in `.env.local` because
calling them is the proof (item 2), and the Census ZCTA-to-congressional-district
relationship file was fetched as an input to JUR-3 (item 12).

The entry exists so the file starts with a record of why it exists rather than
with a heading and nothing under it.

## hunt6-hardening-0823 · 2026-08-23

**This session was a hardening-and-visual run, and it hunted one thing: the
seven Morris County commissioner portraits (`OFF-1` / `NJ13`), which the brief
named as its one narrow exception.** Everything else it did was code. The
routes below are the ones that did not exist at session start.

### The commissioner's OWN page, rather than the board's index

- **Conceived:** by reading the RECORD of the previous attempt rather than the
  world. `lib/registry/official-photos.json` carries, for six of seven
  commissioners, *"door 2, rungs walked 2026-08-15 —
  `…/Board-of-County-Commissioners`: 0 candidate image(s), none carrying their
  name; `…/Board-of-County-Commissioners`: 0 candidate image(s)"*. **The same
  URL twice, recorded as two rungs.** The seventh — Tayfun Selen, the only one
  with a face on the card — was walked at `…/Board-of-County-Commissioners/
  Tayfun-Selen`. The difference between the six and the one was not the person
  and not a wall; it was which page somebody asked.
- **Query:** `https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners/John-Krickus`
  and the six siblings, each fetched and scanned for an `<img>` whose alt text
  or filename carries the person's name.
- **Returned:** **7 of 7**, every one a JPEG between 61 KB and 1.29 MB, every
  one read as an image and confirmed to be a clean solo portrait before this
  entry was written. Nothing has been shipped: the review row is `NH78`.
- **Generalises:** **yes, and widely.** Every roster row in this product already
  carries a `websiteUrl` pointing at that person's own official page — it is the
  field the card renders as their official page — and a portrait hunt that walks
  the BODY's page instead is asking an index for a thing that lives on a leaf.
  The class is every curated roster in the registry.

### The member pages discovered from the board index, not built from names

- **Conceived:** by this session's own failure, half an hour earlier. The first
  version of the hunt built each URL from the commissioner's name and **lost
  three of seven to HTTP 404** — Morris County keeps the period after a middle
  initial (`Stephen-H.-Shaw`, not `Stephen-H-Shaw`). Three absences entirely of
  the hunt's own making, which is the same shape as the 2026-08-15 run it exists
  to correct, one level down.
- **Query:** `https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners`,
  scanned for `href` values under its own path, each slug matched against the
  roster names.
- **Returned:** 9 links, 7 of 7 members matched, and the three 404s became 200s.
- **Generalises:** **yes.** RULING 93 in miniature — ask what the tier above
  publishes about the tier below. A route that GUESSES an identifier is a route
  that reports a body's absence when it got the name wrong, and any body index
  that links its own members can be read this way.

### Routes conceived that returned NOTHING, reported as successes

**None this session, and that is a fact about its scope rather than about its
luck.** Every route above hit on its first walk because the previous absence was
procedural rather than real. A session that conceives four routes and gets zero
from all four has done what RULING 88 asks; this one conceived two and got seven
portraits, and the honest note is that neither route was hard — which is the
uncomfortable half of the finding.

### What a person with a browser would have typed (RULING 94, move 1)

*"morris county nj commissioners"* — the county's own board page is the first
result, and every commissioner's name on it is a link to their own page with
their portrait on it. **Two clicks.** That is the whole route, and it had been
recorded as an absence for eight days.

## visual-tail-and-rehunt-0823 · 2026-08-23

**The wall this session hunted behind, stated first because it decides how every
route below reads.** Every outbound host except `github.com` is refused at this
environment's egress gateway with `403` to `CONNECT`. That was established by
walking the ladder rather than assuming it: **rung 2** (plain fetch) `403`,
**rung 3** (full browser header set) `403`, **rung 4** (a different client —
`curl`, `node` fetch and `wget` each) `403`, **rung 6** (the live browser,
Chromium via Playwright) `net::ERR_TUNNEL_CONNECTION_FAILED`. **Rung 5** — a
different egress — is the one that would answer it and is not available here;
the environment's own documentation forbids routing around a policy denial and
requires it be reported instead, so it is reported. **Rung 1, the committed
snapshot, is open**, and every route below is walked there.

This is an EGRESS wall in the g3 sense — a rung is `(client, headers, URL,
egress)` — and it is a fact about this session's machine on this date, never a
fact about any source. Nothing below is recorded as an absence.

### Mine the committed search corpus for campaign-site domains

- **Conceived:** an inventory mismatch rather than a research idea. NJ Hunt 4
  spent its entire search budget on 272 candidates and committed the result;
  `campaignSite` then stood at **0 of 272**. Both cannot be true of a corpus
  doing its job — 858 hits with URLs, titles and snippets had been collected to
  answer this field and never read for it. RULING 90's question, *what would I
  try if there were no manifest at all?*, answers here with: read what is
  already in the tree before going back out.
- **Query:** `data/hunt/nj-hunt4-search.json`, mined by `pnpm mine:campaign-sites`
  (`scripts/mine-campaign-sites.mts`). No network call.
- **Returned:** **12 leads across 12 of 272 candidates — 8 STRONG, 4 WEAK**,
  from 858 hits, with 598 excluded as known aggregators/news/social by name and
  25 as government hosts. The strong set includes `selenformorriscounty.com`
  (Tayfun Selen), `joehathawayforcongress.com`, `strobelforschoolboard.com`,
  `rebeccabennettforcongress.com`, `corybooker.com`.
- **Every row is a LEAD, never a HIT.** A domain matching a candidate's name is
  a guessed identifier, and the control check — fetch it, confirm the page
  self-identifies with the filed name, the office and the cycle — is exactly
  what the egress wall prevents. The artifact says so in its own header.
- **Generalises:** **yes**, to any jurisdiction where a per-entity search corpus
  has been committed. The classifier is name-shape plus an excluded-host list,
  neither of which is New Jersey-specific.

### Mine the committed government graph's `leaders` for roster rows

- **Conceived:** `data/hunt/wiki-graph-07866.json` is 4.5 MB committed on
  2026-08-22 — 280 nodes, 174 entities, 171 bodies the registry does not hold.
  Its per-node `leaders` array had never been read by anything. `NH72` records
  rosters as OWED for 20 of 39 Morris municipalities while three of them sat in
  this file.
- **Query:** `pnpm mine:wiki-leaders` (`scripts/mine-wiki-leaders.mts`) over the
  committed graph. No network call.
- **Returned:** **72 rows recovered from 80 leader entries**, 8 too short to be
  a name. **9 are New Jersey municipal rows** and all nine are for the three
  municipalities of 07866 — Rockaway Township, Rockaway Borough and Denville —
  giving mayor, manager and clerk for each. None is currently held as an
  officeholder (checked against 1,157 names in `lib/registry/officeholders-*.json`).
- **A RULING 100 finding fell out of it.** The committed graph stores leader
  names **with Wikipedia markup still attached** — `"Joseph Jackson ([[Republican
  Party (United States)"` — on 5 of 72 rows. Nothing was empty, so no zero-row
  check ever fired; the rows were simply not names, and only reading them shows
  it. The fix belongs in the graph's generator under RULING 92, that generator
  reads Wikipedia over the network, and the artifact is owed a regeneration.
  Tracker row opened.
- **Every row is a LEAD, never a FOUND.** RULING 87: Wikipedia names the person
  and the citation proves them. Not one footnote could be fetched.
- **Generalises:** **yes**, to every zip with a committed government graph. The
  markup-cleaning is Wikipedia-wide, not article-specific.

### What both routes have in common, and it is the finding worth keeping

Neither is clever. Both are the same observation twice: **this project had
already paid for the bytes and had not read them.** 858 search hits and 80
leader entries were sitting in the tree, committed, while the fields they answer
were recorded at zero — and the previous session's conclusion from its exhausted
search quota was that the constraint was money. That is RULING 83's failure
recurring in a new place, and the cheapest route in the manifest is still the
one nobody walked.

---

## overnight-depth-0824 · 2026-08-24

**Five routes that did not exist at session start. Three returned rows, two
returned zero, and the two that returned zero are reported here as successes —
the invention is the deliverable, not the yield.**

### filed-email-domain — the right-hand side of the `@`

- **Conceived:** not from the manifest. From asking what data this project
  ALREADY HOLDS says beyond the field it was collected for. Contact at 07866
  stands at 272 of 272 because the Morris County Clerk publishes every
  candidate's filed email. Reading eight of them in a row: `tom@tomkean.com`,
  `rebecca@rebeccabennettforcongress.com`, `info@analiliafornj.com`,
  `bookerteam@corybooker.com`. **Seven of the eleven campaign sites this
  project already held were sitting inside an email address it had held since
  the filing was parsed.** Nothing had ever read the right-hand side of the `@`.
- **Query:** `data/ballot/nj-morris-2026-contacts.json` → for each of 272 rows,
  `https://<domain-of-filed-email>` where the domain is not a mailbox provider
  (33 of 272), plus `https://<campaign-shaped-local-part>.{com,org,net}` where
  the local part carries an office word (12 of 272). 69 URLs probed, each
  control-paired. Run: `WTP_STAMP=$(pnpm stamp) pnpm nj:email-domain`.
- **Returned:** 9 campaign sites, 1 official host, 1 party organ, 16
  not-a-candidacy, 42 no-answer. **One NEW: Gary Kapner**, 11 → 12 of 272.
- **Generalises:** to every jurisdiction whose filing carries an email — which
  is a state-by-state question, not a national one. New Jersey county clerks
  publish one; New Hampshire publishes a name and a town, so this route does
  not travel there and that is recorded rather than assumed.

### wikipedia-citation-follow — the footnote, not the article

- **Conceived:** by reading RULING 87 against the manifest and finding a gap
  between them. That ruling says *Wikipedia names the person; the citation
  proves them*. The manifest holds three Wikipedia routes and **every one reads
  the ARTICLE** — not one walks the footnote. So the ruling names a confirming
  step nothing was built to take, and nine municipal officials had sat at LEAD
  since 2026-08-23 waiting for it.
- **Query:** `https://en.wikipedia.org/w/api.php?action=query&redirects=1&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles=<article>`,
  then the `<ref>` URLs attached to the SENTENCE naming the person — never the
  article's whole reference list, which would confirm any person against any
  citation. Run: `WTP_STAMP=$(pnpm stamp) pnpm wiki:citation`.
- **Returned:** 9 of 9 leads walked. 2 CONFIRMED_OFFICIAL, 1 PRESS_CONFIRMED,
  4 CITATION_SILENT, 2 NO_CITATION.
- **Generalises:** to roughly 19,000 templated US municipality articles. The
  scoping-to-the-sentence is the portable part; what does not travel is which
  hosts count as official, which is answered per state.

### state-directory-as-official-host — an authority outside us

- **Conceived:** three towns' OWN homepages were being filed as press. A New
  Jersey municipality's site is very often on `.org`, and a TLD test calls that
  a newspaper. `CLAUDE.md` already anticipates it: official is decided against
  something outside us, including *the hosts the source wiring itself types as
  a body's own page*. The State of New Jersey publishes a directory of all 564
  municipalities with each one's website — already committed under RULING 93,
  and never used for this.
- **Query:** `data/hunt/tier-directories.json`, route `nj-localgov` — 624
  entities, 592 distinct hosts, read as the set of state-designated official
  hosts.
- **Returned:** `rockawaytownship.org` and `rockawayborough.org` reclassified
  from PRESS to OFFICIAL. It also caught a STALE citation: Wikipedia cites
  `denvillenj.org`; the state names `denvillenj.gov`.
- **Generalises:** to every state that publishes a municipal directory. The
  METHOD travels; the directory does not, and is enumerated per state.

### crt.sh certificate-transparency domain search — RETURNED ZERO

- **Conceived:** the previous session's constraint was a rate-limited search
  engine. Certificate transparency logs are a completely different dependency:
  every HTTPS domain issued a certificate appears in public CT logs, so
  "does this candidate have a site" can be asked of the logs instead of an
  engine — and CT finds UNLINKED sites, which is exactly the gap `domain-search`
  describes. D70 names the technique for enumerating Legistar tenants; nothing
  had used it for campaign-site discovery.
- **Query:** `https://crt.sh/?q=selenformorriscounty.com&output=json`
- **Returned:** **ZERO. `crt.sh` answers HTTP 502 from nginx**, twice, minutes
  apart. Its public Postgres interface is the other door and this repo has no
  Postgres client and no `psql`; adding one is a dependency, which is a side
  quest under RULING 89, so it was not taken. SSLMate's CertSpotter answers at
  200 and confirms a KNOWN domain, but takes no wildcard, so it cannot do
  discovery — which is the thing this route was invented for.
- **Generalises:** the idea does, to every candidate anywhere, if a
  wildcard-capable CT source can be reached. **Recorded as a wall around a
  known thing** (RULING 90.4): what is on the other side is the set of domains
  registered under a candidate's name, and the roads to it are crt.sh's web
  front end (502), its Postgres interface (no client), and a paid API (refused
  under RULING 83's free-source floor).

### mojeek-independent-index — RETURNED ZERO

- **Conceived:** RULING 52 says two routes that fail for the same reason are
  one route wearing two names. DuckDuckGo, Bing and Yahoo all walled the
  previous session — and all three are Bing-backed, so they were ONE
  dependency counted as three. Mojeek runs its own crawler, so it is a
  genuinely independent index.
- **Query:** `https://www.mojeek.com/search?q=%22Selen+for+Morris+County%22`,
  paired with the control `https://www.mojeek.com/search?q=%22Zzqxwvnonexistent99+for+Morris+County%22`
- **Returned:** **ZERO, and the CONTROL is what caught it.** Real and control
  came back 5,518 and 5,532 bytes — indistinguishable. Reading the page: *"You
  need to enable JavaScript"* over a **Captcha**. A byte-count check alone
  would have recorded a wall as a clean empty result. Captcha walls are NAMED,
  not defeated. Marginalia answers with real content and its index is small and
  non-commercial; Stract 404s; Brave and DDG-lite answer and were not walked
  further this session.
- **Generalises:** the PRINCIPLE does and is the durable part — count search
  dependencies by whose INDEX they are, not by how many brand names sit in
  front of it.

---

## rulings-sweep-0824 · 2026-08-24

Six routes that did not exist at session start. **Two returned rows, four
returned zero**, and RULING 88 counts all six: the invention is the deliverable,
not the yield.

### wikipedia-nh-election-articles — RETURNED ROWS

- **Conceived:** RULING 83 was adopted over a Rockaway Township encyclopedia
  page that six sessions never opened. The same reasoning had never been pointed
  at New Hampshire, where the owed set at 03255 is 19 candidates with no known
  campaign site — and the binding constraint is the SITE, because a site
  unlocks the photo, the blurb and the contact together. Hunting 19 individuals
  is Tier C; asking what one article says about all of them is Tier A.
- **Query, literally:**
  `https://en.wikipedia.org/w/api.php?action=parse&page=2026_United_States_House_of_Representatives_elections_in_New_Hampshire&prop=wikitext&format=json&redirects=1`
  and the same for `2026_United_States_Senate_election_in_New_Hampshire` and
  `2026_New_Hampshire_gubernatorial_election`. **Control:**
  `…&page=2026_Zzqxwv_Nonexistent_election…`, which returned
  `{"error":{"code":"missingtitle"}}` — so a 200 here is a document rather than
  a styled apology.
- **Returned:** **one campaign site this project did not hold** —
  `https://www.paigefornh.com/` for Paige Beauchemin. Treated as a LEAD under
  RULING 87 and PROVED by fetching the site itself: HTTP 200, 546,058 bytes,
  control strings `Beauchemin` ×24, `Paige` ×62, `Congress` ×19, negative
  control 0. That closed **three** owed fields for her — site, blurb and photo
  — from one Tier A read.
  A systematic sweep of every external link in all three articles, filtered
  against hosts already held and against news/PAC/aggregator domains, produced
  **no further site for anyone on the 03255 ballot**. The remaining
  candidate-shaped hosts belong to other New Hampshire districts.
- **Generalises:** yes, and it is the strongest route in this log. Every state
  has these articles, they are templated, and one parser reads all of them.

### fec-committee-contacts — RETURNED ROWS

- **Conceived:** RULING 90.5 — every AUTHENTICATED resource is walked before any
  unauthenticated one is exhausted. `FEC_API_KEY` is proven and 12 of the 31
  owed candidates at 03255 are federal. The candidate record carries a filed
  ADDRESS, which is not a contact; the COMMITTEE record carries the campaign's
  own filed email and website, which is.
- **Query, literally:**
  `https://api.open.fec.gov/v1/candidates/?state=NH&cycle=2026&per_page=100&sort=name&api_key=…`
  then `https://api.open.fec.gov/v1/candidate/<ID>/committees/?api_key=…` for
  each match.
- **Returned:** 65 New Hampshire 2026 candidates; **5 confirmed matches** to the
  owed set, each with a filed committee email and, for four of them, a website:
  Manzur, Nicholson, Orlando, Martin, Beauchemin. Most of those fields were
  already held, so the direct yield was corroboration rather than new rows —
  and the corroboration is what let two door-3 portraits ship with an
  independent check on identity.
- **The near-misses are the reason this is written down.** `SMITH, KEVIN H.` is
  not Sabrina Ann Smith, and `SAAL, MAXWELL LEAVY` is not Mary Maxwell — the
  surname sitting in the given-name field. A guessed identifier is a LEAD, and
  a route that matched on surname alone would have shipped two wrong people.
- **Generalises:** to every federal candidate in the country.

### sos-nh-rung-3 — RETURNED ROWS (a wall that fell)

- **Conceived:** the NH filings this product renders come from a Secretary of
  State PDF dated **7.16.26**, five weeks old with a September 8 primary. Under
  RULING 53 that is a document worth re-testing, and `sos.nh.gov` was recorded
  as needing rung 5.
- **Query, literally:** `https://www.sos.nh.gov/elections/candidates` at rung 2
  with an identified client — **403**. The same URL at **rung 3**, the full
  browser header set (`User-Agent` Chrome 151, `Accept`, `Accept-Language`,
  `Sec-Fetch-Dest/Mode/Site/User`, `Upgrade-Insecure-Requests`) — **200,
  232,664 bytes.** The committed filing PDF likewise: 403 at rung 2, **200 and
  473,945 bytes of real `application/pdf` at rung 3**.
- **Returned:** the host, which was recorded as needing a different EGRESS on
  2026-08-21, **answers at rung 3 today**. That is a rung, and it is cheaper
  than the one on record.
- **Generalises:** to every Drupal-hosted state government site that refuses a
  bare client. Recorded so no session pays rung 5's price for a rung 3 wall.

### nhjournal-filing-compilation — RETURNED ZERO OWED FIELDS

- **Conceived:** the stuck protocol's fourth move — *who else needed this badly
  enough to have compiled it already?* Local political press covers a filing
  deadline candidate by candidate, which is precisely the enumeration the owed
  set needs.
- **Query, literally:**
  `https://nhjournal.com/2026-candidate-filing-update-whos-in-whos-out/`
- **Returned:** **ZERO owed fields.** HTTP 200, 61,397 bytes; 4 of 19 owed names
  present. It gives home towns — Jarvis of Manchester, Sabrina Ann Smith of
  Pittsfield, Alciere of Hudson — and no website, email or photograph for
  anybody. The towns are worth having as a disambiguator for a later search and
  they close nothing.
- **Generalises:** the SHAPE does — every state has this outlet. The yield
  should be expected to be identity corroboration rather than contact detail.

### gc-roster-cross-match — RETURNED ZERO, AND RE-CONFIRMED AN OLD FINDING

- **Conceived:** the stuck protocol's third move — *test the shape, not the
  instance.* County-office candidates in New Hampshire are frequently sitting
  state representatives, and a sitting member has an official page, a
  `@gc.nh.gov` address and a chamber portrait. If the shape holds, one join
  closes contacts and photos for several people at once.
- **Query, literally:** a surname-and-given-name match of the 03255 owed set
  against the 7,977 rows of `data/reference/openstates_legislators.csv`,
  filtered to New Hampshire.
- **Returned:** **ZERO owed fields, and the reason is the finding.** Five
  apparent hits, four of them surname collisions with different given names —
  Arnie Davis and Fred Davis are not Erica S. Davis, Bryan Morse is not Samantha
  Morse, Tanya Donnelly is not Kathleen Donnelly. The fifth, Karen Ebel, is
  real and her contact was already held. This **re-confirms on 2026-08-24**
  what `NH49` recorded on 2026-08-21: the General Court roster reaches none of
  the county challengers. An expired absence, re-tested rather than trusted.
- **Generalises:** the technique does. The negative result is specific to this
  ballot and has a shelf life.

### certified-winners-against-rosters — RETURNED ROWS

- **Conceived:** `NH73`. One stale encyclopedia roster was found by hand; a
  defect found by name is the start of a class sweep and never the end of one.
- **Query, literally:** `pnpm roster:stale` — 263 certified winners from the
  Morris County Clerk against the 271 people this project holds on Morris body
  rosters, matched on a hard-normalised first-and-last name.
- **Returned:** a **three-way** split over 234 municipal winners — 99 CONFIRMED,
  **45 POSSIBLY STALE**, 90 NO ROSTER HELD.
- **The first version of this route was wrong and the correction is the point.**
  It reported 135 MISSING, which read as 135 stale rosters. It is not: for 90 of
  them this project holds **no roster for that municipality at all**, which is a
  COVERAGE gap and not a correctness defect. Denville — the instance `NH73` was
  opened over — is in that 90: Zimmermann, Venis and Cote are absent because
  there is nothing there, not because what is there is wrong. Reporting one
  number would have been RULING 105's failure exactly.
- **Generalises:** to any county publishing certified winners, which is all of
  them.

## state-money-0824 · 2026-08-24

Seven routes conceived that did not exist at session start. **Three returned
rows, four returned zero, and all seven are reported** — the invention is the
deliverable.

### The NJ ELEC per-entity filing endpoint — where the money actually is

- **Conceived:** by disbelieving a number rather than by walking a list. The
  committee listing returns `TOT_CONT_AMT` on every row and every value was
  `0`. Instead of recording that as "these candidates raised nothing", the
  question asked was *is this field ever non-zero for anybody, ever?* — so a
  COMPLETED cycle was used as a control, which is a question no route in the
  manifest tells you to ask.
- **Query:** `POST https://www.njelecefilesearch.com/api/VWEntity/Entities20`
  for location codes `1435`, `1432` and `1400` across election years `2026`,
  `2025`, `2024` and `2023` — twelve location-years — then
  `GET https://www.njelecefilesearch.com/api/VWEntity/GetEntityFilingData?ENTITY_S=399070&EntityOnly=true`
- **Returned:** the control proved the field is **always zero, in all twelve
  location-years, 158 rows**, including cycles finished years ago whose
  candidates demonstrably raised six figures. The filing endpoint then returned
  **26 filings for entity 399070 summing $204,571.68**. Across the session:
  **297 calls, 0 failures, 58 candidacies with real figures.**
- **Generalises:** YES, to every NJ ELEC entity and therefore to every New
  Jersey candidate at every level. It is the difference between the whole route
  being a false zero and the whole route working.

### The amendment collapse — a total that reconciles is not a total that is correct

- **Conceived:** by reading the filing rows rather than summing them. Ann
  Grossi's 2023 committee shows `R-1 period 3` **twice**, same receipts,
  different disbursements. A `SUM()` over that is wrong and looks perfect.
- **Query:** `GET .../GetEntityFilingData?ENTITY_S=449927&EntityOnly=true`, then
  the same for `446812`, comparing `(FormName, PERIOD, AMEND_NO)` tuples.
- **Returned:** naive summing gives Grossi **$237,109.54**; collapsing to the
  highest `AMEND_NO` per `(form, period)` is lower and correct. Also settled the
  period-vs-cumulative question by measurement — DeGroot's `R-1` period 5 is
  **$24,977.25** against period 3's **$39,777.95**, and a cumulative series
  cannot decrease.
- **Generalises:** YES, to any filing system that publishes amendments as
  separate rows, which is most of them.

### The D-1-only committee — registered is not reported

- **Conceived:** from the same disbelief, one floor down. After the filing
  endpoint landed, **63 of 73 records still read $0**. A `D-1` is a certificate
  of organization; it registers a committee and says nothing about money.
- **Query:** grouping the returned filings by `FormName` across all 297 entities.
- **Returned:** **5 candidacies moved out of `FILED`** and into a sourced
  absence. Small, and it is five named people who would have been shown "raised
  $0" when they had reported nothing at all.
- **Generalises:** YES — every state has a registration form distinct from its
  financial reports, and counting it as a financial report is the same error.

### Reading a walled SPA's API out of its own JavaScript bundle

- **Conceived:** rung 6 is refused at `cfs.sos.nh.gov`, so the page's own
  network calls cannot be OBSERVED — but the bundle that would make them is
  served at rung 2, and it names its endpoints in plain text.
- **Query:** `GET https://cfs.sos.nh.gov/main-AHN3BUTJ.js` and each of the
  thirteen `chunk-*.js` files named in `index.html`, searched for `/api/`.
- **Returned:** **ZERO API paths.** The bundles surfaced only
  `/GetEventLogDetails`, `/dashboard` and three `/lobbyist/...` routes. The
  campaign-finance endpoints are in lazy route chunks this pass did not locate.
- **Generalises:** YES as a TECHNIQUE — it is rung 7 obtained without rung 6,
  which matters for every JS-rendered source behind an edge filter. It did not
  work here and it is reported as invented rather than as successful.

### The client-fingerprint inversion — the browser is not always the strongest rung

- **Conceived:** by noticing a contradiction in my own measurements rather than
  picking one. curl said 403 and Node's `fetch` said 200 against the same host
  minutes apart, so the variable had to be the client.
- **Query:** the same URL, `https://cfs.sos.nh.gov/`, through four clients —
  `curl` with a browser UA, Node `fetch` bare, Node `fetch` with the full
  browser header set, and Playwright Chromium — plus a header-isolation control
  sending and withholding `x-wtp-synthetic-run`.
- **Returned:** **curl 403 · Playwright Chromium 403 · Node `fetch` 200 (65,928
  bytes), with or without our header.** The ladder's rung 6 is the WEAKEST rung
  against this edge and rung 4 is the strongest.
- **Generalises:** YES, and it inverts an assumption this project has been
  carrying. Rung 6 is described as the rung a wall falls to; here it is the rung
  that trips the wall.

### The AZ SeeTheMoney data endpoint

- **Conceived:** by asking where the portal's own table gets its rows, given the
  Secretary of State's campaign-finance path is a 404.
- **Query:** `POST https://seethemoney.az.gov/Reporting/GetNEWTableData` and
  `POST .../GetDetailedTableData`, plus `/robots.txt` and
  `/PublicResources/TermsOfUse`.
- **Returned:** `GetNEWTableData` **HTTP 200 with a two-byte empty body** —
  live, parameters not determined. `GetDetailedTableData` **404**, so the name
  is exact. `robots.txt` **404** and the terms path **404**.
- **Generalises:** to Arizona, and the ASP.NET MVC shell it exposes predicts the
  parameter names are the controller action's own argument names.

### The FEC directory as the 50-state agency seed

- **Conceived:** by refusing the brief's premise. It proposed seeding a
  directory from CFI's `stateLinks` page. Before fetching it, the question was
  *what does the tier above already publish about this* (RULING 93) — and the
  answer had been sitting in `data/reference/` since 2026-08-22.
- **Query:** `GET http://www.cfinst.org/state/stateLinks.aspx`, then parsing the
  committed `fec_combined_federal_state_disclosure_directory.csv`.
- **Returned:** CFI's page is **HTTP 404** and `www.cfinst.org` fails TLS
  entirely — the proposed seed does not exist. The committed directory yielded
  **56 jurisdictions, 56 with a campaign-finance office named, 45 URLs alive,
  44 control-matched, 10 refused or dead.**
- **Generalises:** YES, to all 56 jurisdictions and to every future state hunt.

### The stuck protocol, where it ran

Run for the two fields that ended the session unfound — **NH per-candidate
totals** and **AZ per-candidate totals**. Both are recorded with their literal
queries in `docs/sources.md` and
`docs/arizona-source-enumeration.md`. **2 stuck protocols run; 0 fields
returned to owed for a missing one.**

*What would I try if there were no manifest at all?* For New Hampshire: type
`nh campaign finance reports search` into a search box and click the first
government result. That is what produced
`https://sos.nh.gov/elections/campaign-finance/` — **HTTP 200, 2.95 MB** — which
carries the reporting-law notice, the contribution-limit schedule, and
**individual filed reports published directly as PDFs**. The PDF series is a
route to New Hampshire's money that does not go through the walled application
at all, and it is named here as the next branch rather than walked.
