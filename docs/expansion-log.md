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
