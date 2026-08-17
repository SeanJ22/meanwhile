# The 03255 depth scorecard — h

Written 2026-08-16, rendered from the committed evidence ledger at
`docs/evidence/h-03255.jsonl` (34 rows). Nothing here is reconstructed from
memory; where a number was not instrumented, this file says `unmeasured` and
names the reason.

---

## The headline, and the honest shape of it

**This session did not complete the sweep it was briefed to run, and the
three cost views the brief asks for cannot be computed from what it did.**
That statement comes first because it is the finding that matters most: a
scorecard that reported three confident views off six percent of the universe
would be the exact failure the experiment was designed to detect.

What the session establishes is narrower and real:

- **The denominator now exists, from outside our own records, and it did not
  before.** 166 units enumerated across three counties from the 2022 Census of
  Governments, mapped unit-by-unit to two scope flags with the method recorded
  per row.
- **The universe/schema acquisition line of C11 has a measured first-build
  cost and a near-zero marginal cost**, which is the single most transferable
  number here.
- **One required field was hunted to a HIT, and one plausible false answer was
  rejected on the way** — which is the more useful result of the two.

Everything else is a tracker row carrying its whole spec. They are named in
§8 and in `docs/tracker.csv`, not softened here.

### What the three views would need, and why they are `unmeasured`

| View | What it asks | Status |
|---|---|---|
| 1 — incremental session acquisition | what remained to complete this universe from the frozen h-start state | **unmeasured**: the sweep covered 2 of ~60 in-scope bodies. A per-field cost from that sample would be a sample of the easiest bodies, and the easiest bodies are the ones already wired. |
| 2 — same-universe steady-state refresh | what this universe costs started fresh tomorrow | **unmeasured**: requires a completed universe to refresh. |
| 3 — observed transfer cost | what the next previously-unseen instance costs | **partially measurable, and reported below for ONE line only** — universe/schema acquisition, where n is genuinely 3 counties. |

**View 1 → View 2 is the learning investment; View 1 → View 3 is the expansion
signal.** Neither delta is computable. Reporting view 3's one measurable line
as though it were the whole view would be presenting a maintenance number as
an expansion number, which the brief names as the specific error to avoid.

---

## 1 — Universe integrity

Frozen 2026-08-16 before any hunting. Full record in `docs/universe-03255.md`,
machine-readable in `data/audit/universe-03255.json`.

### Step A — the authoritative universe

2022 Census of Governments, Government Units Listing, fetched 2026-08-16
(HTTP 200, 11,459,763 bytes). **166 units** across Merrimack (63), Sullivan
(40) and Hillsborough (63).

**Merrimack replicates the previously committed hand extract exactly — 63
against 63, zero diff by `censusId` in either direction.** That is a
verification rather than an agreement.

### Step B — the two ratios, never blended

| Universe | Rendered N | Authoritative M | Note |
|---|---|---|---|
| who-governs (units) | 3 | **3 resolved + 40 UNRESOLVED** | the three that govern are all rendered; the 40 are special districts with no Census boundary at any vintage |
| who-governs (bodies) | 6 | **UNENUMERABLE at freeze** | see below — this is the finding, not a number |
| meetings-near (units) | — | **47 by venue proxy / 29 by territory bound / 1 UNRESOLVED** | the product renders bodies, not units; the two are not comparable without the body layer |
| candidates | 0 hunted | **47** across 12 contests | item 3 not started; row **H04** |
| officials | 9 named (KRSD board) | 9 seats | the one body whose roster was hunted this session |

**The who-governs body ratio is `UNENUMERABLE`, and that is the honest answer
rather than a missing one.** The Census counts *units* — one row for the Town
of Newbury. The product's denominator is *bodies*: Newbury's Selectboard,
Planning Board, Zoning Board of Adjustment, Conservation Commission and
whatever else the town's own board list holds. **No external enumeration of
bodies exists.** So the body universe is a two-layer denominator and the
second layer is itself a hunt. Newbury is `BODIES_UNENUMERATED`: we hold four
of its boards because earlier sessions wired them, and "four" is what we hold,
not what the town has.

Stating `6 of 6` for 03255 — which `pnpm census:zip 03255` does today — is
true against the registry and says nothing about the town.

### Denominator corrections, with audit trail

| Correction | Evidence |
|---|---|
| The official denominator held **Merrimack County only**; 03255's 25 km circle crosses into Sullivan and Hillsborough. 103 further units enumerated. | `pnpm zip:universe 03255` |
| `states/nh/NOTES.md` said no village district reaches Newbury (nearest Lake Todd). True of Merrimack alone. **Highland Haven Special District** and **Ashuelot Pond Dam Precinct** (Washington, Sullivan County, 14.89 km by venue proxy) sit inside the circle, never assessed. | `data/audit/universe-03255.json` |

### Field-matrix corrections

`vH-1` frozen 2026-08-16, zero corrections. Candidates for `vH-2` are named in
§1b — they were acquired, not yet promoted.

---

## 1b — Beyond-matrix acquisition

The matrix is a floor. What one page volunteered beyond it, at no additional
retrieval cost:

| Subject | Beyond-matrix fields | Cost |
|---|---|---|
| Kearsarge Regional School District board | year first elected, term expiry year, committee assignments per member, SAU number, SAU office address, phone, fax | **zero marginal** — all on the page already fetched for `roster` |

**The rule earning its keep:** the expensive part of a hunt is reaching the
source. A second visit for these seven fields would have paid the entire
discovery cost again. They are candidates for a `vH-2` schema correction and
are recorded as acquired rather than required.

---

## 2 — Baseline maturity

| | Count |
|---|---|
| Required fields solved by **A1** (session-start recipe reproduces them) | **unmeasured** — see below |
| **A0** inherited-snapshot-only fields | **unmeasured** |
| Bodies wholly baseline-refreshable | **unmeasured** |
| Median baseline rungs and active time per field | **unmeasured** |

**Why this whole section is unmeasured, stated rather than estimated.**
Separating A1 from A0 requires running the session-start recipe against each
already-populated field and watching whether it reproduces the value
independently. That is a per-field replay across roughly sixty bodies, and it
was not run. Guessing the split would inflate exactly the number the brief
warns about — baseline maturity flattered by work humans did months ago.

One A0 datum is established, because the hunt tripped over it:
**`school_body.member_towns` was neither A1 nor A0 at h-start — the repository
held no value for it at all.** `states/nh/NOTES.md` named the district without
ever naming its members.

---

## 3 — Learning investment (bucket B)

Code and procedure counted together, because a rule that makes the next town
cheap is worth as much as a parser that does.

| Capability | Kind | First subject that required it | First-build | Reuse proven in-sweep | Class |
|---|---|---|---|---|---|
| `pnpm gus:extract` — Census of Governments per county | code | Sullivan + Hillsborough, absent from the repo | measured coarsely, see below | **yes — 3 counties in one run** | **B1** |
| `pnpm zip:universe` — two-universe mapper with per-row method | code | 03255 | coarse | no — one zip | **B0** |
| `lib/evidence/emit.ts` — the C8 ledger | code | the experiment itself | coarse | yes — every hunt writes it | **B1** |
| `lib/evidence/field-matrix.ts` — frozen `vH-1` | config | 03255 | coarse | no | **B0** |
| **Strip the shared navigation before harvesting a CMS page** | procedure | Kearsarge member towns | ~0 | not yet | **B0** |
| **Read the vendor off the page footer rather than guessing** | procedure | kearsarge.org | ~0 | not yet | **B0** |
| **Read `robots.txt` for the crawl delay before calling a 403 a fingerprint** | procedure | kearsarge.org | ~0 | not yet | **B0** |
| **Branch on the xlsx self-closing slash; print rows-read and rows-matched** | procedure | the GUS workbook | ~0 | not yet | **B0** |

**Same-subject replay (C7's requirement for every B0)** is `unmeasured`. It
was not run, and the reason is honest rather than principled: the session ran
out of room before the replay pass. Without it the B0 rows carry a build cost
and no steady-state figure, which is precisely the "unknown marginal cost"
the control exists to prevent. Recorded as a hole.

**C2b backfill** — replaying a new capability against earlier A0/C/D fields in
the same family — was **not run**. Zero fields were reclassified. Discovery
order therefore still determines this table's class mix, which is the failure
mode C2b names.

---

## 4 — Bespoke burden (bucket C)

| | Count |
|---|---|
| C-STRUCT (structurally bespoke) | 0 identified |
| C-AUTO (automation candidate, named not built) | 2 |

C-AUTO, both found by this session and neither built:

1. **Special-district territory resolution.** Forty units at 03255 are
   `UNRESOLVED` for `governsZip` because the Census publishes no boundary for
   them. A reusable path plausibly exists — NH RSA 52 districts file their
   territory with the town or the state — and it was not built.
2. **Body enumeration per unit from the unit's own board list.** Newbury's
   site reveals its board list on hover. Turning a town's board list into a
   body enumeration is the missing second layer of the who-governs
   denominator, and it generalizes to every municipality in the country.

**Bucket C is CURRENTLY BESPOKE, never "permanently manual."** One session can
prove the baseline did not automate something and that this session chose not
to. It cannot prove nothing ever will.

---

## 5 — Exhaustion burden (bucket D)

**Zero fields are legitimately in bucket D, and that is a statement about this
session rather than about New Hampshire.** D requires an EXHAUSTED ladder —
all fourteen rungs walked and recorded. No field reached rung 11.

One field is worth naming for what it is *not*:

| Field | Rungs walked | State |
|---|---|---|
| KRSD `member_towns` | 1, 2, 9, 10 — HIT at rung 9 | solved |

**No publication-obligation finding is claimed.** The mandate's evidence
standard for one — the specific obligation, its authoritative source, why it
applies to this body and this document type, its effective date, the date
checked, the complete retrieval history, the final failed state — is met by
nothing in this session, and reaching for the finding before the ladder is
exhausted is the incomplete hunt the mandate forbids wearing a respectable
face.

**What rung 14 leaves for the author's browser: nothing yet.** No hunt got far
enough down the ladder to owe him one.

### Walls observed, by class

| Wall | Host | Class | Answer |
|---|---|---|---|
| HTTP 403 on a burst, 200 when paced | `kearsarge.org` | **RATE** (`robots.txt` `Crawl-delay: 10`, enforced) | patience — a different client is the wrong diagnosis |
| HTTP 403 to Node with full browser headers, 200 to `curl` | `kearsarge.org` | TLS/HTTP2 **FINGERPRINT** (recorded 2026-08-15) | a different client |
| HTTP 302 on 6 of 16 sitemap URLs | `kearsarge.org` | redirect not followed by the hunt script | trivial; the script did not pass `-L` |

Two different walls on one host. The wrong diagnosis sends the next session
hunting clients when the answer is to slow down.

---

## 6 — Recovery cohort (C6)

**Not run — 0 of an unknown M.** The brief's re-walk debt (existing "not
published", "not machine-readable" and "could not reach" records re-walked
against the full fourteen-rung ladder) was not attempted. Row **H03**.

One re-walk target is named because the session tripped over it:
`states/nh/NOTES.md` still records Newbury's Zoning Board of Adjustment as
`KNOWN_UNCOVERED` with its venue unpublished, and **M89 found that venue in
the department page's contact markup** on 2026-08-15. The file is stale on its
own record. Appended rather than edited, per the append-only rule.

---

## 7 — Cost decomposition (C11's eight lines)

Instrumented durations exist for 15 of 34 ledger rows — the network fetches,
which the hunt scripts timed with a monotonic clock. **Everything else is
`unmeasured` and the reason is C0: acquisition outranks measurement, and no
rung was traded for a stopwatch.**

| Line | Measured | Note |
|---|---|---|
| Universe / schema acquisition | **partially** | see below — the one line with a real number |
| Baseline operation / retrieval | unmeasured | |
| Reusable first-build engineering | unmeasured | wall-clock exists in git; git is an audit receipt, not a stopwatch |
| Reusable marginal reuse | **near-zero, measured** | `gus:extract` ran three counties in one pass: 92,150 rows read, ~1 minute total. The marginal county is a command-line argument. |
| Bespoke acquisition | unmeasured | |
| Exhausted / unresolved acquisition | unmeasured — and zero fields reached exhaustion | |
| Verification and regression overhead | unmeasured | |
| Documentation and playbook overhead | unmeasured | |

**Total instrumented network time across the whole session: 12.1 seconds
across 15 timed fetches.** That number is real and it is also nearly useless
on its own, which is the point of stating it: retrieval is not where the cost
of this work lives. The cost lives in deciding what to fetch, reading what
came back, and refusing the plausible wrong answer — none of which a fetch
timer can see.

### The one line with a transferable number

**Universe/schema acquisition, per county:** one 11 MB download shared across
all counties nationally, then a single pass over 92,150 rows yielding three
counties at once. **The marginal cost of the next county is one command-line
argument.** Step B — jurisdiction mapping — is per zip, not per county, and
runs offline against committed geometry in seconds.

This is the C11 line the brief calls out as one national expansion must pay
per geography and must never treat as free. **The measurement says it is very
nearly free, once built** — for counties inside states whose TIGER layers are
already committed. That last clause is load-bearing: three states have those
layers and forty-seven do not.

---

## 8 — Source families (C12)

**This is a depth benchmark from one zip in one state. It is not a 50-state
sample and nothing here forecasts states 4–50.** One zip in New Hampshire
cannot establish that its mix of municipal sites, vendors, special districts
and PDF practices represents anywhere else. AZ and NJ are the replications
that would turn this into a forecast, and they have not been run.

| Family | n | Observed | Validated where |
|---|---|---|---|
| `census-gus-xlsx` | **1** source, 3 counties | one national workbook, per-county filter; the parse trap in §5 of the playbook | NH only — but the workbook is national, so this is the family most likely to transfer intact |
| `civicplus-nh/kearsarge.org` | **1** | sitemap at `/sitemap.xml` (496 URLs); `robots.txt` crawl delay honoured; board members page seats members BY TOWN; footer names the vendor | NH only |

**Two families, n = 1 each.** With n that small no median is reportable and
none is reported — the raw values are above. The brief's own instruction
applies: distinguish "reusable as observed here" from "validated across
materially different state environments," and nothing here is the latter.

---

## What this session did not do, in its own words

Named rather than smoothed, each carrying a tracker row with its whole spec:

- **H01** — the depth sweep across the full body universe (item 2). 2 bodies
  touched of ~60 in scope.
- **H02** — the body-enumeration layer: turning each unit's own board list
  into a body count, without which the who-governs ratio has no denominator.
- **H03** — the re-walk cohort (item 2's inherited debt), 0 walked.
- **H04** — the candidate sweep across the frozen 47-candidacy ballot universe
  (item 3), 0 hunted.
- **H05** — the special-district territory resolution for 40 `UNRESOLVED`
  units.
- **H06** — the C7 same-subject replays and the C2b backfill pass, without
  which every B0 carries a build cost and no steady-state figure.

**The measurement thinned before the hunting did, which is the order the brief
sets — but the hunting also stopped well short.** Saying so plainly is the
only version of this document worth committing.
