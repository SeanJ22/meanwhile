# The session map — built from the author's 117 dispositions

2026-08-17. Source: `docs/deferred.csv`, Disposition column, read in full.
Every ruling folded as written; nothing relitigated.

**Updated after g7 (PR #71):** Queue 0 is DONE — M120, G09, M131, R16,
R17, R02, V02, B06 closed; T04, T03, D03 recorded; T10 deliberate
non-ruling. Queue 1 partial: R01, R19, R18, R08, R11, the stamp
allowlist, and the build-stamp endpoint shipped; the remaining
thirteen Queue 1 sub-items and all of Queues 2–3 carry to g8. New
rows from g7: R33 (this file was missing from the repo — resolved by
this commit), R34 (Neon local branch, author console action), R35
(eight rows cite branch `claude/apple-clean-0816`, which never
existed).

**Updated after g8 (PR #74):** R23 closed (the Turbopack trace — the
deploy that had been stale since `main@a8f7ff2` landed), G04 closed (the
walk counts rows LANDED, not requests issued), R38 answered clean and
its precondition put in place, B01 interim shipped (the display name is
**Meanwhile** on every on-site surface, the repo name and every off-site
identifier deliberately unchanged), R22 rebuilt after the build stamp
was found incapable of its one measurement. New rows from g8: R36 (the
connection string named READONLY is not read-only), R39 and R40 (the
author's production feedback of 2026-08-17), both deferred whole with
their specs intact.

**Updated after g9 (this session):** R39 and R40 **closed** — the phone
pill across all 531 multi-number officials, and the personal address out
of the product with the in-app feedback form and its own store in its
place. M19 **closed** to the author's spiderfy ruling. The walk's
identity set is 100% distinct and a shared identity is a named
regression now. R36 **verified and still open** — the readonly
credentials went into the wrong `.env.local` line, so the variable named
READONLY still connects as `neondb_owner` with full write and DDL. New
rows from g9: R41 (should the feedback form collect an optional reply
address — a user-data-field decision, the author's), R42 (the local
`DATABASE_URL` cannot authenticate, so no local run can prove a write).
**Still carrying:** item 5's remaining six — D19, D18, D24, D31, M12,
D22 — and all five of the g7 item 4–8 block (the ask surface, G05, G07,
D35, and the fourteen finish-now rows).

**Updated after g10 (this session):** Four data rows **closed** — D19
(sitting-as persistence and the live ingest path, which found SEVEN
special districts inside a county feed that exposes four bodies), D18
(twelve real public meetings held online, recovered from being dropped
at normalize and rendered without a pin), D24 (the canonical
reconciliation joined on Census GEOID; the 64 slug-similarity matches
are gone and all 229 remaining gaps carry a stated reason), D31 (the
curated-identifier convention settled against opencivicdata's own list,
with both named consequences fixed). **R36 and R42 both stay open**: the
author swapped the variable NAMES without swapping the hosts, so the
readonly string now sits on the local branch and authenticates nowhere —
which also left this session with **no handle to the production
database**, so the run-id census could not be run. R42's own defect is
fixed and proven by `pnpm verify:local-write`. **R41 has no ruling
recorded anywhere in the repo**, so nothing was built and the shape
stays as g9 specced it. **Still carrying:** item 5's remaining two — M12
and D22 — and all five of the g7 item 4–8 block (the ask surface, G05,
G07, D35, and the fourteen finish-now rows).

The deck is clear: **every row has a disposition.** Under the author's
ruling, H is unblocked the moment the pre-H queue below is worked — and
several of your dispositions put items *inside* H itself, so H grows.

---

**Updated after g11 (this session):** **R36 and R42 both CLOSED.** The author
corrected the host, `pnpm verify:readonly` passes all thirteen checks and
`pnpm verify:local-write` passes all of its including branch separation — so
the production run-id census ran for the first time since the marker shipped
(`search_log` 3,888 rows: 0 organic, 1,026 synthetic, 2,845 unknown, 17
author, reconciling exactly, across 52 runs), and `pnpm feedback:read
--target=production` works. The census is now a command, `pnpm census:runs`.
**The one sanctioned production write handle exists and is proven** —
`WTP_PRODUCTION_DATABASE_URL_WRITE`, resolved through `lib/db/write-handle.ts`,
which refuses the READONLY variable by name and refuses any read-only string in
any variable, both planted and demonstrated at the unit and at the script.
`searchlog:backmark` moved onto it: until today a variable named read was this
repo's actual write path to production. **Migrations 0006, 0007 and 0008
applied to production** through that handle and verified by column query; the
production journal holds 9 of 9. **R41 CLOSED and built** on the author's
ruling A — one optional reply field, its own nullable column on the feedback
table alone, stored unscrubbed because the reader typed it into a box that
asked for it, with the message body's T09 scrub unchanged and pinned at
exactly one call. The form's flat promise that nobody can write back is now
true of one case only, and the page and the confirmation both say which case
the reader is in. **M12 CLOSED** — the school overlay splits into unified /
elementary / secondary, with the class audited at all three sites that mapped
a division to a map layer. **D22 CLOSED AS A FINDING**: no live NovusAgenda
tenant exists in scope, established by sweeping 23 candidate tenants rather
than re-reading one body — and 22 of them answer HTTP 200 with the vendor's own
error page, because NovusAgenda wildcards its per-client subdomain namespace.
That is now a playbook rung. **G05 rule 4d CLOSED** — the router learns four
in-app destinations (ballot, meetings, districts, contact) and the ask copy
reads its promises from the routes, so the copy cannot name what the router
cannot route. **Still carrying:** the rest of the g7 item 4–8 block — A01, A02
and M119 (item 4's remaining halves, with A06 and A07 verified working but
specced to close in A01's PR), G05's other six rules, G07, D35, and the
fourteen finish-now rows.

## Queue 0 — Closures and recordings (one small task, no build)

These commit to the tracker and are done. One pasteable task closes all
of them in a single run.

| Row | Your ruling | Action |
|---|---|---|
| M120 | Close — hasn't reproduced | Status → Done (not reproduced) |
| G09 | Close — this is resolved | Status → Done. **This also closes Q1 and Q2**: no ramp measurement, no sixteen frames, the two `measure:focus` could-not-run checks stay recorded as could-not-run permanently |
| M131 | Light mode looks fine — keep as is | Status → Done (author-accepted) |
| R16 | Accept as stands | Status → Done (allowlist accepted, 81 SUSPICIOUS entries stand) |
| R17 | Close | Status → Done |
| R02 | (You were unsure of the ask) | The ask was "is anything left, or close it" — the work shipped long ago. **Close as Done** |
| V02 | Already used, no issues | Status → Done |
| B06 | Idea on 8/7/2026 | Record the date in the row, Status → Done |
| T04 | Never to solely one side, equal offers always made | **Ruling recorded in the tracker now**; published on the transparency page when T01 un-tables |
| T03 | Full review does not happen before open | **Ruling recorded as accepted risk** — see flag 3 below |
| R18 | No — use EST as standard | Generated-at lines carry EST; small config change, rides with Queue 1 |
| R19 | Raise the number | Rides with Queue 1 |

## Queue 1 — Do now: repo, truth, and small fixes (1–2 sessions)

Your "now" rulings that are small, independent, and unblock everything
else. Includes the six items you ruled on earlier in this chat that were
never built.

**From earlier rulings, still unbuilt:** the `.env.local` / production
database split (P0 — a browser tab can still write unmarked rows into the
sellable table), the `schedulepage` → human-name rename, `walk:all`
reporting check identities instead of a count, the two stamp-audit
allowlists, and the build-stamp endpoint.

**From the sheet:** R01 (CLAUDE.md clobber guard — "approved, build now"),
R05 (map layer tests now), R08 (harden mirror comparison now), R23
(Turbopack warning — fix now), R19, R18, G04 (walk counts rows landed,
not requests issued), M19 (overlapping pins — fix now), D19 (sitting-as
attribution — fix now; the join is built, persistence and live-path are
the remainder), M12 (split the school overlay), D18 (virtual meetings
render as "online" with join info), D24 (chase the 348 OCD matches), D31
(settle the curated-ID convention, keep them in), D22 (NovusAgenda
adapter), R11 (branch-exists check — pre H), B01 interim rename (flag 2
below).

## Queue 2 — g7: the interface and ask-surface session (series)

Your interface pass plus everything you ruled into it. This is more than
one session; under the deferral rule it runs as g7, g7b… with the
boundary between items.

**Queue 2 is now MOSTLY CLOSED (g12, 2026-08-17).** The interface half and
the ask half are done: G05 closes at 7 of 7 rules, G07 shipped with 4a as
its designed compensation, D35 is built, and the consolidated ask surface
closed A01, A02, A06, A07 and M119 in one PR under your matcher ruling.
M134 and M93 are done. **Eleven rows remain and they are the whole of what
is left in this queue** — struck through below as they closed.

- ~~**G05** — rules 4a–4f and 4h, whole ("Build Pre H")~~ **DONE (g11 4d,
  g12 the rest)**
- ~~**G07** — the pill label ("Build in G7")~~ **DONE (g12)** — labels and
  the widths that forced them in `lib/routing/ask-pill-labels.ts`
- ~~**D35** — positions three-answer machinery ("Build in G7")~~ **DONE
  (g12)**
- ~~**The ask surface, consolidated into ONE build** (flag 1): **A01** +
  **A02** + **M119** + **A07** + **A06**~~ **DONE (g12)**, in one PR, under
  your matcher ruling: strong-match keywords, exact names, the classifier
  behind its ripcord for everything weaker, and the refusal with the
  destinations offered when it is unavailable
- ~~**M134** — a Yes becomes the pick ("build now")~~ **DONE (g12)**
- **M136** — body battlecards ("build now and deploy with what we already
  have; continue to add")
- **M139** — the half-load and the load budget ("finish now")
- **M135** — the every-row-opens-a-card audit ("finish now")
- **M07** — returning-user state, per your adjustment: remember the zip
  but force re-entry on return; never assume the district
- **B15** — the laws half of key votes ("do now — finish laws")
- **G10** — 8a's remainder ("finish now")
- **P01** — measure decomposition into provisions ("finish now")
- **P03** — reaction extensions to measures and positions ("finish now")
- **D25** — comment access, keep curating at scale ("do now")
- **D29** — Tucson's 56 boards wired through ("finish now")
- **D06** — funding tracker unblocked per your ruling (flag 4)
- ~~**M93** — I owe you a default-vs-one-tap-down proposal for the WGH
  card; you rule and it builds post H~~ **PROPOSAL WRITTEN (g12)** — in
  `docs/DESIGN.md`, nothing built. **It ends with one question that is
  yours:** whether an EMPTY section collapses closed with its honest line
  inside, or stays open showing it. The battlecard chose to stay open; this
  card carries more sections, so the same choice costs more space here —
  and the crowding is why the row exists.

## Queue 3 — Post-g7, pre-H

Everything you stamped "pre H" or "post G7, pre H":

**A03, A04, A05** (data-center search, contact routing, docket
summaries — post G7, pre H) · **B14** (blurb-equalization sweep — post
G7) · **B19 + B16** (polling place in-app, siblings, built together —
your B16 ruling accepts the accuracy bar with SoS / Vote411 / whatever
works, reader stays in app) · **D05** (candidate info, PRL-fed — pre H,
post G7) · **D52** (state campaign finance: **NH, AZ, NJ in that
order** — pre H) · **D62** (PRL adopted — "yes, probably will use PRL
downloads"; feeds D05) · **M81** (jurisdiction badge — pre H) · **M95**
(governors' term end and age — pre H) · **P02** (ballot mapping — pre H)
· **D47** (state comparison — pre H) · **H03** (the re-walk cohort —
post G7, pre H; the H prefix is its ID, not its queue, and it has been
in this queue all along) · **M123** (Kearsarge towns — "wire them in
now"; moves here from h2's brief since you've pulled it forward) ·
**D50** (photos to 750, with rungs generated so it scales — moved here
2026-08-18, g19: "Finish to 750, generate rungs so it can be done at
scale" is a pre-H build and it was sitting in Queue 4) · **D03's
three-state half** (NH, AZ, NJ — moved here 2026-08-18 for the same
reason; the remaining 47 states stay in Queue 4)

**Moved OUT of this queue 2026-08-18 (g19):** P06, P07 and P08 are
TABLED by your ruling and now sit in Queue 6. Their "What do I do now?"
consolidation is recorded there, not lost.

## Queue 4 — H itself (the hunt, briefs already written)

h2 / h3 / h4 stand, amended by your rulings:

- **H01** — "sweep scheduled for H" (h3)
- **H02** — the denominator states what's found; readers who know of a
  missing body are pointed at the **feedback link (to be built)** — this
  adds a small build to h2's spec
- **H04** — "schedule in H" (h4, all 47, no tiers — unchanged)
- **D36** — the 29 NOT_ATTEMPTED candidate-link hunts ("run hunts in H")
- **D46** — prop sponsor attribution ("build in H")
- **X07** — the Facebook-as-campaign-site sweep ("run sweep, defer to H")
- **D08** — ballot source hunt ("find other sources, defer to H")
- **D03** — the REMAINING 47 states only. The three-state half moved to
  Queue 3 on 2026-08-18 (g19), where its disposition always put it, and
  has since been confirmed shipped: NH, AZ and NJ all serve state roll
  calls today. What is deferred to H is the other 47.

*(**D50** moved to Queue 3 on 2026-08-18 — see the note there.)*

## Queue 5 — Post-H

B18 · C01 · C02 · C03 · C04 · D04 · D07 · D51 · H05 ("attempt other
routes, report back, post H build") · H06 · M13 · M18 (address at the
time; ideally fix derivation) · M75 (legend-as-pill design, measure and
fix) · M92 · M93's build · P04 · P05 · P10 (**Marana** as the second
jurisdiction) · T07 · V03 · V04 · V06 · V08

## Queue 6 — Tabled / non-code / kept in tracker

**P06 + P07 + P08** — tabled 2026-08-18 (g19), your ruling. They were
in Queue 3 as the consolidated **"What do I do now?" link** — one
surface answering all three — and that consolidation is the shape they
come back in if they come back. Nothing about them is deleted; they are
tabled, not closed, and the tracker rows stand.


Per your rulings, no scheduling: B02 (waits on the name) · B03 · B04 ·
B05 · B07 · B08 · B09 · D23 (tabled for lawyer) · T01 · T02 · T06 ·
P09 ("maybe, depending on sourcing — table") · P12 · V01 · V05 · V07 ·
X02 · X03 · T10 (fires at testing end) · R13 (rule kept, anchor stands)

---

## Flags — each raised once, then folded as you rule

**1 — The ask surface is one build wearing six IDs.** A01, A02, A07,
M119, A06, and G05's rule 4d all describe the same surface: one input,
keyword-first, routing to curated answers, refusing without a source,
logging from day one. Building them as separate rows would produce six
partial versions of one thing. The map consolidates them into a single
g7 build; the tracker rows all close against it.

**2 — "Meanwhile" as the interim name.** Your B01 ruling renames the
product across all spots while B02 says the trademark search waits. The
standing rule is no name committed before USPTO classes 9 and 42. An
interim name *appearing publicly* is a soft commitment — testers and any
early coverage will attach to it. The rename is queued as ruled; if you
want "Meanwhile" internal-only until B02 runs, say so in one line.

**3 — T03 is an accepted risk and connects to three tabled rows.** No
full security review before open, with T02 (verification), T05 (abuse
review), and T06 (calibration) all tabled. Together that means the
reaction store opens on demo-grade hardening with anonymous-tier rows
only. That's a coherent position — tier-weighting was always the design
— but it's the bot-flooding surface Victoria named on day one, so it's
recorded here as your accepted risk rather than an oversight.

**4 — D06 unblocked, with the structural rule intact.** Your ruling
unblocks the funding tracker; the settled FEC posture stands unchanged:
reader-facing display is protected accountability use, and contributor
data never enters anything sold — that's structural, not a per-feature
decision. D23's counsel question stays tabled and doesn't block the
build.

**5 — One typo to confirm.** D03 reads "finish for only NH, NH, AZ" —
taken as **NH, NJ, AZ**, matching the three covered states. Say
otherwise if you meant it.

**6 — T05, answered for you to confirm.** You wrote "unsure what the ask
is." The ask: does a human abuse-review path exist before free-text
comments open? Since P03's free-text remainder is in your "finish now"
pile, this becomes load-bearing — the map assumes **free text does not
ship until the review path exists**, which is what the abuse policy
already promises. Overrule in one line if you want free text sooner.

---

## g13 — 2026-08-18. What changed for you

**1 — Both dead scheduled jobs are alive, and verified by running them.**
The intake tripwire and the meetings refresh had each been failing on
schedule. Both are fixed and both were dispatched for real rather than
reasoned about: the tripwire purged 1 limiter row (11 remain) and committed
its report; the refresh wrote 202 fresh + 24 carried = 226 total with all
ten sources reachable. Neither guard was loosened — in both cases the guard
was correct and the thing it guarded had never been taught to declare
itself.

**2 — R47 is a P0 you should know about before the walkthrough.** At 85701,
zooming all the way out wipes every pin. `pnpm walk:all` catches it and is
red until it is fixed. Half the diagnosis is done and written down: the
server is innocent — 89, 97, 97 meetings across the radius rungs, monotonic
— so the pins are being dropped on the client. The other half is not
guessed at, and the row says where to start. It was found by the standing
suite, which is exactly what that suite is for.

**3 — Body cards now say what a body can decide.** Seven sections, and the
prose behind "what this body does" is a paraphrase of a statute or charter
read on the day, cited with its URL. Arizona's county and school-district
classes and Tucson's charter are entered. **New Hampshire is not** — those
bodies render the honest absence line until somebody reads RSA 28, 47 and
189. There is deliberately no national default, because what a county board
does is a different answer in fifty states and one plausible sentence would
be wrong somewhere without ever saying so.

**4 — The eleven finish-now rows are now ten, and that is the denominator.**
M136 is done. The two P0 jobs took the front of the session by instruction
and by weight; the remaining ten are deferred whole, not thinned and not
partially built, each with its spec intact. The next brief carries them in
the same order.

**5 — Two small rows opened, not fixed, deliberately.** R45: the Node 20 →
24 forced-actions warning on every workflow run (`actions/checkout@v4` and
`actions/setup-node@v4` need version bumps). R46: `"type": "module"` in
`package.json` would silence the warning on every test file, but it is a
package-wide change to module resolution and wants deliberate evaluation,
not a reflex edit. Both rows say what to check before touching them.


**Updated after g14 (2026-08-18):** Items 0 and 1 whole, item 2 at 1 row of
10. **R45** and **R46** both close — the action pins land on **v7, not the v5
the row named**, because setup-node v5 auto-caches on a `packageManager`
field and pnpm is not on the runner until `corepack enable` runs after it;
and `"type": "module"` goes in after an enumeration that found the repo has
**no `.js` or `.cjs` files at all** (112 warnings per test run → 0).
**R47** closes, and the row's own reading was overturned: the pin wipe was
**4 of 4 runs**, not 1 of 2 — a deterministic 200–500 ms gap while the
re-query is in flight, seen only sometimes because the walk sampled once per
zoom. The pins now carry the last answer through the gap, scoped so they
never carry across a zip change. **M139** closes whole: the half-load was one
missing effect dependency (`ensureDistricts` reads the active state through a
**ref**, so nothing re-ran the pass when the state resolved — and
`exhaustive-deps` cannot see a ref); the zip pill's square-inside-a-round is
fixed on both halves; the districts door is two sections with a count each,
**without** the row's "Districts in this zip" wording, which a ZCTA cannot
support; and the load budget is measured on production with a cold cache, all
four surfaces PASS. **R43 and R44 are named here for the first time** — both
opened and closed by g13, never reported under their row ids: the tripwire's
refused purge and the carry-forward archive clip. Neither is outstanding.
**Nine rows carry to the next brief in the same order** — M135, M07, B15,
G10/8a, P01, P03, D25, D29, D06 — deferred whole, each with its spec intact.

---

## g15 — 2026-08-18. What changed for you

**The external audit is in the tracker as nine rows, `AUD01`–`AUD09`, each with
your disposition on it.** The audit document itself is NOT here — the brief says
to commit it from your Drive copy and it is in neither the repo nor the mirror,
so every row records that its content came from the brief and names what is
missing (the evidence citations, except AUD04's). The IDs drop the dash because
`tests/tracker-integrity.test.ts` requires `^[A-Z]+\d+$`; each row carries the
audit's own label in prose rather than weakening that guard.

**The stack question is closed in writing** (`AUD01`, Done) at state.md §4.13 —
no migration without a new ruling, and the reasoning kept is that this product's
bottlenecks are algorithmic rather than linguistic.

**Three of our own numbers had stopped describing the code, and all three are
fixed.** The commands table said 371 tests dated today; the true count is
**993**, and 371 had simply stopped being updated while sessions kept adding
tests — it drifted by 622. "Allowlisted warnings" was a word with no mechanism,
and now has one: `lint-allowlist.json` plus `corepack pnpm lint:allowlist`,
which refuses a warning that is not listed with a reason. And "largest bundle
927 files" was never a bundle size — it is the file count in a server trace
manifest, and every standing report had been reading it as reader JavaScript.

**Two budgets replace that one figure from here on**, and both belong in future
reports: server trace cardinality **927 files** (ceiling 1050), and the actual
client cost for `/` — **2,861,445 bytes of initial JavaScript, 861,210 gzip**,
of which **MapLibre is 75%**. MapLibre is tracked apart and counted in the
total, never excluded, per your instruction.

**`/api/meetings` now resolves the governing geography once instead of twice** —
measured, 2 point-in-polygon sweeps per request before, 1 after — with the four
pilot zips plus one out-of-coverage point proven **byte-identical** before and
after.

**Both scheduled refreshes stop running the suite against data that did not
move.** Proven by dispatch on both branches, run ids in the report.

**Four queue rows landed, five did not, and none is half-built.** M135's audit
finished across all seven list surfaces and found the ask panel's autocomplete
leaving **21 of 227 rows answering a click with silence** — now 2, both named
refusals. M07 done. B15 done, and the remainder it kept describing had already
been closed three days earlier by B17 — the row was never updated, so a stale
gap propagated into two later documents and into this brief. G10 8a reported
with its numbers, and its dark-theme failures turned out to be the instrument's,
not the map's.

**Five rows carry forward, deferred whole with specs intact** — **P01, P03,
D25, D29, D06**. This session took items 2 and 3 ahead of them, which is a
deviation from the brief's stated order; the reasoning is in the report and in
state.md, and it is yours to overrule.

**Needs your hands** is in the report, and it is short: the place-row card is a
design decision nobody but you should make, and the `^_` lint pattern is a
config line rather than an edit.

---

## g16 — 2026-08-18: the deploy landed, the leak class closed, the measures came apart

**The deploy is live.** Production had been serving `bf0cd7b` — a snapshot-refresh
commit from before g15 — and now serves this session's merges. The PR-merge
trigger worked inside the handoff gate's own five-minute window, which answers
the half of R51 that g15 had to leave open.

**The budget refusal was correct and is now explained to the file.** Netlify
builds in standalone mode, which this repo had never measured: 927 windows
default, 935 linux default, 1130 windows standalone, **1138 linux standalone** —
and 1138 is the only one of the four that describes a deploy. The 203 files that
join are all `node_modules/next/dist`, none of them ours, every app manifest
byte-identical. **The ceiling was not raised to get green.** Budget 1 is now two
numbers — the largest APP manifest (195, ceiling 240, the number R23 blew up)
and the framework runtime trace baselined per mode — because the old single
maximum could have stayed green while an app route grew from 195 files to 900.

**The leak class is closed at one construction site.** 45 scripts open browsers
through `scripts/browser.mts`; a test refuses any other construction, and a
second test proves non-leak by *running* it, with a permanent plant that must
keep leaking. The old guard was deleted: it asserted a constant appears in
source, which every leaking script satisfied. A new measurement narrows the
diagnosis — the header survives a live beacon and is lost only on the **unload**
path.

**36 fixed waits down to 12**, each survivor justified in one of three named
forms and guarded both ways. The first conversion filed **thirteen false
regressions** by settling on a canvas that mounts instantly; the fix and the
lesson are both at the helper.

**Item 3 completed 1 of 5 rows.** P01 is done — all 11 AZ measures decomposed
into **52 contested provisions** from the Legislative Council's own enumeration,
rendered between the summary and the official text, every id already the
reaction target P03 will attach to. **P03, D25, D29 and D06 were not started**
and carry forward whole. **Item 4 completed 1 of 3** — the audit document landed
and all nine AUD rows have their citations; the place card and the `^_` config
line were not built.

**Your testing pass arrived mid-session and is recorded whole, not built.**
`docs/Feedback 8.18 1421 pm.docx` and 29 screenshots, roughly forty findings, on
tracker row **F01**. One of them is a data claim rather than a UI one and is
called out separately: the New Hampshire card says Kearsarge could not be reached
while the New London pin shows its meetings.
