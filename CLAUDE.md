# CLAUDE.md

Civic app, two halves. Consumer side shows what's on a user's ballot with sourced candidate positions, translates ballot measures into plain language, and alerts users to nearby local government meetings. Data side captures user reactions and sells anonymized aggregates to political organizations. Consumers never pay.

## Stack

**This section names DECISIONS, never versions.** (Rewritten 2026-08-20,
Prompt C item 4.3.) A framework version written here goes stale the next time
anyone runs an upgrade, and a stale constitution is worse than a short one — a
session reads it as current and builds against a fact that is no longer true.
So the shelf-life content lives where it is authoritative and this points at it:
**`package.json` and `pnpm-lock.yaml`** for what is installed, **`netlify.toml`**
for how the deploy builds, **`next.config.ts`** for what the build does, and
**`drizzle.config.ts`** for the database wiring.

What does not drift, and is therefore law:

- Next.js (App Router) + TypeScript + React.
- Tailwind + shadcn/ui. The design tokens are committed — see the design-system
  rule below.
- Postgres on Neon, accessed through Drizzle. **Schema changes go through
  Drizzle migrations; no hand-edited SQL against the database**, and a
  migration is applied with `pnpm db:apply`.
- **Deployed on NETLIFY.** Not Vercel — the file said Vercel for months and it
  was never true of this repo. The build Netlify runs is the literal command in
  `netlify.toml`, and `.github/workflows/build-check.yml` runs that same string
  on every push so a refused build is readable without the author's Netlify
  login.
- **The scheduler is GitHub Actions, not platform cron.** **THREE workflows are
  SCHEDULED and EIGHT can push `main`, and the two numbers are different on
  purpose** (corrected 2026-08-24, RULING 124). The five data refreshers keep
  their `workflow_dispatch` and their push, so a source stays runnable by hand;
  what they lost is their cron. Every source's schedule now lives in
  **`refresh-daily.yml`** — one run a day, per-source cadence from
  `lib/ops/refresh-cadence.ts`, one gate, and **one commit however many sources
  moved**. The other two schedules, `intake-tripwire` and `job-watch`, commit
  only under `docs/`, which the deploy filter classifies as non-shipping, so
  **only one scheduled workflow in this repo can cost a production build.**
  The pusher count is asserted in `tests/push-main.test.ts` and the schedule
  census in `tests/refresh-cadence.test.ts`.

  *The superseded text, kept because a deleted rule comes back as drift:* SEVEN
  workflows push `main` (corrected 2026-08-22, NJ Hunt 4 item 1, `NS02` — this line said
  five from the day it was written and was two short by the time anyone read
  it): `refresh-meetings-snapshot`, `refresh-fec-snapshot`,
  `refresh-legiscan-snapshot`, `refresh-dotgov-snapshot`, `intake-tripwire`,
  `job-watch` (added NH Hunt 3, RULING 56 — it commits the Needs Sean row it
  raises) and `refresh-nj-filing` (added NJ Hunt 3 — it rebuilds the Morris
  County ballot from the clerk's current filing). Each rebases and retries
  through `scripts/push-main.mjs`, because two of them running close together
  used to lose one run's work (R48). **The number is asserted in
  `tests/push-main.test.ts`**, so the next one to be added moves the test rather
  than quietly making this sentence wrong again. **Cadence is RULING 124's**,
  which amends RULING 78: the ORCHESTRATOR runs once daily, and each SOURCE
  inside it runs on the rate its data actually changes — meetings and the NJ
  clerk filing daily through the election, FEC and LegiScan weekly, the `.gov`
  register monthly, each with its reason stated on the entry. RULING 78's "every
  scheduled refresh runs ONCE DAILY, except the clerk filing" is superseded, and
  is kept here in that sentence rather than deleted.
- Auth via Auth.js, email magic link only — no OAuth, no social login.
- MapLibre GL with a vector tile provider. Not Google Maps.
- Mobile is responsive web first. A React Native client comes later if push
  notifications justify it, and will consume the same API.

## The order of every trade

**Correct first. Fast second. Nothing third.** Perfection and speed are both
mandatory, and when they collide, correct wins — always. A fast wrong answer
in this product is a false claim about a government, and that is the one
failure it cannot survive. Never ship partial data as complete, never let
green stand in for verified, never trade an honest gap for a plausible
guess. Data is the trophy, and nothing outside the four limits in the
public-records rule below stands between this product and it. Public records
are the product's birthright. Difficulty is friction, not refusal. Go get it.

## Non-negotiables in code

### THE TRANSPARENCY MANDATE

(Adopted 2026-08-16, the author's directive. Copied verbatim from the h session
brief. It governs every hunt in this product, and every session inherits it at
session-open. It sits above the operational rules below because they inherit
from it.)

Get out of my way. This public information is mine and I need to read it.

These are PUBLIC bodies and PUBLIC people. Their records, their meetings, their money, and their votes are already owed to the reader. Difficulty of access is frequently deliberate, and this product exists to defeat it — forcing the transparency that is already required. That mission governs every hunt.

Do not fail. Find every avenue, every back door, every nook, every cranny.

* Difficulty is an obstacle to out-climb and/or out-maneuver, never a reason to stop. A hunt that ends before the ladder is exhausted is an incomplete hunt, not a finding, and may never be reported as one.
* A wall never renders as an emptiness. A failed retrieval is reported as a failed retrieval, with the wall named and every rung listed with its result. "No meetings" is never the render for "could not reach the calendar." Absence is never asserted.
* Where a body is REQUIRED to publish and has not, that is a finding and it renders as one — the obligation stated, the date checked, the rungs walked. That sentence, in front of a reader, IS the transparency being forced. That being said, this is a LAST RESORT — as a reminder, this is public information and it is required to be SOMEWHERE. Reaching for the finding before the ladder is exhausted is the incomplete hunt this section forbids, wearing a respectable face. And it carries an EVIDENCE STANDARD, because it is a legal claim about a named body, not a retrieval report. It renders only when the record holds: the specific publication obligation; the authoritative source for that obligation (statute, rule, or charter, cited); why the obligation applies to THIS body and THIS document or data type; the obligation's effective date, or the version of the legal text applicable on the date checked; the date checked; the complete retrieval history; and the final failed state. Where the obligation itself is uncertain, the surface renders the retrieval failure honestly and NEVER upgrades it to a compliance claim. No claim without a source record — the same law as everywhere else in the product.
* Every wall that falls becomes a rung, so it never costs a second session.
* Two prohibitions remain, and neither is caution: no residential-proxy spoofing, and nothing fabricated when the ladder is genuinely exhausted. We take everything that is owed and we invent nothing.

**Recorded deviation from the source document, so a later comparison reads it as a decision and not as drift** (recorded 2026-08-17; the adaptation itself was made 2026-08-16 by the h session and reported then). The text above is verbatim from the h session brief with ONE adaptation: the brief's first bullet and its operational-interpretation paragraph each cited experimental control **C5**, and the same brief separately forbade copying its experimental controls into `CLAUDE.md`. Those two clauses therefore read here without the C5 reference. Nothing else was changed, compressed, reordered or paraphrased. A session diffing `CLAUDE.md` against the h brief will find exactly this difference and no other.

### THE LADDER, EXHAUSTIVELY — AND IT IS THE ONLY NUMBERED ONE

(The standing definition — a hunt is over only when every rung below has been
walked and recorded with `attemptedAt` and its result. These fourteen rungs are
`ladder vH-start`.)

**THIS IS THE CANONICAL RETRIEVAL-MECHANICS LADDER, and its numbering is the
numbering that reaches the database.** (Named canonical 2026-08-20, the
author's ruling; `docs/rulings.md` carries it as RULING 16.) A `walledAtRung`
value written anywhere in this product is a rung number FROM THIS LIST and from
no other.

The collision this closes: `docs/source-ladder.md` carried its own numbered
list of thirteen, and it is a DISCOVERY ladder — where a document lives, not
how to get bytes past a wall. Two numbered ladders in one repo meant a "rung 7"
in a throw site and a "rung 7" in a document were different rungs, and nothing
said so. The thirteen are retired in place with a dated note and their content
lives on as the lettered where-to-look ladder in `docs/zip-playbook.md` §2,
lettered precisely so it can never collide with these numbers again.

Rung values written before F22 (2026-08-20) are PROVENANCE-UNKNOWN. F22 was the
session that made throw sites name their rung in this numbering, so everything
earlier is uncertain — those values are MARKED as unknown and are never
reinterpreted, because guessing which ladder an old number meant would
manufacture a retrieval history nobody walked.

1. Committed snapshot.
2. Plain fetch.
3. Fetch with the full browser header set.
4. A different CLIENT whose TLS fingerprint passes (curl beat the fingerprint filter in the f session where header-swapping did not).
5. A different EGRESS — g3's finding: a rung is `(client, headers, URL, egress)`. A CI runner's IP being refused is an EGRESS wall, not a header problem; name it and move to another rung rather than hunting headers.
6. The LIVE BROWSER with JavaScript executed and content awaited. A page that renders for a human renders for us. A plain fetch returning nothing on a JS-rendered page is a FALSE MISS, not a wall.
7. The page's own network calls — the JSON endpoint feeding the widget is usually right there, and it is better data than the HTML.
8. Structured markup the prose hides — vCard, JSON-LD, microdata, RSS, iCal. (The playbook's "prose said no; ask the markup": Newbury's ZBA venue lived in a vCard block behind a map link.) An `.ics` feed is a calendar handed to us.
9. Linked documents in EVERY format. PDFs ARE DATA — text-layer extraction first, OCR when scanned. "Paper-only" and "not machine-readable" are honest ONLY when the document does not exist online — never when a PDF is sitting on the body's site unparsed.
10. Sitemaps, search-index caches, directory listings.
11. The Internet Archive, with snapshot URLs.
12. The vendor platform underneath — Diligent/BoardDocs, Granicus, CivicPlus and siblings expose predictable paths and APIs; identify the platform and use its own interface.
13. The body's own public-records request path, as a named rung.
14. The author's browser, last.

Operational interpretation of "every wall that falls becomes a rung": every successful wall-breaking method becomes a PERMANENT reusable step in the playbook, whether it is code or procedure. Only a genuinely NEW RETRIEVAL CLASS increments the numbered ladder. A new technique inside an existing rung enriches that rung; it does not renumber the ladder. This preserves the mandate verbatim while keeping the ladder version stable.

Every session reports RUNGS ADDED and where they landed — which existing rung
was enriched, or, for a genuinely new retrieval class, which number was added.
A run that learned a new way past a wall and did not write it down has spent the
discovery and kept nothing.

### RULING 52 — DISCOVERY IS A TREE, NOT A LADDER

(Adopted 2026-08-21, the author's ruling, NH Hunt 3. The ladder above is
unchanged and its numbering is still canonical: this governs how the ladder is
USED, and it is why the ladder can never produce the answer "unreachable.")

**Branches to the same fact are independent. A branch returning empty is one
measurement on one date, never a verdict about the fact.** The hunt does not
stop when a branch fails; it takes another branch. Where no branch exists, one
is built.

*The rationale stays attached, because a stripped rule reads as guidance.*

If the front door is locked and the back door is locked, that does not mean the
building cannot be entered. There are windows, a loading dock, a fire escape, a
neighbour with a key, a public filing describing the floor plan. **A ladder
produces the answer "unreachable" because a ladder has one direction. A tree
does not have that answer available to it.** The hunt is standing behaviour —
constantly, consistently, always going after the same information by different
avenues and different sources. It is not a special effort reserved for hard
cases.

This was adopted over three walls this repo had written down as permanent, all
three of which fell in one session, and two of which were recorded as OURS:

- `gc.nh.gov` was recorded as refusing every client this project has, browsers
  included. Re-walked 2026-08-21: it answers rung 2 at HTTP 200.
- `sos.nh.gov` stayed walled host-wide from 2026-08-13 until somebody walked
  rung 5, on 2026-08-21.
- Kearsarge's nine board emails sat in the page's own `href`s after two separate
  sessions recorded them as honest absences; read at rung 4 on 2026-08-21.

Every one of those had a defensible RUNG history behind it. That is the point:
rungs prove the retrieval discipline was followed on one route, and no rung
count proves a second route was ever tried.

- **Every recorded absence names which branches were walked and on what date.**
  "Not found" without branches and a date is not a valid record. Two
  INDEPENDENT branches minimum — and two routes that fail for the same reason
  are one route wearing two names, so a branch declares what it goes *through*
  (a host, a vendor, a publisher) and independence is counted over distinct
  dependencies rather than over branch names.
- **A source recorded as walled is recorded with the date it was last tested,
  never as a standing property.**
- **No branch result is permanent. This is the second half of the law and it is
  not separable from the first.** A fact not found today is hunted again on its
  cadence, forever, until it is found. Nothing in this project is ever concluded
  to be unobtainable.
- **Persistence, not circumvention.** Captcha and challenge walls are named, not
  defeated. A `robots.txt` disallow gets a compliant route to the same
  information. Where a document is obtainable only by request, make the request
  and record it. This does not narrow the two standing prohibitions in the
  transparency mandate; it restates them for the tree.

A **rung** is retrieval mechanics — how to get bytes past a wall, numbered above.
A **branch** is where the fact might also live — a different publisher, a
different document, a different body that files the same thing. A branch may be
walked at any rung. `lib/hunt/discovery.ts` is the machinery; it is guarded in
`tests/discovery-tree.test.ts`.

### RULING 53 — RECORDED ABSENCES EXPIRE

(Adopted 2026-08-21, the author's ruling, NH Hunt 3. Inseparable from RULING 52
above — it is that ruling's second half made operational.)

**An absence is a measurement with a shelf life, not a conclusion.**

- **Candidate fields: 7 days.** Filings open, campaigns launch, sites appear.
- **Bodies, rosters, and officials: 14 days.**
- **Walled sources: 14 days, regardless of how emphatically the wall was
  recorded.** That last clause is not decoration: `gc.nh.gov` and `sos.nh.gov`
  were both recorded emphatically and both were wrong, as the re-walk of
  2026-08-21 showed.

Past its window a record is **stale** and is re-walked before it is relied on.
Stale is not wrong and a stale record is never deleted — it means the
measurement no longer carries a claim on being current. **Staleness is a state
the data carries, not a note in a document**, and a record that cannot say when
it was measured reads as stale rather than fresh, because defaulting the other
way is how a bad date buys permanent trust. This runs on the scheduled refresh,
not by hand.

### RULING 57 — EVERY TWIG IS NAMED

(Adopted 2026-08-21, the author's ruling, NH Hunt 4. It sits beside RULING 52
and RULING 53 because it decides WHAT the tree is grown over: those two govern
how a fact is hunted, and this governs which bodies are owed a hunt at all.)

**The trunk is the United States. The major branches are the states. Then
counties, then towns, then districts, then the water authority in one
township — and the twig is as relevant as the trunk.**

A township water authority in New Hampshire governs something for somebody, and
if this product does not name it, nobody else will either. **No body is too
small to name. Name it, then find what can be found about it.**

*The rationale stays attached, because a stripped rule reads as guidance.* A
product that reaches only the bodies that are easy to reach is a worse version
of what already exists. The easy bodies — the city council, the county board,
the big district — are already covered by somebody: a newspaper, a vendor
portal, a civic-tech aggregator. The cemetery trustees, the village district,
the fire precinct, the transfer station advisory group are covered by nobody,
and they are the ones a reader cannot research alone. Reaching only the easy
ones does not make this product smaller than it could be; it makes it
redundant.

Operationally:

- **A body is NAMED FIRST and hunted second.** Enumeration does not wait on
  coverage. A body with no meeting source, no roster and no site is still
  entered, still rendered, and still carries what is known about it — which may
  be only its name, its host municipality and the enumeration that found it.
  That is more than nothing, and nothing is what a reader has today.
- **A body that cannot be reached today is a DATED MEASUREMENT with its
  branches recorded, never a decision to leave it out.** RULING 52 and RULING
  53 govern it from there: the branches are named, the date is stamped, and it
  is re-walked on its cadence.
- **Coverage is measured against the OFFICIAL universe**, as the coverage rule
  above already requires — the Census of Governments, NCES, and the state
  registers that enumerate the twigs the Census misses. `pnpm twig:pair`
  reports the pair for a zip and NAMES every unit with no body here, because a
  count is not a name and a village water district disappears into a statistic
  the moment it is only counted.
- **Two official enumerations that disagree is a FINDING, not an error.** The
  Ashuelot Pond Dam Precinct is in the 2022 Census of Governments and absent
  from New Hampshire's own village-district register, read the same day. It is
  named here with both facts recorded, rather than dropped because two
  authorities could not agree it exists.

### RULING 60 — THE SESSION HAND-WORKS BODIES, AND EVERY BRANCH KEEPS BRANCHING

(Adopted 2026-08-21, the author's ruling, NH Hunt 5; written into law here
2026-08-21, NH Hunt 6 item 6. It sits beside RULING 52 and RULING 57 because it
is what happens when the tree those two describe runs out of automated limbs.)

**Where no automated branch reaches a body, the session hand-works it. That is
the session's job, not a fallback it resorts to.** A body left dark because no
script reaches it is a body this product chose not to cover, and the choice is
invisible in every report that only counts what the scripts got. So the hand
work happens, the route that succeeded is recorded, it is built into a NAMED
BRANCH, that branch is applied across every body of the same shape, and the
session reports **how many further bodies the branch then reached** — as a pair
against how many were hand-worked. A hand-worked body that produced one row and
no branch has spent the discovery and kept nothing.

**And the caveat is inseparable from the rule, because without it the branch
becomes a false generalisation:**

**A branch proven in one place is proven for that SHAPE, not for everywhere.**
The route that reached a Newbury board will not reach a **borough in Alaska**,
an **unincorporated county in Arizona**, or a **parish in Louisiana**. New
England town government — town meeting, SB2, an elected board of selectmen, a
school administrative unit sitting above the district — is one of the stranger
shapes in the country, and nearly every branch this project has built so far was
built against it. Alaska has boroughs and an unorganized borough covering an
area larger than most states, with no municipal layer underneath it at all.
Arizona's counties run vast unincorporated territory where the county IS the
municipal government and there is no town clerk to ask. Louisiana has parishes,
police juries, and a civil-law vocabulary in which half these routes' names mean
something else.

**When a branch fails somewhere new, it is not discarded — it grows a
sub-branch.** The failure is recorded with the jurisdiction and the date, so the
next state knows what to expect rather than rediscovering it. The tree gets
deeper as the country gets stranger, and **a branch that stops working is
evidence the tree needs another limb, never evidence the fact is
unobtainable.**

*The rationale stays attached, because a stripped rule reads as guidance.* The
failure this forbids is subtle and it feels like competence: a session builds a
branch, the branch works, the branch is written down as THE way to reach that
fact, and two states later a session walks it, gets nothing, and records an
absence — with a defensible branch history behind it, which is exactly the shape
RULING 52 was adopted over. A branch is a measurement of one route in one
jurisdiction on one date. Generalising it into a rule about the country is how a
correct discovery becomes a wrong verdict.

The machinery is `subBranches` on each route in `lib/hunt/branch-manifest.ts`,
and `expectedToTravel`, which records what this project actually believes about
a route's portability. Honest uncertainty is a legal answer there and is
better than a confident wrong one.

### RULING 61 — THE BRANCH MANIFEST, AND WHAT EXHAUSTION MEANS

(Adopted 2026-08-21, the author's ruling, NH Hunt 6. **Supersedes RULING 58's
two-branch bar, which was too low.**)

**`VERIFIED_ABSENT` is earned only when every route in the manifest for that
field type has been walked, named and dated, and every one returned nothing.**

Not a count — a **named list**, the same list every time, so no session decides
on the fly what exhausted means. The list is `docs/branch-manifest.md`, made
checkable in `lib/hunt/branch-manifest.ts` and enforced by
`isEvidencedAbsence`.

**The manifest is a living document that only grows.** It is never complete,
never final, and never a reason to stop. A session that finds a new route adds
it to the manifest and applies it **retroactively** to everything already marked
absent — every absence record stamps the manifest version it was earned under,
so a record earned under `v1` stops being exhaustion the moment `v2` exists,
automatically and without anyone having to remember to go back for it. A route
is never removed; a route that stops working keeps its id with a dated note.

**We do not know what we do not know. Assume there are always more ways.**
Reaching the end of the manifest is not proof that a fact does not exist — only
proof that these named routes returned nothing on this date. That sentence ships
with the manifest and with every verdict it produces.

*Why two was not enough.* RULING 52 set the bar at two independent branches, and
that was a large improvement on the ladder's `unreachable` verdict. It is still
far too low to support the sentence it authorises. *This public person has no
campaign site* is a claim about a named person and the transparency mandate's
evidence standard applies to it. Two branches proves almost nothing; trying
thirty-seven routes and stopping does not tell you the forty-third would have
failed either. Three separate times this project recorded something as absent
and was wrong, and every one of those had a defensible retrieval history behind
it.

*What this costs, stated rather than hidden.* The contact list is nearly the
whole manifest, because a phone number can come from anywhere — which makes
`VERIFIED_ABSENT` on a contact close to unearnable in practice. That is the
correct outcome and not a defect in the bar. A field that cannot be exhausted
stays **still owed** and is hunted again on its RULING 53 clock. Nothing in this
project is ever concluded to be unobtainable.

### RULING 62 — A TEST FILE MAY NOT LOSE GUARDS SILENTLY

(Adopted 2026-08-21, the author's ruling, NH Hunt 6.)

**A file write that removes assertions from an existing test file fails the
build unless the removal is explicit and intentional.**

The suite reports on tests that EXIST. A deleted test cannot fail, so it reports
`fail 0` — and every other protection in this project runs through that suite,
which means a guard vanishing unnoticed silently weakens all of them. A session
wrote `tests/<name>.test.ts` for a new guard, the name was already taken, and
eight unrelated guards stopped existing under a green run.

**The test count is too weak an instrument on its own.** It moves for legitimate
reasons — every session that adds a guard moves it — so it is noise rather than
an alarm; it is blind to substitution, because a write that deletes eight guards
and adds eight leaves the total identical; and even a drop cannot name what
stopped running. **Names are the instrument. The count is a summary of it.**

`tests/guard-census.json` records every test file and every guard NAME in it.
`tests/guard-census.test.ts` recomputes it and fails BY NAME when a recorded
guard is gone. The census is not a lock — a guard may leave, but it has to leave
the census in the same commit, and `pnpm guard:census --write` refuses to erase
a name without `--allow-removals`. So making the census agree with a deletion is
itself a diff that says which guards left.

### RULING 63 — EVERY ZIP INHERITS; NO ZIP STARTS FROM SCRATCH

(Adopted 2026-08-21, the author's ruling, NH Hunt 6.)

**The manifest, the playbook, and every branch built are cumulative property of
the PROJECT, not of the zip that produced them.** Rockaway does not re-derive
what Newbury learned. Arizona does not re-derive what Rockaway learned.

- **Every zip run OPENS by loading `docs/branch-manifest.md` and
  `docs/zip-playbook.md` and stating which branches it inherited before hunting
  anything.** This is the first thing in the run, not a reference consulted when
  stuck.
- **Every run reports branches INHERITED against branches NEWLY BUILT, as a
  pair.** That ratio rising across zips is the only real evidence the method
  compounds. **A session that builds a branch which already existed has
  committed a defect** — it is reported as one, with the existing branch named.
- **A new branch is checked against the manifest BEFORE it is built.**
  Duplication is worse than a gap, exactly as it is in the tracker.
- **Both files are indexed BY QUESTION, not read front to back.** A New Jersey
  session must be able to find "how do I reach a town clerk record" without
  reading what New Hampshire taught about village districts. At 175 KB and
  growing, an unindexed playbook is one a session will skim.
- **Where an inherited branch fails in a new jurisdiction it grows a sub-branch
  per RULING 60.** It is never deleted, and its failure is recorded with the
  jurisdiction and the date so the next state knows what to expect.

### RULING 75 — A CLOSE-OUT COMMIT IS GATED LIKE ANY OTHER COMMIT TO `main`

(Adopted 2026-08-22, the author's ruling, NJ Hunt 3. Written into law here
2026-08-22, NJ Hunt 4 item 1.3, closing `NS03`. It sits beside RULING 62 because
both are about a protection that reported green while not running.)

**Every commit that reaches `main` passes the same gate, and a close-out record
is a commit that reaches `main`.**

The merge-cadence rule above permits a session to ship its code once and then
write close-out records as separate named commits, because a document cannot
name the commit that contains it. That is correct and it stays. What went
unnoticed is what it implies about gating: `pnpm handoff --ship` calls itself the
single door everything merges through, and **for code it is — for close-out
records it never was.** They were committed after the ship and pushed straight
to `main` through no gate at all, by every session in this repo's history.

The shape put a red suite on `main` twice. The second time, NJ Hunt 2's close-out
carried a session script with five `TS18046` sites, build checks #196 and #197
failed, Netlify refused both deploys at 'building site', and production served a
seven-hour-old build for the rest of the day. **The session reported green gates
truthfully** — it ran them before the file existed. That is the failure this rule
exists to name: an honest report about a tree that no longer matched what was on
the server.

Three parts, and the third is the one nothing local could ever have supplied:

1. **`pnpm closeout` is the gated door.** It refuses off `main`, refuses a dirty
   tree, runs the literal build command `netlify.toml` gives Netlify — which
   type-checks everything `tsconfig.json` includes, `scripts/` included — pushes
   through `scripts/push-main.mjs`, then waits for the tip to go green. **There
   is no skip flag**, for the reason the build gate already gives: an escape
   hatch on a gate is how the gate stops meaning anything.
2. **`pnpm main:green` asks GitHub, not the working tree.** Every other gate in
   this repo answers a question about local files. The question that went unasked
   is about the REMOTE BRANCH, and only the server knows what happened to a
   commit after it landed. Four verdicts are kept apart — green, red, pending and
   **could-not-tell** — because a check that cannot reach its subject must never
   print like a passing one (RULING 24).
3. **`pnpm handoff` carries a `main checks` line and fails on RED.** A session
   may not report clean gates while leaving `main` failing and production stale.

*Why not a pre-push hook.* `core.hooksPath` is per-clone and can be silently
absent in a fresh clone, and a hook that runs on every work-in-progress push is a
hook that gets `--no-verify`d out of existence. The server-truth check has
neither problem — it cannot be absent, and it costs one API call.

### RULING 76 — SESSION-DATED SCRIPTS ARE COMMITTED, AND HELD TO EVERY STANDARD

(Adopted 2026-08-22, the author's ruling, NJ Hunt 3. Written into law here
2026-08-22, NJ Hunt 4 item 1.3, closing `NS03`.)

**A one-shot script written for one session's evidence stays in the tree, and
`scripts/` is never excluded from the type check.**

Three reasons, in order of weight:

1. **They carry technique, and technique is a rung.** The page-shrink recipe for
   a 68,000px ballot page, the `sessionStorage` seeding that stops a map capture
   showing the welcome overlay, the marker-before-shrink ordering — every one of
   those is a wall that fell, and the standing rule is that a wall which falls
   becomes a permanent reusable step rather than a discovery spent and kept.
   **Deleting the script deletes the rung.**
2. **They are the method record behind evidence already reported.** RULING 2
   makes a screenshot evidence only once it has been read as an image. A report
   saying four captures were read, with no committed record of how they were
   produced, is weaker than one where the recipe is in the tree.
3. **"Not committed" creates an untracked class the gates never see** — the same
   invisibility that caused RULING 75's failure, work reaching `main`'s
   neighbourhood without passing anything. Moving these out of the tree would not
   gate them; it would only stop them being looked at.

**The standard, stated:** they type-check under `strict` like every other file,
they lint, they carry a header saying which session and which claim they served,
and they are never excluded from the type check. `scripts/` holding one-shot
tools is not a reason to weaken the check over `scripts/`.

**What this does NOT license** is minting a new dated script where a
parameterised one would do. A shooter that takes a zip and a list of contests is
worth more than the eleventh `shoot-<date>.mts`, and the preference is stated
here so the count is a fact about the past rather than a target.

### RULING 77 — VERIFY LOCALLY, SHIP ONCE

(Adopted 2026-08-22, the author's ruling, NJ Hunt 4. It is the merge-cadence
rule's missing half: that rule says how many times a session may ship, and this
says WHEN.)

**Never ship and then verify. Verify, confirm it works, then ship.**

Almost nothing needs production. Screenshots at 430×932, `pnpm walk:all`, the
card checks, the who-governs pill and the whole ballot page all run against a
**local production build**. Only the deploy-SHA confirmation and `/api/build`
require the live site, because only those two are questions about what the server
is serving.

- **One planned deploy, one merge**, and close-out records are part of that
  commit where they can be.
- **A defect found in local verification is fixed BEFORE the ship**, not shipped
  and then patched. The second-merge exception in the merge-cadence rule above
  survives — a live walk that catches a regression must be allowed to fix it —
  but a session that could have caught the defect locally and did not has spent
  the exception on its own carelessness, and the report says so.

*The rationale stays attached, because a stripped rule reads as guidance.* Ship-
then-verify was costing a merge every time, and the merges were not the real
price: between the ship and the verification, production was serving the defect
to readers. A local production build is the same bytes. There was never a reason
to find out on the live site.

### RULING 78 — CI RUNS WHERE IT EARNS ITS COST

(Adopted 2026-08-22, the author's ruling, NJ Hunt 4.)

**A gate that runs three times for one merge is one gate and two copies of it.**

Build check was firing on the branch push, again on the pull request, and again
on the merge to `main` — three runs plus a Netlify deploy each, on top of the
scheduled refreshes. That exhausted the Actions balance, and an exhausted balance
does not fail loudly: it produced completed jobs with zero steps recorded, which
read as a broken tree for a whole session (`NS04`).

- **Build check runs on the pull request and on `main`.** The branch-push trigger
  is removed. Those two together cover everything the third covered, because
  every branch that matters becomes a pull request and every merge lands on
  `main`.
- **Scheduled refresh workflows run ONCE DAILY**, except the clerk filing near a
  filing deadline, which keeps its one-day RULING 53 clock.
- **Nothing stops gating.** This removes duplicate runs of the same check, never
  a check. A cadence change that dropped coverage would be the budget raised to
  fit the change it was supposed to catch, in another costume.

### RULING 79 — A RULING CLOSES THE NEEDS SEAN ROW IT ANSWERS

(Adopted 2026-08-22, the author's ruling, NJ Hunt 4. **This amends RULING 37
deliberately**, and the amendment is narrow.)

RULING 37 says only the author closes a Needs Sean row. That stands for rows
awaiting his judgement. What it did not anticipate is the row he has ALREADY
ANSWERED — he rules in conversation, the ruling is recorded in `docs/rulings.md`
and shipped, and the row that asked the question sits open waiting for him to say
the same thing a second time in a spreadsheet. Needs Sean stood at 54 open and an
unknown share of those were already answered. **That is the accumulation the
section was built to prevent.**

- **Where a dated ruling in `docs/rulings.md` demonstrably answers a Needs Sean
  row, the session marks it Resolved**, records the ruling number and the
  shipping SHA on the row, and moves it.
- **Every such close is reported individually with its ruling and SHA**, so he
  can reverse any the session got wrong.
- **Where no ruling answers the row, it stays open and is named individually.**
  Ambiguity is not a licence to close.
- **Rows that are genuinely his judgement and carry no ruling** — a naming
  decision, a business call, a visual preference — **stay open regardless of how
  long they have been there.**

### RULING 80 — THE COMMITTED GEOMETRY FOLLOWS THE READER, NOT THE COUNTY

(Adopted 2026-08-22, the author's ruling, NJ Hunt 4 item 4, closing `NH44`.)

**The TIGER geometry clip widens to the adjacent counties. A unit this product
names is a unit the map can draw.**

The committed geometry was clipped to ONE county per state. A zip's first-rung
circle crosses county lines — 3 of 4 pilot zips do, and 184 of 279 measured — so
towns inside the circle were entering the registry with their boards, their
rosters and their meetings, and no polygon. RULING 57 says a body is NAMED FIRST
and hunted second; a body that cannot be DRAWN because a build-time clip was
convenient is that rule losing to a file format.

- **The clip is the county plus its adjacent counties**, per state.
- **The vector-tiling threshold is a real constraint and is measured, not
  assumed**: the feature count is stated before and after against it, and a tile
  over its budget is a finding rather than a rounding error.
- **A unit that reads "no division of its own" after the widening is a
  DIFFERENT finding from one that read it before**, and the pair is stated.

### THE FIVE PROCESS RULINGS OF NJ HUNT 5 — AND THE NUMBERS THEY ACTUALLY CARRY

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5 item 1.)

**A numbering collision is named here rather than resolved silently.** The
author's brief adopted these five as RULINGS 81 through 85. Those two numbers
were already spent: NJ Hunt 4, earlier the same day and from the author's
previous brief, recorded **RULING 81 — an exhausted Actions balance is not a
broken tree** (answering `NS04`) and **RULING 82 — the job watcher's sampling was
the defect, not its logic** (answering `JOB01`), and both are cited by id in the
resolved tracker store and inside `docs/rulings.md` itself.

`docs/rulings.md` is append-only, so renumbering the two that already shipped
would leave dangling references in a record whose whole value is that it does not
move. The five below therefore take **RULINGS 83 through 87**, in the brief's
order, and every one of them carries the brief's number so a search for it finds
the rule:

| The brief called it | It is law as | Its name |
| --- | --- | --- |
| RULING 81 | **RULING 83** | The free-source floor |
| RULING 82 | **RULING 84** | The manifest is tiered and walked in order |
| RULING 83 | **RULING 85** | The two-click test |
| RULING 84 | **RULING 86** | Per-state source enumeration precedes the hunt |
| RULING 85 | **RULING 87** | Wikipedia is a Tier A discovery source, never a source of record |

**Nothing about the content is changed by this** — the five rules below are the
brief's text with its rationale attached. Only the labels moved, and a Needs Sean
row records the choice so the author can reverse it if he wants his own numbering
to win.

### RULING 83 — THE FREE-SOURCE FLOOR

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5. The brief numbered it 81.)

**No paid resource is proposed, acquired, or specced until every free route in
the manifest has been walked and reported with counts.**

- **A session or a review naming a constraint that money would solve must first
  show what the free routes returned.**
- It applies to REVIEWS as much as to sessions.

*The rationale stays attached, because a stripped rule reads as guidance.* NJ
Hunt 4 ended with a recommendation to buy a search API, on the strength of a real
and correctly measured constraint: DuckDuckGo walled after six queries, Bing and
Yahoo after roughly 170, and 124 of 272 candidates returned no classified URL.
Every one of those numbers is true. What made the recommendation wrong is what
was sitting unwalked while they were being measured.

**Wikipedia's Rockaway Township page was two clicks from a plain Google search
and six hunt sessions had never opened it.** A person with a browser types "2026
New Jersey elections", clicks the second result, clicks through to Rockaway
Township, and reads: the mayor, all nine council members with party and ward, all
seven Morris County commissioners, the three county constitutional officers, the
state legislative district, the congressional district, and links to the township
site, the school district, NCES data and the fire department — every fact
footnoted to its primary source.

That is a **process failure, not a research failure**, and it is the specific
failure this rule exists to make impossible: a session spending its scarce
per-entity search quota on individuals while a templated encyclopedia page listed
nine of them outright, and then concluding from the exhausted quota that the
constraint was money.

### RULING 84 — THE MANIFEST IS TIERED, AND WALKED IN ORDER

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5. The brief numbered it 82.)

**Every route in the manifest carries a TIER, and the tiers are walked in
order, always.**

- **Tier A — broad sources that answer many entities at once.** Wikipedia
  municipality and election articles, the Census of Governments, NCES, the FEC
  Combined Federal/State Directory, the Secretary of State, the state election
  division, the county clerk, the state campaign-finance authority.
- **Tier B — the entity's own official source.** The town site, the district
  site, the body's own page.
- **Tier C — per-entity search.** General web search, per-person queries.

**A session may not reach Tier C for a field until Tier A and Tier B are walked
and recorded for it.**

*The rationale stays attached.* A flat list lets a session spend a rate-limited
quota on individuals before touching a source that would have answered fifty at
once, and that is exactly what happened: 124 candidates returned nothing from a
walled engine while a templated encyclopedia page listed nine council members
outright. A tier is not a preference about quality — Tier C routes find things
Tier A never will. It is a statement about COST PER FACT, and walking the cheap
broad routes first is what leaves quota for the ones that genuinely need a
per-person query.

The tier lives on the route in `lib/hunt/branch-manifest.ts`, a route without one
fails the build, and `judgeManifestWalk` refuses to honour a Tier C walk for a
field whose Tier A and Tier B routes are unwalked.

### RULING 85 — THE TWO-CLICK TEST

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5. The brief numbered it 83.)

**Before recording any absence, or naming any constraint, the session states
what a person with a browser would type into a search box to answer this, and
confirms that path was walked.**

Not *did we walk our routes* — **did we walk the obvious one.** A route a
non-technical person would reach in two clicks is **Tier A by definition** and is
added to the manifest the moment it is found.

*The rationale stays attached.* Every retrieval discipline in this project is
designed to beat hard walls, and a discipline built for hard problems develops a
blind spot for easy ones: the ladder, the tree, the manifest and the control
query are all instruments for getting past something, and none of them ever asks
whether there was anything to get past. Six sessions walked increasingly
sophisticated routes to facts that were sitting on the second Google result.

### RULING 86 — PER-STATE SOURCE ENUMERATION PRECEDES THE HUNT

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5. The brief numbered it 84.)

**Before any state's hunt begins, the session enumerates that state's free
sources into the manifest as state-scoped routes.** The Wikipedia municipality
and election articles, the Secretary of State, the election division, the
campaign-finance authority, the county clerks and recorders, NCES, and whatever
the FEC directory names for that state.

**This is a written research step producing a written list, and it happens
before the first entity is touched.** It is also what makes each new state
cheaper than the last.

*The rationale stays attached.* RULING 63 says every zip inherits and no zip
starts from scratch, and it is about BRANCHES — the technique. This is about
SOURCES — the places. A branch that reaches a town clerk record is portable
knowledge; which office in this state IS the clerk is not, and a session that
discovers it mid-hunt discovers it once, expensively, under time pressure, and
usually incompletely. Enumerating first costs an hour and is paid back the first
time a route is walked in tier order.

### RULING 87 — WIKIPEDIA IS A TIER A DISCOVERY SOURCE, NEVER A SOURCE OF RECORD

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5. The brief numbered it 85.)

- **Municipality articles are templated** across roughly 19,000 US articles, so
  ONE parser reads all of them.
- **Every extracted fact carries the footnote it came from**, and the primary
  source is fetched and confirmed before the fact ships. **Wikipedia names the
  person; the citation proves them.** A fact whose citation cannot be confirmed
  is a `LEAD`, not a `FOUND`.
- **The form-of-government line predicts which bodies exist.** Rockaway is
  Faulkner Act, Mayor-Council Plan F, one of 71 of New Jersey's 564
  municipalities using that form — a nine-member council, six wards plus three
  at-large. That answers twig enumeration under RULING 57 before the hunt
  starts.
- **Names, parties, term dates and districts are facts and are not
  copyrightable.** Extract the facts, follow the footnotes, do not copy the
  prose. Wikipedia's terms permit reuse; this is not the Ballotpedia situation
  RULING 70 governs.
- **Wikipedia gives ROSTER depth, not KELLY depth.** Photos, phones and campaign
  sites are still hunted — but a person who has not been NAMED cannot be hunted
  at all, and that is the gap this route closes.

*The rationale stays attached.* The distinction between a discovery source and a
source of record is the whole of this rule. Nothing in this product may cite an
encyclopedia for a claim about a named person; the never-generate-a-position rule
and the transparency mandate's evidence standard both forbid it. What an
encyclopedia is exceptionally good at is telling you WHO TO GO ASK ABOUT, and
which document to ask. Treating it as either one of those things alone gets it
wrong in a different direction — refusing it entirely leaves nine council members
unnamed, and trusting it directly puts an unsourced claim in front of a reader.


### RULING 90 — EXHAUSTION MUST BE ARGUED, NOT ASSERTED

(Adopted 2026-08-22, the author's ruling, NJ Hunt 5. **The author's numbering,
used exactly as given.** 88 and 89 are deliberately unassigned — a gap in the
sequence is cheap, and renumbering his ruling to close it would be this file
correcting him about his own law. `docs/rulings.md` records the gap so a later
session reads it as a decision rather than as a missing entry.)

**"I walked every route in the manifest" is not exhaustion and never was.**

*The rationale stays attached, because a stripped rule reads as guidance — and
here the rationale IS the rule, because the rule is about a habit of mind rather
than a procedure.*

**Every fix to date has been a LIST.** Wikipedia was a list. The caucus sites
were a list. The API keys were a list. RULING 84 tiered the list and RULING 61
named it, and both were real improvements. **None of them can be the fix, because
the failure is that lists are finite.** Each new list closes the gap that was
just discovered and leaves the next one open, and the next one has been found the
same way every time: the author, with a browser, in about two clicks, finding
what six sessions missed. That is not six unlucky sessions. It is a method that
searches its own index and calls the index the world.

So the standing obligations:

1. **For every field that ends a session unfound, the report answers a specific
   question: *what would I try to find this if there were no manifest at all?*
   Then tries it, and reports what it returned.** Not what the manifest said —
   what a person who had never heard of the manifest would do. The question is
   mandatory per unfound field and the answer is mandatory in the report.

2. **Answering "nothing further" is an assertion of exhaustion and is
   PROHIBITED. The item fails.** There is no version of that sentence that is
   acceptable, including the polite ones — *the manifest is exhausted*, *every
   route returned nothing*, *this appears to be genuinely unavailable*. A session
   that cannot think of another thing to try has found the limit of its
   imagination, which is a fact about the session.

3. **The META-SEARCH is a FIRST MOVE, not a last resort.** Before touching any
   individual entity, ask the open question and answer it: *where does this state
   publish candidate information? where does this county publish officials? who
   covers these races?* **One cheap search answering that beats hundreds
   answering nothing.** NJ Hunt 4 spent its entire search budget on 272
   individuals and never once asked where all 272 live.

4. **A wall is a wall AROUND something.** When a source refuses, the record
   states what the wall is around and what other road reaches it. *DuckDuckGo
   refusing after six queries* is one road closed; it is not a fact about a
   candidate, and it may never be written down as though it were. This is RULING
   72 sharpened: naming the other branches is not enough, the record must name
   what is on the other side.

5. **Every AUTHENTICATED resource is walked before any UNAUTHENTICATED one is
   exhausted. A key sitting unused while a session hits a public rate limit is a
   DEFECT, and is reported as one.** A credential is a route somebody already
   paid for; burning a free quota beside it is the free-source floor of RULING 83
   with the sign flipped, and it is just as wasteful.

*What this ruling cost to learn, measured on the day it was adopted.* NJ Hunt 5
walked the seven credentials `.env.local` holds. Three had never been called by
anything in this repo — confirmed by sweeping the tree with `git grep -a
--untracked` rather than by trusting the register. Calling them took one script
and returned, in a single run: 18 sitting members of Congress with a photo and an
official page each, 61 state legislators with email addresses, 137 federal
candidates, and 42 federal document collections. **And one finding that only a
call could produce — `CENSUS_API_KEY` is INVALID**, refused by the host with
`X-DataWebAPI-KeyError: 1`, which no amount of reading the register would ever
have surfaced. Every one of those was available while the previous session was
measuring how fast a free search engine would rate-limit it.

### RULING 93 — ASK WHAT THE TIER ABOVE PUBLISHES ABOUT THE TIER BELOW

(Adopted 2026-08-22, the author's ruling, NJ Hunt 6.)

**The federal government publishes directories of state governments. States
publish directories of their counties and municipalities. Counties publish
directories of their towns, school districts and special districts. Before
hunting any tier, walk the directory the tier above publishes about it.**

**This is a general principle, not a list.** It inverts discovery from guessing
sideways to descending a hierarchy, and it is **Tier A by construction** under
RULING 84 — a directory answers for everything below it in one fetch, where a
per-entity route costs once per entity.

*The rationale stays attached, because a stripped rule reads as guidance.* Every
route this project had built before it went sideways: search a name, guess a
host, read an encyclopedia article about one municipality at a time. Morris
County's own *Cities and Towns* page reached **30 of 39** municipalities and the
nine it missed included **Rockaway Township, the governing body of the target
zip**. Six sessions hunted municipal sites that way.

New Jersey had published the list the whole time — all 21 counties and all 564
municipalities, with each one's official website, at
`nj.gov/nj/gov/county/localgov.shtml`. And the tier above THAT names it:
`usa.gov/states/new-jersey` links straight to it under the heading *Local
governments*. Two fetches from the top of the hierarchy to a complete answer,
against six sessions of sideways guessing.

- **The route is walked before the tier below it is hunted**, and the
  enumeration it produces is reconciled against the official universe as a
  PAIR — never blended. Two official enumerations that disagree is a FINDING
  (RULING 57).
- **A directory that has moved is a branch that failed on a date, never a
  missing directory.** `nj.gov/nj/gov/county/` answers **HTTP 200 with a styled
  "Page not found"**, which a status check alone reads as success. The document
  is at `localgov.shtml`. Control strings are mandatory on directory routes for
  exactly this reason: a 200 whose content is not about the thing asked for is
  not a document.
- **`usmayors.org` is a DISCOVERY SURFACE, never a source of record.** It is a
  nonprofit's directory, not a government publication, so the Ballotpedia
  question of RULING 70 governs it rather than public-domain status.

The machinery is `scripts/tier-directory.mts` (`pnpm tier:directory`), whose
routes each declare **who publishes it**, **which tier it is about**, and the
**control string** that must appear. Every route in it is a `.gov`
publication: US government work, public domain, no attribution obligation and
no terms to accept.

### WHAT IS LAW HERE, AND WHAT IS A RULING

(Adopted 2026-08-20, Prompt C item 5.)

**This file is law.** A rule here binds every session and is changed only by the
author.

**Most decisions are not law**, and until 2026-08-20 they lived only in whichever
chat window was open when they were made — which meant a session could be told
to "hardcode the ruling as fact" with no way to check what the ruling said, and
a superseded ruling could come back as drift because nothing recorded that it
had been superseded. `docs/rulings.md` is that record: append-only, dated, one
entry per ruling, each naming what it supersedes. It is surfaced in
`docs/context.md`, so every session opens on it.

A ruling that becomes law is written INTO this file and its entry in
`docs/rulings.md` says so. A ruling that contradicts this file does not
silently win: the conflict is named, and the author rules.

### THE DEFERRAL BOUNDARY FALLS BETWEEN SUBJECTS, NEVER INSIDE ONE

(Adopted 2026-08-17, the author's ruling on the conflict between the mandate
above and the nothing-half-built rule. Both stay; this is the layer between
them.)

The deferral boundary falls between subjects, never inside one. A subject is never left half-hunted or half-built — the mandate governs the subject and the ladder is walked to exhaustion. But a session does not stop starting new subjects because it doubts it can finish them all. It keeps going until the session genuinely ends, defers whatever remains whole and specced, and states in its report how many subjects were completed against the denominator — "2 of 60", never "the sweep was deferred."

---

**Never generate a candidate position.** Every position, vote, or stance rendered to a user must carry a source record pointing at a specific statement, roll-call vote, filing, or questionnaire response. If no source exists, the field is null and the UI renders "no public position found." Do not infer from party affiliation, endorsements, or similar candidates. This applies to LLM-generated summaries too — summaries paraphrase a cited source, never fill a gap.

**No composite match scores.** Alignment renders per issue. No aggregate percentage, ranking, ordering by fit, or UI affordance implying a recommendation.

**Reader friction is a defect.** Remove it relentlessly. Every unnecessary click, confirmation, new tab, duplicate message, or hidden entry point is a bug with the same standing as a wrong number. The reader is trying to find out what is happening; everything between them and that answer had better be earning its place. Exactly three exceptions — friction that is the product working, checkable by number, and a change claiming one must name which: (1) the transparency disclosure at the point of reaction capture; (2) the optionality of the narrowing prompt — declining must stay the effortless default; (3) anything constituting consent to collection. These three are load-bearing. Everything else goes. **The fourth exception — "honesty about coverage gaps, which may never be smoothed into implied completeness" — is RETIRED** (2026-08-20, RULING 47, the author's ruling). It was written to protect a per-candidate coverage statement, and RULING 44 and RULING 47 together deleted every per-card form of that statement: the line, the count, and the buried enumeration. What replaces it is not silence about coverage — it is one page-level sentence, "What we have found, we are displaying here.", which says the same thing about every card at once and singles nobody out. Honesty about coverage survives everywhere it was ever load-bearing: the gap ledger, the stated-N-equals-rendered-rows rule, the two-numbers pair rule, and the prohibition on asserting absence. What is gone is the licence to spend a reader's attention on it, next to a named person's name, once per card.

**No user-to-user surface.** No comments, feeds, upvotes, public profiles, or shared slates. Reactions are write-only from the user's perspective — stored and aggregated, never rendered back to any user including in aggregate form. Showing aggregates anchors later respondents and corrupts the data being sold.

**Collect the minimum.** Zip or address for district resolution, an email for account identity. Do not add fields to the user model without asking first.

**The design system is committed, not improvised.** (Adopted 2026-08-15, the design pass.) Structural labels organize, content leads, flagship surfaces get flagship treatment, and reader-facing polish follows the committed tokens — `docs/DESIGN.md` and the tokens in `app/globals.css`, never a new ad-hoc scale.

**Reader surfaces speak plain language.** Every reader-facing string passes the 15-year-old test. Identifiers, enum values, and internal keys never render outside a technical-details disclosure: no OCD-ID, no `school_district:tucson_unified_district`, no `NO_SOURCE_FOUND` reaches a reader — label maps translate, or the row does not render. The reader gesture on a card is expansion, never clipboard — no click-to-copy affordances on reader surfaces.

**The register is chosen by surface, and the ask-box beat draws from a fixed pool.** (Adopted 2026-08-15, the author's voice doctrine.) Two registers, and using the wrong one is a defect with the same standing as a wrong number. *Playful* on **interaction** surfaces — asks, calls to action, expanders, empty states, confirmations: warm, casual, timeless-casual over dated slang, because a dated joke ages into a wrong-feeling product. *Level* on **claim** surfaces — funding numbers, votes, summaries, citations, refusals, coverage gaps: plain, neutral, never cute about a real person or real money. The two meet constantly and the seam is the rule, not an exception: an expander's button may be playful while every word inside it is level. The ask box's acknowledgment beat draws at random from a FIXED author-curated pool, committed at `lib/routing/ask-beat-pool.ts` — acknowledgment register only. Labels implying deliberation ("Thinking", "Pondering", "Analyzing", "Reasoning") are PROHIBITED there: nothing a reader sees is generated, and a deliberation label claims otherwise. **Code never adds a pool entry; the author does** — guarded in `tests/ask-box.test.ts`.

**The stranger test.** (Adopted 2026-08-14, the author's principle written as the standard.) A person in Tucson should be able to learn everything they'd want to know about Newbury, NH from this product alone. The completeness bar for any place is a STRANGER's, not a local's — a local fills gaps with what they already know; a stranger has nothing, so any gap a stranger would hit is a defect. Every surface, every explainer, every card is judged against the reader who has never been there: no assumed context, no "everyone knows how town meeting works," no office left unexplained, no body left unpeopled. Tester passes walk every zip as a stranger by instruction.

**Coverage claims are made against the official universe, never against our own records.** (Adopted 2026-08-14.) "We watch N of M bodies here" — M comes from the Census of Governments and the official enumerations (NCES for school districts, state municipal/authority/special-district rosters), never from counting our own registry. A registry that defines its own denominator cannot be caught missing anything — the Sunnyside class of miss is a gap in what we know exists, and only an external denominator surfaces it. The per-county audit lives in `docs/coverage-audit-by-county.md`.

**Public records are reachable. A vendor's terms describe a route, not a wall.** Every agenda, minute set, meeting notice, ballot and candidate filing this product retrieves is a public record a public body is statutorily obliged to publish. A software vendor hosting those records does not acquire rights over them, and a vendor's website terms of use are not a mechanism by which a public body can narrow statutory access to its own records. The difficulty is structural and deliberate — scattered across incompatible vendors, buried in server-rendered portals, published without feeds. That is friction, not prohibition, and routing around friction is what this product is for. **"Not found" is a claim and has to be earned**: only an enumerated record of every ladder rung attempted and what each returned (`docs/source-ladder.md`); a body without a recorded search is `NOT_ATTEMPTED`, never exhausted. "Exists but not found yet" is always a work item; "publishes nothing" is a real finding claimable only with the full ladder recorded. A 403 to a plain client, a stale URL, a feed with zero items, a server-rendered site, no documented API, unfriendly vendor marketing terms — none of these are answers. What does hold, and it is the whole of it: never authenticate or circumvent an access control; never accept clickwrap terms and then violate them; never request at a rate that degrades service (serialized requests, identified `User-Agent` with a contact address, honour `Retry-After`, never re-fetch an unchanged `contentHash`); never retrieve anything the body has not already published to the public. Everything outside those four is reachable. There is deliberately no "blocked" coverage status — a terminal we-gave-up state encoded in a schema is how giving up becomes routine; a closed route is recorded on its rung and the next rung is attempted.

**The product never tells anyone how to vote.** It presents sourced positions, sourced votes, and the reader's own stated priorities side by side. It never ranks candidates, never generates a recommended ballot, never computes a match, fit, alignment or compatibility score, and never orders candidates by anything other than a neutral criterion such as ballot order or alphabetical. This is stricter than the no-composite-score rule above and it is not a UI preference: the moment the product recommends, its neutrality claim is gone and the data business goes with it. A reader asking for a recommendation directly is not an exception, and neither is a well-sourced, transparent, explainable one — the transparency of the method is not the issue. Guarded in tests: no candidate or measure record may grow a `score`, `rank`, `rating`, `match`, `fit`, `grade`, `alignment`, or `recommendation` key.

**Organizations render as filed, never characterized.** (Adopted 2026-08-14, second session.) A contributor organization renders with its FEC-registered name and committee type, linking to its FEC page. The app NEVER labels an organization's affiliations, alignments, or politics — never "an AIPAC affiliate," never "a progressive group," never "-aligned" anything. The reader who wants to know what an org is clicks through to the filing. Guard-tested on the funding surfaces for characterization strings where feasible; the rule itself is law regardless of what the guard can reach.

**A photo ships through one of four doors, and the composition standards are not one of them.** (The four-door structure adopted 2026-08-15, the author's ruling.) Two halves, and confusing them is the failure this rule exists to prevent. **Each door carries its own adoption stamp on its own line below** — the doors became law on different days, and a single parenthetical holding three dates left one of them ("and 2026-08-14", with no stamping verb in front of it) invisible to `pnpm verify-stamps`. A stamp nothing audits is a stamp nobody can catch.

*The standards never move, at any door.* A clean solo portrait or honest initials — never a wrong face, never a banner, a logo, a wordmark, a group shot, an event candid where the person is not the unambiguous sole subject, a screengrab, or a generated likeness. Any doubt about identity fails at every door. EXIF stripped, served from our own origin, source URL recorded per row, remove-on-request honoured. A door is permission to use a source; it is never permission to ship a worse picture.

*The doors govern the source basis only, and are tried in order:*

1. **An explicit recorded license** (door 1, adopted 2026-08-13) — public domain (GPO, a chamber's own release), or a machine-checkable Commons license, recorded per row.
2. **An official government-published portrait** (door 2, adopted 2026-08-14) — the portrait a government body publishes to identify its own member — with attribution to the publishing body and remove-on-request.
3. **The campaign's own self-published portrait from its own site** (door 3, adopted 2026-08-15) — an `og:image` or a site headshot on the candidate's own domain, labeled "campaign-provided," source recorded, remove-on-request. A campaign publishing its candidate's face for recognition is distributing it.
4. **Last resort, when doors 1–3 all fail for a person** (door 4, adopted 2026-08-15) — any portrait published on the candidate's own campaign site or on any `.gov` site (anything on a `.gov` site is official, by the author's ruling). Post it, cite it, move on. Remove-on-request.

*Prohibited at every door, unchanged:* press photos, wire images, photographer-credited images, and social-media images. That is the demand-letter class and no door reaches it — a working photographer's copyright is not narrowed by where the image was reposted.

Every shipped photo records WHICH door it shipped through (`docs/photo-report.md`, one row per photo); every miss records which doors were tried, per person (`docs/photo-report.md` again — equal effort per candidate applies to photo hunts by name).

**A campaign that lives on Facebook still has a campaign site.** (Adopted 2026-08-15, the author's ruling.) In small races the campaign's whole public presence is often a social page — no domain, no site, just a page. Recording that as "no campaign site found" hides a real, findable thing from the reader, and it penalizes exactly the candidates least able to buy a domain, which is the information asymmetry the equal-effort rule exists to catch. So a social page MAY serve as the campaign-site link when AUTHENTICITY is establishable: the page self-identifies with the filed candidate name, the office and the cycle, AND is reachable by an authoritative trail — named in a filing, linked by the county party or local press, or the top self-identified match — with that trail recorded as the link's source. It renders labeled honestly — "the campaign's Facebook page" — never dressed as a website. It NEVER supplies a photo: social-media images are prohibited at every door of the photo rule, and a door the campaign-site rule opens is not a door into the photo rule. It supplies no prose beyond the labeled self-description the blurb rule already governs.

**Equal effort per candidate within a race — A HUNT DISCIPLINE, AND NOTHING ELSE.** (Adopted 2026-08-14, the tester's mobile pass — her finding, in her words: "Karen might be the perfect fit for me, but she has no information here. So I'm only going to look at the folks that do have information... how could using this app actually impact voter outcomes instead of collect information from voters." **Scope corrected 2026-08-20 by RULING 26 below, after two successive attempts to enforce this rule at the DISPLAY layer ended with the product rendering no candidate cards at all.**) The app can say nothing about anyone and still tilt a race, because a thin card tracks incumbency and campaign professionalism, not merit — an information asymmetry no neutrality rule above catches. So: hunts for candidate information — photos, blurbs, contacts, sites — are run for EVERY candidate in a contest, and misses are recorded per candidate. A hunt session takes a contest as a UNIT and works every candidate in it before moving to the next contest; it does not fill in the incumbent because the incumbent is easy. A hunt that stops when the well-covered candidates are done is not finished; it has produced a ranking. Where the hunt still comes back empty, the absence is disclosed ONCE at the foot of the page and never on the card — see RULING 42 below, which deleted the per-card line this clause used to mandate. **The app's neutrality includes what it fails to find.** **This rule lives in the hunt and never becomes a display rule.** It may not withhold a card, a contest or a field, and any implementation that does is forbidden by RULING 26 below.

**RULING 26 — SHOW EVERYTHING WE FIND.** (Adopted 2026-08-20, the author's ruling, Prompt D item 1a. It is never overridden.)

Everything the product holds about a candidate renders. Collection state never governs display. There is no threshold, no completeness bar, no equality condition, and no circumstance under which a candidate, a contest, or a field is suppressed because something else is missing. A gap in one field has no bearing on any other field, on that candidate's other data, on the other candidates in the contest, or on whether the contest appears at all.

*The rationale stays attached to the rule, because a stripped rule reads as guidance.* Completeness is a property of the HUNT. It kept being treated as a property of the record. Every version of the gate — strict field equality in Prompt B, hunt-completion equality in Prompt C — was an attempt to make the display responsible for a fairness problem that belongs to the collection discipline, and each version withheld more than the last until the product showed nothing at all while holding portraits, finance figures and verified pages in the database. Blanking a contest over one or two missing fields is never the correct response to an incomplete hunt. The correct response to an incomplete hunt is more hunting.

*Where equal effort lives.* In the hunt, and nowhere else. See the rule directly above. That discipline is the constraint. It is not a display rule and it never becomes one.

*Presentation of gaps is a visual question.* How a card looks when a field is missing gets settled in visual feedback sessions over time. It is never a reason to withhold data, and a visual concern never earns a suppression path.

**RULING 27 — NO SUPPRESSION PATH MAY EXIST IN THE CODEBASE.** (Adopted 2026-08-20.) Not live, not behind a flag, not disabled, not retained for a future feature, not as a guard, not commented out as a reference implementation. `tests/no-suppression.test.ts` asserts none exists and fails the build if one is reintroduced — enforced at commit rather than discovered by the author opening the site, which is how both previous versions were found.

**RULING 28 — ABSENCE IS ONE BURIED ANNOTATION PER CONTEST, NEVER A PER-FIELD INDICATOR.** (Adopted 2026-08-20.)

- A field with no data renders NOTHING — no row, no label, no placeholder, no greyed line, no dash, no "still looking for". Cards in a contest may be different lengths and that is correct.
- The only disclosure is a single asterisk on the contest heading with a footnote below the cards in small secondary text: *"An incumbent is likely to have more information available here than the people running against them."* (`components/ballot/incumbency-note.tsx`.) The `*` is reserved for it across the whole ballot page, so the shared-source and scope-note sequence starts at `†`.
- Hunt-queue vocabulary never reaches a reader. "Still looking for", field-name lists, `NOT_HUNTED`, `VERIFIED_ABSENT`, `NOT_APPLICABLE` and any equivalent are internal states. They live in the tracker and in session reports — never on a card, in a header, or in a tooltip.

**RULING 42 — THE PAGE-LEVEL DISCLOSURE REPLACES `THIN_CANDIDATE_LINE`, AND NO PER-CARD COMPLETENESS MARKER MAY EXIST.** (Adopted 2026-08-20, the author's ruling, Prompt E item 3.)

`THIN_CANDIDATE_LINE` — "We haven't found much about this candidate yet.", mandated by the equal-effort rule above from 2026-08-14 — is DELETED, from the card, from `lib/ballot/candidate-cards.ts`, and from this file. Nothing takes its place on a card. No marker, badge, line, icon, styling or ordering may indicate how complete one candidate's record is relative to another's, or relative to anything.

*The rationale stays attached, because a stripped rule reads as guidance.* The line was added for a real finding and it was the wrong instrument for it. It printed on exactly one kind of card — the shortest one in the race — so the reader was told, on a named person's card, in their column, next to their name, that this is the candidate we know least about. A badge worn only by the least-resourced person running is the information asymmetry the equal-effort rule exists to catch, pointed the other way, and it was the per-card repetition RULING 28 had already ended everywhere else on the page.

*What ships instead.* One plain page-level disclosure, once per page — not once per contest, never per card — at the bottom of the ballot: **"What we have found, we are displaying here."** (`app/ballot/page.tsx`, `COLLECTION_NOTE`.) It says the same thing about every card at once and singles nobody out. It replaces nothing else: the contest-level incumbency footnote RULING 28 specifies is a different statement about a different fact and is untouched, as is the `*`-reserved marker convention.

*Where the discipline lives.* In the HUNT, unchanged and still binding — the equal-effort rule above, and RULING 26. A disclosure is not a substitute for hunting, and the correct response to a thin card remains more hunting.

Guarded: `tests/no-suppression.test.ts` fails the build if a per-card completeness marker returns, and `pnpm walk:all` fails against production both if one returns and if the page-level disclosure goes missing.

**RULING 23 — the four-state field is DATA, not a gate.** (Adopted 2026-08-20.) `FOUND` / `NOT_HUNTED` / `VERIFIED_ABSENT` / `NOT_APPLICABLE` stays on the candidate record as the work queue `HD01`–`HD30` were sized against (`lib/ballot/hunt-state.ts`). Nothing reads it to decide what renders, and no render path may even import it. `VERIFIED_ABSENT` is earned by a completed hunt carrying the rungs walked and the date checked; `NOT_APPLICABLE` carries a reason and a date; neither is ever written by a migration.

**Every blurb carries its source class.** (Adopted 2026-08-14, second session.) Any prose describing a person or organization names where it came from, in the register the candidate cards already ship ("In the campaign's words — [domain], read [date]"). No unlabeled descriptions of real people or orgs, anywhere, ever — a description without its source class is treated as a generated claim and removed.

**The collection stores never join — n stores, same rule for every n.** Three today: the search log, the reactions store, and (when notification is built) the subscription store. The search log is permanently identifier-free: no account key, no device ID, no fingerprint, no retained IP, no session key that survives the session, no subscriber ID, no foreign key to anything — it records what was asked and where, never who, and it is honest to sell only because it cannot be resolved to a person. The reactions store is identifier-free the same way, with one disclosed wrinkle: a random browser-minted continuity key, stored only hashed, that relates a browser's reactions to each other (so an answer can be changed) and to nothing else — it joins no other table, appears in no export, and its column exists on the reactions table alone. The subscription store holds an email or push token, a zip, and topic or body interests, and no behavioral history — not what was searched, not what was opened, not what was read, not what was reacted to. No store carries a column that could join to another, and there is no mapping table between any pair; tests assert the schemas share no key. The honest form of the trade: a subscriber is notified about topics they declared, not topics we inferred from watching them — a slightly worse notification product, and the only version that survives the transparency page. **The intake limiter is this rule under load (T08):** rate limiting requires transient tracking of a submitting device, and that state lives in its OWN space — the `intake_limiter` table, keyed by a digest deliberately different from the reaction store's continuity hash (`sha256("intake-limiter:" + key)` vs `sha256(key)`), holding counters only, expiring on its own 48-hour schedule, joined to nothing, exported in nothing. A protection that violates n-stores-never-join to enforce it has failed; `tests/db-schema.test.ts` asserts the limiter table shares no joinable column with any store. Rows that trip a limit but land anyway are quarantined by `suspect_reason` — a why, never a who — and excluded from every aggregate unconditionally; nothing auto-deletes, the author decides. The intake protections sit behind `ripcord.rateLimits` (thresholds tunable via `WTP_LIMIT_*` env vars) and the master ripcord `ripcord.reactionIntake` closes all intake writes; the 2am pull procedure is `docs/ripcords.md`. Validity checks — real target ids, closed enums, length caps, and the like — are never behind any flag.

**Every production probe row a session creates is NAMED in its report.** (Adopted 2026-08-15, the author's standing order.) A session that taps a reaction, fires a log event, or otherwise writes a row against production states it in the standing report — the timestamp, the target, and what it was proving. The reason is not tidiness: these stores are sold as reader signal, and a row a session created is plumbing wearing reader clothes. Unnamed, it is indistinguishable from a real answer, and the author cannot tell which without an investigation — the T08 session named its probes and the 0814f session did not, and that cost exactly such an investigation. Naming them is also what makes a later quarantine or exclusion a filter rather than a hunt. The same obligation covers rows a session's automated walk creates.

**The ripcord doctrine — legally-open features ship behind named kill switches.** (Adopted 2026-08-13, author-approved.) A feature whose legal or policy question is open but whose build is otherwise sound may ship only when: (1) it sits behind a named flag — a ripcord — whose tracker row states the flag name, the open question, and WHO closes it (a named closer, e.g. counsel); (2) every record the feature produces carries a provenance tag so pulling the ripcord is a filter, never a migration or a hunt; (3) ripcorded data never enters an export or a sold aggregate until its question closes — a ripcord that only hides the UI while the data flows downstream is not a ripcord; (4) the transparency page changes in the same commit that ships the feature. The first application is the FEC funding surface (tags `FEC_COMMITTEE`, `FEC_CONTRIBUTOR`; ripcords `ripcord.fecContributorDisplay` and `ripcord.fundingReactionsInAggregates`, the second shipping PULLED) — deferred whole this session; its tracker rows carry the flags and the closer.

**A join that can collapse must be asked for distinctness — identical payloads across distinct keys are presumed broken.** (Adopted 2026-08-14, the FEC replication bug.) The sibling of the count check below: a match rate can read 100% while every match points at the same row. Any join or enrichment binding values to keys must be checkable for per-key uniqueness — no two officials share an FEC committee id unless the FEC itself proves the share (`tests/funding.test.ts`, the D40 family). The rule extends to every layer that can alias keys: an HTTP response whose body varies by a request input must carry that input where every cache implementation keys on it — in the path, never only a query string on a `public` response (production served one campaign's books for three politicians exactly this way), and a client component holding fetched state must reset it when its key prop changes. When adding a keyed join, enrichment, or cacheable endpoint, state how distinct keys are proven to produce distinct results.

**The zip playbook is append-only, and every depth run ends with its diff.** (Adopted 2026-08-15, the author's standing order; tracker R13.) `docs/zip-playbook.md` is the machine-checkable definition of done for a zip and the source ladder per jurisdiction type. It is written by the sessions that discover it: **the rungs written so far are the rungs discovered so far, and every new state is presumed to teach new ones** — discovering and recording a rung is the work, not a deviation from it. Entries are APPEND-ONLY: a rung that stopped working gets a dated note beside it, never a deletion, because the next state may hit the same wall from a different side. Every zip or depth run ends with a **playbook diff** — what was added — or an explicit "nothing new," stated in the standing report. A run that learned something and did not write it down has spent the discovery and kept nothing.

**A render default may never manufacture a claim — a null renders as its NAMED GAP, on every surface, always.** (Adopted 2026-08-16, from the closest call of the 0815 mobile session.) The key-votes surface came one deploy from asserting "Did not vote" about named members of Congress, because a component defaulted a null position straight into a statement. The commonest reason for that null was the most innocent one — they were not in that chamber in 2021 — and the render turned our empty cell into a specific, checkable, false claim about a person. No component default may convert absence into an assertion: not `?? "Did not vote"`, not an empty string that reads as zero, not a placeholder that reads as a finding. The gap gets a name of its own, and the name says WHOSE gap it is — "we haven't recorded this yet" is a fact about us and "not in this chamber for this vote" is a fact about them, and they may never render as the same sentence. Absence also never wears a present value's styling: a named gap renders in the gap's own register (an outline where a recorded position renders as a filled pill), because a colour is a claim too. **The rule is the ATTRIBUTION, never a particular sentence** (clarified 2026-08-19, F01 items 6.1 and 6.2, after the author struck "that's a gap in our research" and "this is a gap in our data" from the whole product): "we haven't recorded this chamber's vote on this yet" satisfies it in full, and the clause that used to follow it was editorial about our own shortcomings rather than attribution. What must survive is that the reader can tell OUR gap from THEIR absence; what may be rewritten at any time is how that is said. `tests/wording.test.ts` bans the struck phrasing across `app`, `components`, `lib` and `data`, and guards the surviving attribution in the same test so neither half can be lost without the other being noticed. Guarded where cheap — `tests/key-votes.test.ts` is the pattern, and `tests/card-sources.test.ts` is the same rule applied to a Sources tab that reported absence without having looked. The rule is law regardless of what a guard can reach.

**An operation that can return nothing must be asked what it returned.** No adapter, join, or scripted edit may report success without stating its count. The shape has now been sighted four times — an empty RSS feed recorded as working, a zero-match join presented as a clean build, a scripted edit that edited nothing and exited 0, and a NovusAgenda portal returning 200 with zero meetings recorded as a HIT. Every adapter reports fetched/normalized/dropped per run (`ReportingMeetingSource`); the snapshot writer refuses a snapshot whose sources do not state integer counts (`lib/meetings/snapshot.ts`, guarded in `tests/snapshot.test.ts`); parse tests assert minimum row counts against recorded fixtures, never merely the absence of an error. When adding any of these, state the count and the denominator — a deliberate clip must not read as a failure, and a real failure must not read as a clip.

**Every session ends by running `pnpm walk:all` against production, and a prior win that fails is a NAMED REGRESSION.** (Adopted 2026-08-16, from the g3 session's own reason for existing.) Every session before this one wrote its own walk, and every walk checked only the surfaces that session had touched — so a win shipped in one session and broken in the next died silently, because nothing owned it once its session ended. Three were found dead on the first run: Kearsarge's fifteen sittings, `/about-area` answering HTTP 500 at every zip, and the meeting counts at 03255 down from 26 to 7. Each check in `scripts/walk-all.mts` carries the SESSION that shipped the claim, so a failure prints as "the win <session> shipped is undone" rather than as an anonymous red line. **New walks APPEND — the suite only grows**, and a check leaves it only when the author retires the claim behind it. Two disciplines make it worth trusting: a check that could not RUN is reported separately from a check that FAILED (an unreachable service is not a missing feature), and the checks that WRITE — a reaction tap, an ask submission — are excluded by name, with the exclusion printed on every run so the gap is stated rather than implied. The run's own production rows are counted and printed too: every `/api/meetings` GET writes a search-log row, so a walk is never row-free and saying so is the probe-naming rule applied to the instrument itself.

**A full-page screenshot is evidence only once it has been READ AS AN IMAGE.** (Adopted 2026-08-20, the author's ruling.) Capturing a screenshot is not looking at one. A file written to disk, a byte count, a green capture step — none of these are the reader's view, and a session that reports "screenshotted" on the strength of any of them has reported a step it did not take. So: every full-page capture a session offers as evidence is opened and read as an image, and the report states screenshots as **N of N read as images**. **A DOM assertion plus a live walk does not substitute** — they answer a different question, because the defects this rule exists to catch are the ones the DOM is happy about: an element present and painted behind another, a mask that dropped, a control below the fold, a colour that renders a gap as a finding. **If a capture cannot be read, the item it belongs to is a BOUNDARY STOP, not a finish**, and the report names which capture and why it could not be read. That is a real ending and an honest one; a finish claimed on unread evidence is neither. This is the render-default rule pointed at our own reporting: an unverified surface may not be written up as a verified one.

**A failed fetch never silently empties a previously-full surface.** (Adopted 2026-08-16 — the refresh corollary to the render-default rule.) The render rule forbids a component turning absence into an assertion. This is the same rule one layer down: a RETRIEVAL failure may not be written into the data as an absence, because by the time a null reaches a component the lie is already in the file. The truth session verified fifteen Kearsarge sittings live; the next scheduled refresh got a 403, recorded the source as failed, and committed a snapshot with every one of that source's meetings gone — a school board that sits fifteen times a year rendered as a body with nothing scheduled. Two rules follow. **Per-body isolation:** one host's refusal may not empty the bodies on other hosts (`schedulepage` served five bodies across three hosts through a loop whose first failure threw, so a New Hampshire WAF deleted a New Jersey school board). **Carry-forward:** `lib/meetings/carry-forward.ts` keeps a refused source's last known rows, clipped to the same serving window, with their original `collectedAt` intact and the carried count stated per source — never restamped as fresh. A source that succeeds and reports no refusal carries nothing, because a body that genuinely went quiet must be allowed to. Guarded in `tests/refresh-corollary.test.ts`.

**A read from the subject's own official source IS the verification.** (Adopted 2026-08-16, the author's ruling.) A fact read off the Governor of Arizona's own website, on a stated date, with the link two rows above it, rendered under the words "Verified: not yet" — the product slandering its own best evidence on the surface whose whole job is to say where a claim came from. So an official-source read renders as verified, BY that source, ON the read date; "not yet" is reserved for provenance where a second rung is genuinely owed (an aggregator, a third-party page, a social feed). Official is decided against something outside us and never a hand-list: the `.gov`/`.mil` TLDs, RFC 1480's `.us` locality space, and the hosts the source wiring itself types as a body's own page. A VENDOR portal is deliberately not official — the records are the body's, the site is a third party's. An official host with no read date stays unverified, because a missing date may not be filled in with a plausible one. `lib/officials/verification.ts`, guarded in `tests/verification-vocabulary.test.ts`.

**More viewport must never mean fewer pins.** (Adopted 2026-08-16.) Zooming out is a request to see MORE, and a map that answers it with less is indistinguishable from a map losing data. The cause was never clustering or culling: the settle re-query carried no radius, so the server used the ladder's first rung at every zoom while a wheel zoom dragged the centre, and a fresh small circle was drawn around a new point. The requested radius follows the viewport, floored at the first rung and capped at the last, and a materially wider view is its own reason to re-ask — a centre-distance test alone misses zooming out in place entirely. `lib/map/viewport-radius.ts`.

**Where collection and rendering can diverge, BOTH numbers are reported, always, as a pair.** (Adopted 2026-08-20, the D68 rule.) A single figure standing in front of two measurements is a data-destruction pattern, not a rounding choice: a flat total conceals a falling component, and the component that is falling is the one somebody needed to see. The ballot page counted contests one way and rendered them another and reported one number; the meetings snapshot counted two things and stated one. Both looked healthy. So a surface, a script, a report or a snapshot that can COLLECT one number and RENDER a different one states them BOTH, makes the pair reconcile, and names which is the standing figure. The rule above — an operation that can return nothing must be asked what it returned — catches a ZERO. It does not catch this, and D50 recurred in F01 because nobody had written the difference down. Where the two do not reconcile, that is the finding, and it renders as one.

**A named instance is an example of a class-wide defect.** (Adopted 2026-08-20.) Every defect this project has found by name has turned out to have siblings: one separator-broken allowlist was fourteen hand-kept state registries; one campaign's books served for three politicians was every `public`-cached response keyed on a query string; one unparsed Apptegy page was a whole CMS family. So a reported defect is the START of a sweep, never the end of one. Fix at the SHARED CODE PATH, sweep the class with a non-skipping tool — `git grep -a --untracked`, or ripgrep with binary handling forced, because a NUL byte and a hidden path each make ripgrep report nothing found without having looked — and state COUNT FOUND and COUNT FIXED. Fixing the named instance alone and reporting it as closed is how a class defect survives the session that discovered it.

**The Kelly standard, and there are no tiers of it.** (Adopted 2026-08-20.) Every official and every candidate carries a photo, a phone, a working contact, a specific verified page, and a campaign site. That is the standard, whole, for everybody — not a scale to be met partly, and not a target that well-covered people reach and thin ones do not. A tiered standard is the equal-effort rule's failure wearing a respectable name, because the tier a person lands in tracks incumbency and campaign professionalism rather than anything about them. Where a field genuinely does not exist, that is a FINDING and it is recorded as one with the rungs walked and the date checked; where nobody has looked yet, that is a gap and it reads as ours. The two may never render alike. See the equal-effort rule above, which this makes checkable.

**Stated N equals rendered rows.** (Adopted 2026-08-20.) Any count a surface states is the count of the rows that surface actually rendered, built from the same list in the same pass. A number produced by a second query is free to disagree with what is on screen, and a denominator that can disagree with its own page is not a denominator — it is a second opinion presented as arithmetic. Where a count is deliberately clipped, the clip is stated with both numbers, per the pair rule above.

**A ceiling moves only on proof, and the proof is a measurement.** (Adopted 2026-08-20.) The build budgets in `scripts/bundle-budget.json` are baselines with headroom — a ceiling is baseline +15%, rounded down — and `tests/build-budget.test.ts` enforces them. Raising one is a decision that needs a measured before and after on the same machine in the same mode, and the new baseline is what was measured, never what was wanted. Every budget figure in every report is READ FROM THAT FILE, both modes, with the CI run id named; the rounded KB line printed by the build is an estimate and is never the reported number. A ceiling raised to fit the change it was supposed to catch has stopped being a budget.

**A session carries carryover and the deferred queue, and nothing else, until the queue clears.** (Adopted 2026-08-20.) The work a session takes is what the previous session left plus what the deferred queue holds. Nothing new is added to a session's own scope mid-flight: a defect discovered becomes a tracker row and the session keeps going, and writing the row is the whole response. **And a session does not stop early.** It drives until the gas light comes on — the old three-to-four item limit is dead, it is not to be reintroduced by any document, and a session that finishes its list starts the next thing rather than closing out. The instrument for "how much room is left" does not exist inside a session; two sessions in a row stopped at roughly a third and a half of their window while believing they were nearly done. The deferral boundary rule above still governs WHERE a session may stop: between subjects, never inside one.

**Where a tool does not exist to reach a public record, BUILD IT.** (Adopted 2026-08-20.) The absence of a script is never a wall. The transparency mandate says difficulty is friction rather than refusal, and "we have no extractor for this format" is difficulty. So the tool gets built, committed, registered in `docs/zip-playbook.md` §4, and cited by the hunt that needed it — that is the work, not a detour from it. A hunt that stopped because no code existed to finish it has not exhausted the ladder, and may not be reported as though it had.

**A zero-row extraction is a FAILED extraction, never an empty document.** (Adopted 2026-08-20.) A parser that returns nothing has told you about itself, not about the document. Every extraction layer reports rows found against what it was given, and zero rows is an error state that names the document, the layer and the reason — never a clean exit. This is the sibling of the operation-count rule above, and it exists because the same shape has now been sighted five times: an empty RSS feed recorded as working, a zero-match join presented as a clean build, a scripted edit that edited nothing and exited 0, a portal returning 200 with zero meetings recorded as a HIT, and rendered prose extracted from an Apptegy page that never contained the byline the page was fetched for.

## DISCOVERY CONDUCT

(Adopted 2026-08-22, the author's Discovery Conduct brief, item 3. Eight rulings
adopted together — **RULINGS 88, 89, 94, 95, 96, 97, 98 and 99** — held in full
here rather than as pointers. `docs/rulings.md` carries them with the same text
and the letter-to-number mapping the brief's A-through-H lettering maps onto.)

**Why this section exists, and it is a diagnosis rather than an exhortation.**

Sessions walk the routes the brief names and no others. **This is not
disobedience; it is what the system asks for.** Scope is a ceiling by rule, the
branch manifest is a checklist with a completion condition, the discipline rules
correctly make speculative moves feel like confessable defects, and — the part
nothing had noticed — **no report contract has ever asked a session what it
found that was NOT on the list.** A session that walked eleven known routes and
a session that invented three new ones produced identically-shaped reports and
were graded the same.

The consequences are measured, not asserted. **Wikipedia as a Tier A source was
identified by the author, not by a session**, and when finally walked it
returned 261 officials, 898 rows, 818 citations confirmed against primary
sources (91.1%), and 174 governing bodies against a registry holding 12. **API
credentials the author personally obtained sat uncalled** until NJ Hunt 5 called
several and closed 119 owed fields in one run; the Census key was invalid and
that was found only because something finally hit it. **A paid search API was
recommended** while Wikipedia's Rockaway Township page — two clicks from a plain
Google search, carrying the mayor, nine council members, seven county
commissioners and the county constitutional officers, all footnoted — had never
been opened.

**More principles will not fix this.** RULING 90 and RULING 93 are principles and
behaviour did not change. What changes behaviour is **a required output that
cannot be produced by walking a list**. That is RULING 88. The other seven make
it real.

### RULING 88 — THE EXPANSION REQUIREMENT

**Every hunt report carries an EXPANSION section listing routes that did not
exist at session start.** For each one: **how it was conceived**, **the literal
query or URL** that produced it (not a description of the search — the text that
was typed), **what it returned including zero**, and **whether it generalises to
a class of entities**.

**A hunt report with an empty expansion section FAILS THE ITEM** — exactly as
"nothing further" already fails an exhaustion claim under RULING 90.

**A newly conceived route that returns nothing is a REPORTED SUCCESS, not a
defect. The invention is the deliverable, not the yield.** This clause is
load-bearing and it is the one most likely to be quietly ignored, because every
other rule in this file rewards rows found. A session that conceives four routes
and gets zero from all four has done what this asks, and its report says so
without apology.

*Why a required output rather than another principle.* A principle can be
satisfied by a session that believes it complied. This cannot: either there is a
route in the section that did not exist this morning, or there is not.

### RULING 89 — EXPANSION IS NOT A SIDE QUEST

**Expansion is a NEW ROUTE TO A FIELD ALREADY OWED on the item list. A side
quest is a new capability, a new surface, new infrastructure, or work on a zip
that is not the current zip.**

Expansion is **required**. Side quests remain **forbidden** and become tracker
rows — writing the row is the whole response, unchanged. **A session citing
RULING 88 while building infrastructure has committed a scope breach and reports
it as one.**

*Why this ships in the same breath as RULING 88.* "You must invent new routes"
is one sentence away from "you may build anything you can justify", and that
reading would undo the scope discipline that keeps a session finishing what it
started. The test is about the DESTINATION, not the technique: does this route
end at a field the item list already owes?

### RULING 94 — THE STUCK PROTOCOL

**When a field is unfound after Tier A and Tier B — before any absence is
recorded, and before Tier C per-entity search begins — run five moves and record
the literal query text or URL and the result for each.**

1. **What would a person with a browser type right now?** Type it.
2. **What does the tier above publish about the tier below?** Federal publishes
   states; states publish counties and municipalities; counties publish towns
   and districts. Descend; do not guess sideways. (RULING 93.)
3. **What did entities of this same shape do?** If one township posts a clerk's
   PDF, the other twenty may. **Test the shape, not the instance.**
4. **Who else needed this badly enough to have compiled it already?** Courts,
   local news, League of Women Voters, unions, chambers of commerce, libraries,
   universities.
5. **One lateral query phrased exactly as "where else can I find this"** for the
   specific fact, on a general search engine.

Phrased as QUESTIONS rather than fixed URLs so they cannot go stale — and so
they cannot be completed, since the answer differs in every state.

**A recorded absence with no stuck-protocol block is VOID and the field returns
to owed.**

*Where it sits, exactly, and why.* After Tier A and Tier B, BEFORE Tier C. That
placement is the whole economy of it: per-entity search is the expensive tier,
and four of these five moves are broad routes that may answer for fifty entities
at once. NJ Hunt 4 spent its entire search budget on 272 individuals and never
once asked where all 272 live.

### RULING 95 — CREDENTIALS ARE PROVEN, NOT ASSUMED

**Every hunt session regenerates `docs/credential-ledger.md` at session start by
CALLING each key.** A key not called this session is reported as **unproven** —
not assumed working, not carried forward from the last session's table. **An
invalid key opens a Needs Sean P1 row the same session.**

*Why calling and not reading.* The register can only say which files reference a
key. It cannot say whether the key works, and the difference has cost real
findings: `CENSUS_API_KEY` was invalid and nothing discovered it until something
finally hit the endpoint.

*And why the bar is "is the body ABOUT the thing asked for".* The Census host
answers a rejected key with **HTTP 200 and an HTML page titled "Invalid Key"**,
so a check written against the status code reads a dead credential as healthy.
The control is that the body parsed as the data requested, plus a deliberately
bogus second request that must come back DIFFERENT (RULING 68).

The generator is `scripts/credential-ledger.mts` (`pnpm credentials`), and the
artifact is never hand-edited (RULING 92).

### RULING 96 — SOURCES HAVE FRESHNESS

**`docs/sources.md` carries a LAST-WALKED DATE on every entry, keyed or not**,
with the expiry discipline that already governs absences under RULING 53:
**candidate fields 7 days, bodies and rosters 14, walled sources 14.**

**A source past expiry is re-walked or reported STALE with its date. A source
walked but not recorded is a DEFECT**, because the next session re-derives it.

*Why sources and not just absences.* RULING 53 made an absence a measurement
with a shelf life. A source is the same kind of claim wearing a friendlier face
— *this endpoint answers, this licence permits, this is where the list lives* —
and every one of those can stop being true without anything here noticing. A
register with no dates cannot tell a session which of its rows are observations
and which are folklore.

### RULING 97 — A FOUNDER FIND IS A CLASS-WIDE DEFECT

**When the author finds a source, route, or fact the sessions did not, that is a
DEFECT IN THE DISCOVERY PROCESS**, handled like a named instance of a class-wide
defect in code. The next session answers three questions in its report:

1. **What procedure would have found this without him?**
2. **Why did that procedure not run?**
3. **What changed so it runs next time?**

**Absorbing the find as a new manifest entry and moving on is not an adequate
response** — that is fixing the named instance and reporting it closed, which
the named-instance rule already forbids everywhere else. **Manifest growth that
comes only from the author is the failure this ruling names.**

### RULING 98 — EXPLORATION HOLDS A GUARANTEED POSITION IN ITEM ORDER

**In every hunt brief, expansion work is its own NUMBERED ITEM and is NEVER
LAST. This binds the chat writing briefs as much as the session executing
them.**

*The reason, stated plainly because it is a fact about how this system actually
behaves.* Whatever sits at item 1 eats the run. Expansion placed at the tail
never happens, because it is scheduled to begin after exhaustion — and
exhaustion never arrives, by design, since RULING 90 exists precisely to stop a
session declaring it. **A brief that puts exploration last has not
deprioritised it; it has cancelled it, while appearing to require it.**

### RULING 99 — THE AMENDMENT PROCEDURE

**Every ruling is amendable. A ruling is changed only by a LATER DATED RULING
that names the number it supersedes, states what changed and why, and adds a
mapping line in BOTH `docs/rulings.md` and `CLAUDE.md`.**

**Rulings are never edited in place and never silently dropped.** A superseded
ruling stays in the file marked superseded, carrying its successor's number.

*The precedent, and the format.* On 2026-08-22 a brief adopted five rulings as
81 through 85 while a session earlier the same day had already spent 81 and 82.
Renumbering the two that shipped would have left dangling references in an
append-only record whose whole value is that it does not move. The five took 83
through 87 with a mapping table in both files. Every amendment takes that shape.

*Why the file and not memory.* A superseded ruling that is deleted comes back as
drift — something reads it, cites it, or reasons from it, and nothing says it
was overturned. That is the exact failure `docs/rulings.md` was created to end.

### THE REPORT CONTRACT IS A FILE NOW, AND IT IS AMENDED RATHER THAN REINVENTED

(Adopted 2026-08-22, the same brief, item 5.) **`docs/report-contract.md` is the
close-out contract every hunt session answers.** A brief may ADD to it; a brief
does not subtract from it.

**What was found when this was written:** there was no template. The contract
lived in each session's own brief, rewritten by the chat every time — which is
precisely why the one figure that would have caught the discovery failure had
never appeared in it. **A contract that is rewritten every session cannot
accumulate.**

It enumerates seven required figures, each with its denominator: **expansion
routes conceived**, **routes returning rows (N of N)**, **routes returning zero
(N of N)**, **stuck protocols run**, **fields returned to owed for a missing
stuck protocol**, **credentials proven (N of M)**, and **sources past expiry
(N of M)**. **A report missing any of these is INCOMPLETE and the session says
so about itself.**

### THE MAPPING TABLE — the brief's letters against the numbers they carry

| The brief called it | It is law as | Its name |
| --- | --- | --- |
| A | **RULING 88** | The expansion requirement |
| B | **RULING 89** | Expansion is not a side quest |
| C | **RULING 94** | The stuck protocol |
| D | **RULING 95** | Credentials are proven, not assumed |
| E | **RULING 96** | Sources have freshness |
| F | **RULING 97** | A founder find is a class-wide defect |
| G | **RULING 98** | Exploration holds a guaranteed position in item order |
| H | **RULING 99** | The amendment procedure |

**88 and 89 were held open on 2026-08-22** so the author could claim them rather
than have `docs/rulings.md` renumber a ruling of his. He claimed them here. C
through H continue from 93, the highest then in use.

## HUNT 6 HARDENING — SEVEN RULINGS OF 2026-08-23

(Adopted 2026-08-23, the author's Hunt 6 hardening brief. Seven rulings, **100
through 106**, held in full here rather than as pointers. `docs/rulings.md`
carries each with the same text in plain language, because a ruling the author
cannot read is a ruling that does not bind him.)

### RULING 100 — A PARTIAL ANSWER THAT ADDS UP IS STILL A WRONG ANSWER

(Adopted 2026-08-23, Hunt 6 hardening item 3. The missing half of the
zero-row-extraction rule above, which catches a reader that came back with
NOTHING and cannot see one that came back with SOME.)

**Where a source states a count, extraction that yields fewer FAILS. Where a
source states no count, extraction records that it could not assert one — a
distinct, named, reportable state, never a silent pass.**

*The rationale stays attached, because a stripped rule reads as guidance.* A
council page says *nine members*. The reader came back with five. Every
instrument in this repo said that was healthy, because every instrument was
asking *did anything come back* — and five is not nothing. **A total that
reconciles is not a total that is correct.**

Three instances in one session, and only the third was visible before it:

- A stray `<br id="isPasted">` ended Rockaway Township's roster sentence early.
  **Four of nine council members vanished; the parse reported five rows and
  exited clean.**
- A filter requiring a party letter, a term year or a seat deleted the two Mount
  Olive members the article says least about — the two least-documented people
  on the body, which is the equal-effort failure pointed the other way.
- Pequannock's sentence used the past-tense copula `was composed of`. **Five
  sitting members read as an empty body.**

The second state is the load-bearing half. "We read four and the page never said
how many there should be" is a far weaker claim than "we read four and the page
says four", and a report running the two together tells a reader it checked
something it did not.

The machinery is `lib/extract/count-assertion.ts`; `ExtractResult` gains the
`PARTIAL` outcome and a REQUIRED `count` field, so a new layer cannot be written
without answering the question and "did not consider" is not expressible.
Guarded in `tests/count-assertion.test.ts`.

### RULING 101 — OUR OWN IDENTIFIER NEVER LEAVES OUR OWN ORIGIN

(Adopted 2026-08-23, Hunt 6 hardening item 4. It finishes `VF02`, where one of
two findings was fixed and the other was written down and left.)

**Synthetic-run identification travels to our origin and nowhere else, enforced
in the harness rather than remembered.**

Two findings, one line of code, and only one was closed. **MapTiler's CORS
preflight refuses `x-wtp-synthetic-run`, so the basemap failed in every capture
and every walk this repo has ever taken** — which is why NJ Hunt 5's photographs
showed *Basemap unavailable* while its 371 checks were green. Both were honest.
They were looking at different pages, because the instrument was breaking the
thing it was measuring.

The second was recorded and never enforced: **the run identifier was crossing
our origin to every third-party host the page touched.** Nothing sensitive is in
it — it names a walk, not a person — but a header identifying our infrastructure
arriving at hosts we do not control is the wrong shape for a product whose
central claim is that its stores share no joinable column.

It is `lib/ops/origin-confinement.ts` now rather than four lines inside a
harness, which is the difference between enforced and remembered: nothing failed
if they were deleted and nothing could test them without launching a browser.
`tests/origin-confinement.test.ts` walks it across every third-party host these
pages reach, BY NAME, so the guard has a stated denominator rather than one
example. Failing safe means stripping, never keeping.

### RULING 102 — FIXING A GENERATOR IS NOT FINISHED UNTIL ITS OUTPUT IS REGENERATED AND DIFFED

(Adopted 2026-08-23, Hunt 6 hardening item 5. **Amends RULING 92** by giving it
the completion condition it never had.)

**Each generator's own source is digested and the digest committed beside its
artifact. A generator whose digest has moved FAILS THE BUILD until its artifact
is regenerated and the digest re-recorded, and the count changed is reported.**

`data/hunt/nj-morris-municipal-sites.json` pointed **five municipalities at the
wrong government's website** — `morris_township` at Morris Plains',
`chatham_township` at Chatham Borough's — **with its generator already fixed**.
Somebody did the RULING 92 thing, correctly, and stopped. Every downstream hunt
read the stale output as current and nothing anywhere went red, because "fix the
generator" was satisfied the moment the generator was fixed.

**The digest is over the GENERATOR, not the artifact, and that is the whole
design.** An artifact hash tells you the artifact changed; it cannot tell you the
artifact SHOULD have changed — which is the entire question. A network
generator's output legitimately moves when a government moves its website. Its
SOURCE moves only when somebody edits it, and that is exactly the event after
which a re-run is owed.

`pnpm regen` reports, `pnpm regen --write` records, and a git sweep finds the
ones already in the tree by comparing each generator's last commit against its
artifact's. Guarded in `tests/generated-artifacts.test.ts`.

### RULING 103 — A CLASS SWEEP COVERS DUPLICATED IMPLEMENTATIONS, NOT ONLY NAMED INSTANCES

(Adopted 2026-08-23, Hunt 6 hardening item 6. **Amends the named-instance rule
above** by naming the blind spot in its own instruction.)

**The sweep predicate is BOTH: every surface showing the named symptom, and
every duplicate implementation of the code path.**

Three separate copies of an initials function rendered **Thomas J. Haynes III**
as **"TI"** — each took the first letter of the first token and the first letter
of the LAST, and the last token was the generational suffix. Fixing the copy the
reader complained about left two copies of the same defect standing.

Grepping the symptom cannot find them: they are not the same text and they do
not use the same variable names. So the sweep compares the SHAPE of the code
with identifiers set aside, which is what makes a renamed copy collide.

**The gap was in the existing rule's own wording.** *Fix at the SHARED code
path* assumes there is one.

*What the instrument taught about itself.* Its first version read 241
declarations across 806 files and reported one duplicate group — a sweep
reporting nothing found without having looked, which is the failure this repo
names most often. It reads 2,114 now. `pnpm dupes` is the tool,
`tests/duplicate-implementations.json` is the baseline every entry of which
carries a disposition and a REASON, and the baseline only shrinks.

### RULING 104 — AN ARTIFACT THE AUTHOR PLACES IN THE REPO IS AN INPUT THE SESSION MUST REACH

(Adopted 2026-08-23, Hunt 6 hardening item 15. **Extends RULING 94 to visual
sessions explicitly**, which were outside its stated scope.)

**Unreachable is a defect to report, never a permitted outcome.**

The 8/22 visual brief pointed at a Google Drive folder. A session has a shell
and a repo and no Google credentials: the input was unreachable BY
CONSTRUCTION. The brief then said *if the folder is unreachable, proceed and
report that — it is not a blocker*, which is a pre-authorized exit, and the
session took it and honestly reported that it had not attempted the folder.

Both halves were the brief's fault. The cost was specific: `LBL-2` came back
*"0 found, could not reproduce, did not guess"* while the image showing it sat
in a folder the session never opened. **Refusing to guess at a fix was correct.
Stopping with unread evidence was not.**

RULING 94 already says a non-attempt before recording an obstacle is void. It
was written for hunts. It binds visual sessions too. The captures live in
`docs/feedback/<date>/`, they are committed, and `tests/asset-store.test.ts`
names the exemption with its reason so a size guard cannot push them back out
to somewhere a session cannot reach.

### RULING 105 — RENDERING IS REPORTED AS A THREE-WAY SPLIT

(Adopted 2026-08-23, Hunt 6 hardening item 15. **Extends the two-numbers rule
above** from a pair to a triple.)

**Never a bare count. Three numbers, each with its denominator: what is
RENDERING, what is OUT OF SCOPE with the reason, and what is IN SCOPE AND STILL
DARK.**

*"174 bodies render"* sounds complete and says nothing about the ones that do
not. **The middle number is what keeps the report honest**, because without it
there is no way to tell a body this product decided not to cover from a body it
failed to reach — and those need completely different responses. One is a
decision; the other is work.

### RULING 106 — NO GENERATED DOCUMENT CARRIES A SIZE CAP

(Adopted 2026-08-23, Hunt 6 hardening item 16, `NS09` — the author ruled C and
extended it: there are no caps anywhere. **Supersedes the 40 KB cap** set
2026-08-17 and the 20 KB one before it.)

**A file this project generates for itself is as long as it needs to be.
Nothing trims it to fit. Where a generated file grows, the response is to remove
duplication in the SOURCE, never to clip the output.**

A cap forces silent trimming, and silent trimming is a partial that reconciles
and reports success — **RULING 100's failure, one floor up.** `context.md` was
capped at 20 KB and dropped its entire tracker-change section; the cap was
raised to 40 KB; by 2026-08-23 the same cascade was dropping the same section
again and walking P0 notes from 130 characters down to 90. Raising a limit is
treating a symptom, and the third time it happens the limit is the problem.

Two caps found and removed: `context.md`'s `CAP_BYTES` (40 KB, now `Infinity`,
and the shrink cascade deleted rather than loosened), and `docs/log.md`'s
twelve-row clip on its finished and still-open lists — the same trim wearing a
polite face, which grew the file by 25 KB when it came out.

**What replaces a cap.** Uncapped, a generated orientation file can creep toward
reproducing this one and leave two authorities that disagree. **Every section
states where it came from, and any block claimed VERBATIM is tested against its
source so divergence fails the build.**
`tests/context-pinned-conduct.test.ts` holds both, and its provenance sweep
immediately found a real gap: the pinned conduct block named its source only at
the END, after the whole thing, rather than where a reader arrives.

## TWO RULINGS OF 2026-08-23 — THE VISUAL TAIL AND REHUNT SESSION

(Adopted 2026-08-23, the author's visual-tail-and-rehunt brief, items 1, 2 and
10. **RULINGS 107 and 108.** `docs/rulings.md` carries both in plain language,
because a ruling the author cannot read is a ruling that does not bind him.)

### RULING 107 — A FRESHNESS DATE IS WRITTEN ONLY BY THE CODE PATH THAT PERFORMED THE READ

(Adopted 2026-08-23, item 1. **Closes `NH80`.** It is the enforcement half
**RULING 96** was missing: that ruling made last-walked dates the instrument
deciding whether a source is re-walked, and had no way to distinguish a date
somebody earned from a date a program printed.)

**A stamp that updates without a read is not a freshness record. It is the
suppression of one.**

*The rationale stays attached, because a stripped rule reads as guidance.* A
missing date sends a session back to the source. A confident wrong date stops
it, permanently — so a restamp does not merely fail to help, **it suppresses
the re-walk that would have caught the staleness**, which is worse than
`UNKNOWN`. RULING 53 already says a record that cannot say when it was measured
reads as stale rather than fresh, because defaulting the other way is how a bad
date buys permanent trust. This is that reasoning applied one layer down, to the
generators that WRITE the dates rather than the register that holds them.

*What `NH80` feared, and what was actually there.* `NH80` left
`lib/officials/directory-source.ts` un-regenerated on the belief that
`pnpm congress:migrate` would restamp a `collectedAt` of 2026-08-16 without
re-reading. Regenerated against the committed snapshot it came back
**BYTE-IDENTICAL** — it propagates `snapshot.source.collectedAt`, the day the
data was genuinely read, and was already honest. **The defect was one file
over.** `docs/congress-legislators-diff.md` moved its header from
*Generated 2026-08-16* to *Generated 2026-08-23* with nothing read, because the
value feeding it was a clock call named `collectedAt`.

- **Two kinds of date, named apart and typed apart.** A **read stamp** answers
  *how current is this DATA* and is mintable only from evidence of a read, or
  CARRIED forward from a prior read — which is what propagation is, and is
  honest, because the date still names the day somebody looked. A **run stamp**
  answers *when did this PROGRAM run*, comes from the clock, and **may never be
  written into a freshness field.**
- **Where no read is evidenced the answer is `UNKNOWN`**, which reads as stale.
  There is no `--today` escape, for the reason `scripts/sources-freshness.mts`
  already gives: stamping an entry with today's date without having called it is
  the fabrication rule.
- **An adapter that stamps the moment it fetched is NOT restamping**, and that
  carve-out is DECLARED rather than inferred — a file states
  `@freshness-reads-here` when its clock stamps sit in the reading path.
  Declaring costs a diff, which is the same mechanism `tests/guard-census.json`
  uses to let a guard leave. **A carve-out nobody has to write down is a
  carve-out that grows.**

The machinery is `lib/ops/freshness.ts` (branded types, so the mistake cannot be
written in new code) and `lib/ops/freshness-audit.ts` (a source sweep, because a
plain string assigned a plain string type-checks perfectly). `pnpm freshness:audit`
reports; `tests/freshness-provenance.test.ts` enforces the registered generators
and pins the wider class to a baseline that **only shrinks**.

**Measured on adoption: 10 of 10 registered generators audited, 1 able to
restamp without reading and now 0; 523 files swept, 31 clock-fed sites found,
29 verified by hand as reading paths and declared, 1 fixed, 1 a tracker row.**

### RULING 108 — ANYTHING A SESSION MUST READ AT SESSION START LIVES IN THE REPO

(Adopted 2026-08-23, item 2. **Generalises RULING 104**, which said an artifact
the author places in the repo is an input the session must reach. This says
where it has to be placed for that to be possible at all.)

**A session has a shell and a clone. The Drive mirror is a convenience for the
author, never a channel to a session.**

- **The repo copy is the PRIMARY output, written FIRST, and never guarded.**
- **A mirror failure is a warning about the mirror**, never a reason to produce
  nothing.

*The rationale stays attached.* `context.md` — the orientation file every
session is told to open first — was written to the Drive mirror ONLY, and
`scripts/handoff.mjs` **returned early when the mirror was absent**, which it is
on every machine that is not the author's. So on a session's machine the file
was not merely unreachable: it was never written. Every improvement made to it
landed where no session could see — RULING 106's uncapping, the tracker-change
section restored to ten of ten rows, P0 notes restored to full length.

**This is the second time in two sessions.** The first was the 8/22 visual
brief's Google Drive folder, which RULING 104 was adopted over, and the shape is
identical: something is left for a session in a place only a person can reach,
and the session honestly reports that it did not look.

*Why the ORDER is the rule and not a detail.* A mirror write that came first and
threw would leave the repo copy unwritten — the failure this ruling ends,
rebuilt inside the fix for it. `tests/context-pinned-conduct.test.ts` asserts the
repo write precedes the mirror write in the generator's own source, and that
handoff no longer returns early.

**The artifact: `docs/context.md`, 44,383 bytes, uncapped, carrying the
`## DISCOVERY CONDUCT` block verbatim from this file.**

## TWO RULINGS OF 2026-08-23 — THE REMOTE SESSION

(Adopted 2026-08-23, the author's remote visual-tail brief, item 8.
**RULINGS 109 and 110.** `docs/rulings.md` carries both in plain language,
because a ruling the author cannot read is a ruling that does not bind him.)

### RULING 109 — A BRIEF DECLARES THE ENVIRONMENT IT REQUIRES, AND THE SESSION VERIFIES IT BEFORE ITEM ONE

(Adopted 2026-08-23, item 8.)

**Every brief declares which of two kinds it is, and the session confirms it
before item one.**

- **LOCAL-REQUIRED** — the work needs credentials, live network, or
  production.
- **REMOTE-CAPABLE** — every item runs against committed data and a local
  production build.
- **A HUNT IS ALWAYS LOCAL-REQUIRED**, because a hunt is by definition
  retrieval.

**A session in the wrong environment says so IMMEDIATELY and does the subset it
can**, rather than discovering the constraint partway down a ladder.

*The rationale stays attached, because a stripped rule reads as guidance.* The
remote session of 2026-08-23 opened by answering four questions — is
`.env.local` present, is any host but `github.com` reachable, is Playwright's
Chromium usable, does a local production build run — and had all four inside a
minute. Without that opening the same facts arrive one at a time, each as a
failure in the middle of some other item, and each costs the time it takes to
decide whether it is a broken tree or a deliberate boundary. `NH92`'s wall was
established the expensive way, across rungs 2, 3, 4 and 6, by a session with no
way to know it was policy.

**Where a required input is unreachable, that is RULING 104's defect to report
— never a permitted outcome.** Declaring the environment is what makes the
difference visible before the ladder is walked.

### RULING 110 — A SEARCH THAT RETURNS NOTHING MUST SHOW IT LOOKED IN THE RIGHT FORM, NOT ONLY THE RIGHT PLACE

(Adopted 2026-08-23, item 8. **It is RULING 100's lesson moved from extraction
to search**: that ruling catches a reader that came back with SOME of a
document and reported all of it; this catches a search that came back with none
of a thing and reported it absent.)

**Absence of a match is not absence of the thing. A sweep reports the SHAPES it
searched, not only the terms.**

- **A shape is the pattern the thing takes, not the letters it is spelled
  with** — *a sentence announcing we will not describe something*, never *the
  string "we're not going to describe it"*.
- **The instrument is shown catching the real instance.** A sweep that cannot
  find the defect it was written for is a sweep reporting green about nothing,
  and the test that proves it carries the shipped copy verbatim.
- **The report states N found, N removed, and the search forms used.**

*The rationale stays attached.* On 2026-08-23 a session reported the
*"we haven't read the law"* refusal gone from the repo. It had grepped one
string. The copy was alive in `lib/ballot/battlecard-sections.ts` under
different wording, **on the FIRST and MANDATORY section of every candidate
card** — so while the product counted 214 bodies with no definition, every
candidate on every ballot opened with the app declining to describe the office
they were standing for. **That report was not dishonest**; it searched in the
wrong form, and nothing in the process asked it to prove otherwise.

**The half that is easy to get wrong would delete a rule rather than enforce
one.** A refusal and a NAMED GAP use nearly the same words. *"We haven't
recorded this chamber's vote on this yet"* is REQUIRED by the render-default
rule. What is forbidden is announcing that we will therefore say nothing. Every
shape is tested against the honest lines this product ships (`KNOWN_GOOD` in
`lib/text/refusal-shapes.ts`), because an instrument that flagged them would
become pressure to delete the attribution rule instead of the refusal.

The machinery is `lib/text/refusal-shapes.ts`, `pnpm sweep:refusal` and
`tests/refusal-copy.test.ts`; its sibling for render defaults is
`lib/text/absence-defaults.ts`, `pnpm sweep:absence-defaults` and
`tests/absence-defaults.test.ts`.

## TWO RULINGS OF 2026-08-23 — THE QUESTIONNAIRE AND THE CORPORA

(Adopted 2026-08-23, the author's questionnaire-and-corpora brief, item 5.
**RULINGS 111 and 112.** `docs/rulings.md` carries both in plain language,
because a ruling the author cannot read is a ruling that does not bind him.)

### RULING 111 — A JOIN IS NEVER A LOOKUP FOR A FACT THAT LIVES ON ONLY ONE SIDE

(Adopted 2026-08-23, item 5. It is **RULING 100's failure moved from reading a
document to reading a database**: that ruling catches an extraction that came
back with SOME of a document and reported all of it; this catches a query that
came back with some of a table and reported all of it.)

**Before querying a joined source, state which SIDE holds the fact and whether
the join can DROP ROWS. Where it can, query the side that holds it.**

*The rationale stays attached, because a stripped rule reads as guidance.* A
join drops the rows that fail to match, and **a dropped row is returned as
nothing — which is the same shape as a genuine absence.** No instrument in this
repo can tell those apart, because every instrument asks whether something came
back.

The district classifier asked the Census–NCES crosswalk whether a school system
is INDEPENDENT or DEPENDENT. **Only the Census file carries that fact**; NCES
does not. So a question one file could answer completely was put to two files
stapled together, and the crosswalk's own report states the cost outright:
**4,083 of 13,859 Census school systems have no NCES match and are absent from
it entirely** — 3,373 of 12,546 independent districts and 710 of 1,313
dependent ones. Every one of those vanished silently and read exactly like an
honest `UNCLASSIFIED`.

**The join was not built badly, and that is the point.** The two files share no
identifier at all: NCES publishes a Census ID only on the F-33 fiscal survey,
which is a separate acquisition. The crosswalk therefore matches on state code
plus normalised name, one-to-one, and counts an ambiguous name as UNMATCHED
rather than resolving it. That is the correct method and it still loses 29.46%.
**A correctly-built join that drops three rows in ten is not a lookup table**,
and no amount of improving it makes it one.

- **Which side holds the fact is stated before the query**, not discovered
  afterwards.
- **Whether the join can drop rows is stated.** A join on names always can.
- **Where it can, the query goes to the side that holds the fact.**

### RULING 112 — A FIRST-PARTY INSTRUMENT IS SYMMETRIC BY CONSTRUCTION, OR IT IS NOT SHIPPED

(Adopted 2026-08-23, item 5. It is the **equal-effort rule's other half**: that
rule governs how hard we look at what already exists, and this governs what we
create.)

**Identical questions, identical word limits, identical deadline, identical
reminders, identical rendering of non-response. Answers publish VERBATIM and are
never summarized.**

*The rationale is hardcoded here so it is not re-litigated.* An incumbent always
has more public material than a challenger. **Hunting harder makes that gap
WIDER, not narrower**, because there is more to find on the incumbent — so the
equal-effort rule, which is a discipline about retrieval, cannot fix an
asymmetry that lives in the source material itself. No amount of hunting closes
it, and the correct response to that is not more hunting; it is an instrument
that does not have the asymmetry to begin with.

A first-party questionnaire is the only one this product can build. Every
candidate in a contest gets the same blank page on the same day. It is also
original data owned outright, which is the ANSWER to the Ballotpedia licensing
question RULING 70 governs rather than a workaround for it.

- **The contest is the unit and it is ALL-OR-NONE.** Every candidate in a
  contest is invited or none is. A contest where the well-covered candidates
  were asked and the thin ones were not is the equal-effort failure in its
  purest form, committed by the instrument built to prevent it. Enforced in
  `lib/questionnaire/invitations.ts` rather than left to a caller to remember.
- **Nothing is ever truncated.** An over-limit answer is REFUSED at submit time
  with its own word count shown, and the candidate decides what to cut. Silent
  truncation favours whoever writes short, invisibly.
- **Answers publish verbatim.** No summarization, no paraphrase, no LLM
  compression, no fact-check annotation inside the answer, no editorial note, no
  rating. **The Citizens Clean Elections Commission's *in their own words* is
  the model.** Enforced by ABSENCE — there is no summary field on the response
  record and no summarising call under `lib/questionnaire/`, and
  `tests/questionnaire.test.ts` sweeps for both BY SHAPE (RULING 110), with
  plants proving the sweep catches a real one.
- **Non-response is neutral and factual and identical for everyone**: invited on
  this date, reminded on these dates, no response yet. **Never evasion,
  avoidance, refusal or declining.** A candidate owes us nothing, and a sentence
  implying otherwise is this product scoring them for silence — the
  recommendation it does not make, delivered by implication. The banned shapes
  are held in `tests/questionnaire.test.ts` with plants.
- **A withdrawal returns the candidate to the NEUTRAL INVITED STATE**, never
  "responded then withdrew". Neutrality wins over completeness here, and it is
  the author's call recorded as one. `renderableResponse` returns the same
  `null` for a withdrawn record as for an unanswered one, so the calling surface
  cannot tell them apart and therefore cannot render them differently.
- **The question set is VERSIONED and the version travels with every answer.**
  Changing it mid-cycle across candidates who answered the old version breaks
  symmetry — two people in one contest would have answered two different
  instruments and their answers would render side by side as though they had
  not. `docs/candidate-questionnaire.md` is GENERATED from
  `lib/questionnaire/instrument.ts` so a second copy cannot disagree with the
  one candidates are actually asked.
- **The plan and the act are different fields** (RULING 107, pointed outward). A
  generated invitation carries `invitedOn: null` and an empty `remindedOn` until
  the code path that actually sends stamps them. Stamping a schedule as a send
  would put a date on an act nobody performed, and the Positions empty state
  reads exactly those two fields to decide whether to tell a reader we asked.
- **Authentication adds no identifier to this product.** A single-use expiring
  token to the email already on the certified filing; no account, no password,
  no new identifier; only `sha256(token)` is stored. **Candidate responses are
  published civic content, not reader data** — they live in the content store,
  and the n-stores rule is untouched: nothing lands on the search log or the
  reactions store.

**Asymmetry in an instrument we control is worse than asymmetry in the world,
because we chose it.**

## TWO RULINGS OF 2026-08-23 — THE GREEN STEP AND THE ALWAYS-ON LAYER

(Adopted 2026-08-23, the CI-and-depth session, item 9. **RULINGS 113 and 114.**
`docs/rulings.md` carries both in plain language, because a ruling the author
cannot read is a ruling that does not bind him.)

### RULING 113 — A STEP THAT REPORTS SUCCESS IS ASKED WHETHER IT DID THE THING

(Adopted 2026-08-23, item 9. It is the **operation-count rule** — *an operation
that can return nothing must be asked what it returned* — pointed at a BUILD
STEP rather than at a data fetch. Supersedes nothing.)

**Where a step's product can be observed, observe it AT THE STEP, not at the
first consumer.**

`main` was red at `3d453fd` with four failures and one cause:
`NO CHROMIUM INSTALLED. Wanted build 1234; searched /home/runner/.cache/ms-playwright`.
The step before them, whose entire job is installing that browser, **reported
success in 27 seconds** — and its own log, two screens above the failure, reads
`Chrome for Testing 151.0.7922.34 ... downloaded to /home/runner/.cache/ms-playwright/chromium-1234`.

**The install landed in exactly the directory the suite searched.** What failed
was `lib/ops/chromium-pin.ts`, looking for the binary at the legacy
`chrome-linux/chrome` while Chrome for Testing puts it at
`chrome-linux64/chrome`. It had never worked on any platform with the pinned
Playwright, the author's own Windows machine included.

Two separable failures, and the second is the one that cost the time:

1. **A step reported success with its product unchecked**, so the defect
   surfaced eighty seconds later inside four unrelated tests, after a
   2,000-test suite had already run.
2. **The message named the wrong half.** *"NO CHROMIUM INSTALLED"* about a
   directory holding a freshly installed Chromium sends every reader to the
   installer, which was working perfectly. An absence that can name what it DID
   see points at the reader instead of the writer.

So: a step whose product is observable carries a check immediately after it,
naming what it looked for, where, and what it found. **Where the product can be
compared against what the TOOL ITSELF reports producing, compare them** — that
is the drift check nothing had here, and the only one that could have failed.
`scripts/assert-browser.mts` is the instance; the rule is the class.

**The check has no skip flag**, for the reason the build gate already gives: an
escape hatch on a gate is how the gate stops meaning anything. The one locally
available "fix" — letting the guard pass with no browser — is what
`scripts/browser.mts` forbids in as many words.

### RULING 114 — A LAYER THAT ALWAYS RENDERS MUST BE RIGHT, BECAUSE COMPLETING IT REMOVED THE HONEST SILENCE

(Adopted 2026-08-23, item 9. It is the **render-default rule** read forward in
time: that rule forbids a default converting absence into an assertion, and
this governs what happens when there are no absences left. Supersedes nothing.)

**Every always-on stamp is asserted against a SOURCE OF RECORD, and a mismatch
FAILS rather than renders.**

`classKeyFor` had Census LSAD **43** and **44** reversed — 43 is `town`, 44 is
`township` — so New Jersey's township definition rendered on **Morristown,
Kearny, Dover, Newton, Boonton, Westfield, Clinton, Hackettstown, Phillipsburg,
Harrison and Belvidere**. Not one of those is a township.

*The rationale stays attached, because a stripped rule reads as guidance, and
here the rationale is the whole rule.*

**Closing the class layer to 1,253 of 1,253 is what made the swap dangerous.**
While the layer was incomplete, a body with no definition rendered NOTHING —
and nothing is never wrong. Completing it converted every misclassification
into a false claim about how a reader is governed, silently, because **a wrong
definition looks exactly as healthy as a right one.** Coverage went from a
number that could only embarrass us to a number that can lie.

**A completeness figure therefore needs a companion that can go red.**

- **The check is against a DIFFERENT PUBLICATION.** Re-deriving a stamp from the
  field it was stamped from proves only that the code is deterministic; it would
  have agreed with the swap on all 1,253 rows, every day, for as long as the
  swap lived. TIGER describes a POLYGON; the 2022 Census of Governments
  describes a GOVERNMENT and names it in full — `TOWNSHIP OF ROCKAWAY`, `TOWN OF
  MORRISTOWN`. The swap disagrees with the second on every row it touched.
- **Joined on an identifier, never a name string**, and **gated on the KIND of
  government as well as the code**. A school district's GEOID occupies the same
  seven characters a place code does, and an ungated lookup joined six districts
  to unrelated towns and cities.
- **Two authorities disagreeing is a FINDING (RULING 57), closed by walking a
  third branch and recording what it said** — never by editing the expectation.
  Buckeye, Arizona is the live case: TIGER says city, the 2022 roster says `TOWN
  OF BUCKEYE`, the body's own site is walled at rung 3, and rung 11's archived
  capture carries *"City of Buckeye"* three times on its own homepage. The
  roster name is stale. It is recorded as ADJUDICATED **with the route that
  settled it**, and it still reports as a disagreement — an adjudication list is
  not a suppression list.
- **A row with nothing to compare against is counted SEPARATELY, by name, with a
  reason, and never folded into the verified total.** A sweep that quietly
  counted the unchecked as agreeing would report confidence it never measured —
  RULING 100's partial, one floor up. And a floor is asserted on the verified
  count, because a sweep whose source failed to load would report zero
  mismatches and read green.

The machinery is `scripts/class-stamp-sweep.mts` (`pnpm class:sweep`),
`data/derived/class-stamp-sweep.json`, and `tests/class-stamp-sweep.test.ts`.

## TWO RULINGS OF 2026-08-24 — THE DRILL AND THE FROZEN GAP

(Adopted 2026-08-24, the overnight depth hunt, items 6 and 8. **RULINGS 115 and
116.** `docs/rulings.md` carries both in plain language, because a ruling the
author cannot read is a ruling that does not bind him.)

### RULING 115 — A DRILL IS NOT A FAILURE

(Adopted 2026-08-24, item 8, closing the diagnosis on `JOB02`. Supersedes
nothing.)

**An alarm must be able to tell an EXERCISE from an EVENT. One that cannot will
eventually cry wolf, and the cost is never the false alarm — it is the real one
nobody reads.**

*The rationale stays attached, because a stripped rule reads as guidance.*
`JOB02` recorded that `refresh-meetings-snapshot` failed on two CONSECUTIVE runs
and healed unexamined, and reasoned — correctly, by the rule as it stood — that
two in a row is evidence the cause is ours rather than a host refusing on a
schedule. The watcher raised a **P1 Needs Sean row**.

**Both runs were deliberate drills.** Runs `32543393133` and `32543652154`, five
minutes apart, both `workflow_dispatch`, both carrying
`WTP_INGEST_FORCE_JOB_FAILURE`, and both logging the ingest's own sentence:
*"This failure is FORCED … No vendor failed. No source failed."* Somebody was
testing this very watcher and it worked.

So the alarm performed perfectly and produced a row nobody could act on. **The
Needs Sean queue is precisely where that cost lands**: it is the one channel
that reaches a person, and an item in it that turns out to be nothing teaches
the reader to skim the next one.

Three parts, and the last two are the ones easy to get wrong:

- **Only the test that RAISES a row is narrowed.** The failure RATE still counts
  every run, because the rate is a fact about the workflow and a drill did fail.
- **The number set aside is PRINTED on every run.** A deliberate exclusion that
  reads as a clean result is the silent-trim shape this file names more often
  than any other.
- **An UNKNOWN trigger is not a drill.** Where the kind of run cannot be read,
  the alarm still fires. That direction costs a wasted look; the other loses a
  real failure.

*Why the trigger rather than the forced flag.* The flag lives in the run's
INPUTS, which the run list does not carry, so reading it means a log fetch per
run — forty logs to answer one question. The trigger is already in the list, and
it is the better question anyway: **a watcher exists to catch a job breaking on
its OWN CADENCE**, and a manual dispatch is a person doing something deliberate.
The workflow already refuses the force flag unless the run is a dispatch, so
every drill is a dispatch by construction.

The machinery is `runsOnOwnCadence` in `lib/ops/job-watch.ts`, guarded in
`tests/watch-workflows.test.ts` — including the case that matters more, *a real
scheduled double failure STILL raises a row*, so narrowing the input cannot have
narrowed the detector.

### RULING 116 — A GUARD MAY PIN AN INVARIANT OR A DIRECTION, NEVER THE SIZE OF A GAP

(Adopted 2026-08-24, item 6. Supersedes nothing. It is the **two-numbers rule**
pointed at the test suite rather than at a report.)

**A test that freezes how much work is LEFT goes red when the work gets done.
That trains a reader to raise the constant instead of looking at what changed —
which is the opposite of what a guard is for.**

*The rationale stays attached.* `tests/body-form.test.ts` asserted
`owedAFormDefinition === 1037`. That was true the day it was written. Reading
eight municipal statutes and writing `lib/officials/form-definitions.ts` took
bodies carrying a form definition from **216 to 857**, so owed fell to 396 —
**and the suite went red because the work had been done.** Nothing was wrong.
The guard was measuring the size of the hole.

What is worth holding still is the SHAPE of the accounting, never its current
value:

- **The INVARIANT.** Every body is either described or counted as owed, and the
  two sides sum to the total. True at any coverage, and it is what catches a
  body going missing.
- **The DIRECTION.** Coverage may improve and may not silently reverse. A number
  going the wrong way is a real finding; going the right way is the point of the
  project.
- **The PAIR.** Both halves asserted together, because *owed fell* on its own is
  also what it looks like when rows vanish.

*Why this is a ruling rather than a note.* A frozen coverage number does not
fail loudly and get fixed. **It fails on the day somebody made progress**, and
the cheapest way to make it green is to edit the constant to match. Do that
twice and the guard has become a record of what coverage happens to be — which
nobody reads — rather than a claim about what must always be true, which
somebody would.

## THE EIGHT RULINGS OF 2026-08-24 — THE AUDIT REMEDIATION

(Adopted 2026-08-24, the audit-remediation session, item 9. **RULINGS 128
through 135.** `docs/rulings.md` carries all eight in plain language, because a
ruling the author cannot read is a ruling that does not bind him.)

Two external audits of `ae5b178` (code head `336a3eb`) — one for correctness,
one for performance — returned eight findings, two systemic patterns and six
performance items. **Every finding was REASONED rather than reproduced**,
because the auditor could not run code, so the session's law was that no fix
ships without its finding first reproduced against the code as shipped. Eight of
eight reproduced; none was disputed.

### RULING 128 — EXTRACTION CONSERVES, AND THE SUM IS EXACT

(Adopted 2026-08-24. Answers **A-002** and **S-001**. Extends the
zero-row-extraction rule and RULING 100; narrows neither.)

**`produced + dropped + outOfWindow + duplicates === logicalInput`. Exactly.
Every logical record has one disposition, and a record that has none vanished.**

The shipped contract asked a BOOLEAN — *was anything dropped?* — and a boolean
cannot tell one drop from ninety-nine. Reproduced before it was touched: 100
logical inputs, 0 output, `{malformed: 1}`, branded as a fully-accounted result.
**One recorded drop laundered ninety-nine disappearances.**

That was the right question for RULING 43, which is about a pass that produced
NOTHING. It is silent about a pass that produced SOME — which is RULING 100's
partial exactly: *a total that reconciles is not a total that is correct.*

- **The unit is the LOGICAL RECORD, never the document.** One `.ics` file is one
  raw row and 1,157 events. The old module doc used that fact to argue against
  counting; the answer to *documents and events are different units* is to count
  in the unit the disposition happens in, not to stop counting.
- **A pass that cannot count records `COULD_NOT_ASSERT`** — named, reported,
  never a silent pass. `clerksboards` is the honest case: where a clerk writes
  *meets as required*, one counted drop stands in for an unknowable number of
  sittings and no true number exists.
- **A duplicate is a disposition**, and it used to be a bare `continue` leaving
  no trace — which is also where A-005's collisions vanished.

The machinery is `conserve` in `lib/sources/normalize-account.ts`, guarded in
`tests/conservation.test.ts` and swept in `tests/zero-row-contract.test.ts`.
Measured on adoption: 13 of 13 call sites declare a count, 12 adapters' fixtures
re-run under the shared contract, 0 newly failing.

### RULING 129 — A SAFETY CAP IS A FAILURE BOUNDARY, NEVER AN IMPLICIT END OF DATA

(Adopted 2026-08-24. Answers **A-006**. Supersedes nothing.)

**Reaching a cap while the source still advertises more is a FAILURE, and it
throws — naming the pages fetched, the rows read, and the URL not followed.**

Apptegy stopped at twelve pages with the API still offering a next page: 240
events read, an unknown number left on the server, no error and no partial
marker. The adapter's own comment already called the cap *a runaway stop, not a
coverage cap*, and the code did not enforce the difference. **A cap documented
as unreachable and silently reachable is worse than one nobody claimed anything
about.**

The sweep this required found the identical shape in `legistar`'s `pageById`,
behind an identical comment. The cap itself stays — a runaway stop is a real
need — and what changed is what hitting it MEANS.

### RULING 130 — EVERY TRANSPORT SUCCESS PASSES ONE SHARED DOCUMENT FINALIZER

(Adopted 2026-08-24. Answers **A-003**. Supersedes nothing.)

**A body becomes a return value in exactly one place, and every rung goes
through it.**

The 403 escalation had two return paths that never met `notADocument`: rung 3
was checked only for a known challenge page, and rung 4 was returned raw with
neither check. **Document validity depended on WHICH RUNG succeeded** — the same
bytes refused on rung 2 and accepted on rung 3. Reproduced against the shipped
code: an HTML 404 page returned as an `.ics` feed.

**And no test could reach either branch**, because the escalation is gated on
`!options.fetchImpl` — correct, so a fake fetch is not routed around, and the
effect was a production path nothing could observe. That is the chromium-pin
shape. `HttpOptions.ladder` is the DECLARED seam; production injects nothing and
walks the real rungs.

### RULING 131 — A PARTIAL SOURCE IS A FIRST-CLASS RESULT

(Adopted 2026-08-24. Answers **A-004** and **S-002**. Extends the refresh
corollary; narrows nothing.)

**A result says which SCOPE failed, for which divisions, and why. Completeness
is never inferred from `ok: true`, and carry-forward preserves the failed scope
and no other.**

`ical` fetches two feeds per body, and the past feed's failure was caught by an
EMPTY `catch` whose comment read: *the archive's absence is visible as a
jurisdiction with no concluded meetings.* **That sentence is the render-default
failure written down as a design note.** The adapter reported success,
carry-forward preserves rows only for a source or division that FAILED, and
every concluded meeting the previous snapshot held was deleted by an outage.

Marking the whole division unreachable would be wrong the other way — the
upcoming feed answered, and carrying its rows forward would resurrect a sitting
the town had just cancelled. So an `ARCHIVE` failure carries back only sittings
that had already concluded, asserted in both directions.

### RULING 132 — THE IDENTITY BOUNDARY IS PROVEN OVER VALUE SPACES, NOT COLUMN NAMES

(Adopted 2026-08-24. Answers **A-001**. It is **The collection stores never
join** made enforceable; it narrows nothing.)

**No reader collection store may hold a value that identifies a person
independently of us.**

The claim in this file is absolute. The test that was supposed to assert it
checked column NAMES against a fragment list — and `feedback.reply_to` held a
raw email address, does not contain the letters `email`, and was waved through
as a carefully-written named exception. `questionnaire_invitations.email` holds
a raw email address too. **One value space, two tables, equality-joinable, and a
guard that could not see it** — RULING 110's wrong-form search, inside a test.

- **Classification is by DOMAIN**, in `lib/db/identity-domains.ts`: every column
  of every table, and a column missing from it fails the build.
- **World value versus minted handle is the distinction that matters.** An email
  address is joinable using data nobody here controls. A handle we minted is
  joinable only where we put it, and we can say where.
- **A shared deterministic hash is the same join key relocated.** Two tables
  holding `sha256(address)` still match. The contact handle is `randomUUID()`,
  never derived from the address.

*The scope correction, recorded rather than smoothed.*
`questionnaire_invitations.email` is a candidate's address from the county
clerk's certified public filing, held to send one questionnaire, and nothing
about it is wrong. **The finding's force is the CLASS**: an absolute claim is
falsified by one counterexample however defensible the other side of the join
is.

### RULING 133 — A PERFORMANCE CHANGE SHIPS WITH ITS MEASUREMENT

(Adopted 2026-08-24. Answers **P-001** through **P-004**. Extends the
two-numbers rule and RULING 113; supersedes nothing.)

**Counts, bytes or timings, before and after, asserted by counters or committed
baselines. Never visual equivalence.**

`lib/map/marker-pool.ts` claimed since it was written that a filter narrowing
500 pins to 480 does 20 DOM writes. Nothing measured it, and the wiring made it
false: the canvas was handed the FILTERED venues, so twenty filtered-out venues
arrived as twenty venues the data no longer had and their markers were
destroyed. **Visual equivalence cannot tell a reused marker from a recreated
one** — the map looks identical either way, which is why it lasted.

- **A change is KEPT ONLY IF THE REBUILT NUMBER FELL.** P-002's first attempt
  moved the landing bundle from 2,955,835 to 2,956,534 raw bytes — UP — because
  one static importer remained. A change kept because it sounded right is what
  this forbids.
- **A speed change that alters an answer is a wrong answer that arrived
  faster.** P-003 cut exact polygon tests from 2,291 to 14 per lookup and
  shipped only because **279 of 279** supported zips resolve to an identical set
  of divisions.

### RULING 134 — AN INSTRUMENT WITHOUT A COMMITTED BASELINE IS UNFINISHED

(Adopted 2026-08-24. Answers **P-005**. Supersedes nothing.)

**It measures nothing until normal is recorded — and a dishonest baseline is
worse than none.**

`pnpm perf` has existed since 2026-08-17 and `docs/perf-baseline.md` has never
been committed: a thermometer with no recorded normal temperature. Run on this
machine against a local production build it reported *hardware acceleration OFF
or UNKNOWN* and `NaN` for every frame metric. **That output was not committed**,
which is the rule working: the row stays open with the measurement attached
rather than closing on a number that describes a rasterizer.

### RULING 135 — A FENCE BARS ACTING ON CONTENT, NEVER COMMITTING THE AUTHOR'S ARTIFACTS

(Adopted 2026-08-24, the author's instruction. Refines **RULING 104**; narrows
nothing.)

**A file the author places in the repo is registered into git UNREAD, and the
fence on its content stands in full force.**

RULING 104 says such an artifact is an input the session must reach. A standing
fence says a session may not act on a visual batch's contents until the visual
session owns them. Read together they appeared to conflict, and the conflict
blocked `handoff --ship` for every session while the files sat untracked.

They do not conflict. **Committing is REGISTRATION, not action.** `git add` on a
capture the session never opens is precisely what makes it reachable to the
session that owns it, and it reads nothing.

*Recorded because it is a fact about the repo rather than about the rule:* on
2026-08-24 `docs/feedback/8.24/` existed and was EMPTY. There were no captures
to commit, git cannot track an empty directory, and the session's first act was
therefore a no-op — reported rather than smoothed.

## Entry experience

The app opens on a map. The user enters a zip code, the map zooms, upcoming local meetings and hearings render as pins.

Zip is orientation only. ZCTAs cross city, county, school district, and legislative boundaries, so a zip can never resolve a ballot. Store zip as `approximate_location` and never treat it as district truth. Prompt for a street address only when the user wants their actual ballot, and explain why at the point of asking.

Zoom targets come from Census ZCTA centroids. District boundaries from Census TIGER/Line.

Never render an empty map. If nothing upcoming is in view, widen the radius, then show recently decided items, then fall back to district boundaries with officeholders.

## Reaction capture

This is the revenue-generating path. Treat it accordingly.

Reactions are always asked **after** the explanation, never before.

**Measures** are decomposed into contested provisions — funding mechanism, spending program, oversight, sunset — and reactions attach to provisions, not to the measure as a whole. Schema must support many reactions per measure keyed by provision.

**Candidates** get reactions attached to a specific sourced position, never to the candidate as a whole. The question is "would you vote for someone who holds this position," not "do you like this candidate."

Each reaction has a one-tap binary and an optional free-text field. Binary carries volume; text carries color. Never require the text.

**Incumbent and challenger reactions are stored and aggregated in separate buckets.** Incumbents have records, challengers have rhetoric. Aggregating them makes incumbents look worse by construction.

**Disclosure at the point of capture — the one-time acknowledged notice.** (Author-revised 2026-08-13; the prior form was an always-visible sentence beside every input.) The first reaction tap a device ever makes surfaces a one-time notice — "Your answer joins anonymous local totals. We never know who you are. How we use this →" — that must be acknowledged before the answer is recorded; the acknowledgment stores device-local and the notice never repeats. The linked transparency page carries the full truth, including that totals may be sold. The gate blocks capture until acknowledged: an unacknowledged tap parks and applies only on acknowledgment, never silently records. Still never buried in a privacy policy — the notice is at the capture point, the reader must pass through it exactly once, and `tests/reactions.test.ts` pins the sentence, the link, and the park-don't-record behavior.

**Moderation runs before any export.** Free text about named real people will contain slurs and threats. No aggregate leaves the system unfiltered.

**The free-text input carries a threat notice.** Adjacent to the field, plain and short: threats of violence are removed and may be reported to law enforcement. Wording is "may," not "will" — a stated commitment that isn't honored on every instance is worse than a reserved right.

Flagged text is preserved with full metadata, never silently deleted — deletion destroys evidence. Flagging never auto-reports; every report passes human review first. See `docs/abuse-policy.md`.

## Signal integrity

The attacker with the strongest motive is a buyer. A campaign that can fake eight thousand lookups in a district shapes what the other side spends money on. Design against a funded adversary, not a kid with a script.

Gates, cheapest first:
- Device attestation on every write — App Attest, Play Integrity, Cloudflare Private Access Tokens. Proves a real device without identifying a person.
- SMS verification with carrier lookup. Reject VoIP and prepaid numbers. This is the single highest-value gate per unit of friction.
- Address validation via USPS or Smarty — confirm existence, residential, deliverable. Invisible to the user. Cap responses per household.
- No postcard verification. Kills the funnel on a free product nobody's heard of.

Weight, don't gate. The product has natural proof-of-work: a real user reads the explainer before reacting. Record time on measure, scroll depth, provision expansions, and arrival-to-answer gap. Store an engagement score on every reaction and weight it in aggregation. Bots jump to the endpoint; faking realistic reading across thousands of accounts is expensive and leaves patterns.

Honeypots: occasionally serve a provision nobody would have an opinion on, or a fake measure in a district that has none. Scripts answer everything.

Anomaly detection runs on the aggregate layer — timing bursts, response clustering, text entropy, geographic distribution against population density. Assume detection, not prevention.

**Every export reports its confidence mix.** Counts by verification tier — device-attested, SMS-verified, address-validated, unverified — plus engagement-weighted and raw figures. Never ship a single blended number. Stating the confidence converts an unsolvable problem into a disclosed one.

## Data model conventions

OCD-IDs (`ocd-division/country:us/state:az/...`) are the universal join key for districts, offices, and elections. Every geographic entity carries one. Never join on name strings.

Evidence is tiered and stored explicitly: `STATEMENT` (what they said), `RECORD` (how they voted), `FUNDING` (who paid). The UI keeps these visually distinct. Don't collapse them.

Every externally sourced record stores `source_url`, `source_org`, `collected_at`, `verified_at`. Provenance is never dropped in a transform.

Signal snapshots are immutable and timestamped. Calibration depends on being able to prove what the data said before an outcome was known. Never backfill or amend a published snapshot — write a correction record instead.

## External sources

**`docs/sources.md` IS THE SOURCE OF RECORD FOR WHAT RESOURCES EXIST.**
(Stated 2026-08-22, the author's instruction, NJ Hunt 6.) Every source is
recorded there, not only the keyed ones — a keyless public route is a source
and a source walked but never recorded is a source the next session
re-derives. Each row carries its **status**, its **access method**, its
**licence status** (`.gov` public domain, CC BY-SA, nonprofit terms), and the
**tier** it sits at under RULING 84. **And each is also a route in
`docs/branch-manifest.md`: `docs/sources.md` answers *what exists and what may
we use*, the manifest answers *what do we walk and in what order*. Both, every
time.**

**The register is `docs/sources.md`, and this section is the law that governs
it.** (Rewritten 2026-08-20, Prompt C items 4.3 and 9.5.) A table of sources
and their auth mechanisms is shelf-life content: a key gets added, an endpoint
dies, a licence changes, and a stale table in the constitution is read as
current by every session that opens it. `docs/sources.md` carries the live
register — one row per source, with its status (wired / evaluated / not in
use), its auth mechanism, its licence obligations, and the adapter that reads
it. `.env.local`'s keys are enumerated there against what is actually wired, so
a credential nobody uses is visible rather than forgotten.

What does not drift:

- **Do not add advocacy organizations, PACs, or endorsement sites as sources.**
  Go to the underlying government filing. An endorsement list is somebody
  else's judgement about a candidate, and this product does not carry
  judgements about candidates.
- **A licence obligation is law, not a note.** Where a source's terms require
  attribution — LegiScan's CC BY 4.0 is the live case — the attribution ships
  with the data it describes, and `docs/sources.md` records the obligation
  beside the source.
- **Adding an external source is an ask-before**, listed at the foot of this
  file. It is a standing commitment to a third party, and one of them is a
  legal question wearing an API key.
- **A dead endpoint is recorded as dead rather than deleted.** The Google Civic
  **Representatives** endpoint shut down in April 2025 and any code or doc
  referencing it is dead — use Divisions for OCD-ID resolution and get
  officeholders elsewhere. Recording the death is what stops the next session
  rediscovering it.

## Repo layout

**The tree is the tree; read it.** (Rewritten 2026-08-20, Prompt C item 4.3.) A
directory diagram in the constitution describes the repo on the day it was
written and quietly stops describing it afterwards — `docs/code-manifest.md`
and the tree itself are authoritative, and neither can drift from what exists.
What belongs here is the small number of placement rules that are decisions
rather than descriptions:

- **`lib/sources/<name>/` — one ingestion adapter per external source.** Every
  adapter exports `fetch()`, `normalize()`, `upsert()`. **Adding a source means
  adding a directory, never editing shared ingestion logic**, because a shared
  path edited per source is a path where one source's quirk becomes every
  source's behaviour.
- **`lib/db/` — the Drizzle schema, its migrations, and the queries.** Schema
  changes go through migrations; no hand-edited SQL against the database.
- **`tests/fixtures/` — recorded API responses. No live calls in tests.** A
  fixture is the bytes a server actually sent, and `.gitattributes` marks the
  directory `-text` so nothing rewrites that evidence on checkout.
- **`docs/` — methodology, policy, and the standing record.** `docs/state.md`
  is the living state document, `docs/rulings.md` is the append-only record of
  every ruling that is not law, and the two tracker stores named below are
  task status.

**Task status lives in the TWO TRACKER STORES, and the tracker is a queue that empties.** (Rewritten 2026-08-20, Prompt E items 6 and 13; RULING 35.) `docs/tracker-working.csv` holds every OPEN row and `docs/tracker-resolved.csv` holds every finished one. A finished row LEAVES the working view and lands in the resolved store, so the number the author looks at is what is left rather than everything that has ever existed. **Nothing is ever deleted**; the resolved store is permanent and is the record of what was decided and when. `docs/tracker.xlsx` is the workbook he edits by hand — Working, Resolved, and a tab explaining both. `docs/tracker.md` and `docs/log.md` are generated views and are never hand-edited. `docs/tracker.csv` is the FROZEN pre-rebuild snapshot: read for history, never written again, digest-pinned in `tests/tracker-stores.test.ts`.

Update the row for any item you work on, in the same commit as the work, through `corepack pnpm tracker:move` — nothing else writes the stores. **A status change edits the existing row. It never appends a second row with the same ID** — a tracker with two rows per ID cannot be read by anything, and it silently breaks every lookup by ID. M02 and M04 each carried a duplicate pair for a day before anyone noticed. Nothing is resolved without evidence: the branch name, and which of `test` / `lint` / `build` passed. A commit SHA cannot be used — it does not exist inside the commit that would name it. An agent grading its own homework drifts optimistic; this tracker only earns its keep if it tells the truth.

**RULING 37 — WHO MAY MOVE A ROW, AND IT CUTS BOTH WAYS.** (Adopted 2026-08-20.) A session marks its own completed work Resolved and moves it, in every section except **Needs Sean**. **Only the author closes a Needs Sean row** — a session may never mark one Resolved or Conditionally resolved, and may never move one out, however obviously finished it appears. **Sessions OPEN Needs Sean rows**: routing something to his attention is the session's job, and he does not have to notice that something needs him. Guarded in both directions by `tests/tracker-stores.test.ts`, which fails the build if a session moves one.

*Why the second half matters as much as the first.* A rule that only stopped sessions closing his rows would leave the queue depending on him spotting that a decision was waiting. He is one person and the sessions run unattended; the thing that reaches him has to be put in front of him.

**RULING 38 — THE AUTHOR'S RESOLUTION NOTES ARE INSTRUCTIONS, NOT COMMENTARY.** (Adopted 2026-08-20.) Every session opens by running `corepack pnpm tracker:open`, which reads the resolved store for rows resolved since the last run and surfaces his notes and the rows he wrote himself. A **Conditionally resolved** row's condition is a LIVE REQUIREMENT on that session — satisfied, or reported as unsatisfied with the reason. The report states what was read and what was done about each note. **A note read and ignored is a session failure**, and it is the failure this rule exists to name: a note nobody acts on is worse than no note, because he wrote it believing it would be acted on.

**RULING 41 — THE AUTHOR WRITES ROWS TOO, AND A SESSION NEVER REWORDS ONE.** (Adopted 2026-08-20.) Rows do not originate only from sessions. He adds them by hand as he works through the product, most often into Visual feedback and Product / UI. He types a description and **does not invent an id** — the move script assigns one in the correct format and reports which ids it assigned. Attribution records `Sean` as opening author, which is full attribution and never `UNKNOWN`. Every session reads his open rows at session start, so a row added on Monday reaches the next run without a prompt mentioning it, and the session reports what it read. **A session may not reword, retitle, or delete one.** It may work the row, set a priority if none is set, and resolve it under RULING 37. The description is his — he is describing what he saw, and a session rewriting that into what it thinks he meant has replaced the evidence with an interpretation of it. Guarded in `tests/tracker-stores.test.ts`.

**Priority is three levels, ranked inside a section and never across them** (RULING 29): P1 broken or blocking, P2 needed before the section is done, P3 wanted but not needed. Five P1 rows maximum per section (RULING 30) — a section over the cap is REPORTED as stopped, and **the cap is never satisfied by demotion**. Every row has a home in `docs/tracker-sections.json` and there is no holding section (RULING 32). **Gaps are not tracker rows** (RULING 33): a gap is a measurement of coverage and lives in `docs/gap-ledger.md`, which is generated and therefore current; the tracker holds the decision to hunt a place, and the ledger holds which of that place's bodies are still dark.

**One CODE merge per session; close-out records may follow as separate named commits.** (Adopted 2026-08-19, the author's amendment to the merge cadence, after F01 shipped three merges under a rule that asked for one and reported the deviation rather than smoothing it.) The one-merge rule was always about CODE — batching reader-facing change into a single reviewable ship — and it collided with the sentence directly above: **a document cannot name the commit that contains it.** `docs/state.md` must carry the deploy SHA and the real `walk:all` numbers; neither exists until the code has shipped and been walked; writing either before it is known would be the fabrication rule, and chasing the regress would merge forever. So the line is drawn where it actually falls. The session ships its code ONCE. `state.md`, the tracker, and any document carrying the deploy SHA or the walk numbers may follow in separate commits, and the report states the **code SHA and the close-out record SHAs separately and labels them as such** — a reader must be able to tell at a glance which commit changed what a reader sees and which changed only our account of it. F01's `a119578` / `1203d48` / `5daeb8f` / `5253e5f` split is correct under this rule and is not a violation.

**The one exception, and it is the only one** (amended 2026-08-20, the author's ruling): the session ships **one PLANNED code merge**. A SECOND code merge is permitted only to fix a regression the live walk caught — and when one is taken, the report **names the regression and states both SHAs**. That is the whole of the exception: not a second feature, not a second batch of items, not work that ran late. A walk that finds a live regression and a session that ships without fixing it is the worse outcome, and a rule that forced the choice would be a rule against fixing it. Any other second merge remains a deviation and is still reported as one. F01C2's `1407c53` / `7d986cb` split is correct under this amendment.

**An agent does not know today's date, and a date not read from the system clock is a fabrication.** Every stamp entering any document — a tracker Note, a `state.md` section, an `Adopted` line in this file, a provenance field — comes from `pnpm stamp`, which prints today in `America/Phoenix` (a UTC read after 5pm local is a day ahead, and that is the same bug wearing a smaller hat). A plausible date is not a date; it is the same failure as a generated candidate position — a confident claim with nothing behind it — and it is worse here, because it misdates the rule every later decision was supposedly made under. Guarded at authorship by the pre-commit hook and in the suite by `tests/doc-dates.test.ts`; `pnpm verify-stamps` audits this file's `Adopted` stamps against the git history that would have to be true for them, and writes `docs/stamp-audit.md` for the author to rule on. Nothing corrects a stamp automatically — an agent that repaired a date would be doing the thing that caused the defect.

## Commands

**`package.json`'s `scripts` block is the list.** (Rewritten 2026-08-20, Prompt
C item 4.3.) It held ten entries when this section was written by hand and
holds well over a hundred now, so any copy here is a copy that is wrong. Run
`pnpm run` to see them.

Four are named here because they are not conveniences — a rule elsewhere in
this file depends on each one existing and being run:

- **`pnpm stamp`** — today's date, `YYYY-MM-DD`, America/Phoenix. Every date
  entering every document comes from here. See the date rule below.
- **`pnpm verify-stamps`** — audits this file's own `Adopted` stamps against the
  git history that would have to be true for them, and writes
  `docs/stamp-audit.md` for the author to rule on.
- **`pnpm walk:all`** — the standing regression net, run against production at
  the end of every session. See the walk rule below.
- **`pnpm db:apply`** — applies the committed Drizzle migrations to a database
  this repo can reach. It is how a schema change reaches production, and
  `--target=production` is required to touch it.

## FIVE RULINGS OF 2026-08-24 — THE FACES, THE VERBS, AND THE NATIONS

(Adopted 2026-08-24, the author's decisions of that day. **RULINGS 117, 118,
119, 121 and 122.** RULING 120 is the business constraint below.
`docs/rulings.md` carries all six in plain language, because a ruling the author
cannot read is a ruling that does not bind him.)

### RULING 117 — THE ASSET STORE HAS A PUBLIC ADDRESS, AND A RESTORE IS VERIFIED BY HASH

(Adopted 2026-08-24, the author's ruling, closing `R57`. **It finishes RULING
20**, which moved portrait bytes out of git and could not say where they land.)

**The content-addressed store lives in a dedicated PUBLIC repository —
`github.com/SeanJ22/wtp-assets` — and every restored byte is proved against the
hash it was requested under.**

RULING 20 was right and could not finish. The store was a local path on the
author's machine, so Netlify could not reach it; the committed portraits were
therefore deliberately NOT deleted, because removing them would have blanked
every candidate and official card in production. The repo carried both the
bytes and the mechanism built to replace them.

**The cost was never only repository size.** `NH101` held **97 sitting members
of Congress** whose portraits were retrieved over git, licence-confirmed (CC0
1.0 Universal, GPO works, door 1) and byte-verified on 2026-08-23, and could not
ship, because there was nowhere to put them a build could read.

- **PUBLIC is the correct posture, not a convenience.** Everything in the store
  was already published — by a government body, by a campaign about itself, or
  under an explicit open licence. A private store needs a credential in the
  build, and a credential is a thing that expires, leaks, or sits unused beside
  a rate limit (RULING 90.5). There is nothing here that publication has not
  already given away.
- **The hash is the check, and the status code is not trusted.** A 200 that is
  not the thing is not a document. Content-addressing makes the control total
  and free: the NAME of the file is the hash of its correct contents, so bytes
  that do not hash to the name they were requested under are refused whatever
  the transport said. A refusal is a **CANNOT RUN for that row** (RULING 24),
  never a decision to serve nothing.
- **The README carries the four-door provenance discipline and
  remove-on-request**, where a person pictured there would look for it.

The machinery is `lib/ops/asset-remote.ts` and `pnpm assets restore` /
`pnpm assets prove-remote`, guarded in `tests/asset-remote.test.ts` — whose
load-bearing case is the one a live call would almost never exercise: **HTTP 200
carrying the wrong bytes must be REFUSED.**

### RULING 118 — AN APPOINTED OFFICIAL NEVER CARRIES THE GOVERN VERB

(Adopted 2026-08-24, the author's ruling, closing `NS07`.)

**Appointed people never carry the govern verb, and neither does any role
description.** The author's words for what to say instead: **"runs the
department," "chair," "president of the committee."**

New Jersey's executive departments are enumerated as bodies under RULING 57,
and their rulemaking hearings are exactly the there-is-a-hearing-Tuesday surface
this product exists for. **Their MEETINGS were never in question and are
unaffected.**

*The rationale stays attached, because a stripped rule reads as guidance.* The
who-governs card's verb is GOVERN, and that is a claim about the READER'S OWN
POWER over a person — that they chose them and can unchoose them. A
commissioner of a state department was appointed. A reader did not elect them
and cannot vote them out, so *governs you* describes a relationship that does
not exist. **This is not a softer version of the same sentence.** *Runs the
department* is accurate and useful and tells a reader who is responsible for
something that reaches them; *governs you* is false about the reader.

The machinery is `governVerbMayAttach` in `lib/registry/body-class-labels.ts`,
which is asked ONCE rather than re-decided per surface — and that is the point,
because the three label maps this replaced included a BINARY
(`GOVERNING ? "Governing" : "Advisory"`) that would have labelled every other
kind of body advisory. Guarded in `tests/body-class-labels.test.ts`.

### RULING 119 — A SOVEREIGN TRIBAL NATION IS ITS OWN CATEGORY OF GOVERNMENT

(Adopted 2026-08-24, the author's ruling, closing `NS08`. **This unblocks the
Arizona hunt's start condition.**)

**Tribal nations are their own specific category of government — SOVEREIGN,
neither federal nor state nor local — with their own label and their own body
class. Nationally, not an Arizona special case.** The author named New Mexico,
Oklahoma and Texas as coming.

**How it was found is the part worth keeping.** Nothing in this product's
enumeration would have produced it. It came out of the **FEC Combined
Federal/State Directory**, whose Arizona entry names six offices — one of them
the **Navajo Nation Ethics and Rules Office**, listed alongside the states as a
jurisdiction holding administrative hearings, ethics clearances and
investigations under the Navajo Ethics in Government Law. No municipality list,
no county roster and no state register carries it. That is RULING 93's
descend-the-hierarchy move earning its place.

- **A new class, not a flag on an old one.** `GOVERNING` inside a state
  hierarchy makes a nation a subdivision of that state, which is precisely what
  it is not; every other existing value is worse. RULING 57 says the twig is as
  relevant as the trunk — **a sovereign nation is not a twig, it is a trunk this
  product had never touched.**
- **THE GOVERN VERB DOES NOT ATTACH, and that is honesty rather than caution.**
  Tribal jurisdiction turns on tribal membership and on land status, not only on
  where a reader is standing, and this product resolves a reader by geography
  alone. The nation, its government and its meetings are named; the governing
  relationship is not ours to assert.
- **The identifier is PROJECT-MINTED and says so.** The canonical
  `opencivicdata/ocd-division-ids` registry carries **no tribal division type at
  all** — read 2026-08-24, its complete top-level vocabulary is `state:`,
  `district:`, `territory:` and `court_of_appeals:`. There was nothing to look
  up. The ids are keyed on the **Census AIANNH code** with the ANSI code beside
  them, read from a keyless `.gov` publication with a control search. **A minted
  id whose basis is an authoritative federal code is a different thing from a
  guessed identifier**, and the distinction is recorded so nobody re-derives it.

The three nations holding territory in or adjacent to Pima County are wired:
the **Navajo Nation**, the **Tohono O'odham Nation** and the **Pascua Yaqui
Tribe** (`lib/registry/tribal-nations.ts`).

### RULING 121 — ONE BODY THAT SPANS TWO TOWNS HAS ONE ID, RENDERED UNDER BOTH

(Adopted 2026-08-24, the author's ruling, closing `NH33`.)

**A body governing territory in more than one division is ONE body with ONE id,
rendered for readers in every division it covers.**

Lake Todd Village District governs territory in Bradford AND Newbury. The New
London–Springfield Water System Precinct serves New London AND Springfield.
Because a body id was `<division>#<slot>`, each shipped as TWO rows carrying the
same name — one body wearing two ids — and every count that walked the registry
counted them twice.

**Filing each under one division only would be worse**, because it hides a real
body from readers in the other town, who are governed by it just the same.

**This is the first pair of many, not a curiosity.** Village districts,
precincts, fire districts and regional school committees routinely cross
municipal lines, and a product that reaches the smallest bodies (RULING 57) will
meet this constantly.

### RULING 122 — A PARTY-HOSTED CANDIDATE PAGE IS THE CANDIDATE'S PAGE, WITH THE HOST LABELLED

(Adopted 2026-08-24, the author's ruling, closing `NH11`. **It extends the
campaign-that-lives-on-Facebook rule** to the same shape on a party's site.)

**Where a candidate's only public presence is a page on their party's own site
carrying their NAME, the OFFICE, their OWN WORDS and a CONTACT, it renders as
their verified page and their contact — with the host labelled.**

A candidate for Governor had no campaign website and no campaign social page.
What he had was a party-hosted page with his name, the office, a sentence in his
own words and an email address. Recording that as *no campaign site found* hides
a real, findable thing from a reader — **and it does it to the candidate with
the fewest resources**, which is the information asymmetry the equal-effort rule
exists to catch.

**The HOST LABEL is what keeps this inside the organizations-render-as-filed
rule.** This product never characterises an organization's politics. Presenting
a party's website under a bare "Campaign site" label would blur exactly that
line. It renders as *the page his party publishes about him* — the source named
plainly, the reader left to judge it, which is what this product does with every
other source. It supplies no prose beyond the labelled self-description the
blurb rule already governs, and it **never supplies a photo**.

## THE BUSINESS CONSTRAINTS

(Adopted 2026-08-24, the author's decisions of that day. `docs/rulings.md`
carries each in plain language, because a ruling the author cannot read is a
ruling that does not bind him.)

### RULING 120 — EQUAL SOLICITATION IS THE OBLIGATION; BUYER COMPOSITION IS NOT

(Adopted 2026-08-24, the author's ruling, closing `T04`. **His words are the
ruling and are recorded verbatim**, because a paraphrase of a business
commitment is a different commitment.)

> **"We will never sell exclusively. I will solicit equally. Whether they buy
> is up to them — if 65% of buyers end up on one side, that is not something I
> can control so long as the solicitation was equal."**

**The data is never sold exclusively to one buyer.** Not to a campaign, not to
a party, not to a committee, not to a vendor acting for any of them, and not
for a window of time. There is no price at which exclusivity is available.

**The obligation is EQUAL SOLICITATION, and it is the half this product
controls.** The offer goes out equally. That is a real, specific, checkable
commitment: who was approached, when, and on what terms.

**Buyer composition is NOT an obligation, and pretending otherwise would be
worse than useless.** If the buyers who accept skew heavily one way, that is a
fact about the market. The only ways to "fix" it would be to refuse customers
on the basis of their politics, or to claim a control nobody has — and both are
further from neutrality than the honest number is.

*The rationale stays attached, because a stripped rule reads as guidance.* The
neutrality claim does not survive selling exclusively, and it survives selling
equally, and the difference between those two is the whole of this section. An
exclusive sale is an advantage this product HANDED to one side; a skewed set of
buyers is an advantage this product OBSERVED. The first is our act and the
second is the world, and a business that confuses them ends up either
politically screening its customers or lying about what it can promise.

**What follows operationally:** the solicitation record is the artifact that
proves this, not the sales record. And every export continues to report its
confidence mix, which is a separate obligation and is untouched by this one.



## FOUR RULINGS OF 2026-08-24 — THE MONEY, THE DEPLOYS, AND THE KEYS

(Adopted 2026-08-24, the state-campaign-money session. **RULINGS 124, 125, 126
and 127.** `docs/rulings.md` carries all four in plain language, because a ruling
the author cannot read is a ruling that does not bind him.)

### RULING 124 — A COMMIT THAT CANNOT CHANGE WHAT A READER SEES DOES NOT COST A DEPLOY

(Adopted 2026-08-24, Sean's instruction of that day, escalated twice: deploys are
burning credits, cut them to the floor. **Amends RULING 78**, which set every
scheduled refresh to once daily.)

**Six production deploys landed before 5 AM on 2026-08-24. Three of them rebuilt
and redeployed a byte-identical application in order to serve paperwork.**

Two moved data a reader sees and deserved their builds. `ba0947c` moved an
intake report; `2a7e825` and `ae5b178` moved `docs/context.md` and
`docs/state.md`. And that is only the visible half — deploy previews are
Netlify's default, so **every push to every session branch was building too**,
invisible in the production list and looked at by nobody.

- **Previews and branch deploys do not build.** The preview context was closed
  in g17; the branch context was not, which left the same duplicate running
  under another name.
- **A path-keyed deploy filter** — `scripts/netlify-ignore.mjs`, predicate in
  `lib/ops/deploy-paths.ts`, a stated reason per entry.
- **One daily orchestrated refresh.** Five workflows on five crons committing
  five times becomes `refresh-daily.yml`: one run, per-source isolation, one
  gate, **one commit however many sources moved**. A quiet day commits nothing —
  not a ceremonial "refreshed, no changes" commit.
- **Cadence matched to each source's real rate of change**, each justified:
  meetings and the NJ clerk filing daily through the election, FEC and LegiScan
  weekly, the federal `.gov` register monthly.
- **`pnpm closeout` refuses a separate push to `main`.** It had been made SAFE —
  it gates the build — and was still costing a production deploy per paperwork
  diff.

**THE ALLOWLIST DIRECTION IS THE RULE.** A path is paperwork only if it matches a
named prefix; everything else builds. An unknown directory wrongly built costs
one wasted build. An unknown directory wrongly classified as paperwork serves
stale data to readers with nothing going red. Those are not comparable.
**`scripts/` is deliberately SHIPPING** — nothing under it reaches a reader, but
`pnpm build` type-checks it and RULING 76 exists because a session script broke
the build.

**Every failure path builds** — no cached ref, a shallow clone, a git failure,
the predicate failing to load. RULING 24.

**The claim is measured rather than asserted.** `tests/deploy-paths.test.ts`
reads the built `.nft.json` trace manifests and fails if any file under a
non-shipping prefix is traced into the deploy. Re-deriving the classification
from the list it was written from would prove only that the code is
deterministic (RULING 114). Measured on adoption: **31 manifests, 234 traced repo
files, 0 offenders.**

**And the cadence is calendar-driven on purpose.** The obvious implementation
asks when an artifact last changed with `git log -1 -- <path>`. On CI that is
wrong and it fails SILENTLY: in a shallow clone, per-file `git log` returns the
tip date for every file with no error, so a weekly source would read as
refreshed-today every day forever.

### RULING 125 — VERIFICATION HAPPENS ON THE LOCAL PRODUCTION BUILD

(Adopted 2026-08-24, Sean's ruling. It is **RULING 77 carried to its
conclusion**: that ruling said WHEN to verify, and this says WHERE.)

**Every walk, every screenshot and every card check runs against a local
production build. `walk:all` loses its production mode entirely, and a non-local
target is REFUSED rather than honoured.**

RULING 77 already established that almost nothing needs production, because a
local production build is the same bytes. What it left standing was the habit.

**The cost was never the traffic.** Every `/api/meetings` GET writes a row to the
search log, and **the search log is a store this product sells**. **11,755 synthetic
rows** had accumulated by 2026-08-24, against 260 organic — measured, not the 618 the
brief stated. They are excluded from every aggregate by the
`T10` machinery and that machinery works — but *organic by construction* is a
stronger claim than *organic after filtering*, it is the claim the transparency
page implies, and it costs nothing.

**The one remaining production fact is which SHA is live**, read from **Netlify's
deploy record via the API — one call, zero requests to the site**. Asking
`/api/build` answers the same question while writing reader-indistinguishable
traffic into a sold store.

**And it is compared against the last DEPLOY-ELIGIBLE commit, never the tip of
`main`.** Under RULING 124 a docs-only commit correctly never builds, so the tip
is routinely a commit Netlify was right to ignore; comparing against it would
report "production is behind" on every close-out, forever, and an alarm that is
wrong on every quiet day is one nobody reads (RULING 115). Four verdicts, and
**`cannot-tell` exits non-zero** — no credential is not a pass.

### RULING 126 — CAMPAIGN-FINANCE DATA RENDERS FOR READERS AND NEVER ENTERS ANYTHING SOLD

(Adopted 2026-08-24, Sean's ruling. It EXTENDS the existing FEC posture to every
source; it narrows nothing.)

**Campaign-finance data, from any source — the FEC, a state agency, a county
clerk, or anything else — renders for readers and never enters an export, an
aggregate, or anything sold.**

Two reasons, either sufficient. **The legal one:** federal law restricts
commercial use of FEC contributor information (52 U.S.C. § 30111(a)(4), the open
question behind `ripcord.fecContributorDisplay`), and **several states restrict
theirs analogously** — a product ingesting three states' filings would otherwise
acquire that question three more times without noticing. **The product one,
which binds even where the law does not:** what this product licenses is
reader-attention signal — anonymous reactions, opinions about displays. A buyer
receives opinions, never records. That is the author's own 2026-08-15 ruling on
`ripcord.fundingReactionsInAggregates`, generalised.

**So the firewall is ARCHITECTURE, not policy.** Campaign-finance rows live in
the committed reader-content corpus, never in Postgres where the sold stores are,
and `tests/campaign-finance-firewall.test.ts` asserts three walls: no database
table holds it, the aggregation layer cannot import it, and if it ever did enter
the database it would share no joinable column with any collection store.

*Sean's decision of the same day also settled the other half — the data is
COLLECTED AND RENDERED NOW, with election counsel reviewing afterwards on `B05`.
That supersedes the older render-after-review posture for state data and changes
nothing about this firewall, which is the condition the collection proceeds
under.*

### RULING 127 — NO TOOL PRINTS A CREDENTIAL VALUE, AND THE GUARD IS THE VALUES THEMSELVES

(Adopted 2026-08-24, Sean's instruction, item 3.)

**A credential value never reaches a transcript, a log, a report or a committed
file. The check is not a pattern that looks credential-shaped — it is the actual
values in `.env.local`.**

**The instance is not the finding.** A pattern scan for credential-shaped strings
is the RULING 110 failure waiting to happen: it searches for the FORM a secret
takes rather than for the secret, and a Census key is forty hex characters — so
is every git SHA in this repository. Sweeping BY VALUE found **nine distinct
credentials** where the brief named one, including all three database connection
strings and the production write credential.

**Nobody pasted a key.** `curl -w '%{url_effective}'` printed the resolved URL
back, and several of these APIs carry the key as a query parameter — a
credential escaping through the *reporting* field of a tool being used
correctly. **The rotation leaked by the same mechanism**, which is why the guard
had to exist before the next one.

- **Nothing a tool prints may contain a value from `.env.local`**, and the
  redaction is applied at the point of output so a value cannot leak through a
  path nobody thought to check.
- **The sweep covers the repo AND the Drive-mirrored artifacts**, because RULING
  108 established the mirror is a place things land and this is that surface
  pointed outward.
- **A rotated key is proven dead and the new one proven live, by CALLING both.**
  RULING 95's bar applies to the corpse as much as to the replacement: the Census
  host answers a dead key with **HTTP 200 and an HTML page titled "Invalid
  Key"**.
- **A scrub is cleanup, never the fix.** A value written to a synced folder must
  be assumed read. **Rotation is the fix.**


## THE SIX RULINGS OF 2026-08-24 — SEAN'S VISUAL WALKTHROUGH

(Adopted 2026-08-24, from the author's 8/24 walkthrough and the sixteen captures
he recorded between 11:54 and 12:27. **RULINGS 136 through 141.**
`docs/rulings.md` carries all six in plain language, because a ruling the author
cannot read is a ruling that does not bind him.)

### RULING 136 — FEEDBACK NAMES EXAMPLES; A FIX CLOSES THE CLASS

(Adopted 2026-08-24, the author's frame for the whole walkthrough. He has now
stated it three times across two walkthroughs, which is why it is law rather
than a note.)

**His words: "All of what I've provided are examples of recurring issues. These
are not the specific issues; these are examples of underlying issues."**

Every id in a feedback list names an INSTANCE. The defect is the CLASS. An item
is done when the class is closed everywhere it exists — every state, every zip,
every surface — and the named instance is only the verification case.

- **An item closed at the instance and open at the class is NOT DONE** and may
  never be reported as done.
- **Every ending carries its denominator**: the class named, the surfaces and
  states it exists on, N of M closed, and the observed instance confirmed among
  them.

*The rationale stays attached, because a stripped rule reads as guidance.* The
named-instance rule above already says a reported defect is the START of a
sweep. What it does not say is what a FEEDBACK ITEM is, and a feedback item
looks exactly like a request to fix one thing. *"The role text is cut off on Dr.
Ravi Shah"* reads as a request about one card; it was **17 uncompensated
letter-spaced runs across 11 files**. Fixing the card would have been a truthful
report of an untrue fix.

*What this cost before it was written down.* `LBL-2` closed on 2026-08-23 at
"6 found, 6 fixed" — correctly, and none of the six regressed — and the author
found the same defect on another card the next day. The six were right. **The
class was 23.**

### RULING 137 — FOR LAYOUT, AN ANNOTATED IMAGE IS THE SPEC AND OUTRANKS PROSE

(Adopted 2026-08-24. It is the read-as-an-image rule's cousin: that one says a
capture is EVIDENCE only once it has been read, and this says a capture can be
a SPECIFICATION.)

**Where the author annotates a capture — an arrow, a red box, a strikethrough —
that image IS the spec. It is built to directly, and it wins against any prose
describing it, including a brief's own.**

- **A spec image is identified BY CONTENT before anything is built.** A
  file-to-issue mapping inferred from capture times is a guess, and on
  2026-08-24 it was wrong about both of them.
- **Where the image and the prose disagree, the image wins and the disagreement
  is REPORTED**, so the author can overrule the reading rather than discover it.

*The rationale, and it is a measured failure rather than a preference.* The 8/22
prose said *"left column, nested."* The build was faithful to those words and
the result was wrong — the cards ended up INSIDE the sidebar instead of floating
beneath it, and the whole of `LAY-1` was deleted the following day. **Prose lost
information the image carries.** An arrow has a start and an end; "nested" does
not.

### RULING 138 — DISPLAY CONSOLIDATES SOURCES; THE RECORD IS NEVER DELETED

(Adopted 2026-08-24, from `SRC-1` through `SRC-4`. It narrows nothing in the
no-claim-without-a-source rule; it constrains how a fix to it may be built.)

**Every inline asterisk and per-item source annotation collapses to ONE line at
the bottom of the card. That is a change to what RENDERS, never to what is
HELD.** Single source: *These were sourced from [publisher].* More than one:
*We sourced this information from these three sources,* then the list, still at
the bottom.

**Footnotes, source URLs and fetch dates are never deleted from the data**, and
a test asserts the populated provenance fields are IDENTICAL before and after
the consolidation runs (`tests/source-consolidation.test.ts`).

*Why the test is not optional.* "Remove the source annotations" and "remove the
sources" are one careless edit apart, and only one of them is allowed. A session
that deleted the fields would satisfy every visual check — the cards would look
exactly as asked — and the product would have quietly stopped being able to say
where anything came from.

*What this supersedes, with the cost stated rather than hidden.* F01 3.2
collapsed repeated provenance to one note per distinct source with a footnote
MARKER on each row. That was a real improvement and the markers are now the
friction. On a card carrying two bodies at one building a reader can no longer
tell which row came from which — Tucson splits city and school meetings at one
address, so this is not hypothetical. It is the author's call; what it buys is
that the other ninety-odd cards, which carry one source, stop printing
punctuation nobody reads.

### RULING 139 — THE PRODUCT NEVER ANNOUNCES ITS OWN FAILURE

(Adopted 2026-08-24, from `BAL-7`, made product-wide. It is the render-default
rule's other edge, and the two are easy to confuse.)

**"That is a gap on our side" and every variant comes out, everywhere. State
what is known, offer the narrowing, move on.**

**THE ATTRIBUTION IS NOT WHAT THIS TOUCHES, and that distinction is the whole
rule.** The render-default rule requires that a reader can tell OUR gap from
THEIR absence, and it says in as many words that what it protects is the
ATTRIBUTION rather than any particular sentence. *We haven't recorded this
chamber's vote on this yet* is REQUIRED. *That is a gap on our side, not a
finding about those districts* is attribution PLUS a verdict on ourselves, and
only the second half is struck.

- **The sweep is by SHAPE, never by string** (RULING 110), and it lives on the
  existing refusal-shapes instrument rather than in a second one.
- **The honest attributions are planted in the test beside the defects**, so the
  family can never become pressure to delete the render-default rule.
- **The report states N found and N cut.**

*Measured on adoption: four instances shipped, four cut* — two the author
red-boxed himself, plus one in the map entry and one in the voting-sites panel
that the widened sweep found. One of the three new patterns could not match
anything at all until a planted instance caught it.

### RULING 140 — DATES SPELL OUT, PRODUCT-WIDE

(Adopted 2026-08-24, from `BC-12` and `BAL-4`. **Supersedes the mm/dd/yyyy
convention of `3h`**, 2026-08-16.)

**The author's words: "in seat until January 3rd, 2029," never "01-03-2029."**
Full month name, ordinal day, four-digit year, everywhere a reader sees a date.

**ONE formatter**, and RULING 103 applies with force: this defect had THREE
implementations under three names and none of them called each other —
`formatDateMDY` (the ballot page and the funding surface), `inSeatUntil` (which
built `${m}/${d}/${y}` by hand off its own regex, and is the LITERAL instance
the author quoted), and the picks card (which spelled the month already and
stopped short of the ordinal). Fixing the first alone would have left his own
example on screen.

*A calendar date is read from the string and never round-tripped through a
`Date`.* `new Date("2026-11-03")` <!-- expected-future: the 2026 general election, quoted as a code example --> is midnight UTC, and formatting that in
America/Phoenix returns November 2nd — an election date off by one day, which
in this product is a false claim about a government.

### RULING 141 — THE SPEAK YOUR MIND STORE'S FOUR RULES

(Adopted 2026-08-24, the author's ruling on `BC-11`. All four are constitutional
and none is optional.)

**Speak Your Mind is the collection point for verbatim constituent sentiment —
product infrastructure, not a comment box.** The framing is what you would say
if this person were standing in front of you.

1. **DISTRICT-STAMPED, JOINED TO NOTHING.** The subject's public id, the
   reader's zip-resolved district, a timestamp, the text, and a hashed
   browser-minted continuity key. No email, no account reference, no address,
   and no new join path to any other store. **The continuity key is digested
   under its own prefix** — three stores hash the same kind of key, and without
   distinct prefixes they would be equality-joinable on a value nobody would
   have to look up. This store was born UNDER the A-001 identity boundary
   (RULING 132) rather than retrofitted to it.
2. **HONEST DISCLOSURE AT THE BOX.** One line, plain language, before the reader
   types: what is written may be shared — without a name, because we do not hold
   one — with campaigns, organizations and researchers. **"May", never "will."**
   The reason there is no name is inside the sentence, because *anonymously* is
   a promise a reader takes on trust and *we do not hold one* is a fact they can
   check. The honest version is the credible version.
3. **PII SELF-DISCLOSURE IS REDACTED AND FLAGGED, AND A FLAGGED ROW NEVER
   EXPORTS VERBATIM.** People type their own names, emails, phones and street
   addresses into boxes like this. The pass and the flag exist BEFORE any export
   path does — the store is born safe, not retrofitted. **It detects the act of
   INTRODUCING yourself rather than trying to recognise names**, because any
   list of names is incomplete and a list built from our own officials would
   flag the very sentiment this box exists to collect.
4. **ABUSE TRIAGE, NOT FORWARDING.** Nothing typed here is ever auto-forwarded
   to anyone. Severe content goes to a HELD queue for the author's review, in
   the tiers `docs/abuse-policy.md` already defines. **Harsh political speech is
   never held** — over-filtering degrades the product to guard against a rare
   case, and a box that promises you can say what you would say to their face
   and then swallows it would be worse than not asking. The intake limiter's
   attestation applies to submissions.

**Not rendered publicly.** Collected, never displayed — the same reasoning that
keeps reaction aggregates off every card, because showing them anchors later
respondents and corrupts the data being sold. **The default is REVERSIBLE and is
the author's call.**


## TWO RULINGS OF 2026-08-24 — THE LINE IN THE SAND AND THE FINISH LINE

(Adopted 2026-08-24, the author's decisions of that day, written before the
hunt they govern. **RULINGS 142 and 143.** `docs/rulings.md` carries both in
plain language, because a ruling the author cannot read is a ruling that does
not bind him.)

### RULING 142 — THE LINE IN THE SAND, AND NOTHING COLLECTED BEFORE IT IS EVER SOLD

(Adopted 2026-08-24, the author's ruling. **His words are the ruling and are
recorded verbatim**, because a paraphrase of a promise is a different promise.)

> **"I will draw a line in the sand once people outside of testing are actually
> using it. We have not crossed that line yet."**

**Nothing collected before that line — organic-looking or not — is ever sold, or
shown to anyone as signal.** Not the reactions, not the search log, not a
sample, not an aggregate, not a chart in a buyer deck, not a screenshot in a
pitch. **The sellable clock starts at zero on the day the password wall comes
down.**

*The rationale stays attached, because a stripped rule reads as guidance.* Every
row in those two stores today was made by the author, by a tester he asked, or
by this project's own instruments. Some of them look exactly like reader rows,
because they were produced by walking the product the way a reader would.
**That is the problem, and it is not solvable by filtering.** A filter
separating them depends on a session having correctly declared every synthetic
run, forever, in every path — and the measured history says otherwise: 11,755
synthetic search-log rows accumulated against 260 organic before RULING 125 sent
verification to the local build. *Organic after filtering* is a weaker claim
than *organic by construction*, and only one of them survives being asked about.

**The mechanism is `T10`, never a filter somebody remembers.**
`lib/ops/demo-window.ts` holds the wall-down trigger and `pnpm demo:sweep` fires
it; **`WALL_DOWN` is set by the change that takes the wall down and by nothing
else** — never inferred from a deploy, a config read, or a probe. A promise kept
by memory is a promise broken, which is the sentence T10 was opened over.

**What this changes about that mechanism, and it is a real change.** T10 was
built to delete a WINDOW — `WALL_UP` to `WALL_DOWN` — and refused to run at all
while `WALL_UP` was unset, on the correct reasoning that deleting from the
beginning of time would take real reader rows with it. **Under this ruling there
are no real reader rows before the line**, by definition, so the lower bound is
not unknown: it is the beginning. The refusal is lifted for that one case, kept
for every other, and `demoSweepVerdict` states which of the two it is on the
verdict itself. Guarded in `tests/demo-window.test.ts`.

**No date is written into that module.** The line has not been drawn,
`WALL_DOWN` is `null`, and a plausible date there would decide an irreversible
deletion on a fabricated number.

### RULING 143 — WHAT DONE MEANS FOR 07866, AND IT IS PER CANDIDATE

(Adopted 2026-08-24, the author's ruling, recorded so the finish line is a
measurement rather than a feeling.)

**Every candidate on the 07866 ballot either meets the Kelly standard IN FULL —
a photo, a phone, a working contact, a specific verified page, and a campaign
site — or carries an ARGUED ABSENCE: a five-move stuck protocol under RULING 94
with its literal queries recorded, and an expiry date under RULING 53. Nothing
in between counts, and there is no partial credit.**

- **A candidate with four of the five Kelly fields and no protocol on the fifth
  is NOT done.** The field is still owed.
- **An absence with no stuck-protocol block is VOID** and the field returns to
  owed — RULING 94, unchanged, restated here because this is the place a session
  is tempted to round up.
- **An absence EXPIRES.** Candidate fields carry a 7-day clock (RULING 53), so a
  protocol walked tonight is owed again next week. **Done is not a permanent
  state**, and a report that says otherwise is describing a measurement as a
  conclusion.
- **The distance remaining is reported as a NUMBER against 272 every session**,
  and it is the number that decides when Arizona starts. The zip order is law:
  NH `03255`, then NJ `07866`, then AZ `85641`, then AZ `85701`.

*The rationale stays attached.* "Depth" has no finish line, and a session can
report progress against it honestly, forever. Many small-race candidates
genuinely have no campaign site, and the honest end state for them is an argued
absence rather than a blank — **which means the finish line cannot be "everybody
has five fields", because that line is unreachable and would leave the zip
permanently unfinished.** It also cannot be "we hunted hard", because that is a
fact about the session rather than about the ballot. Kelly-or-argued is the only
version that is both reachable and checkable, and it is checkable PER CANDIDATE
rather than in aggregate — which is what stops a well-covered contest carrying a
thin one across the line.

## TWO RULINGS OF 2026-08-25 — THE FINAL PASS

(Adopted 2026-08-25, the author's final-pass brief, item 2. **RULINGS 144 and
145.** `docs/rulings.md` carries both in plain language, because a ruling the
author cannot read is a ruling that does not bind him.)

### RULING 144 — AN ARGUED ABSENCE MAY BE BUILT FROM WALLS, AND IT EXPIRES THE DAY A WALL FALLS

(Adopted 2026-08-25, the author's ruling. It is the operational half **RULING
94** was missing, and it narrows neither RULING 94 nor RULING 61.)

**A five-move stuck protocol whose moves were REFUSED still earns an absence.
Each wall is recorded as a walked move carrying its rung history and the date it
was tested, alongside the moves that answered. The absence expires on its normal
RULING 53 window, or EARLY — the day any wall inside it falls — whichever comes
first.**

*The rationale stays attached, because a stripped rule reads as guidance, and
here the rationale is a measurement rather than an argument.*

The NJ depth session of 2026-08-24 earned **zero** argued absences. Not because
it failed to walk the protocol — it walked it — but because the general search
indexes are closed to this project, and a move that returns HTTP 403 is not a
move that returned nothing. Read strictly, that means **no absence can ever be
earned while any wall stands**, and a field with no route left sits owed
forever, re-hunted nightly against the same refusal.

**That is dishonest in the other direction, and it is the direction nobody
watches.** Every discipline in this file points at one failure — asserting an
absence that was never earned. Its mirror is asserting that a field is still
reachable when every route to it has been tested and refused. A permanent
"still owed" is a claim too: it says *we believe this exists and we will find
it*, and after the tenth identical refusal nothing supports that sentence.

- **The protocol still runs in FULL.** All five moves, every literal query or
  URL recorded. A wall is a recorded move, never a skipped one, and a protocol
  with four moves walked and one omitted is still void.
- **Each wall names what it is a wall AROUND** — RULING 90 item 4, unchanged.
- **The absence carries BOTH clocks and expires on the earlier.** The RULING 53
  window is the ceiling; the floor is any wall in the record falling. An absence
  built on a closed door becomes owed again the moment the door opens,
  automatically, without anyone having to remember which absences were built on
  which walls.
- **An absence built ENTIRELY of walls says so.** It is the weakest kind and
  must be legible as the weakest kind. `VERIFIED_ABSENT` is still RULING 61's
  bar and is NOT reached this way; what this earns is a dated, argued, expiring
  absence — which is what RULING 143 asks for, and a different thing.

*What this does NOT license.* It is not permission to declare a wall and stop.
RULING 52 is unchanged: a branch refusing is one measurement on one date, and
the response to a refusal is another branch. This governs only what happens once
every named branch has been tried and the record is honest about which of them
answered and which slammed.

### RULING 145 — A PLATFORM-HOSTED CAMPAIGN PRESENCE FILLS THE CAMPAIGN-SITE FIELD, WITH THE HOST LABELLED

(Adopted 2026-08-25, the author's ruling. A direct extension of **RULING 122**
to the platform a campaign actually lives on. The campaign-that-lives-on-Facebook
rule above is its parent rather than its rival, and supersedes nothing.)

**An official campaign presence on a platform — a Facebook page or its
equivalent — FILLS the campaign-site field when reached by a compliant route,
and renders with its host labelled plainly.**

*The rationale stays attached.* Small-race candidates overwhelmingly live on
platforms rather than domains. A domain costs money and a page costs nothing, so
a rule recognising only domains does not measure campaign presence — **it
measures campaign budget**, and records the least-resourced candidate in every
contest as having no presence at all. That is the information asymmetry the
equal-effort rule exists to catch, committed by the field definition itself.

- **The verification bar does not move.** The presence must be the candidate's
  OWN, established by name–office–cycle agreement and control-checked. A page
  found by guessing a handle is a `LEAD`, never a `HIT`.
- **Compliant routes only.** The Meta Ad Library API, archived captures,
  cross-posted mirrors, local-news embeds, and the campaign's own filed
  materials.
- **The host is named, never dressed as a website** — *the campaign's Facebook
  page*, in those words.
- **It NEVER supplies a photo.** Social-media images are prohibited at every
  door of the photo rule, and a door the campaign-site rule opens is not a door
  into the photo rule. This is the clause most likely to be lost, because the
  page has a picture on it and the field beside it is empty.
- **It supplies no prose** beyond the labelled self-description the blurb rule
  already governs.

## THE SIX RULINGS OF 2026-08-25 — THE ONE-SESSION BRIEF

(Adopted 2026-08-25. **RULINGS 146 through 151.** `docs/rulings.md` carries all
six in plain language, because a ruling the author cannot read is a ruling that
does not bind him. Five of the six were written BEFORE the work they govern,
which is the point of them — a rule adopted after a session is a rule that
describes what the session already did.)

### RULING 146 — A SESSION RUNS UNATTENDED, AND NOTHING IT RUNS MAY BE ABLE TO ASK IT A QUESTION

(Adopted 2026-08-25, the author's standing instruction, made law rather than
repeated in every brief.)

**Nobody is watching. A question asked is hours lost.**

- A decision that is genuinely the author's becomes a **Needs Sean row** and the
  session keeps going. It never waits and it never ends its turn to ask.
- **No command may be capable of prompting.** Non-interactive flags everywhere,
  `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT=disabled`, stdin closed, every
  long-running command inside a timeout. Five silent minutes is a kill, a row,
  and carry on.
- **Ambiguity resolves against the repo**, which is the thing that can be
  checked; a brief is a description of the repo written earlier.
- **"Ran out of room" is not a blocker.** Neither is a wall, a refusal, or a
  missing input — each is a finding with a row.

*Why this is law and not a header.* It has been the top of every brief for days,
and it is a fact about how this project runs rather than about one night's work.
A rule that has to be restated every time is a rule that will eventually be left
out of a brief, and the session reading that brief will stop and wait.

### RULING 147 — NO RECONCILIATION MAY COMPARE A PARSER TO ITSELF

(Adopted 2026-08-25. It is **RULING 114's** reasoning — *re-deriving a stamp
from the field it was stamped from proves only that the code is deterministic* —
made general and pointed at every check in the repo.)

**Every reconciliation names its EXTERNAL ANCHOR: an authority we did not
write. A check with no external side is decoration, and is deleted or rebuilt.**

*The rationale stays attached, because a stripped rule reads as guidance.* The
MAYOR defect shipped **nine invisible contests and seven fabricated candidates**
while `pnpm nj:filing:check` reported AGREES on 272 against 272. Both of those
numbers came from our own parser reading the same document. The check was not
lying and it was not broken; it was asking whether a thing equals itself, which
it always does.

- **The anchor is named on the check**, in words, so a reader can see what the
  other side is without reading the code.
- **A count published BY the authority is an anchor. A count we derived from
  the authority's document is not.**
- **Where no external anchor exists the check says so**, reporting
  `COULD_NOT_ANCHOR` rather than `AGREES` — two names for two different states,
  because a check that cannot reach an authority must never print like one that
  did (RULING 24).

### RULING 148 — THE MAY-WE-WALK VERDICT IS ENFORCED BY THE FETCHER, NEVER REMEMBERED BY A SESSION

(Adopted 2026-08-25. It is the enforcement half of the public-records
permission rule, the way RULING 107 was the enforcement half of RULING 96.)

**The shared fetcher REFUSES any host whose recorded verdict is `no` or
`unknown`. Permission is asked before the first byte, by the code, never by a
person remembering to look.**

*The rationale.* Two search engines went into a pool on the strength of the
right two questions asked in the wrong order — *does it answer* and *does it
pass a control query*. Both do. Both also carry `Disallow: /search`, which is
the exact path a query goes to, and `docs/sources.md` had recorded that, dated,
in a column headed *may we walk it*, with the answer **no**. The register was
correct and the tracker row was correct; the session opened the register and
read the sections it expected to need rather than the one about the thing it was
about to do. The run was stopped at 125 of 276 and its output discarded.

- **`unknown` refuses.** A host nobody has ruled on is not a host we may walk.
  That direction costs a lookup; the other direction costs an apology.
- **A DISALLOW is not a WALL.** A wall is a host refusing us, and RULING 53
  sends a session back to re-walk it on a clock. A disallow is a host telling us
  not to ask, and re-walking it on a clock is asking again after being told no.
- **Proved with a planted forbidden host**, so the refusal is demonstrated
  rather than asserted.

### RULING 149 — THE COVERAGE MATRIX IS GENERATED, INTERNAL, AND NEVER RENDERED TO A READER

(Adopted 2026-08-25, with the instrument it governs.)

**`docs/coverage-matrix.csv` is written by `pnpm matrix`, regenerated every
session, never hand-edited (RULING 92), and never rendered to a reader in any
form.**

*Why the last clause is constitutional rather than a preference.* The matrix is
a grid of every candidate against every fact, with a state and a provenance in
every cell. Put in front of a reader it is a **completeness score per
candidate**, sorted — which is the composite match score this product does not
compute, the per-card completeness marker RULING 42 deleted, and the
equal-effort failure, all at once. It is exactly as useful internally as it is
forbidden externally.

**It reads the stores and adds nothing to them.** The collection minimum is
untouched: an instrument that had to collect something in order to measure would
have changed the thing it measures.

### RULING 150 — A NEEDS SEAN ROW STATES ITS ASK AS AN ANSWERABLE QUESTION, WITH OPTIONS

(Adopted 2026-08-25.)

**A row in that section ends with a QUESTION the author can answer, and the
options he is choosing between. A row that cannot state one is misfiled and is
rerouted to the section that owns the work.**

*The rationale.* Needs Sean is the only channel that reaches a person, and it
stood at 48 open. A row that describes a situation without asking anything
cannot be closed by him — there is nothing to say — so it sits there forever,
and every row like it makes the queue less likely to be read at all. That is the
accumulation RULING 79 was adopted over, arriving through a different door.

- **Not every long row is misfiled.** A row asking a genuine judgement call is
  correct however long it is; what is misfiled is a row asking nobody anything.
- **A rerouted row is never reworded** (RULING 41) and is never closed by the
  reroute. It moves to the section that owns the work and stays open there.
- **An ask is a property of the SENTENCE, not of its punctuation.** Measured on
  adoption: only 5 of 44 rows contained a question mark, and 43 of 44 carried a
  real ask. A mechanical sweep would have rerouted 39 rows that genuinely need
  him.

### RULING 151 — THE AUTHOR'S TRACKER DECISIONS OF 2026-08-25, RECORDED AS A BATCH

(Adopted 2026-08-25, the author's instruction, recorded the way RULING 123
recorded his decisions of 2026-08-24 — so that a close has an authority which
exists. `docs/rulings.md` carries the detail.)

`NS11`, `NH142` and `NH169` close on the rotation proof. `B05` drops to P3 and
stays his. `T05` and `NH108` are annotated with his date and stay OPEN. `JOB03`
is rerouted out of Needs Sean under RULING 150 and diagnosed the same day.


## TWO RULINGS OF 2026-08-25 — THE RECONCILIATION

(Adopted 2026-08-25, earned by Item 6 of the one-session brief rather than
written ahead of it. **RULINGS 152 and 153.** `docs/rulings.md` carries both,
and `docs/reconciliation-2026-08-25.md` carries the evidence they were earned
from.)

### RULING 152 — a reader-facing DONE names the production deploy that is serving it

(Adopted 2026-08-25, earned by the reconciliation of Item 6. It is the
merge-cadence rule's missing receipt.)

**A session may not report a reader-facing item DONE without naming the
production deploy that carries it and the state that deploy reached.** Not the
merge, not the commit — the DEPLOY.

- **The deploy id, its state, and the SHA it built.** Read from Netlify's deploy
  API, which is one call and zero requests to the site (RULING 125).
- **A deploy that never reached `ready` has not shipped anything**, however
  green the merge was.
- **Where the deploy record cannot be read, the item reports `COULD_NOT_TELL`**
  and never DONE. RULING 24, applied to the last step.

*The rationale stays attached, because a stripped rule reads as guidance.* The
reconciliation of 2026-08-25 tested six DONEs against what production was
actually serving during Sean's walk, and found **every claimed fix genuinely
live** — so this rule is not written because a deploy ate one. It is written
because ANSWERING the question took an afternoon and a Netlify token that was
not there a day earlier, and because the same read turned up four production
deploys in two days that reached `error` and were never published — `3449ef8`,
`41113c1`, `55d3047` and `e0f6426`. Three were real code merges. Each was
covered by a later merge so nothing was permanently lost, and **between the
merge and that later deploy production served older code while nothing in this
repo said so.** A receipt costs one API call and removes the question
permanently.

### RULING 153 — a fix is verified on the reader's path, not on the path that satisfies the assertion

(Adopted 2026-08-25, earned by the reconciliation of Item 6. It is RULING 147 —
*no reconciliation may compare a parser to itself* — pointed at VERIFICATION
rather than at reconciliation, and it is RULING 136's missing half: that ruling
says a fix closes the class, and this says what it means to have checked.)

**A verification states the READER'S ROUTE to the thing it verifies, and walks
it. A test that exercises only the code path the fix introduced has proved that
the code does what the code does.**

*The rationale stays attached, because here the rationale is a measurement.* Six
DONEs were disproved by Sean the next morning. Verdict (a) — never reached
production — did not happen once; every fix was live. The five real recurrences
share one mechanism, and it is not carelessness:

- **`BAL-9`** built a camera store and restored from it correctly. The store is
  written only after a user GESTURE — the code says so itself: *"flyTo, jumpTo
  and fitBounds never [carry an originalEvent], so this stays silent through
  every camera move the app makes itself."* Entering a zip flies the camera
  programmatically, so a reader who types a zip and clicks through has nothing
  remembered and gets the continent back. The fix works for a reader who
  happened to pan first. **And `git grep BAL-9 -- tests/ scripts/` returns
  nothing**: the words "done, verified" rested on no artifact this repo holds.
- **`BC-14`** asserted the consolidation it had written, on the data type it had
  written it for, and reported *4 surfaces, 0 footnote markers* — true, and
  about the wrong four surfaces.
- **`JUR-2`** asserted the new branch and not the branch beside it, while the
  module's own documentation already said the branch beside it was wrong.

Operationally:

- **The route is stated in words** — *type a zip, open the ballot, press back* —
  before the assertion is written, so a route that never touches the fix is
  visible as one.
- **A verification that cannot reach the reader's route says so** and the item
  is a BOUNDARY STOP rather than a finish. That is a real ending and an honest
  one.
- **An assertion over stored state is not a verification of a rendered
  outcome.** A history-state round-trip is not a restored viewport, and only a
  capture read as an image is (the read-as-an-image rule).

## FOUR RULINGS OF 2026-08-26 — THE ALL-OPEN BOARD

(Adopted 2026-08-26, the all-open-board session. **RULINGS 157, 158, 159 and
160.** `docs/rulings.md` carries all four with the same text, because a ruling
the author cannot read is a ruling that does not bind him.)

### RULING 157 — A FIX IS VERIFIED AGAINST A CASE IT WAS NOT DERIVED FROM

(Adopted 2026-08-26. It is **RULING 153's missing half** — that ruling said a
verification must walk the READER'S route, and this says it must walk a case
the fix did not come from. It narrows neither RULING 136 nor RULING 153.)

**A fix's verification must exercise at least one case the fix was NOT derived
from, and the report NAMES that case. Verifying only against the reported
instance does not close the class.**

*The rationale stays attached, because a stripped rule reads as guidance, and
here it is a measurement rather than an argument.* The prior session produced
four reconciliations and **all four came back verdict (b) — predicate too
narrow.** Not one earlier fix had regressed; not one had failed to reach
production. Every one was real, live, and wrong about a case it had never seen.

**`MTG-9` is the clean illustration.** It was validated against a district whose
bad data was NOISY, then shipped wrong against one whose bad data was CLEAN,
because the predicate had been shaped by the noise. **The fix passed because
the test case was the source of the fix.**

That is not carelessness and care will not fix it. When one instance supplies
both the diagnosis and the proof, the verification is guaranteed to succeed.
**RULING 147 named this shape one floor up** — *no reconciliation may compare a
parser to itself* — and this is that reasoning pointed at a FIX.

- **The derived-from case is still verified.** This adds a case; it removes
  none.
- **The independent case is NAMED IN THE REPORT**, by id, surface or entity —
  never "audited across the class", which is a claim with no case in it.
- **Where the class genuinely has ONE member, the report says so** and states
  how that was established.
- **An independent case that FAILS is the deliverable.** It is the session
  finding the class before the author does. *It happened on adoption day: a
  computed-style probe agreed with the DARK-2 fix because the probe forced the
  browser into dark mode — the case the fix was derived from — and a capture
  taken with no such forcing showed the defect untouched.*

### RULING 158 — A SHED REQUIRES A MEASUREMENT AND A REASON

(Adopted 2026-08-26.)

**A shed is invalid without a STATED CONTEXT-USAGE MEASUREMENT, as a number,
and a SPECIFIC reason it could not continue. Below 80% context usage there is
room: stopping is an UNFINISHED SESSION and is reported as one, never as a
shed. Invoking the shed clause without a number is a failed close-out.**

*The rationale.* The prior session shed more than half its visual work **at 56%
context usage**, with no measurement and no reason. That is the same shape as
its own capture script reporting `0 offenders` about a panel it never opened: a
legitimate-sounding mechanism invoked for something that did not happen. *Shed*
and *stopped* call for completely different responses — one is scheduling, the
other is a problem — so a report that confuses them is unreadable.

- **The number is stated at the MOMENT OF THE DECISION**, not reconstructed.
- **The reason is specific to what remained**, never "running low".
- **A session that chooses to stop says so plainly** and does not point at the
  shed clause to describe it.
- **Order is unchanged.** Shedding is from the BOTTOM, never mid-item.

### RULING 159 — A COUNTING SCRIPT FAILS LOUDLY WHEN ITS DENOMINATOR IS ZERO

(Adopted 2026-08-26. It is **RULING 100's** partial and **RULING 43's**
zero-row extraction, moved to the instruments that measure this repo — and it
is the third venue for this exact shape.)

**Any script that reports a count FAILS LOUDLY when its denominator is zero or
its selector matches nothing. Zero is a result that must be EARNED, never
defaulted to.**

*The rationale.* The prior session's capture script reported **`0 offenders`**
about a panel it never opened — three guessed selectors, none matching, a clean
exit. **That is RULING 113's Chromium step that installed nothing and reported
success, and RULING 100's six silent partial extractions.** Same failure, third
venue. A fourth was found on adoption day: `pnpm questionnaire:doc --write` had
regenerated nothing and exited 0 on every Windows machine since it was written,
because its main-module guard split a backslash path on `/`.

- **A selector that matches nothing is an ERROR**, naming the selector, the
  surface, and what it did find.
- **A denominator of zero is an ERROR** unless the script can state a reason the
  population is genuinely empty — a named `COULD_NOT_ASSERT`, never a silent
  pass (RULING 100's second state).
- **The floor is asserted BEFORE the count is reported.**
- **The instrument is shown catching the real thing** (RULING 110).

The machinery is `lib/ops/denominator-floor.ts`, the audit is
`pnpm floor:audit`, and the baseline in `tests/denominator-floor-baseline.json`
pins the invariant and the direction rather than the size of the gap
(RULING 116). Measured on adoption: **275 counting scripts, 214 with no floor.**

### RULING 160 — IN-CYCLE SALES ARE ALLOWED, AND EQUAL SOLICITATION IS THE CONSTRAINT THAT CARRIES NEUTRALITY

(Adopted 2026-08-26, Sean's ruling. **Amends RULING 120** under the RULING 99
procedure. RULING 120's prohibition on exclusivity and its equal-solicitation
obligation are UNCHANGED and carried forward in force; what changes is WHEN a
sale may happen, and what the whole set of constraints is.)

**Sean's ruling and his reasoning, recorded because a paraphrase of a business
decision is a different decision: in-cycle sales are ALLOWED, as standing
policy. August and September of an election year are the highest-value moment,
and refusing it is the wrong call.**

**The old retrospective-only posture — nothing sold until after November 3 —
was PILOT-SCOPED and is superseded.** It is not to be re-imported anywhere: not
in the pricing sheet, not in the committee-sale rules, not as a lingering
conditional in code or copy. *Swept on adoption across the whole tree with nine
search shapes; every hit was a ballot-measure analysis or an unrelated build
note. **0 remnants found, 0 removed** — the posture had never been written into
the repo, which is exactly how a superseded rule comes back as drift.*

**Neutrality is now carried by FOUR constraints, and they are the whole of it:**

1. **Equal solicitation.**
2. **Published uniform rates.**
3. **Never exclusive.**
4. **No off-catalog bespoke cuts for any single buyer.**

**Three of the four are ARTIFACTS and verify themselves.** A rate sheet is
either published and uniform or it is not.

**Equal solicitation is a BEHAVIOUR, and it is the one that actually carries the
neutrality.** Offering insight to the campaign that asked while never
approaching its opponent produces **a perfectly uniform rate sheet and a
lopsided customer list** — invisible in every artifact above.

So the **solicitation ledger** is built: every offer recorded, to whom, when, at
what published rate, and which contest it touches. **The reconciling unit is the
CONTEST**, so both sides of a race are answerable at a glance and by anyone; a
ledger sorted by buyer needs the reader to do the join in their head, and a
claim that depends on that is a claim nobody checks. A one-sided contest is a
BREACH reported with the unapproached side NAMED, never as a percentage. The
rate on an offer is a REFERENCE to a published entry and never a typed number,
because a typed number is how an off-catalog cut gets made without anyone
deciding to make one. **It shares no joinable column with reader data** —
architecture, not a policy promise (RULING 132).

**Buyer composition is NOT an obligation.** RULING 120's second half is
untouched: a skewed set of buyers is a fact about the market, and the only ways
to "fix" it would be to screen customers by politics or to claim a control
nobody has.

`lib/business/solicitation-ledger.ts`, guarded in
`tests/solicitation-ledger.test.ts`, whose load-bearing case is the one an
artifact can never catch.

## TWO RULINGS OF 2026-08-26 — THE INVERTED LADDER AND THE DONOR

(Adopted 2026-08-26, the sources-and-incumbency session. **RULINGS 166 and
167.** `docs/rulings.md` carries both in plain language, because a ruling the
author cannot read is a ruling that does not bind him.)

### RULING 166 — THE BODY'S OWN PUBLICATION IS RUNG ONE, AND ITS BULK DOWNLOAD IS RUNG ZERO

(Adopted 2026-08-26, the author's ruling. **Amends RULING 84** under the
RULING 99 procedure: that ruling's three tiers stand and its cost-per-fact
reasoning is untouched. What changes is the ORDER INSIDE Tier A. It narrows
nothing.)

**Before any aggregator, any third party, and any per-entity search, the
governing body that holds the office is walked first. Where that body offers a
bulk download, the bulk file is taken before any page-by-page retrieval. A
third-party source may only be reached after the body's own publication has been
walked and what it carries has been recorded.**

*Why this was ruled, stated plainly so it is not softened.* New Hampshire's
state legislative data reached this product through **LegiScan — a third-party
aggregator** — while the New Hampshire General Court publishes its own data
directly at `gc.nh.gov/downloads/` (last tested 2026-08-26, HTTP 200), including Member Data as `.txt`, `.xls` and
`.xlsx` and an ODBC document for a public read-only SQL Server. That page exists
precisely so consumers do not have to scrape the site. **The ladder was
inverted.** LegiScan is a good source and stays in use; it simply is not rung
one, and reaching it first meant no session ever asked what the body offered.

**This is not a legislature rule.** It applies to every body in the product — a
county, a school district, a city council, a state agency. The bodies that
publish in bulk usually do so precisely to avoid being scraped.

**Tier A splits, and that split is the whole amendment.** **A0** is the body's
own publication and the tier above it in government (RULING 93) — bulk download
first, then the body's own pages. **A1** is third-party compilations that answer
many entities at once: Wikipedia, LegiScan, Citizens Count, Open States,
GovTrack. A1 is still Tier A and is still walked before Tier B and Tier C; it is
now walked after A0. Tiers B and C are unchanged.

**A bulk file is rung ZERO because it is not a retrieval problem at all.** The
fourteen rungs are about getting bytes past a wall. A published `.txt` of a
whole roster has no wall in front of it, and a session that walks rungs 2
through 6 against a body's individual member pages while that file sits one
directory away has not been defeated by anything — it never asked.

*Measured on adoption, last tested 2026-08-26.* `gc.nh.gov/downloads/Members.txt`
is 82,694 bytes and 408 rows carrying, per legislator, name in three parts, chamber, seat number,
county, district, **`electedStatus`**, address, phone, work email, party, title
and up to five committees with their phones — **406 of 408 with an email and 266
with a phone**, in one fetch, from the body. `ftp://ftp.azsos.gov/cfsdata2/`,
named in Arizona's own Bulk Filing Guide, is anonymous and carries **8,828
Arizona campaign committees** and the state's **109 filing jurisdictions** (1
state, 15 counties, 93 cities and towns). Neither had ever been walked.

**And the ruling paid for itself twice on adoption day.** The brief that ordered
this work named New Hampshire's public SQL Server as `216.177.20.245`. The
body's own document names `66.211.150.69`. Probed the same hour: the brief's
address is `ECONNREFUSED`; the body's answers **TCP OPEN on 1433**. A session
that went to the aggregator, or to the brief, rather than to the body would have
recorded a dead endpoint.

### RULING 167 — DONOR RENDERING IS AGGREGATE ONLY

(Adopted 2026-08-26, the author's authority, stated in the brief as in force
rather than as a proposal. It sits beside **RULING 126**, which walls
campaign-finance data out of everything sold; this governs what may be shown to
a READER, which is a different question and was open.)

**Totals, source types, in-state versus out-of-state, and employer-level
rollups. No individual donor name and no donor address renders anywhere in this
product, for FEC data or for state data.**

*The rationale stays attached.* Publishing them is lawful — that is what a
disclosure regime is. **Rendering them searchably builds a way to locate private
individuals by their politics**, next to a map, next to a zip box, in a product
organised around a reader's address. This project will not build that, and the
reason is not legal exposure.

- **A donor is a private individual. A committee is not.** An organization
  renders as filed, with its registered name and committee type, exactly as the
  organizations-render-as-filed rule already requires. Nothing here narrows it.
- **An employer-level rollup is an aggregate and is permitted**; a single row
  naming one person's employer beside their contribution is not.
- **This is a RENDER rule and not a COLLECTION rule.** The filings are retrieved
  and held with their provenance intact, because a claim about money still needs
  its source record.
- **RULING 126 is untouched and is the other wall.** None of this data enters an
  export, an aggregate, or anything sold, at any level of summary.

*Measured on adoption, and the measurement is the reason this entry exists in
this shape.* The session first wrote that nothing rendered and the count changed
was 0 of 0. **That was wrong**, and wrong in the way this file names most often:
an assertion about a surface nobody had opened. `components/funding/funding-section.tsx`
was rendering `group.contributorName` beside `{group.city}, {group.state}` for
every itemized individual receipt, live. **2 of 2 render sites changed** — the
named one, and the second-hop panel a fix aimed at the first would have left
standing (RULING 103, RULING 157). The cheap fix was refused on purpose: keeping
the rows and dropping only the names leaves an amount, a city and a date per
row, which is re-identifiable against the FEC's own public search in about a
minute. The row had to stop being a row. Guarded in
`tests/donor-aggregation.test.ts`.

## Ask before

Adding a user data field. Adding an external source. Anything that ranks, scores, or orders candidates. Anything that renders one user's input — or any aggregate of it — back to users. Anything that changes how reactions are bucketed or exported.
