> Historical implementation record. This is not current policy or a release requirement. Read docs/rulings.md §0, §3 and §5 for current instructions.

# we-the-people — current context

**GENERATED FILE — do not edit, and do not copy it back into the repo.**
Written by `pnpm handoff` (`scripts/context-file.mjs`) at 2026-09-04 10:16:34 EDT.
Session day 2026-09-04 (America/Phoenix, from `pnpm stamp`).

It has no repo counterpart, is never compared for drift, is skipped by
`pnpm handoff --check`, and is overwritten after every successful `--ship`.

It exists so a conversation outside the repo can get current without pulling
the 1314 KB `state.md`. **Nothing in it is composed** — every line is read
from `docs/state.md`, `docs/tracker.csv`, `lib/ripcords.ts` and git. Long
fields are clipped with `…`; nothing is summarised.
Repository holding paths resolve through the committed move plan; source records stay unchanged.

---

## Phases — 0 standing(s)

Source: docs/state.md — section not found.

> **SECTION FAILED — phases could not be built.** `### Where the phases stand` is not in docs/state.md — the heading moved or was renamed

> This is a failure of this generator, not a statement that the project has no phases.

<!-- PINNED: never trimmed. Verbatim from CLAUDE.md. -->

> **Source: `docs/governance/ledger.jsonl`, the canonical governance store, verbatim.**
> Both hand-written copies of each ruling are carried where they diverged.
> `CLAUDE.md` is the authority; this is a copy of it, pinned here because the
> failure RULING 88 fixes is a session not knowing there was anything to look up.
> `tests/context-pinned-conduct.test.ts` fails the build if the two diverge.

## DISCOVERY CONDUCT



*Pinned VERBATIM from `docs/governance/ledger.jsonl`, the canonical governance store. Nothing here is composed.*



### RULING 248 — if a public record exists, get it

**These are public bodies and public people. Their records, meetings, money and votes are already owed to the reader. If a public civic record exists, get it — and "get it" means the whole chain, `DISCOVERED → ACQUIRED → EXTRACTED → NORMALIZED → CANONICALLY_LINKED → QUERY_RETRIEVABLE → READER_VERIFIED`, where no upstream success implies a downstream one.**

1. **The obligation outlives the route and the worker.** A route can fail; the record obligation cannot. `ROUTE_BLOCKED → NO_SOURCE_FOUND → COMPLETE` is forbidden for a record known or expected to exist. Running out of known methods is not running out of methods; the next obligation is to find the next public path.
2. **Three closes, and no fourth.** (a) Acquired and reader-answerable. (b) Affirmative source-backed evidence about the record itself — not created, not yet published, lawfully withheld, destroyed under retention, not obtainable publicly — where our failure to retrieve is never that evidence. (c) Every machine-executable public route worked and only a human or offline act remains: `PUBLIC RECORD STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED`, and the obligation stays live.
3. **Persistence is never intrusion.** No bypassed authentication, no misused credential, no exploited vulnerability, no non-public system, no residential-proxy spoofing, nothing fabricated when the ladder is genuinely exhausted.
4. **The vendor is not the record. The URL is not the record. The API is not the record.** Granicus, Legistar, CivicClerk, BoardDocs, Diligent, CivicPlus, Hyland and the like are filing cabinets. The model is `GOVERNMENT → RECORD → REPRESENTATION(S) → ROUTE(S)`. A failure on one host is a fact about that host. One representation lost is a replacement obligation, never a loss and never a blessing.
5. **One successful route never collapses the source universe.** Materially distinct representations carry different facts: an API 200 never retires the PDF, a readable PDF never retires the API. An adapter is a route portfolio, its known routes are a floor, and a meeting page is a branching surface. Reconcile every material representation into one canonical record with provenance, observation time and supersession; deduplicate exact duplicates only.
6. **Acquire to the authoritative source universe; project to the reader.** A ZIP, pilot or reader location may order acquisition and may never define its denominator. Where an authority governs a state, acquire the state; where it governs a county, municipality or district, acquire that authority's complete applicable universe. "Statewide" and "source-universe" are claims about the population, not the shape of a key: a pilot-derived population is labelled pilot-derived. Invariant: **zero redundant internet hunt when a new ZIP activates** — anything absent is a pre-existing obligation, never new work caused by the ZIP.
7. **Acquisition without promotion is inventory, not product.** An obligation closes when the reader-facing surface reflects the acquired truth or renders the honest gap, not when evidence reaches the vault. Held data with no live promotion tail is a defect. While unattended promotion is OFF, the pipeline still runs to a STAGED, promotion-ready state and session shipping carries the last mile.
8. **The subject universe may be bounded; the method never is.** A workstream may have a denominator. The effort permitted to complete an owed item is not capped. Where no automated branch reaches a body, the session hand-works it — that is the job, not a fallback — and the branch it builds becomes project property inherited by every later body, ZIP and state. A method that works in 43 states is the method learned so far, never *the* method.

---

### RULING 249 — the ladder, the tiers, and the order they are walked

**Every route carries a tier, and the tiers are walked in order, always. A session may not reach Tier C for a field until Tier A and Tier B are walked and recorded for it.**

- **Tier A0 — the body's own publication, bulk download first.** The governing body that holds the office is walked before any aggregator, and where it offers a bulk file the bulk file is taken before any page-by-page retrieval.
- **Tier A — broad sources that answer many entities at once.** The directory the tier above publishes about the tier below (federal → states → counties → towns and districts), the Secretary of State, the election division, the county clerk, the campaign-finance authority, the Census of Governments, NCES, the FEC directory, Wikipedia's templated municipality and election articles. **Every key in `.env.local` is a Tier A route and is walked; a paid source going unwalked while a free one rate-limits is a defect. A credential is proven by calling it, never assumed.**
- **Tier B — the entity's own official source.** The town site, the district site, the body's own page.
- **Tier C — per-entity search.**

**Wikipedia names the person; the citation proves them.** It is a discovery source, never a source of record: every extracted fact carries its footnote and the primary source is fetched before the fact ships. Unconfirmed is a `LEAD`, not a `FOUND`.

**The free-source floor.** No paid resource is proposed, acquired or specced until every free route in the manifest has been walked and reported with counts. This binds reviews as well as sessions.

**Per-state enumeration precedes the hunt.** Before any state's hunt begins, its free sources are enumerated into the manifest as state-scoped routes.

**The retrieval-mechanics ladder is canonical HERE, and its numbering is what reaches the database as `walledAtRung`. There are FOURTEEN numbered rungs, walked in order; a bulk file is rung ZERO because a published file has no wall to get past.** The A0/A/B/C tiers above say WHERE to look; these rungs say HOW to get bytes past a wall, and only a genuinely new retrieval class adds one — the numbers are stable, because a stored `walledAtRung` would otherwise be reinterpreted: (1) committed snapshot; (2) plain fetch; (3) fetch with the full browser header set; (4) a different CLIENT whose TLS fingerprint passes; (5) a different EGRESS — a rung is `(client, headers, URL, egress)`, and a refused CI-runner IP is an egress wall; (6) the LIVE BROWSER with JavaScript executed and content awaited — a plain fetch returning nothing on a JS-rendered page is a FALSE MISS, not a wall; (7) the page's own network calls — the JSON endpoint feeding the widget; (8) structured markup the prose hides — vCard, JSON-LD, microdata, RSS, iCal; (9) linked documents in EVERY format — PDFs ARE DATA, text-layer first, OCR when scanned; (10) sitemaps, search-index caches, directory listings; (11) the Internet Archive, with snapshot URLs; (12) the vendor platform underneath — Diligent/BoardDocs, Granicus, CivicPlus and siblings; (13) the body's own public-records request path, as a named rung; (14) the author's browser, last. Structured reference data lives in `data/reference/`, content committed, binary out, SHA-256 and provenance beside it.

---

### RULING 250 — absence is argued, never asserted

**Discovery is a tree, not a ladder. Branches to the same fact are independent; a branch returning empty is one measurement on one date, never a verdict about the fact. No number of attempts earns an absence, and a protocol that terminates is not persistence.**

**What earns `VERIFIED_ABSENT`.** Every route in the manifest for that field type walked, named and dated, all returning nothing — a named list, the same list every time — **plus** the stuck protocol below, recorded. An absence with no stuck-protocol block is void and the field returns to owed.

**The stuck protocol** runs after Tier A and Tier B, before any absence and before Tier C. Five moves, each with its literal query or URL and result recorded, and they are the opening, not the count:
1. What would a person with a browser type right now? Type it.
2. What does the tier above publish about the tier below? Descend; do not guess sideways.
3. What did entities of this same shape do? Test the shape, not the instance.
4. Who else needed this badly enough to have compiled it — courts, local news, the League of Women Voters, unions, chambers, libraries, universities?
5. One lateral query phrased as "where else can I find this."

A move that was refused by a wall still counts as walked, carrying its rung history and test date. **The two-click test:** before any absence, state what a non-technical person would type into a search box and confirm that path was walked.

**Absences expire.** Candidate fields 7 days; bodies, rosters, officials 14 days; walled sources 14 days regardless of how emphatically the wall was recorded — or the day any wall inside the argument falls, whichever is first. Stale is re-walked before it is relied on; stale is never deleted. A record that cannot say when it was measured reads as stale.

**Blocked is a real state.** Dispositions include `UNWALKED`, `DISCOVERED`, `IN_PROGRESS`, `INGESTED`, `POINTER_ONLY`, `WALKED_NO_YIELD`, `BLOCKED_CURRENTLY`, `REQUIRES_NEW_ADAPTER`, `RECORDS_REQUEST_PENDING`, `NOT_APPLICABLE`, `RECHECK_DUE`. A CAPTCHA is not absence. Missing tooling is not absence. A walled host is never evidence that a body is unreachable.

**WALL versus JOB.** A source that walls, challenges or times out on its own side is a WALL: named, its rung recorded, the run continues. Anything that is our code is a JOB failure and the run goes red. Check whose stopwatch ran out before naming a wall.

**Permission and transport are orthogonal.** `PERMISSION: ALLOWED | DISALLOWED | CANNOT_TELL | NOT_APPLICABLE` and `TRANSPORT: REACHABLE | FAILED_AT_RUNG | CHALLENGED | TIMEOUT | TLS_CLIENT_MISMATCH | OTHER_NAMED_FAILURE` are separate facts. "Could not fetch robots.txt" is never "robots disallows this host." `CANNOT_TELL` fails safe for the route and keeps hunting by other branches.

**A 200 that is not about the thing asked for is not a document.** Any route that can echo, wall or template gets a control query; a guessed identifier yields a `LEAD`, never a `HIT`. A search that finds nothing reports the shapes it searched, not only the terms.
- Branch independence is counted over distinct dependencies, never branch names: two routes that fail for the same reason are one route wearing two names, and an absence argued from them is void.
- A session with no further avenue says "I have run out of ideas" — a claim about the session, never "this is not published", which is a claim about a government. A blocked route may never become a blocked fact: a CAPTCHA, a wall or missing tooling is a real transport state, never an absence.

---

### RULING 251 — every twig is named, and coverage is counted from the top down

**The trunk is the United States; the branches are the states; then counties, towns, districts, and the water authority in one township — and the twig is as relevant as the trunk. No body is too small to name. Name it, then find what can be found about it.**

- **Coverage descends.** Each tier publishes the tier beneath it, and a tier is not complete until the tier above has been asked what is in it. A body found only by per-entity search when the tier above was never asked is a coverage defect. A walk is counted or it did not happen.
- **A lead is not a body.** Detectors produce candidates: `EDGE_DISCOVERED → ENTITY_CANDIDATE → ENTITY_VERIFIED → BODY_PROMOTED`, or `DUPLICATE`, `REJECTED_FALSE_POSITIVE`, `NEEDS_CLASSIFICATION`. Coverage rises only through verified, promoted bodies, and no candidate count may substitute for the promoted-body count.
- **An enumeration states its geography and is checked externally.** A total that reconciles is not a total that is correct. Coverage claims are made against the Census of Governments and NCES, never against our own registry — and those sources establish governments and districts, never governing bodies.
- **A sovereign tribal nation is its own category of government** — neither federal, state nor local — with its own label and body class, nationally.
- **Zero at a tier fails loudly.** A zero where the walk should have returned something — zero counties in a US state, an empty official enumeration — is a BROKEN WALK and a JOB failure, never a coverage finding; a count is trusted only once the walk that produced it is proven to have run.
- Coverage of the smallest bodies is also measured against the state registers that enumerate the twigs the Census of Governments and NCES miss.
- Two official enumerations that disagree is a finding, not an error: the body is named with both facts recorded, never dropped because two authorities could not agree it exists.
- A government page does not recursively make every hyperlink on the internet owed: a discovered route enlarges the active graph only when it plausibly advances an owed question — a body, an official, a meeting, an election, a filing, a record, or a new source class.

---

### RULING 252 — method knowledge is typed, governed, and inherited

**Every later session inherits method knowledge and none re-derives it, so a wrong sentence in the store costs every session after it. The store is typed, written through one governed path, and read through one typed projection.**

- **Four assertion classes, distinct burdens:** `ROUTE_EXISTENCE`, `ROUTE_OUTCOME`, `COVERAGE_CLAIM`, `DERIVED_CONCLUSION`. A false coverage claim or conclusion never deletes a valid route existence. A method write cites its evidence: artifact, route, jurisdiction, vendor context, observed date, and the disposition that earned it.
- **A new validated method reopens prior conclusions earned before it existed**, and flags every dependent assertion for revalidation. Proven repeatable methods graduate into deterministic code.
- **Convergence is versioned.** `CONVERGED_AS_OF` means every currently eligible avenue has a disposition under the current method, universe and eligibility versions on that date — never that no other source exists. Completion is derived from child state.
- **A frontier is state, not a recipe for recreating state.** Every eligible edge persists with a stable id, provenance and disposition; the cursor is explicit; restart never recrawls seeds to rediscover what was known.
- **One governed write path** to `data/method/knowledge.json`, validating before writing and refusing on any validator issue. A rejected candidate is retained as rejected. Consumers read the typed current-claim projection and never raw route prose.
- **A disposition cites only the Attempt that earned it** and only artifacts that Attempt recorded. A policy denial is a fact about the policy, not the record. A declared contract clause is enforced or it is not law. A snooze changes what the owner is shown and never what is true.
- **Provenance is machine-owned.** When, where, under what permission verdict, in what record class and on which artifacts a record was retrieved is written by the machine from the Attempt, artifact, obligation and permission records. The model's statements about those facts are recorded as claims and never become durable provenance.
- **A contract may only ever TIGHTEN what closes an obligation.** Naming an open disposition in an acceptable-dispositions list never makes it terminal — the evaluator still refuses it as outstanding — so a clause that would let a still-open civic obligation read as closed is refused.
- "Nothing new learned" is a legitimate measured result only after genuine expansion work occurred; it may never be inferred merely because every inherited route completed.
- No manifest, route list, source taxonomy, government-type or platform taxonomy is ever complete: each represents what the project knows now, and a new route is project knowledge, persisted, classified by portability and inherited by every later jurisdiction.

---

### RULING 253 — discovery conduct inside a hunt

**Sessions walk the routes a brief names and no others, because that is what a checklist asks for. The correction is a required output that cannot be produced by walking a list.**

- **Every hunt report carries an EXPANSION section** listing routes that did not exist at session start — how each was conceived, what it returned, where else it applies, and whether it was recorded. Expansion is a new route to a field already owed; it is never a side quest. In every hunt brief it is its own numbered item and never last.
- **A founder find is a class-wide defect** in the discovery process, handled like any named instance: what would have found it, and where else that applies.
- **`docs/sources.md` is the source of record for what resources exist**, keyed or not, each row carrying status, access method, licence, adapter and a last-walked date on the same expiry clocks as absences. A freshness date is written only by the code that read the source; a stamp that updates without a read is the suppression of one.
- **The shared fetcher enforces the may-we-walk verdict** — it refuses any host recorded `no` or `unknown` — and a permission rule binds the next fetch, never possession of what was already published. Captured public-record text is kept and used. Every transport success passes one shared document finalizer.
- **A brief says which kind it is** — local-required (credentials, live network, production) or remote-capable — and the session confirms before item one. A hunt is always local-required. Session-dated scripts are committed and held to every standard.
- **`docs/report-contract.md` is the close-out contract every hunt answers.** A brief may add to it and never subtract.
- **Every expansion route records the LITERAL query or URL that produced it** — the exact text typed, not a description of the search — alongside how it was conceived, what it returned, where else it applies, and whether it was recorded.
- **A zero-yield route is a reported success, never a defect. The invention is the deliverable, not the yield.** The route found and recorded is the result, whatever it returned; an empty expansion section fails the item.

*(Pinned verbatim from `CLAUDE.md` by `scripts/context-file.mjs`. Every other
section of this file is an index; this one is the text, because the failure it
fixes is a session not knowing there was anything to look up.)*

---

## Rulings — 45 recorded

Source: `docs/rulings.md`, append-only. **This is an index, not the text.**
`CLAUDE.md` is law; these are the author's calls that are not, and a session
told to hardcode a ruling as fact reads the file rather than the chat it came
from. Each entry there names what it supersedes.

- RULING 3 — the organic census is closed as a question  [R-0003 · DECISION · ACTIVE]
- RULING 4 — `CLAUDE.md` has no rules 4g or 4h  [R-0004 · DECISION · ACTIVE]
- RULING 15 — the Kearsarge 15-row floor is retired  [R-0015 · DECISION · ACTIVE]
- RULING 17 — `walledAtRung` values written before F22 are provenance-unknown  [R-0017 · DECISION · ACTIVE]
- RULING 123 — the author's decisions of 2026-08-24, recorded as a batch  [R-0123 · DECISION · ACTIVE]
- RULING 151 — Sean's tracker decisions of 2026-08-25, recorded as a batch  [R-0151 · DECISION · ACTIVE]
- RULING 161 — Sean's tracker decisions of 2026-08-26, recorded as a batch  [R-0161 · DECISION · ACTIVE]
- RULING 213 — no external orchestration service; the scheduler builds on the existing control-plane interfaces  [R-0213 · DECISION · ACTIVE]
- RULING 214 — no new multi-project abstraction until a second project exists  [R-0214 · DECISION · ACTIVE]
- RULING 215 — activation Level 5 is removed from the architecture; Level 4 automatic publishing is deferred  [R-0215 · DECISION · ACTIVE]
- RULING 220 — Level-2 scheduling authority persists in a Postgres provider behind the existing control-plane interfaces  [R-0220 · DECISION · ACTIVE]
- RULING 230 — one canonical model-switch verdict  [R-0230 · LAW_DECISION · ACTIVE]
- RULING 241 — Level 1 activation parameters: a TEMPORARY $25/day rolling research spend ceiling, the local dispatchOne worker runtime, hosted worker runtimes deferred to the frontier  [R-0241 · DECISION · ACTIVE]
- RULING 247 — THE CONSOLIDATION  [R-0247 · LAW_DECISION · ACTIVE]
- RULING 248 — if a public record exists, get it  [R-0248 · LAW_DECISION · ACTIVE]
- RULING 249 — the ladder, the tiers, and the order they are walked  [R-0249 · LAW_DECISION · ACTIVE]
- RULING 250 — absence is argued, never asserted  [R-0250 · LAW_DECISION · ACTIVE]
- RULING 251 — every twig is named, and coverage is counted from the top down  [R-0251 · LAW_DECISION · ACTIVE]
- RULING 252 — method knowledge is typed, governed, and inherited  [R-0252 · LAW_DECISION · ACTIVE]
- RULING 253 — discovery conduct inside a hunt  [R-0253 · LAW_DECISION · ACTIVE]
- RULING 254 — show everything we find, and say one thing about it  [R-0254 · LAW_DECISION · ACTIVE]
- RULING 255 — neutrality is symmetric effort, explained absence, and nothing invented  [R-0255 · LAW_DECISION · ACTIVE]
- RULING 256 — scope, identity, and what fills a field  [R-0256 · LAW_DECISION · ACTIVE]
- RULING 257 — a fix is proved on the reader's path, against a case it did not come from  [R-0257 · LAW_DECISION · ACTIVE]
- RULING 258 — reader surfaces speak plain language  [R-0258 · LAW_DECISION · ACTIVE]
- RULING 259 — the collection boundary  [R-0259 · LAW_DECISION · ACTIVE]
- RULING 260 — Speak Your Mind  [R-0260 · LAW_DECISION · ACTIVE]
- RULING 261 — what is sold, to whom, and the four constraints that carry neutrality  [R-0261 · LAW_DECISION · ACTIVE]
- RULING 262 — feedback names examples, images are the spec, and a capture is evidence only once read  [R-0262 · LAW_DECISION · ACTIVE]
- RULING 263 — the sources register and what may be fetched  [R-0263 · LAW_DECISION · ACTIVE]
- RULING 264 — evidence proves its own identity  [R-0264 · LAW_DECISION · ACTIVE]
- RULING 265 — secrets and the owner's identity  [R-0265 · LAW_DECISION · ACTIVE]
- RULING 266 — verify locally, ship once, name the deploy  [R-0266 · LAW_DECISION · ACTIVE]
- RULING 267 — a gate is real, or it is not a gate  [R-0267 · LAW_DECISION · ACTIVE]
- RULING 268 — the single nightly door, and the three contracts behind it  [R-0268 · LAW_DECISION · ACTIVE]
- RULING 269 — an operation that can return nothing is asked what it returned  [R-0269 · LAW_DECISION · ACTIVE]
- RULING 270 — the tracker is a queue that empties  [R-0270 · LAW_DECISION · ACTIVE]
- RULING 271 — Needs Sean is a question, a lane, and never a stop  [R-0271 · LAW_DECISION · ACTIVE]
- RULING 272 — how law is made  [R-0272 · LAW_DECISION · ACTIVE]
- RULING 273 — how a session runs  [R-0273 · LAW_DECISION · ACTIVE]
- RULING 274 — an instrument proves what it claims  [R-0274 · LAW_DECISION · ACTIVE]
- RULING 275 — data conventions that bind everywhere  [R-0275 · LAW_DECISION · ACTIVE]
- RULING 276 — the pilot ZIPs and the zip order  [R-0276 · LAW_DECISION · ACTIVE]
- RULING 277 — integration is separate from activation, and a session never waits  [R-0277 · LAW_DECISION · ACTIVE]
- The repeatability bar (2026-08-20)  [R-X-the-repeatability-bar-2026-08-20 · DECISION · ACTIVE]

## P0 tracker rows — 93 of 456 rows

Source: `docs/tracker.csv`, every row with Priority `P0`. Notes clipped to 130 characters.

| ID | Item | Status | Note |
|---|---|---|---|
| A07 | No-source refusal behavior | Done | Build as a constraint on A01, in the same PR. Do not ship a natural-language entry point without it. \|\| 2026-08-17 (g11). VERIFIE… |
| B06 | Document idea origin date | Done | 2026-08-17 CLOSED BY THE AUTHOR, disposition verbatim: "Idea on 8/7/2026". IDEA ORIGIN DATE RECORDED: 2026-08-07. Stated by the a… |
| B11 | Statewide executives - the governor joins who-governs (item 2… | Done | 2026-08-14 (third 08-14 session). Verified: AZ Hobbs 602-542-4331 + engage@az.gov off /constituent-services (draft path 404d, cor… |
| B13 | The thin-candidate line, and equal effort per candidate (item… | Done | 2026-08-14 (the tester's mobile pass). tests/candidate-cards.test.ts +3 tests. Thin count 101/136 by a heuristic walk of the thre… |
| D07 | OCD-ID resolution layer | Not started | 2026-08-11: the canonical OCD list (opencivicdata/ocd-division-ids, identifiers/country-us.csv) uses cd:at-large, not cd:1. Verif… |
| D09 | ZCTA centroid table - full | Done | Minutes of work. Highest demo-quality-per-effort item on the board. Do first. 2026-08-11 done: pnpm zcta:fetch run, lib/geo/zcta-… |
| D14 | Vendor and statute review per source | Done | Blocks D12 and D13. Created 2026-08-12 because D01 was scoped without any of it. Each finding must also answer the state-law ques… |
| D15 | Decide the OCD-ID convention and reconcile to the canonical l… | Done | 2026-08-12. Was docs/state.md 5.2 item 8 ('verify before Phase 5'); checked and it fails, so it is now a blocker for Phase 4.6 ra… |
| D26 | Meetings snapshot - the committed file production reads | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. Built: snapshot module with validation refusing count-less or all-failed snap… |
| D32 | Officials become people you can actually reach (3a-3e) | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). 3a: Officeholder gained email; the Plural adapter… |
| D33 | AZ and NH ballot surfaces (S3, into S2's shape) | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). ARIZONA (data/states/az/ballot/az-pima-2026.json)… |
| D37 | NH 2026 ballot measures - the earned absence | Done | 2026-08-17: seven CACRs enumerated via LegiScan/CitizensCount/news, ALL dead (CACR 6 ITL 01/07; 12 failed House 3/5 05/14 193-148… |
| D38 | Coverage completeness audit - the official universe | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. Official universe measured: Pima 50 / Morris 98 / Merrimack 63 governments… |
| D39 | Sunnyside and Amphitheater wired live — the author's catch cl… | Done | 2026-08-18 (session date; wall clock 2026-08-14), branch claude/fec-funding-and-final-prep-0818. THE HONEST DIAGNOSIS FIRST: the… |
| D40 | FEC replication bug: one campaign books on three officials (c… | Done | Fix: target moved into the PATH (app/api/funding/[target]/route.ts, old query route deleted; funding-block fetches path form) - e… |
| D44 | FEC snapshot thin-guard - a shrinking book never ships silent… | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. lib/funding/guard.ts findShrinkRegressions (pur… |
| D50 | Photos round 2 - door 2 opens and the chamber tier ships (ite… | In progress | 2026-08-15 (round 3). 535 of 750 -> 590 of 750; 69 portraits shipped under door 2 (24 NH senators, 25 NH representatives, 20 cura… |
| D66 | The meetings snapshot counts two things and states one number | Done | 2026-08-17 (hotfix-0817, branch claude/h2-carry-forward-truth-0817). test 751 of 751 pass (13 new this session: 10 in tests/snaps… |
| F22 | Refresh meetings snapshot has been red since 2026-08-19 and t… | Done | 2026-08-20 (F22 items 1-3, branch claude/f22-refresh-red-0820). THE FIX IS ONE LINE OF SEMANTICS: tests/coverage-manifest.test.ts… |
| G01 | Who Governs Here states one number for one list | Done | 2026-08-17 (g6 item 1a, branch claude/g6-consolidation-0817): fixed. The brief's named suspect was HALF WRONG - the Public Housin… |
| G02 | Every route refuses an unrecognised or malformed parameter | Done | 2026-08-17 (g6 item 1b, branch claude/g6-consolidation-0817): fixed. ROOT CAUSE: Number(params.get('lat')) - params.get returns n… |
| G03 | walk:all prints its own census so no session transcribes a co… | Done | 2026-08-17 (g6 item 1c, branch claude/g6-consolidation-0817): reconciled by enumeration. NOTHING WAS LOST. Enumerated every check… |
| G11 | The meetings count agrees with itself in four places | Done | 2026-08-17 (g6 item 1d, branch claude/g6-consolidation-0817-b): CONFIRMED, not fixed - there was no live defect. One run, four zi… |
| M01 | Map entry screen | Done | Map entry, ZCTA fly-to, venue-grouped pins, meeting panel, empty-state cascade with tier reported on screen. Evidence: branch cla… |
| M08 | MapLibre vector tile fix | Done | RESOLVED 2026-08-11 - see the RESOLUTION paragraph at the end; the diagnosis before it was partly wrong and is kept for the recor… |
| M23 | Officials and representation vanished at the exact tier - res… | Done | 2026-08-14 branch claude/restore-representation-session-0814. Fix: render gate extracted to lib/registry/representation.ts (shoul… |
| M24 | Reset all did not work - reset registry and honest active cou… | Done | 2026-08-14 branch claude/restore-representation-session-0814. Structural fix per the count-invariant family: lib/state/reset.ts i… |
| M26 | S1 - the reader disambiguation prompt (4.6.3/4.6.3c) | Done | DEFERRED 2026-08-14, two reasons recorded honestly: (1) the approved verbatim wording is NOT in the repo - state.md says it was s… |
| M27 | District-type checkboxes dead while the overlay is off | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). Fix is intent, not plumbing: touching the distric… |
| M28 | Friction batch 2a-2j from the author's production pass | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). 2a lib/registry/links.ts: Google universal link (… |
| M29 | Welcome mission text and the license wording | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. 1a: mission text replaced verbatim (six sentences), zip entry and one-tap e… |
| M30 | Kelly-standard candidate cards on the ballot | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. components/ballot/candidate-card.tsx renders every candidate as a card; dat… |
| M32 | Newbury select-board fact and explainer | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. coverage-notice.tsx renders the fact line + all Selectboard members (genera… |
| M33 | Save my picks - device-local ballot marking | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. lib/ballot/picks.ts (single key, no network - pinned by tests/ballot-picks.… |
| M35 | Meetings surfaces - past variant + add-to-calendar + county p… | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. 6a: past-meeting variant in meeting-popup.tsx (VENUE_MAP rung dropped when… |
| M46 | Rockaway mayor wore Tucson's language - cross-jurisdiction gu… | Done | 2026-08-14 (third 08-14 session). Audit found the mayor blurb was the ONLY contamination. GATE PASSED: walk0814c-07866-mayor-GATE… |
| M47 | Every district layer defaults ON - Kearsarge renders at 03255… | Done | 2026-08-14 (third 08-14 session). Rejected alternative recorded in lib/state/defaults.ts: the one-type-per-tier legibility defaul… |
| M48 | Officials group in three tiers everywhere - Local / State / F… | Done | 2026-08-14 (third 08-14 session). The who-governs card and the officials door both render the three headers; the door gained the… |
| M49 | The ballot becomes a call to action (item 4) | Done | 2026-08-14 (third 08-14 session). lib/calendar/event-links.ts pure + tested (all-day and timed shapes); meetings and ballot dates… |
| M52 | Overlays stop pushing history - the phone modal killer (the w… | Done | 2026-08-14 (third 08-14 session). Found by the walk clicking instead of believing green. Branch claude/tester-feedback-0814; test… |
| M53 | Arizona bled into New Hampshire through the ask box (item 1,… | Done | 2026-08-14 (the tester's mobile pass). tests/jurisdiction-content.test.ts +3 tests; regression proven by reintroducing the string… |
| M54 | The ballot was unreachable on a phone (item 2) | Done | 2026-08-14 (the tester's mobile pass). Verified in-browser at 390x844: bubble tappable at y=12, entry at y=180 pinned while the b… |
| M55 | Fixed controls sat over readable content at phone width (item… | Done | 2026-08-14 (the tester's mobile pass). Re-measured in-browser: sidebar-toggle clear, maplibregl-ctrl-top-right clear, legend clea… |
| M57 | The sidebar counters stated numbers their own doors contradic… | Done | 2026-08-15. Measured on production at all four zips before fixing (85701 officials 6 vs 24, bodies 13 vs 60; 07866 officials 6 vs… |
| M58 | Concluded meetings rendered nowhere - the Concluded chip was… | Done | 2026-08-15. Per-adapter denominators recorded in docs/source-ladder.md: 6 of 9 adapters already served history; apptegy did not (… |
| M60 | Mojibake in every candidate blurb attribution (item 3) | Done | 2026-08-15. Repaired at the data, never at the render: 158 sequences in the cards file, 34 regenerated out of docs/photo-report.m… |
| M61 | Party missing on who-governs rows (item 4) | Done | 2026-08-15. All three governors now carry a party from the election authority's own certified filing, cited per row: Hobbs Democr… |
| M86 | The division battlecard denied its own officeholders — a clas… | Done | 2026-08-15 (the truth session, branch claude/truth-session-0815). DIAGNOSED BEFORE FIXING, and the diagnosis narrows the author's… |
| P11 | Reaction outcome honesty - success earned by the 204 | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. lib/reactions/client.ts returns COUNTED/NOT_COU… |
| R01 | CLAUDE.md clobbering guard | Done | It will recur. The Drive mirror is a hedge, not a fix. If CLAUDE.md is ever tiny, restore it - never reconstruct from memory. \|\|… |
| R12 | Deploy pipeline pinned - netlify.toml and the unlisted posture | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. netlify.toml written (corepack enable && corepack pnpm run build; NODE_VERSIO… |
| R34 | Local development can no longer write to the production datab… | Done | 2026-08-17 (g7) THE BRACES SHIPPED AND ARE PROVED; THE BELT SHIPPED IN ITS STRONGEST AVAILABLE FORM; ONE HALF IS THE AUTHOR'S HAN… |
| R47 | NAMED REGRESSION: zooming out to z7 at 85701 wipes every pin | Done | FOUND 2026-08-18 (g13) by pnpm walk:all, which is exactly what that suite exists for - the check carries g3 as its shipping sessi… |
| R51 | Netlify stopped building on push: g15 merged to main and no d… | Done | 2026-08-18 (g15, branch claude/g15-audit-and-final-queue-0818). FOUND AT HANDOFF, and the diagnosis is NOT the one it first looke… |
| V02 | Use Locunity for a week | Done | 2026-08-17 CLOSED BY THE AUTHOR, disposition verbatim: "Already used, no issues. Close" (g7). |
| X04 | Two standing rules adopted into CLAUDE.md (item 7) | Done | 2026-08-14 (third 08-14 session). tests/org-characterization.test.ts. The rules are law regardless of guard reach. Branch claude/… |
| X08 | The transparency mandate and the fourteen-rung ladder become… | Done | 2026-08-16 (h item 0), branch claude/h-03255-depth-0816. FIRST ACTION of the session, before any retrieval, because this session'… |
| F01 | The author's 2026-08-18 testing pass: 40-odd findings across… | In progress | OPENED 2026-08-18 (g16, branch claude/g16-deploy-leaks-queue-0818). NOT BUILT THIS SESSION AND THAT IS THE DISPOSITION, not a sho… |
| D68 | A data-fetch script overwrote verified data with less of it,… | Open | Opened 2026-08-18 (g19 item 4). MITIGATED, NOT CLOSED. Three things landed with it: the resolver's merge is now non-destructive b… |
| D01 | Legistar adapter | Done | 2026-08-13 DONE VIA D12 AND THE COMPOSITE: real municipal agendas replaced the mock as the app active source. This row scoped the… |
| D10 | Persistence design for meetings | Done | Blocks D01 for scheduled ingestion. Does NOT block the demo - the Legistar spike can fetch live with an in-memory cache and no da… |
| D11 | Legistar live spike for demo jurisdictions | Done | Pick the cities to match the buyer call list. Someone typing their own city and seeing their real council agenda is the demo. 202… |
| D12 | Legistar Web API adapter | Done | Documented OData v3 API at webapi.legistar.com/v1/{client}/events, docs at webapi.legistar.com/Home/Examples. GET returns only it… |
| D27 | Morris County (IQM2) and Merrimack County (Revize) adapters | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. iqm2: built on Citizens/Calendar.aspx?From=&To= (server-rendered with future… |
| D59 | One person, one photo - photos key to the PERSON (item 6b) | Done | Done 2026-08-15. Audit first (scripts/photo-person-audit.mts, 813 photo rows, 795 distinct people): Hobbs was one of NINE, not on… |
| HUNT01 | The 03255 depth sweep across the full body universe | Not started | 2026-08-16 (h item 2), branch claude/h-03255-depth-0816. DEFERRED WHOLE, NOTHING HALF-BUILT. 2 subjects were touched (Kearsarge m… |
| M02 | Zip to district disambiguation | Done | Zip is orientation only, never district truth. 2026-08-11: M03 makes the problem visible - turn on Show districts and a zip strad… |
| M06 | Agenda hyperlink on every upcoming item | Done | Agenda link renders on every item that has one. Evidence: components/map/meeting-panel.tsx. 2026-08-12 REOPENED: the links did no… |
| M141 | The meetings panel renders empty until the mouse moves - a pa… | Done | 2026-08-17 (g6 item 3, branch claude/g6-consolidation-0817-b): CLOSED on measurement, with the mechanism named from the code rath… |
| M142 | A carried meeting row never inherits the snapshot's freshness | Done | 2026-08-17 (hotfix-0817, branch claude/h2-carry-forward-truth-0817). test 751 of 751 pass (13 new this session: 10 in tests/snaps… |
| M17 | Resolve the place/cousub duplicate at build time with FUNCSTA… | Done | 2026-08-12, branch claude/coverage-language-and-registry-dedupe. DONE: test (79 pass), lint, build all green. THE BRIEF WAS WRONG… |
| P02 | Ballot mapping | In progress | \|\| 2026-08-19 (g20 item 2c). BUILT, on D05 which shipped in the same commit. lib/candidates/issues.ts is the curated issue vocabu… |
| P03 | Reaction capture | In progress | 2026-08-15 THE SENSOR IS LIVE FOR FEDERAL VOTES (branch claude/reactions-and-plain-language-0815). Do you like this vote? Yes/No/… |
| A10 | The everyday-topics map - the pothole standard | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. Grid FINAL after in-browser verification: 9 top… |
| D30 | Search logging and the transparency page - shipped together | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. tests/search-log.test.ts pins the coupling structurally (log module present -… |
| HUNT02 | Body enumeration per unit - the missing second layer of the w… | Not started | 2026-08-16 (h item 1, found by building the denominator). THE FINDING, which is the reason this row exists: the 2022 Census of Go… |
| HUNT04 | The 03255 candidate sweep - 47 candidacies to the Kelly stand… | Not started | 2026-08-16 (h item 3). DEFERRED WHOLE. THE DENOMINATOR IS ALREADY FROZEN and that is the half that exists: the 2026 New Hampshire… |
| M22 | Responsive - the demo is opened on a phone | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. Gate met: all four zips screenshotted at 390x844 (screenshots/phone-{85701,85… |
| R23 | Turbopack: 'Dynamic filesystem access causes tracing of the w… | Done | CLOSED 2026-08-17 (g8), branch claude/g8-deploy-and-g7-queue-0817; test/lint/build all pass. THE WARNING WAS THE MECHANISM BEHIND… |
| R44 | Carry-forward clipped a failed source's archive to a window t… | Done | 2026-08-18 (g13, branch claude/g13-final-rows-0818). test and build pass; tsc --noEmit clean. DIAGNOSED BEFORE FIXING, and the M5… |
| T05 | Abuse policy live | Open | 2026-08-15 MINIMAL WIRING with the reaction surface: the reaction endpoint respects the abuse policy rate intent (serialized limi… |
| T09 | Refusal-log scrub before store | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. tests/ask-box.test.ts: fixture questions contai… |
| A11 | Tie-or-zero refuses - the PHA never answers for potholes (ite… | Done | 2026-08-14 (third 08-14 session). The fixture test walks EVERY topic route at 85723 and asserts no step names a body outside the… |
| D58 | Non-contribution receipts were rendering as contributions - F… | Done | Done 2026-08-15. Both hops now keep only contribution lines - 11* (individuals, party committees, other political committees, the… |
| D61 | The funding-reactions ripcord flips LIVE, and the funding que… | Done | 2026-08-15 (the truth session, branch claude/truth-session-0815). THE RULING, RECORDED VERBATIM in lib/ripcords.ts and docs/ripco… |
| M140 | The active-state model, built as specified - and the mask sto… | Done | 2026-08-16 (g5), branch claude/active-state-model-0816. DIAGNOSED BY MEASUREMENT, NOT BY READING: at the zoom a reader lands on f… |
| M15 | Division and body registry, generated from division type | Done | 2026-08-12. pnpm registry:build reads the committed boundary files and writes lib/registry/registry.json - 940 divisions, 297 bod… |
| T08 | Launch gate: hardening before the password comes down | Done | Opened 2026-08-15 with the reaction surface going live under the demo-grade-collection / launch-grade-schema split (state.md). Th… |
| M16 | Coverage language on screen for bodies with no source | Done | Phase 4.6.6. 2026-08-12, branch main. DONE: test (78 pass, 10 new in tests/coverage.test.ts), lint, build all green. lib/registry… |
| R43 | The intake tripwire's scheduled purge is refused by the write… | Done | 2026-08-18 (g13, branch claude/g13-final-rows-0818). test and build pass; tsc --noEmit clean. DIAGNOSIS from the failing run's ow… |
| M21 | Link ladder and body coverage audit | Done | 2026-08-12, branch claude/link-ladder-and-coverage-audit. DONE: test (147 pass, 15 new in tests/link-ladder.test.ts), lint, tsc a… |
| PB14 | RULING 7's equal-depth gate withholds most contests, and it b… | Done | 2026-08-20 (Prompt C item 2) CLOSED BY RULING 18. The author ruled: the gate is re-aimed at HUNT COMPLETION rather than field pre… |
| D73 | LIVE DATA LOSS: both sold stores stopped recording for 4h18m,… | Done | 2026-08-20 (Prompt C). FIXED UNDER THE BRIEF'S LIVE-DATA-LOSS EXCEPTION and named here rather than absorbed. WHAT WAS APPLIED, in… |

## Ripcords — 9

Source: `lib/ripcords.ts`, the state of record. State below is the **committed**
position; each flag can be flipped without a deploy via its environment variable
(`pulled` / `live`). Pull procedures: `docs/ripcords.md`.

**`ripcord.fecContributorDisplay`** — **live** · env `WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY` · rows D23, D34

- Open question: Does 52 U.S.C. § 30111(a)(4) (the commercial-use restriction on FEC contributor information) permit reader-facing display of itemized contributions in this product?
- Closer: Counsel (the B05 hire) — nobody else may close it (D23)

**`ripcord.fundingReactionsInAggregates`** — **live** · env `WTP_RIPCORD_FUNDING_REACTIONS_IN_AGGREGATES` · rows D23, D34, D61

- Open question: RULED by the author 2026-08-15: what is licensed is reader-attention signal — anonymous reactions — and never FEC-derived data; a buyer receives opinions about displays, not contributor records. The separate § 30111(a)(4) question over the underlying contributor DATA is untouched by this ruling and still governs ripcord.fecContributorDisplay (D23).
- Closer: Author-ruled 2026-08-15; counsel review welcome (the B05 hire) and may re-pull it

**`ripcord.rateLimits`** — **live** · env `WTP_RIPCORD_RATE_LIMITS` · rows T08

- Open question: Operational, not legal: are the thresholds and the origin check calibrated so no legitimate reader is ever refused? (The author's standard: the fastest human thumb never hits a limit; a script hits one in its first second.)
- Closer: The author — this is a product-safety tuning question, not a counsel question

**`ripcord.askClassifier`** — **live** · env `WTP_RIPCORD_ASK_CLASSIFIER` · rows A09, A12

- Open question: Product, not legal: is a model choosing WHICH curated topic a question belongs to compatible with the no-generation rule, given that it writes none of the answer and its whole output is one identifier from a closed list?
- Closer: The author — RULED 2026-08-15: acceptable as built, stays live. Retained as a one-flip pull if the doctrine ever moves.

**`ripcord.askGrounded`** — **live** · env `WTP_RIPCORD_ASK_GROUNDED` · rows ASK01, ASK02

- Open question: Doctrine: may a model write the reader-facing sentence at all, given that it is shown only records the app retrieved, is given no corpus, tools or network, and has every source URL in its answer checked against the evidence pack it was handed?
- Closer: The author — the directive of 2026-08-27 asked for grounded synthesis by name. Retained as a one-flip pull: pulled, Ask degrades to the structured sourced answer it already produced.

**`ripcord.askSignalCapture`** — **PULLED** · env `WTP_RIPCORD_ASK_SIGNAL_CAPTURE` · rows ASK03, NH246

- Open question: Consent, not product: may the scrubbed question and the answer a reader received be kept as sellable civic-interest signal, and what exact line must a reader see before they type for that to be honest?
- Closer: The author — UNANSWERED as of 2026-08-28. An OPERATOR DECISION pending privacy approval, not a clause of current law: no current rule names Ask specifically, and RULING 141 governs Speak Your Mind. Draft copy is on NH246. Activation is the copy, this flag AND minting the continuity key.

**`ripcord.reactionFreeText`** — **live** · env `WTP_RIPCORD_REACTION_FREE_TEXT` · rows P03, T05

- Open question: Operational and policy, not legal: can the moderation path in docs/abuse-policy.md absorb the verbatims this collects, and is the threat-notice posture holding? Open for the testing window the author declared 2026-08-18.
- Closer: The author — pulled when moderation cannot keep up, restored when it can

**`ripcord.reactionIntake`** — **live** · env `WTP_RIPCORD_REACTION_INTAKE` · rows T08

- Open question: Operational, not legal: held open for live-attack response — is the store currently under an attack that per-device limits cannot absorb?
- Closer: The author — pulled during an attack, restored when the attack ends

**`ripcord.unsourcedFallback`** — **live** · env `WTP_RIPCORD_UNSOURCED_FALLBACK` · rows ASK-12

- Open question: Product, not legal: does an unsourced general answer stay unmistakable from a sourced civic one in front of a real reader? The whole trust posture of this product is that it does not answer what it cannot source, and an answer a reader mistakes for sourced spends that.
- Closer: The author — he is the one who looks at it; pulled the moment the separation reads as thin

## Last 0 tracker status change(s), most recent first

Source: git history of `docs/tracker.csv` (first-parent), 1 commit(s) walked of 1 available. 0 row(s) first appeared in those commits and are not listed — a new row has no status to have changed. 1 commit(s) could not be compared because this checkout is SHALLOW and does not carry their parent — that is a fact about the clone, not about the tracker.

_No status change recovered in the commits walked._

## Git

Source: the same facts `git-state.txt` carries, generated in the same run.

```
generated: 2026-09-04 10:16:34 EDT
branch: codex/reader-last-mile
head sha: 74f748cff379df2181785ad4e5f487d3dccac7c9
head subject: Record complete reader delivery proof and permanent closure controls
origin/main sha: bee7dabcd60cad8be0b4cbd28b03ff47d562bb30
origin/main subject: Post-deploy integrity reading: 2026-09-04T13:48Z
local main sha: a6f7fd4da9dc692c5d7bcdb0153a0d58f4865ab7
local main matches origin/main: no — 7 commit(s) behind
working tree: clean
open prs: none
last recorded tests: 094 (pass)
last recorded lint: pass
last recorded build: pass
last recorded status from: docs/state.md:23452
```
