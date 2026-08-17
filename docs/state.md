# Project state

Written for someone opening this repository with no prior context. It describes
what is real, what is scaffolding, why things are the way they are, and what is
still unresolved.

Last updated: 2026-08-16, sixth session of the day — **the active-state
model**: the mask stopped muting the state the reader is standing in, and
the meetings panel stopped needing a mouse to paint. Both were the same
defect — a clip path 16,800 x 20,000 px that Chromium DROPS rather than
applies, leaving a backdrop-filter scrim over the whole map — and both are
now measured by checks that assert WHAT is covered rather than how smoothly
(pnpm measure:focus, pnpm measure:panels, pnpm measure:fly). Zip shading is
removed from the product by the author's ruling. See §36.

Before that: 2026-08-15, second session of the day — **the design
pass**: flagships look like flagships. The author's bar, verbatim:
"Clean. Like Apple level clean." The system is COMMITTED, not sprinkled —
`docs/DESIGN.md` plus tokens in `app/globals.css`: a type scale whose
structural labels finally organize instead of whisper (LOCAL / STATE /
FEDERAL as confident shelves — M64), the three registers replacing three
grays (voice / link / data — M67), and a funding pill palette that never
touches the party colors (guard-tested — M66). The ask box and the ballot
got the flagship treatment (M65, M66) — the beat kept its exact words and
timing; repeated contest provenance collapsed to footnotes, cited once at
the page foot (M68); the narrowing modal that free panning re-triggered
on every ZCTA crossing became a passive chip that never interrupts (M69);
a typed street now visibly answers — containing districts shade, the
overlay turns on, counters refresh (M70, with the geocode-to-a-point
remainder recorded as D53, blocked on author approval of an external
geocoder); clearing picks earns a real dialog (M71); and the one-line law
entered CLAUDE.md (X05). The key-votes tracker — the tester's ask — is
RECORDED whole as B15, not built. NOTHING behavioral changed except where
the brief said so; all data rules stand. Walk: seven checks green at
desktop and 390×844, before/after pairs in `screenshots/`; the walk's own
production log rows are named in `docs/tester-pass.md` (six
QUESTION_ASKED events and the page-load search rows, ≈09:55–10:38 local).
See §25.

Before that: 2026-08-15, first session of the day (§24) — the counters
stopped lying (M57), the past came back to the Concluded filter (M58),
the mojibake was repaired at the data (M60), party joined who-governs
from election authorities' own filings (M61), and single-candidate
contests gained "Someone else" (M63). Before that, 2026-08-14's seventh
session (§23): the documents stopped making up dates. Before that:
2026-08-14, sixth session of the day. That session
executed the outside tester's **mobile** pass. Arizona was bleeding into
New Hampshire through the ask box's topic templates and is fenced —
shared explainer copy is jurisdiction-neutral by rule, place-specific
truth reaches only its own place, and the guard now audits templates AND
link targets (M53). The ballot was unreachable on a phone and the fixed
controls sat over card text: **one root cause**, an unbounded overlay in
a bounded viewport, measured before it was touched (M54, M55). Her
four-of-six district types turned out to be **neither stale prefs nor a
regression** — she was reading a deploy four hours older than the fix,
and the migration the brief proposed would have migrated nothing (M56).
Her biggest finding became a non-negotiable: the app can say nothing
about anyone and still tilt a race, so **equal effort per candidate**
enters CLAUDE.md and every silent card now names its absence (B13, with
B14 and V08 recorded). The funding section says what KIND of money it is
(D48). And the photo rule gained its second door — official
government-published portraits — which unblocked the state-legislator
tier whole: **476 of 750 → 535 of 750**, three governors' wrong faces
replaced, 278 chamber portraits shipped (D50, In progress). Walk: 72
checks green across four zips. See §22. Before that, the fifth session
of 2026-08-14 (§21): the faces came back, 16 of 747 → 476 of 750 (D20).
Before that, the third session of 2026-08-14 (§19): the Rockaway mayor
stopped wearing Tucson's charter copy (M46, gated, the
cross-jurisdiction guard); every district layer defaults on and
Kearsarge renders at 03255 (M47); the governor joined who-governs as a
first-class statewide attachment, browser-verified against all three
states' own sites (B11); officials group Local → State → Federal
everywhere (M48); the ask box refuses instead of naming the PHA for
potholes (A11); party breakdowns on every roll call, sum-gated to the
chamber's tally (B12); the ballot became a call to action with ONE
add-to-calendar control (M49); the picks card (M50); the copy/truth
batch including the wall-clock dates sweep and the first-run tutorial
(M51); two standing rules into CLAUDE.md (X04); and THE WALK'S OWN
CATCH — overlays pushed history state and Next remounted them, so no
official's full card could open at any phone width; the pattern is
removed (M52, the prior session's "click dead" mystery solved). See
§19. Before that, the second session of 2026-08-14 (§18): the pipeline
proof, reaction honesty (P11), the FEC thin-guard (D44), the
everyday-topics map (A10), the refusal-log scrub (T09), and the photo
census (D45). Before that, the 2026-08-19-labeled session (§17), and the
2026-08-18-labeled FEC-and-final-prep session — the FEC funding surfaces
built FIRST AND WHOLE per the author's order (D34 Done; both ripcords
live in code, counsel holds the flags); Sunnyside and Amphitheater wired
live with the honest record of the prior overclaim (D39); NH legislator
contacts closed the long way (the General Court's own member directory,
read through the Archive); the four-zip phone-width walk at 89 checks
green. See §16. Before that, 2026-08-17: the author's-words-and-depth session —
mission text verbatim on the welcome overlay and "sell" retired for
"licensed"; NH/NJ depth (Kelly-standard candidate cards, the name-case
pass, Newbury's Select Board named and peopled, the earned NH
no-measure absence); the completeness audit against the Census of
Governments official universe with ten special districts curated in and
five new rosters (Kearsarge's wall came down); save-my-picks
(device-local, schema-enforced); office explainers for every ballot
office; the votes polish; past-meeting cards and add-to-calendar; the
mover's "about this area" page; the sidebar numbers as doors; and the
four-zip phone-width tester pass at 74 checks green. FEC (D34) deferred
whole again under stated duress. See §15. Before that, 2026-08-16: the
correctness session (§14).

---

## 1. What this is

**We the People** is a civic app. Today it contains exactly one screen: the map
you land on.

A reader enters a five-digit zip code. The map flies there and renders upcoming
local government meetings — city council, county boards, school districts — as
pins. Clicking a pin shows who is meeting, when, where, and links the agenda.

Around that sits a sidebar shell: a Local / State / National tier toggle,
cascading jurisdiction and body selectors, stats, search with autocomplete,
radius and location controls, filters, a legend, and a list view. District
boundaries can be overlaid, and **clicking the map selects a district** — which
is how a reader narrows from "near this zip" to the specific district they care
about.

There are still no accounts. *(Corrected 2026-08-13, §10: meetings are live —
served from a committed snapshot of seven real sources — and persistence
exists: three tables with a generated migration, with the identifier-free
search log already writing.)*

### Running it

```bash
corepack pnpm install
cp .env.example .env.local     # optional — see §2
corepack pnpm dev
```

Then http://localhost:3000.

**Use `corepack pnpm`, not bare `pnpm`.** `package.json` pins
`"packageManager": "pnpm@10.33.0"`. If a machine has a different global pnpm and
`manage-package-manager-versions` is off, bare `pnpm` silently runs the wrong
version. Corepack honours the pin. Node has no `engines` constraint; Node 24
works.

| Command | Does |
|---|---|
| `corepack pnpm session:start` | Start-of-session sweep, then the dev server — see §8. `--check` starts nothing |
| `corepack pnpm dev` | Development server. Refuses if 3000 is taken; records its pid in `.dev-server.pid` |
| `corepack pnpm build` | Production build |
| `corepack pnpm test` | `node --test` over `tests/` — 371 tests (2026-08-18) |
| `corepack pnpm lint` | ESLint |
| `corepack pnpm ingest <source>` | Run one adapter end to end — `composite` prints per-source accounting and retrieves agenda documents |
| `corepack pnpm meetings:report` | The four-zip gate: meetings per zip, contributing sources, unwired bodies. Live network |
| `corepack pnpm zcta:fetch` | Rebuild zip centroids from Census (see §3.2) |
| `corepack pnpm districts:fetch [type...]` | Rebuild boundary layers (see §2) |
| `corepack pnpm registry:build` | Regenerate the division and body registry (§4.4) |
| `corepack pnpm officials:build` | Regenerate the officeholder rosters — federal and per state (§4.8, §4.9) |
| `corepack pnpm shoot <name>` | Headless capture of what actually rendered |
| `corepack pnpm handoff` | End-of-session sweep — see §8. `--check` reports without touching anything |
| `corepack pnpm db:generate` / `db:migrate` | Drizzle migrations |

---

## 2. What exists and works

All of the following is implemented, passing lint and typecheck, covered by a
green production build, and confirmed rendering in a browser.

### Request path

```
app/page.tsx
  └── components/map/map-entry.tsx        fetches, derives, wires
        ├── lib/state/provider.tsx         shared UI state (reducer + context)
        ├── lib/state/data.tsx             the server's answer, derived once
        ├── components/shell/sidebar.tsx   340px left rail
        │     ├── view-toggle · scope-selectors · stats-bar
        │     ├── search-box (autocomplete) · radius-control · near-me-control
        │     └── filters-area
        ├── components/map/map-canvas.tsx  MapLibre instance, markers, overlays
        ├── components/map/welcome-overlay.tsx  entry prompt (zip-comb inside)
        ├── components/map/district-picker.tsx  click disambiguation
        ├── components/map/legend.tsx · count-badge.tsx · list-overlay.tsx
        └── components/map/coverage-notice.tsx · meeting-panel.tsx
                    │
                    └── GET /api/meetings?lat=&lng=&radiusKm=
                             └── lib/meetings/query.ts   the cascade
                                   └── lib/meetings/registry.ts
                                         └── lib/sources/mock/
```

**`lib/state/` is the one store.** EdiaStratMap keeps a single mutable `S`, and
that is why cross-cutting features are cheap there: the legend, the count badge,
the list and the map all read the same filters. This is the typed version — a
reducer plus two contexts (state and dispatch separately, so a dispatch-only
component does not re-render on unrelated changes). `lib/state/derive.ts` is the
single filter function every surface reads, which is what stops those surfaces
disagreeing about what is currently shown.

**`lib/ocd/tiers.ts` is the filter axis.** Local / State / National is decided
by OCD-ID segment depth against an explicit table, never by string-matching a
label. `tierForOcdId` uses the *deepest* segment only and returns `null` when
that segment is unrecognised — deliberately not walking up to the nearest known
ancestor, because an unknown division type inheriting its parent's tier is a
silent misfiling. A test covers exactly that case.

`app/api/meetings/route.ts` is the map's **only** data dependency. It validates
latitude and longitude ranges, clamps `radiusKm` to the widest ladder rung, and
returns the search result verbatim.

### The empty-state cascade — `lib/meetings/query.ts`

The single most important piece of product logic. An empty map reads as "your
government does nothing" when the truth is usually "nothing within fifteen miles
this fortnight." So the search steps outward:

1. **`exact`** — upcoming meetings within the requested radius (default 25 km).
2. **`widened`** — nothing there, so it tries 60 km, then 150 km.
3. **`concluded`** — no upcoming meetings at any radius; falls back to meetings
   concluded in the last 30 days, rendered visually distinct.
4. **`none`** — nothing either way. Says so plainly.

Which rung produced the result is returned to the client as `tier` and shown on
screen by `coverage-notice.tsx`. This is deliberate: *a search that quietly
widened its radius is indistinguishable from one that found what you asked for,
which makes it a wrong answer.*

Upcoming reaches 60 days ahead; the concluded tier reaches 30 days back. One
upstream fetch happens at the widest radius and the rungs filter over it, so a
real adapter is not asked for the same window three times.

### Other working pieces

- **`lib/meetings/venues.ts`** — groups meetings by rounded coordinate (4 dp,
  about 11 m) so a chamber hosting four sittings is *one* pin, not four stacked
  unclickable markers.
- **`lib/geo/zcta.ts`** — zip validation and lookup. Distinguishes three failure
  modes (`malformed`, `unknown`, `uncovered`) so each can get an honest message.
- **`lib/geo/distance.ts`** — haversine.
- **`lib/time/zoned.ts`** — reassembles a local calendar date plus wall-clock
  time into a correct instant for an IANA zone. Covered by tests including DST
  boundary crossings.
- **`hooks/use-stored-zip.ts`** — remembers the zip in `localStorage` under
  `wtp.approximate_location`, read through `useSyncExternalStore` so the server
  renders a `pending` state and a returning reader never sees the entry notice
  flash before their zip loads. Survives private mode and disabled storage.
- **`lib/db/index.ts`** — lazily constructed Neon/Drizzle client.
- **`hooks/use-stored-theme.ts`** — the light/dark choice under `wtp.theme`, same
  `useSyncExternalStore` shape. The paint-blocking half is an inline script in
  `app/layout.tsx`, because no hook runs early enough to stop a light-theme
  reader seeing a dark flash.
- **`scripts/shoot.mts`** (`pnpm shoot`) — headless Playwright capture of the
  running app. It exists because MapLibre renders on `requestAnimationFrame`,
  which browsers stop delivering to an occluded tab: captures through an
  attached browser come back stale or empty, and timer-based checks hit CDP
  timeouts. It prints what actually rendered, so a screenshot can never quietly
  be of an empty map.
- **Tests** — `cascade`, `zoned`, `districts`, `tiers`, `district-hits`,
  `zip-coverage`, `fixture-provenance`, `subdivisions`, `registry-oracle`,
  `coverage`, `legistar`, `officeholders`, `officeholder-lookup`, `plural`.
  **132 total.** *(2026-08-13: 226 — snapshot, iqm2/revize fixtures,
  db-schema and search-log suites added since this list was written.)*

### The division and body registry — `lib/registry/`

**New in Phase 4.6, and it is the piece that connects the other two.** The app
had polygons and it had meetings and nothing joined them: a point could resolve
to Vail Unified School District and the app still could not say that district
has a governing board.

`pnpm registry:build` generates `lib/registry/registry.json` — **940 divisions, 265 bodies** — from the committed boundary files. Committed like the geometry
and the ZCTA centroids, so nothing at runtime needs a database.

| File | Does |
|---|---|
| `types.ts` | `Division`, `Body`, and the enums — `BodyClass`, `CoverageStatus`, `BodyOrigin`, `AgendaSourceType`, `SourceDataset`, `CanonicalMatch` |
| `derive.ts` | Division type → the bodies it implies, and the LSAD table that decides whether a polygon governs at all |
| `resolve.ts` | Point → divisions → bodies. Pure; geometry is an argument, so it runs in a test, on a server, or against tiles later |
| `coverage.ts` | Point → the honest statement: who governs here, how much of their calendar we hold, and the municipal dedupe (§4.5) |
| `server.ts` | Loads geometry and `registry.json` once per process and caches them |
| `registry.json` | The generated output |

Full numbers, the four-zip oracle, and the identifier decision are in §4.4.
**Wired into the screen as of 4.6.6** — see §4.5.

### District overlays (six types)

Toggleable boundary layers, off by default. When the master toggle goes on,
**one type per tier draws** — congressional, state house, county
(`DEFAULT_DISTRICT_TYPES`). All six at once put three Local boundaries over the
same ground and read as noise; the rest are one checkbox away.

| Type | Source | Scope |
|---|---|---|
| Congressional | `cb_2025_us_cd119_500k` | national, 441 features |
| State upper / lower | `cb_2025_<st>_sldu/sldl_500k` | clipped |
| County | `cb_2025_us_county_500k` | the three clip counties exactly |
| Place | `cb_2025_<st>_place_500k` | clipped |
| School: unified / elementary / secondary | `cb_2025_<st>_unsd/elsd/scsd_500k` | clipped |

**Everything below Congress is clipped to Pima AZ (04019), Morris NJ (34027) and
Merrimack NH (33013)** — 254 KB on top of the 1.55 MB national congressional
file. National coverage across all types is 13,000+ features, which ends the
committed-GeoJSON approach and forces vector tiling; three counties keeps the
tested pipeline and defers that decision until coverage actually expands.
Congressional stays national because tests assert its 441 features and it is the
one tier where seeing past your own county earns the bytes.

The clip is a real overlap test (vertex-in-polygon both directions after a bbox
reject), not a bounding-box test — Merrimack County's bbox reaches half of New
Hampshire. The county layer alone is restricted to exactly the three clip
counties, since the eighteen neighbours sharing a border would misrepresent what
the build covers. A missing per-state file is a skip, not a failure: coverage
genuinely differs by state.

- **`scripts/fetch-districts.ts`** (`pnpm districts:fetch [type...]`) is a
  type registry over one pipeline — download, DBF/SHP parse, OCD identity,
  topology-safe simplification, gap assertion, write.
- **`lib/ocd/fips.ts`** holds FIPS-to-postal as an explicit literal.
  **`lib/ocd/divisions.ts`** builds the sub-congressional identifiers.
- **`lib/map/districts.ts`** is a registry keyed by district type: one source
  and fill/line/label layers each, coloured by **tier accent** (hue says which
  tier). A transparent fill sits under every line because a line has almost no
  hit area. `promoteId: "ocdId"` makes selection `feature-state` rather than a
  source mutation.

  **Dash and weight separate types *within* a tier** (Phase 4.5.2). Hue alone
  was not enough: the Local tier holds three types — county, municipal, school
  — that trace the same ground around any city, and drawn in one colour with
  one dash `[2,2]` they were indistinguishable. Each type now carries its own
  `dash`, `weight` and `labelMinZoom`, ordered by containment: the widest shape
  gets the longest dash and heaviest stroke (county `[7,3]` at 1.25×, labels
  from z6), the most nested gets a fine dot at the lightest weight held back to
  high zoom (school `[1,2]` at 0.75×, labels from z10). Six label layers all
  switching on together at z7 was most of the noise.

**There are six district types, not eight.** `unsd`/`elsd`/`scsd` are merged
into a single `school` type sharing one source, so a K-8 boundary and a
regional high school boundary draw identically even though `districtsAt()`
returns them as separate hits with distinct labels. Splitting them is tracker
**M12**.
- **`hooks/use-district-layer.ts`** persists the master toggle under
  `wtp.show_districts`; the per-type checkboxes live in the store.

**Only four properties per feature** — `ocdId`, `state`, `district`, `label`.
Everything else Census ships is dropped.

### Click to select — a point is in a *set* of districts

`districtsAt()` queries every active fill layer. One hit selects directly;
several open `district-picker.tsx`, grouped by tier and listing however many
districts actually contain the point (never a hardcoded two); zero is a no-op,
so clicking empty water does not silently drop a selection.

This is the surface that makes the zip rule real: **the reader's own click
chooses the district.** Nothing is inferred from where their zip centroid fell.

Measured at the four target zips: 85701 → 6 districts, 85641 → 5 (**no
municipality** — Vail is unincorporated), 07866 → 7 (**two school districts**, a
K-8 and a regional high school), 03255 → 5.

**One known data gap.** New Hampshire's floterial districts overlay their base
districts, so Newbury genuinely sits in two House districts — but Census SLD
files are defined as a non-overlapping partition and cannot express that.
Verified, not assumed: 1,803 sampled points across the NH file each land in
exactly one district. `tests/district-hits.test.ts` asserts today's truth and
separately asserts the file *is* a partition, so if a floterial source ever
arrives the second test fails and points at the first. Getting them means adding
a New Hampshire source, which is an external-source decision.

**No officeholder, candidate, or party data is rendered on these boundaries,**
and none should be added until a sourced officeholder dataset exists. CLAUDE.md
line 17 forbids rendering a position or a person without a source record; a name
on a district line would be inference from nothing. If adding one ever feels
like an obvious improvement, that is the failure mode the rule exists to catch.

---

## 3. What is stubbed or mocked

**The registry is not in this section.** `lib/registry/registry.json` is
generated from real Census geometry and is as real as the boundary files — but
every body in it is `NO_SOURCE_FOUND` with a null name, which is an honest
statement of what is known rather than a stub. See §4.4.

### 3.1 Meeting data — the mock source

**Where:** `lib/sources/mock/` (adapter + 32 fixtures)

Meetings are fake. **The interface around them is not.**

`lib/sources/types.ts` defines the real contract — `MeetingSource` with
`fetch()`, `normalize()`, `upsert()`, and a `Meeting` record carrying an OCD-ID
and full provenance. The mock emits **Legistar-shaped** rows (separate
`EventDate` and `EventTime` strings with no zone attached, exactly as Granicus
Legistar returns them) and transforms them precisely as a real adapter will.
Nothing above `lib/meetings/registry.ts` can tell the difference.

Fixture coverage — **34 events**, of which 6 are in the past and 2 are canceled.
Philadelphia was removed 2026-08-11 and replaced with the jurisdictions covering
two real test zips, 07866 and 03255:

| Jurisdiction | Zip | Events |
|---|---|---|
| Tucson, AZ | 85701 | 10 |
| Rockaway Township, NJ | 07866 | 4 |
| Pima County, AZ | 85701 | 3 |
| Newbury, NH | 03255 | 3 |
| Tucson Unified School District, AZ | 85701 | 2 |
| Morris County, NJ | 07866 | 2 |
| Rockaway Township School District, NJ | 07866 | 2 |
| Kearsarge Regional School District, NH | 03255 | 2 |
| Merrimack County, NH | 03255 | 1 |
| Oro Valley / Marana, AZ | — | 1 each |
| Cochise County / Douglas / Sierra Vista, AZ | — | 1 each |

Two time zones are represented: `America/Phoenix`, which never observes DST, and
`America/New_York`, which crosses it twice a year. That pairing is what catches
a naive offset assumption in the transform.

Merrimack County meets in Boscawen, ~29 km from the 03255 internal point, so it
sits outside the first rung of the radius ladder deliberately — it gives a real
zip a reason to exercise the widened tier.

Fixture dates are **day offsets from today**, resolved at fetch time against the
division's own time zone, so the calendar never goes stale.

**Every fixture URL is null** (Phase 4.5.3). The rows previously carried
invented permalinks — `https://tusd1.org/agendas/4107`,
`tucson.legistar.com/...ID=4101` — which looked exactly like real ones and
resolved to a front page or a 404. That is a `CLAUDE.md` provenance violation
living inside the fixtures, and it is worse there than in application code
because nothing surfaces it until a reader clicks. These meetings were not read
from anywhere, so no URL can honestly cite them.

- `Provenance.sourceUrl` is now `string | null`, which is what its own doc
  comment already promised for an unfillable field.
- `meeting-panel.tsx` renders **"No agenda posted yet"**, which already existed.
- `FIXTURE_SOURCE_HOSTS`, declared beside the fixtures, is the allowlist of
  hosts a fixture may cite. It is **empty**, and
  `tests/fixture-provenance.test.ts` asserts every URL is either null or on it —
  in the raw rows *and* in `normalize()` output, so an adapter that manufactures
  a URL during the transform fails too. A fixture cannot gain a URL without
  someone editing that array in the same change, which turns an invisible
  fabrication into a visible diff.

Tracker **M06 is reopened** as a result: the link rendered, but the target was
fabricated, so "never a dead end" was not met.

**Replaced 2026-08-13: the mock is no longer `active`.** The composite serves
real meetings (§9); `getMeetingSource()` resolves `WTP_MEETING_SOURCE` and the
cascade/zip-coverage tests pin `mock` so the suite never touches the network.
The mock stays in the repo and stays in `scripts/ingest.ts` because the
fixture-provenance and cascade tests run against it. Adding a source is now:
a directory under `lib/sources/<name>/`, a capability entry in
`lib/sources/composite/wiring.ts`, and wiring rows in
`lib/registry/source-wiring.ts` — adding a *body* to an existing source is a
wiring row alone. **Writing is still not solved** — see §3.3. Every adapter's
`upsert()` deliberately reports without persisting until Phase 5 tables land.

### 3.2 Zip centroids — no longer a stub

**Where:** `lib/geo/zcta-centroids.json`

**Resolved 2026-08-11.** `pnpm zcta:fetch` has been run: the file now holds all
**33,144** ZCTA internal points from the Census 2020 Gazetteer and `complete` is
`true`.

The flag is load-bearing. While it was `false` the app could not claim a zip
*doesn't exist*, only that it didn't have it yet, so `resolveZip()` returned
`uncovered`. With a complete table an unrecognized five-digit zip now correctly
reads as `unknown`.

Rerun `pnpm zcta:fetch` when Census publishes a new vintage.

### 3.3 The database

**Where:** `lib/db/schema.ts` — intentionally empty (`export {}`).
*(No longer true as of 2026-08-13 — three tables and a generated migration
landed with D10; see §10. The rest of this section stands as the design it
was built to.)*

Nothing on the entry screen reads Postgres. `getDb()` is lazy specifically so a
missing `DATABASE_URL` does not break `pnpm dev`; the first caller that actually
needs a connection is the one that gets the error.

**A real meeting source needs this solved first:** tables, a generated migration
(`pnpm db:generate`, never hand-written SQL), and an upsert strategy keyed on
the source-namespaced `Meeting.id`. When meetings get a table, **`ocdId` is the
join key** — never `jurisdiction` or `bodyName` strings.

### 3.4 The districts-and-officeholders rung

Referenced in `query.ts` as the rung that should come after `none`: show
district boundaries with the people who hold those offices, so the answer is
never truly empty. **Not built.** Needs TIGER/Line geometry plus an officeholder
data source, neither of which exists in the repo.

### 3.5 `CLAUDE.md` — restored, but was clobbered once

`CLAUDE.md` (~9.4 KB) holds the product's non-negotiable constraints. On
2026-08-11 it was found containing only the 12-byte line `@AGENTS.md` and was
restored from the author's copy.

The likely cause is Next.js scaffolding: `next dev` generates and re-adds
`AGENTS.md` (see `node_modules/next/dist/server/lib/generate-agent-files.js`)
and appears to have overwritten `CLAUDE.md` with a pointer to it.

**If `CLAUDE.md` is ever tiny or is just `@AGENTS.md`, it has been overwritten.**
Do not treat the repo as constraint-free and do not reconstruct the file from
memory — restore it.

### The `G:\My Drive\we-the-people\` mirror

A hedge against the above, and against losing the project's memory with a
branch. It holds ten files, flat — eight copied from the repo, two generated.
The count in this sentence has drifted from the table below it twice (it read
"seven files, flat — six copied" while the table listed nine); the authority is
the `MIRRORED` list in `scripts/handoff.mjs` plus the two generated files, and
R17 is the row for making the report count that list rather than restate it:

| Mirror | Repo |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` |
| `abuse-policy.md` | `docs/abuse-policy.md` |
| `vendor-review.md` | `docs/vendor-review.md` |
| `source-ladder.md` | `docs/source-ladder.md` |
| `defects.md` | `docs/defects.md` |
| `state.md` | `docs/state.md` |
| `tracker.csv` | `docs/tracker.csv` |
| `types.ts` | `lib/sources/types.ts` |
| `git-state.txt` | *generated — no repo counterpart* |
| `context.md` | *generated — no repo counterpart* |

`vendor-review.md` was added 2026-08-12 alongside D14. It is in the mirror for
the same reason `abuse-policy.md` is: a standing document that constrains what
may be built, pending review by counsel, and worth surviving the loss of a
branch.

`git-state.txt` is written by `pnpm handoff` after the fetch and before the
mirror sync. It is plain text, one fact per line: when it was generated, the
current branch, local `HEAD` and `origin/main` by sha and subject, the **R07
check** (does local `main` equal `origin/main`, and how far behind if not),
whether the tree was clean, any open PRs, and the last recorded test count with
lint and build status. Because it is generated it is never compared for drift
and never copied — it is simply overwritten each run.

It exists for the case the rest of the mirror cannot cover: a session that opens
with the drive mounted but the repo not yet cloned or fast-forwarded, where
there is no git to ask. The R07 line is the reason it is worth having at all —
stale local `main` is invisible from inside the repo until someone checks `main`
out and finds an apparently empty project (§7).

The test, lint and build figures are **read from this file**, not re-run. A
status is a claim someone committed to with evidence, not one a script inferred
on its way past, so `git-state.txt` cites the `state.md` line it took them from.

`context.md` is the **second generated file** (R15, added 2026-08-14), written by
`scripts/context-file.mjs` in the same handoff run and holding the same posture:
no repo counterpart, never compared for drift, skipped by `--check`, and
rewritten after a successful `--ship` because a merge moves every fact in it.
It carries the phase standings (§7), every P0 tracker row as ID / item / status
/ one-line note, every ripcord with its flag name, committed state, open
question and named closer, the last ten tracker rows whose Status actually
changed, and the same git facts `git-state.txt` holds — both files are written
from one array so they cannot disagree about the same moment.

It exists because this file is the wrong thing to hand a conversation that only
needs to know where things stand: `state.md` is a quarter of a megabyte, and by
the time it has been pasted anywhere there is no room left for the question. So
`context.md` is capped at **20 KB**, and the cap is enforced by shrinking rather
than by hoping — the tracker-change section is dropped first, then the P0 notes
are narrowed, and **every cut says so in the file**, at the top and again in the
section it was cut from. A partial file that reads as a complete one is the one
thing the cap must not produce. It landed at 18.6 KB with nothing truncated.

**Nothing in it is composed.** Phases are parsed out of §7, tracker rows and
notes are read from `docs/tracker.csv`, ripcord state comes from
`lib/ripcords.ts` — the registry is the state of record, and prose copies of a
flag's position go stale in a way the registry cannot — and the status-change
list is diffed out of git history. Long fields are clipped with `…`, never
paraphrased. A generated summary of any of this would be a fresh set of claims
with nothing behind them.

**Keep the mirror in step in the same change that updates the repo copy.** A
mirror that is only sometimes current is worse than none, because the next
person cannot tell which side is authoritative. The repo is authoritative; the
mirror is a copy, and should be byte-identical.

The same folder also holds `transcripts/` — readable Markdown exports of the
Claude Code sessions that produced this work. Those are *not* mirrored repo
files and have no counterpart here; they are a record of how the work happened,
kept because the source session logs live only in `~/.claude/projects/` and are
neither synced nor backed up.

**Regenerate them at the end of every working session:**

```
node ~/.claude/export-transcript.mjs --out "G:/My Drive/we-the-people/transcripts"
```

That rewrites every session file plus a `README.md` index. They are also worth
*reading*: when a decision here is recorded without its reasoning, the session
that made it usually has the reasoning. They contain the full conversation
including file contents and command output, so treat them as sensitive before
sharing.

Before overwriting a mirrored file, check the target actually matches the
previous repo version — if it has diverged, it holds something the repo does
not, and copying over it loses that.

`docs/abuse-policy.md` (7.4 KB), referenced by CLAUDE.md line 55, is present. It
is a draft pending review by counsel. It references
`docs/escalation-contacts.md`, which does **not** exist yet.

---

## 4. Decisions and the reasoning behind them

These are design commitments visible in the code. They are recorded here because
the reasoning is not obvious from the types alone.

**OCD-IDs are the only join key.** `ocd-division/country:us/state:az/place:tucson`
rather than "Tucson". Names collide across states and change between sources.
`Meeting.jurisdiction` exists **for display only**.

**Provenance rides on every record and is never dropped in a transform.** Every
`Meeting` carries `sourceUrl`, `sourceOrg`, `collectedAt`, and `verifiedAt`. When
a field cannot be filled it is `null` and the UI says so — it is never inferred.
The mock sets `verifiedAt: null` because nothing has confirmed fixtures against
a live source; that is the honest value, not an oversight.

**A zip code is orientation, not identity.** A ZCTA is a statistical shape built
from mail delivery routes; it runs straight through cities, counties, school
districts, and legislative lines. It tells the map where to look and nothing
else. Anything needing real districts must ask for a street address and explain
why at the point of asking. The stored-location key is literally named
`approximate_location`.

**The cascade always reports which rung it landed on.** See §2.

**Unplaceable records are dropped, never guessed.** `normalize()` discards any
event it cannot pin in time or space. A wrong date on a public hearing is worse
than a missing one.

**Pins are venues, not meetings.** See §2.

**`normalize(raw, now)` takes the clock as a parameter** rather than calling
`Date.now()`, so the transform is deterministic and testable. Status
(`SCHEDULED` / `CONCLUDED`) is derived from that parameter.

**The stored zip is re-resolved on read**, not trusted from storage. A Census
vintage update moves centroids; the zip string is the only durable part.

**`CANCELED` meetings are kept but never used to fill an empty map.** A canceled
meeting is itself news; padding a sparse map with one would be misleading.

**Field naming: camelCase in TypeScript, snake_case in Postgres, mapped at the
Drizzle boundary.** Settled 2026-08-11. CLAUDE.md writes provenance fields as
`source_url` / `source_org` / `collected_at` / `verified_at`; `lib/sources/types.ts`
declares them as `sourceUrl` / `sourceOrg` / `collectedAt` / `verifiedAt`. Both
are correct for where they live. The translation happens in one place — the
Drizzle table definitions, which name the column explicitly:

```ts
sourceUrl: text("source_url").notNull(),
collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
verifiedAt: timestamp("verified_at", { withTimezone: true }),
```

No snake_case reaches application code, and no camelCase reaches SQL. There is
currently no table to demonstrate this on (`lib/db/schema.ts` is empty) — the
convention is recorded here so it does not get decided ad hoc when meetings get
one.

**District boundaries use the Census *cartographic* file, not TIGER/Line.**
CLAUDE.md line 31 names TIGER/Line. `cb_2025_us_cd119_500k` is the same source
and the same geography generalized to 1:500,000; full-resolution TIGER/Line is
roughly an order of magnitude heavier and is built for spatial joins, not for
shipping to a browser. At 1:500,000 the file is 1.55 MB after simplification;
the equivalent TIGER/Line pull would be tens of MB before it. When district
*resolution* is needed — deciding which district an address falls in, which is
tracker item M02 — that is a server-side job against full-resolution geometry,
and this file is not it.

**GENZ2025, not GENZ2024.** Both carry the 119th Congress; 2025 is the current
vintage (`https://www2.census.gov/geo/tiger/` lists GENZ2010 through GENZ2025).

**Every congressional seat is `<jurisdiction>/cd:<number|at-large>`.** Verified
2026-08-11 against the canonical published list,
`opencivicdata/ocd-division-ids`, `identifiers/country-us.csv` (194,977
identifiers) — a one-time check of the convention itself, not a runtime
dependency, and deliberately not added as a source.

| Case | Identifier |
|---|---|
| Ordinary district | `state:az/cd:7` |
| At-large state | `state:wy/cd:at-large` |
| DC delegate | `district:dc/cd:at-large` |
| Territory delegate | `territory:pr/cd:at-large` |

Three corrections came out of that check. At-large is **`cd:at-large`**, not
`cd:1` — `state:wy/cd:1` and `state:wy/cd:0` do not appear in the list at all.
And DC and the territories do carry a `cd:` segment: bare `district:dc` and
`territory:pr` are real identifiers, but they name the **jurisdiction**, not the
seat inside it, so using them for a district boundary would join a shape to the
wrong class of entity. 12 features are at-large — 6 states, DC, and 5
territories.

**Simplification is topology-safe by construction.** Vertices are quantized to a
4-decimal grid, then a vertex is removed only if *every* ring containing it
votes to drop it. A district can therefore never shed a point its neighbour
keeps, which is the only way a sliver opens along a shared border. The script
asserts this and refuses to write if any shared vertex survives on one side
only. Tolerance is 0.0018° (~200 m): the highest-fidelity setting that stays
under the 2 MB budget. Counter-intuitively, larger tolerances produce *bigger*
files, because they trip the veto that protects rings from collapsing.

**No silent basemap substitution.** When the basemap cannot render, the map
shows the ground colour and the "Basemap unavailable" notice. It never falls
back to a different tile provider. A silent swap is what made a total vector
rendering failure read as a dark style choice for hours on 2026-08-11 — the
symptom of "no data at all" and "this style is very dark" look identical.
A CARTO fallback added during that investigation was removed for this reason,
and because CLAUDE.md line 138 requires asking before adding an external source.

**Marker elements are real `<button>`s** with `aria-label`s, built imperatively
and styled from `app/globals.css`. MapLibre will happily mount an unfocusable
`div` and leave the map unusable without a mouse.

### 4.1 Basemap decisions (2026-08-11)

**Superseded 2026-08-12. The basemap renders vector tiles.** The raster
workaround, `buildRasterStyle()`, `rasterBasemapEnabled()` and the
`NEXT_PUBLIC_MAP_RASTER` flag are all deleted — see §5.1, now resolved. The
paragraphs below about style choice still hold; the raster claim does not.

**The basemap follows the UI theme** — `basic-v2-dark` / `basic-v2`, both
overridable by env. EdiaStratMap does not theme its map and does not need to: it
draws dark panels over a single light OSM layer. Ours is a dark vector style, so
a fixed basemap would have put light panels over a dark map.

**There is no substitute tile provider.** `resolveBasemap()` returns null
without a key and the caller renders "Basemap unavailable". The OpenFreeMap
fallback was removed: a basemap that silently swaps source is how a total
rendering failure spent hours looking like a dark style choice.

**A useful diagnostic, learned the hard way:** if the basemap is a single flat
colour with **no internal edges anywhere** — no coastline, no land/water
boundary — then no vector data is rendering, regardless of which style is
selected. A correctly rendering dark style always shows a land/water edge.

**Style is `basic-v2-dark`**, set in `.env.local`. Chosen over nine other dark
styles available on the account, measured directly from their style documents:

- Its road network is **one flat `#454545` at 0% saturation** — no coloured road
  hierarchy, nothing to compete with the amber meeting pins.
- **No POI icons or labels at all.**
- Detail labels are held back until **zoom 10**, just under the app's
  `METRO_ZOOM` of 11 — quiet at continental view, legible once someone lands on
  their zip.
- The Local-tier pin (`--accent-local`, `#ffb000`) is **7.1× brighter** than
  the brightest thing the basemap draws.

Its one high-saturation colour (`Sand`, `#182405`, 77% saturation) is at 8%
lightness — a near-black olive, about 37× dimmer than the pins. It appears
around Tucson from z8 as texture, not colour.

The code defaults are now `basic-v2-dark` and `basic-v2` (`lib/map/style.ts`),
matching what `.env.local` was already setting rather than leaving the code
default disagreeing with the deployed one.

**District line colour is token-driven.** `lib/map/districts.ts` reads
`--district-line` and `--bg` off the document when it builds layers, so
`globals.css` is the single source of truth and the overlay follows the theme.
MapLibre paint properties cannot take a `var()`; resolving at build-time is
enough, because a theme change swaps the style, which discards the layers, and
re-adding them re-reads the tokens.

---

### 4.2 Phase 4.5 — the defects found in testing (2026-08-12)

**85641 was not what it looked like.** The brief reported it "shows nothing at
all" and named two candidates: the radius control suppressing the cascade's
widening, or `derive.ts` dropping widened results. **Measured, both were
wrong.** `/api/meetings?lat=32.04903&lng=-110.62291` returns 14 meetings at
`tier: "widened"`, `radiusKm: 60`; `applyFilters` with default state keeps all
14; and a fresh load renders 12 markers with the RADIUS WIDENED notice. The
cascade, the client filter and the camera framing were all already correct — a
previous session had anticipated exactly this and left the comments to prove it
(`map-entry.tsx` gates the radius filter behind `radiusOverridden`;
`map-canvas.tsx` frames all venues when the tier is not `exact`).

**What did reproduce is the radius control, and it had two bugs.**

1. **Enabling it blanked the map.** The toggle dispatched `radius/set` with the
   untouched default of 25 km while 85641's results came from the 60 km rung, so
   all 14 meetings vanished the instant a reader touched the control. It now
   seeds from `result.radiusKm` — the rung the visible results actually came
   from — so the limiter opens at 60 km showing "14 within 37 mi".
2. **Disabling it did not disable it.** The off path dispatched `filter/reset`,
   which cleared every *unrelated* filter (body types, statuses, date window,
   district types) and left `radiusOverridden` true — so the radius kept
   filtering while the control read "off", with no way back short of a reload.
   A dedicated `radius/clear` action now does what the toggle says.

This is the more likely explanation of what the author saw, and it is worse than
the reported defect: silent, recoverable only by reload, and it destroys
unrelated state on the way.

**Why no test caught it.** Nothing covered the path from a real zip through the
cascade *and* the client filter — `cascade.test.ts` works from bare coordinates
and stops at the server. `tests/zip-coverage.test.ts` now closes that, and
closing it required two unrelated repairs:

- `lib/geo/zcta.ts` imported its JSON without an import attribute, so Node
  refused to load it and every zip-level test was impossible. Now
  `with { type: "json" }`, which Turbopack accepts.
- `lib/state/derive.ts` and `reducer.ts` used `@/` path aliases that
  `node --test` cannot resolve, so the reducer could not be tested despite its
  docstring saying it was "exported on its own so it can be tested". Both now
  use the relative, extension-bearing style the rest of `lib/` already uses.

**Remaining gap:** no test drives the components. Both radius bugs lived in the
store and would have been caught by a component-level harness; today the
components are only ever checked by screenshot. Tracker **M13**.

---

### 4.3 Phase 4.6 — what the boundary data actually supports (2026-08-12)

Phase 4.6 derives a body registry from division type: a county has a board, a
municipality has a council, a school district has a governing board. Before any
of that could be written, two questions had to be answered from data rather than
assumed, and both answers changed the plan.

**1. Which polygons have a government at all?** The committed files carried four
properties and none of them said. Measured against the Census place files:

| Layer | LSAD | Government? |
|---|---|---|
| place | 25 city, 43 town, 21 borough, 47 village | yes |
| place | **57 CDP** | **no** |
| cousub | 21/25/43/44/47, plus Princeton NJ (00) | yes |
| cousub | **22 CCD** | **no** — statistical |
| cousub | **32/36/42** grants, locations, purchases | **no** — unorganized |

**376 of Arizona's 467 places are CDPs**, and all 80 of its county subdivisions
are CCDs. A `place → council` rule without LSAD invents 376 councils in one
state, starting with Vail — which is exactly the fabrication 4.6.2 warns about.
LSAD is now the **fifth property** on place and cousub features, carried as the
raw Census code so the interpretation can be corrected without refetching.

**2. Where do municipalities live?** It depends on the state, and the repo only
had half of it:

- **Arizona** — municipalities are *places*. Its county subdivisions are
  statistical.
- **New Jersey** — all 564 municipalities are *county subdivisions*. The place
  file holds ~323 entries and no townships.
- **New Hampshire** — 222 towns are *county subdivisions*. 87 of its 100
  "places" are CDPs.

So **Newbury NH and Rockaway Township NJ had no polygon in this repo at all** —
two of the four target zips, with no municipal geometry and therefore no
possible derivation. `cousub` is now a built type (`cousub-04/33/34.geojson`,
68 KB).

**Identifier shape, and a collision that mattered.** County subdivisions are
nested under their county and slugged from `NAMELSAD`, not `NAME`:

```
ocd-division/country:us/state:nj/county:morris/place:rockaway_township
```

Both shortcuts fail on real data. **Morris County contains Rockaway borough and
Rockaway township — two separate municipalities, two councils, one slug** under
`NAME`. Thirty New Jersey subdivisions collide that way (Clinton town/township,
Mendham borough/township). Dropping the county collides across counties: six
Washington townships, five Franklins, and Arizona's Fort Apache CCD in three
counties. `tests/subdivisions.test.ts` pins all of it.

**The unresolved part, and it blocks the registry.** See §5.2 item 8, now with
evidence: the identifiers this repo constructs **do not match the canonical
list**.

| This repo builds | `opencivicdata/ocd-division-ids` has |
|---|---|
| `state:az/school_district:tucson_unified` | `state:az/county:pima/school_district:tucson_unified_district` — and `state:az/school_district:*` matches **zero** of 194,977 |
| `state:nj/place:rockaway_township` | `state:nj/county:morris/place:rockaway` — nested, and the township appears absent |
| `state:nh/place:newbury` | same, flat — **the nesting rule varies by state** |

CLAUDE.md makes OCD-IDs the only join key, and `bodies.ocdId` is that join.
**Decided 2026-08-12: the internal key stays authoritative and the canonical
identifier rides alongside it with a confidence.** Adopting the canonical shape
wholesale would make Rockaway Township — a real municipality with its own
council — unrepresentable, so it is the one option that can lose a government.
Carrying both keeps every division and *gains* the canonical mapping wherever
it exists, which is the shape Phase 4.7.4 prescribes for national scale anyway.
Reconciliation quality is reported below and re-run by `pnpm registry:build`.
Tracker **D15** tracks closing the gaps.

### 4.4 The registry — what it generates (2026-08-12)

`pnpm registry:build` reads the committed boundary files and writes
`lib/registry/registry.json`: **940 divisions, 265 bodies.** Committed the way
the boundary files are, so nothing at runtime needs a database — which matters,
because `lib/db/schema.ts` is still `export {}`.

| Division type | Divisions | Bodies | Why |
|---|---|---|---|
| county | 3 | 3 | one governing body each |
| place | 272 | **121** | 119 statistical, 32 fictitious duplicates (§4.6) |
| school_district | 141 | 141 | one governing board each |
| cd / sldu / sldl | 524 | **0** | a legislative seat is not a body that meets |

The gaps are the point. **119 statistical divisions produced no body**, **32
fictitious ones produced none** (§4.6 — Census marks the duplicate itself), and
**524 legislative districts produced none either** — a district elects a seat in
a chamber that sits elsewhere, and Arizona's districts elect three people
between two chambers, so the district is not even one seat.

**Against the hand oracle**, all four target zips resolve every division on
their list:

| Zip | Divisions | Bodies | Notably |
|---|---|---|---|
| 85701 | 7 | 3 | Pima, Tucson, Tucson Unified |
| 85641 | 6 | **2** | Pima and Vail Unified — **no municipal body**, correctly |
| 07866 | 8 | **4** | Rockaway *township* plus **two** school districts |
| 03255 | 6 | 3 | Merrimack, Newbury *town*, Kearsarge Regional |

85641 is the case the whole phase exists for: the only municipal-shaped division
covering the centroid is Tucson CCD, a statistical artifact, so the rule
produces no council while still finding Vail Unified's board.

**Every generated row is `bodyOrigin: DERIVED_FROM_DIVISION_TYPE`,
`coverageStatus: NO_SOURCE_FOUND`, `agendaSourceType: NONE`, and `name: null`.**
The claim is structural — *this division has a governing board* — never a
sourced claim about its name, schedule or members. Names vary by state
(supervisors, commissioners, select boards) and a plausible invented one is the
fabricated-agenda-URL failure again, except read aloud. `tests/registry-oracle.test.ts`
asserts all four properties on every row.

**Canonical reconciliation**, from `pnpm registry:build`:

| Type | exact | high | none |
|---|---|---|---|
| cd | 441 | — | — |
| county | 3 | — | — |
| sldu | 25 | — | — |
| sldl | 15 | — | 43 |
| school_district | — | 64 | 77 |
| place | 44 | — | 228 |

`none` is concentrated exactly where §4.3 predicted: county subdivisions, which
the canonical list either nests differently or omits.

### 4.5 Phase 4.6.6 — the coverage language, and a duplicate nobody had noticed

**The registry is now on screen.** `lib/registry/coverage.ts` answers "who
governs this point and how much of their calendar do we hold", the meetings
route attaches it, and `coverage-notice.tsx` renders it. Tracker **M16**.

#### The four states, and which one turned out to matter

The brief's table has four rows: meetings found, bodies known but nothing
scheduled, bodies known with no source wired, and nothing mapped. Building it
surfaced a fifth situation that is really the third one wearing a disguise, and
it is the most common of the lot.

**85641 does not land on the empty rung.** It lands on `widened`, showing 14
meetings from 37 miles away — every one of them Tucson's. So the reader in Vail
was never looking at an empty map; they were looking at *someone else's
government*, with nothing on screen to say so. The original plan replaced the
`none` copy and would have left that untouched.

So the coverage block rides **alongside** the cascade's message rather than
replacing it, and it renders on any rung where a body governing this point has
no calendar. The result for 85641:

> **Radius widened** — Nothing scheduled within 16 miles of 85641. Showing the
> 14 meetings within 37 miles.
> **No city or town government** — this area is unincorporated.
> We don't have calendars for the 2 bodies that govern the area around 85641.
> · Pima — County · Vail Unified District — School district
> You're also represented in AZ-6, State House District 19 and State Senate
> District 19.
> We know these bodies exist because the district boundaries do. We haven't
> sourced their names or meeting schedules yet.

**No body name is ever printed.** `Body.name` is null on every derived row and
stays that way. What renders is the *division's* label, which Census sourced,
plus the structural claim that a division of this type has a governing body —
and a footnote that says exactly which half of that is unsourced. The rule from
§4.4 holds all the way to the pixel.

**`unincorporated` is only claimed when it was measured.** It requires a
municipal-shaped division to cover the point and every one of them to be
statistical. Finding *nothing* is the `UNMAPPED` state instead, because "no
municipal government here" and "our boundary data does not reach here" are
different statements and only one of them is about the reader's government.
67501 (Hutchinson KS, outside the clip) renders the second and still names KS-1,
so it never reads as "you have no representation".

#### The duplicate: 32 governments counted twice, already live

**§4.6.0 of the brief and an earlier version of §6 below both say cousub is
built but not merged, so nothing is double-counted yet. That is wrong.**
`scripts/build-registry.ts` reads *every* `.geojson` in `public/geo`, and
`cousub-*.geojson` is in there. The duplicate landed the moment the registry was
first generated; nobody had counted. M14 — the map *layer* — is genuinely still
open, which is what made the wrong claim plausible.

Concord NH is `state:nh/place:concord` **and**
`state:nh/county:merrimack/place:concord_city`. One city, two divisions, two
governing bodies. 32 of the 153 municipal bodies are duplicates of this kind: 3
in New Hampshire, 29 in New Jersey.

The split is exactly structural, which is what makes it fixable without matching
names — a subdivision-derived identifier nests under its county, a place-derived
one is flat:

| Layer | Divisions | AZ | NH | NJ |
|---|---|---|---|---|
| flat (`place`) | 37 | 5 | 3 | 29 |
| nested (`cousub`) | 116 | 0 | 50 | 66 |

**Resolved properly the same day — see §4.6. The read-layer `dedupeMunicipal()`
described in earlier drafts is deleted, and it had the direction wrong.**

### 4.6 M17 — FUNCSTAT, and why the stopgap was worse than the count suggested

**The brief's premise was wrong, and measuring took one request.** §4.6.0 says
Census ships the answer in "two fields already present on the source files."
They are not present in the *cartographic* files this repo uses. The full field
list of `cb_2025_*_place_500k.dbf` is STATEFP, PLACEFP, PLACENS, GEOIDFQ, GEOID,
NAME, NAMELSAD, STUSPS, STATE_NAME, LSAD, ALAND, AWATER — no `FUNCSTAT`, no
`CLASSFP`. Both exist only in full TIGER/Line.

So `scripts/fetch-districts.ts` gained an optional `tigerLayer` per district
type. Place and cousub now additionally fetch `tl_2025_<fp>_<layer>.zip`, parse
**only its attribute table**, and join `FUNCSTAT`/`CLASSFP` onto the
cartographic rows on GEOID. Geometry still comes from the generalized release;
TIGER is read for two strings and thrown away. GEOID is identical across the two
releases, so this is an exact key join rather than a name match — it matched
**100% on every layer** (467/467, 700/700, 100/100, 80/80, 564/564, 259/259),
and the script throws rather than writing a file whose governance fields came
back empty. The archives are 0.4–1.1 MB at state scale.

**FUNCSTAT is the whole answer, and it is cleaner than expected.** Across the
six clipped files: **A = 121** active governments, **S = 119** statistical,
**F = 32** fictitious. The 32 are exactly the duplicates. Census already marks
the row it created purely to fill its own geographic hierarchy; nothing had to
be inferred from which layer a row arrived in.

| Code | Means | Governs |
|---|---|---|
| `A` `B` `G` | active; partially consolidated with own officials; subordinate | yes |
| `C` | consolidated, **single** set of officials | yes, but see M18 |
| `F` | fictitious — the other layer already lists this government | **no** |
| `N` `S` `I` | nonfunctioning, statistical, inactive | no |

Registry: **297 → 265 bodies**, municipal **153 → 121**.

**The stopgap had it backwards, and that mattered more than the count.**
`dedupeMunicipal()` preferred the county-subdivision row. Concord NH is
`FUNCSTAT=A` in the place file and `FUNCSTAT=F` in the subdivision file — so the
stopgap kept the *fictitious* row and dropped the actual City of Concord. One
government either way, so the count looked right; the surviving identifier was
wrong, which is worse, because every officeholder and meeting downstream joins
on that key. New Hampshire's 221 *towns* genuinely are subdivisions, which is
what made the wrong rule look right.

**The federal check now runs on geometry, not identifiers.** After the fix a New
Jersey borough is a flat `state:nj/place:*` row with no county segment at all, so
the old ID-shaped county filter would silently miss 29 governments. The test
places each municipality by centroid containment instead:

| County | Municipalities | Census of Governments |
|---|---|---|
| Pima AZ | 5 | 5 |
| Merrimack NH | 27 | 27 |
| Morris NJ | 39 | 39 |
| + 3 counties | | |
| **Total** | **74** | **74** |

Per county, not merely in aggregate. `tests/coverage.test.ts` also asserts that
all 32 fictitious rows are suppressed and *only* those, that Concord keeps its
`A` row, and that **Rockaway borough and Rockaway township both survive as
separate governments** — the case that makes the direction of the fix visible.

Cost of the two new properties across six files: under 1 KB.

**One gap left, and it is latent rather than live.** `FUNCSTAT=C` is a
consolidated government with a single set of officials — Nashville-Davidson,
Indianapolis-Marion. The rule treats it as governing, because the alternative
deletes a real city, but a `C` place plus its county derives two bodies where one
council sits. **Zero `C` rows occur in the three clip counties**, so nothing is
wrong today; it becomes real the moment coverage expands. Tracker **M18**.

#### A regression worth keeping the scar tissue for

The first dedupe deleted the City of Tucson. It asked "does a subdivision-derived
municipal division cover this point?", and around Tucson the answer is yes —
`county:pima/place:tucson_ccd`, a statistical Census County Division with no
government at all. Reading that as evidence dropped the flat `place:tucson` and
reported **downtown 85701 as unincorporated**.

The fix is to ask whether the subdivision row produced a *body*, which is the
LSAD rule's answer to exactly this question rather than a second guess at it. The
test that would have caught it was passing a pre-filtered list of governing
divisions, so the CCDs were never present; it now passes the resolved set.

Worth the note because it is the §4.2 lesson again in a new place: the code was
reasoned about carefully, sounded right, and was wrong until it was measured
against a real point.

### 4.7 The Legistar adapter, and what measuring the vendors actually found

**The first real meeting source exists** — `lib/sources/legistar/`, tracker
**D12** — and the review that cleared it is `docs/vendor-review.md`, tracker
**D14**. Both landed 2026-08-12.

**It is not yet the app's source.** `lib/meetings/registry.ts` still resolves to
the mock, deliberately: Pima County's Legistar exposes exactly four bodies, all
Board of Supervisors variants, so switching `active` would take the map from 34
fixtures across four target zips to one county board, dropping 07866, 03255 and
most of 85701. Whether to run a composite source or hold the mock until more
clients are wired is a product decision and is not taken here.

What it does do, verified live: `pnpm ingest legistar` fetches 9 events from
`webapi.legistar.com/v1/pima/events`, normalizes 7, drops 2, and the agenda PDF
and InSite permalink on a normalized record both resolve — a 132 KB
`application/pdf` and a live meeting page. **That is the first agenda link in
this project that is not fabricated,** which is the M06 requirement that §3.1
reopened.

#### Four things that were only knowable by measuring

**Legistar's status codes are legible, and not what the tracker guessed.**
Across nine slugs: **200 open client, 403 token required, 500 not a client.**
The D12 row previously said 404/401. A bare 500 from an API that is
demonstrably live means the slug is wrong, not that the endpoint is down —
`describeStatus()` encodes this so the next person does not read an outage into
it, and the retry logic deliberately does *not* back off on 500, because
retrying asks the same wrong question four more times.

**Tucson is not a Legistar client at all.** `tucson`, `tucsonaz` and
`cityoftucson` all return 500. It runs **Hyland OnBase Agenda Online** at
`tucsonaz.hylandcloud.com/221agendaonline` — a vendor that appears nowhere in
the brief's list. It was found by following the clerk's own agenda link, which
is the 4.6.7 CMS rule earning its place: `tucsonaz.gov` is served by **Granicus
OpenCities**, so inferring the agenda vendor from the website vendor would have
concluded "Granicus, therefore Legistar" and been wrong twice over. Tracker
**D16**, and the terms say do not build it — see below.

**The API returns no coordinates.** `EventLocation` is a room name — "Board of
Supervisors' Hearing Room" — and there is no address, latitude or longitude
anywhere in the payload. So `clients.ts` carries a curated venue table in which
every entry cites the body's own page for the address and the Census geocoder
call for the coordinates, and an unknown venue **drops** the meeting rather than
placing an approximate pin. The drop is counted, never silent. This is the same
discipline as the null fixture URLs in §3.1: a pin in roughly the right place is
a fabricated citation wearing a map marker.

**Legistar has no cancellation field.** `CANCELED` is claimed only on an
explicit word in the free-text comment. The observed values on `pima` are null,
"Study Session", "Special Meeting" and "Joint Meeting" — none of them a
cancellation — so that path has no real positive to test against and the test
pins the negatives instead. A meeting wrongly marked canceled keeps someone at
home, so this must not be widened into pattern-matching.

#### 4.6.9 is real, and it was confirmed rather than assumed

Pima's Board of Supervisors meeting of 2026-08-11 (EventId 1824, 124 agenda
items) carries the headings **"BOARD OF SUPERVISORS SITTING AS OTHER BOARDS"**,
**"LIBRARY DISTRICT BOARD"** and **"SITTING AS THE BOARD OF SUPERVISORS"**. The
county board sat as the library district's board.

That is the many-to-many case the brief predicted, and it carries the 4.7.6
consequence with it: a **special district's business is inside a county feed**,
so a share of the 39,555 special districts are reachable through county feeds
already in Legistar rather than through 39,555 separate hunts. Note that Pima's
Legistar does *not* model the library district as a body — only four Board of
Supervisors rows exist — so the agenda text is the only signal there is.

`detectSittingAs()` **reports** these headings and is tested against the
recorded fixture. It deliberately does not attribute: turning a heading into a
body needs the named district reconciled back to the registry, and there is
nowhere to record the answer until `meeting_bodies` exists in Phase 5.1. Until
then a library-district vote would record as county-board business. Tracker
**D19**.

#### The vendor review, in one paragraph each

Full text in `docs/vendor-review.md`; it is not legal advice and not a
clearance, and everything touching the statutory argument is flagged for B09.

**Granicus — cleared.** Terms revised 2026-07-20, California law, scoped
throughout to "this website", and carrying **no automated-access clause of any
kind** — checked for specifically, and absent, which distinguishes it from both
other vendors. It hardly matters, because the sanctioned API returns only what
the client already marked public. Build on the API; do not scrape
`*.legistar.com` HTML.

**Hyland — do not build.** Its terms explicitly prohibit scraping, robots and
data mining, prohibit commercial exploitation, and prohibit use "to build a
competitive product or service". They enumerate five `hyland.com` hosts and do
**not** list `hylandcloud.com`, where every tenant lives — but that gap is thin
evidence to act on, and Diligent's document proves a vendor states a product
carve-out plainly when it means one. Route to the City instead: ask the Clerk,
use the City's own GovDelivery list, and note that joint Tucson/Pima meetings
already appear on `pima.legistar.com`.

> **REVERSED 2026-08-13 (D16), and the adapter is built and live.** Under the
> public-records constraint added to `CLAUDE.md`, the scope gap is
> dispositive, not thin: the terms reach no further than the hosts they name,
> the tenant host is where the records live, and the records are the City of
> Tucson's — which A.R.S. § 38-431.02 requires posted on the body's own
> website. The original conclusion above is kept because the correction is
> the useful part; `docs/vendor-review.md` has the full reversal.

**Diligent — the brief's §4.5.4 correction is confirmed at source, verbatim:**
"If there is any conflict between these Terms of Use and Diligent's standard
terms for its products and services, Diligent's standard terms will apply and
take precedence." So the website ToU is, by its own instruction, not the
governing document for a tenant portal. Not cleared and not blocked; try the
portal's subscribe channel and the district's own site first.

#### One statute finding that changes product wording

**New Hampshire does not require an agenda at all.** RSA 91-A:2 requires notice
of time, date and place; it does not require an agenda, and a body may take up
topics not on one it chose to publish. Arizona is the opposite — A.R.S.
§ 38-431.02 requires the agenda posted on the body's website 24 hours ahead —
and New Jersey sits between, requiring it "to the extent known".

The 4.6.6 coverage language says we do not have a body's calendar *yet*, which
reads as our gap. **For a New Hampshire body that can be the body's lawful
choice, and there may be nothing to find.** Misattributing a legal choice to our
own coverage is the same family of error as claiming "unincorporated" without
measuring it (§4.5). Affects 03255 and every NH body in the registry. Tracker
**D17**, wording to be decided before it is implemented.

The other statute finding is for counsel rather than for code: **A.R.S.
§ 39-121.03** requires a purpose statement for records requested for a
*commercial purpose*, permits commercial-market pricing, and permits the
custodian to ask the Governor to prohibit the request outright — with a
definition reaching "any purpose in which the purchaser can reasonably
anticipate the receipt of monetary gain from the direct or indirect use of the
public record". It probably does not reach passive retrieval of an
already-published page, since it attaches to a *request to a custodian*, but
this product's data side sells aggregates and the indirect-gain language is
broad. Flagged to **B09**, not resolved.

### 4.8 The federal officeholder roster (2026-08-12)

**Every reader in the country can now be told who represents them in Congress.**
`lib/officials/` and `lib/sources/congress/`, generated by
`pnpm officials:build` into a committed `lib/registry/officeholders-us.json` —
537 people, 429 KB. Tracker **D02**, partially: this is the roster, not the roll
calls that row is actually about.

**Built on the bulk file, not the API.** `unitedstates/congress-legislators` is
public domain, answers in one request, needs no key, has no rate limit, and is
reproducible — which is why §5.0a says to prefer bulk where one exists. **The
route does not change now that a key exists:** `CONGRESS_API_KEY` and
`FEC_API_KEY` were written into `.env.local` on 2026-08-12, after the roster was
built, and the Congress key is for the **photo path only** (D20). The roster
stays on bulk.

**`FEC_API_KEY` is deliberately unwired.** It belongs to the `FUNDING` evidence
tier, not to Phase 5, and D14 has to clear the commercial-use restriction on
contributor information under **52 U.S.C. § 30111(a)(4)** before an adapter
ships. Mixing money data into a roster also invites exactly the composite-score
failure `CLAUDE.md` forbids. The key being present is not a reason to use it.

Like the registry, this is a **committed artifact, not a table.**
`lib/db/schema.ts` is still `export {}`; the first source that needs *writes* is
meetings, not people.

#### The at-large trap, found by checking

The bulk file numbers an at-large district **`0`**. This repo — and the
canonical identifier list — call it **`cd:at-large`**. A natural
`cd:${district}` produces `cd:0`, which matches no division, and would have
**silently lost six voting members**: Alaska, Delaware, North Dakota, South
Dakota, Vermont and Wyoming.

Nothing about that is visible at four target zips, and nothing about it throws.
It was found by listing the registry's at-large identifiers next to the
source's, which took one command. `houseOcdId()` maps it and a test pins it.

This is the same shape as every other correction in this file: reasoned about
carefully, plausible, wrong until measured.

#### What the reconciliation reports

| | |
|---|---|
| Fetched | 537 |
| Senate seats | 100 |
| House seats | 437 |
| Matched to a registry `cd:` division | **431** |
| Unmatched, reported | **6** |

The six are the **non-voting delegates** — DC, Puerto Rico, the Virgin Islands,
Guam, American Samoa and the Northern Mariana Islands. Census does not publish
congressional geometry for them, so the registry has no division to attach to.
They land in an `unmatched` array with a reason, and their division links are
**not shipped**: a name rendered against a division that does not exist is
precisely the CLAUDE.md line 17 failure, and it fails silently because the name
itself is perfectly real.

**Senators attach to `ocd-division/country:us/state:xx`, and the registry has no
state-level division rows at all** — it is generated from boundary layers and
there is no state layer. That is fine rather than a gap: OCD-IDs are
hierarchical, so the state identifier is derivable from the `state:` segment of
any division resolved at a point. That is the hierarchy doing its job, not a
name-string join.

#### Two shapes that are load-bearing

**`OfficeholderDivision` is a join table, never a column.** Arizona elects two
senators to one state division, and its *legislative* districts each elect one
senator and **two** representatives. A `divisionOcdId` column on the person
breaks on Arizona immediately, before any of the harder cases.

**`partyLabel` is display-only and is the field most likely to break the
rules.** It is carried because the source publishes it and hiding it would be
less honest, not more. Nothing may infer a position, a vote, or anything about a
district from it. A test asserts the officeholder shape grows no
score/rank/rating/match/fit/grade key, so a composite score cannot arrive by
accretion.

**Photos are typed and null.** `OfficeholderPhoto` carries a `license`, and a
test already asserts nothing ships without one — the guard is in place before
the images are. D20 has the detail, including two failure modes that force
self-hosting: Congress.gov image URLs 403 on programmatic fetches, and
`theunitedstates.io` is HTTP-only, so hotlinking it from an HTTPS page is
mixed-content blocked and fails in a way the reader sees and the build does not.

### 4.9 State legislators, and the names on screen (2026-08-12)

Tier 2 (**D03**) and the rendering (§5.0 step 3) landed together, because the
rendering is what makes either tier worth having.

**`data.openstates.org/people/current/<st>.csv`, nightly, no key and no login.**
Verified live for all three states. So `PLURAL_API_KEY` is **not required for the
roster** — it is for the v3 API, which none of this touches. Data is CC-0;
attribution is requested rather than required and is carried anyway.

#### The quota is why bulk is correct, not merely tidy

Plural's free tier is **500 GraphQL requests/day at 1 per second.** 620
legislators under any per-person or per-district fetch pattern would spend most
of a day's allowance in a single build — and again on every rerun. The bulk
route costs **3 static requests, metered against nothing.**

So the build prints both counters every run, and warns past half the ceiling:

```
requests: 3 bulk (unmetered) · 0 GraphQL of 500/day
```

They stay separate deliberately. Folding unmetered static downloads into the
GraphQL count would invent pressure on a ceiling nothing is approaching, and
printing neither is how a ceiling gets discovered by hitting a 429.

**It is a quota, not a terms restriction** — it limits how we build, not whether
we may, so D03 stays cleared. `docs/vendor-review.md` records it alongside the
other three vendors, framed as the different kind of entry it is: Granicus,
Hyland and Diligent *hold a public body's records*, whereas Plural *publishes
public-domain data by choice*. There is no access question, and CC-0 leaves it
the only source in that document with no commercial-use question at all.

A test asserts `bulkUrl()` points at `data.openstates.org` and **not** the API
host, because the likely way this breaks is somebody reaching for GraphQL to
fill in term dates, which the CSV does not carry.

#### The New Hampshire trap — the at-large trap in a different costume

Plural designates New Hampshire House districts by **county and number** —
"Merrimack 8", "Rockingham 30". This repo's identifiers are Census numeric
codes: `sldl:608`. **A direct join scores 0 of 201, silently.**

The bridge is the registry's own Census-sourced *label*, which carries the
statutory designation: `sldl:608` is labelled "State House District Merrimack
08". `indexDivisions()` keys on `state|chamber|designation` and
`designationKey()` strips zero-padding so the two spellings meet.

**This is not the name-string join `CLAUDE.md` forbids, and the difference is
worth stating.** That rule is about joining *geographic entities* on colloquial
names that collide across states and drift between sources. A New Hampshire
House district's designation *is* its statutory identity; the match is scoped to
one state and one chamber, exact after normalization rather than fuzzy, every
miss is reported, and the output is keyed on this repo's OCD-IDs throughout.

#### The denominator is the point

| State | Legislators | Linked | Districts the registry holds | With someone |
|---|---|---|---|---|
| AZ | 90 | 24 | 16 | **16** |
| NJ | 120 | 21 | 14 | **14** |
| NH | 410 | 85 | 53 | **53** |

**Zero holes.** The apparent shortfall — 24 of 90 — is the three-county clip,
not a broken join, and the build prints held-against-covered per state precisely
so the two can never be confused. A raw fraction alone would read as a 73%
failure when it is complete coverage of a clipped file.

**Many-to-many, confirmed in real data rather than argued from statute.** AZ
LD19 returns one senator and **two** representatives; NJ Assembly District 25
returns two Assemblymembers; NH Merrimack 07 returns two. A one-seat-per-district
column would have had to drop half of them.

**Chamber titles are a per-state table, not derived.** New Jersey's lower
chamber is the General Assembly and its members are **Assemblymembers**. A state
with no entry reports rather than inventing a title — the same rule that stops
the body registry minting "supervisors" where a state says "select board".

#### What the screen says now

85641 went from *"We haven't sourced their names or meeting schedules yet"* to
naming all six people, each linked to their own site with a **source** link to
the record it was read from:

> AZ-6 — Juan Ciscomani · Republican
> State House District 19 — Gail Griffin, Lupe Diaz
> State Senate District 19 — David Gowan
> U.S. Senators — Mark Kelly, Ruben Gallego

The footnote **narrows** rather than blanket-claiming: it now covers only the
bodies, whose names and schedules are still unsourced. Saying "we haven't
sourced their names" beside a rendered name is its own small lie.

An empty seat renders **"no record yet"**, never "vacant". Having no record and
the seat being empty are different claims and only one of them is ours to make.

**The screenshot caught what the tests could not.** The Officials stat card read
`0` with three names rendered beside it — `computeStats` already accepted the
count and nothing ever passed it. It reads 6 now. This is the second time in two
sessions that `pnpm shoot` found something green tests missed.

**Two tests had to be rewritten, and the reason generalizes.** They asserted
that state legislative seats had no records — true when written, false the
moment Plural landed. They pinned a *moment* rather than a *mechanism*. Their
replacements assert the invariant: an unindexed division yields an empty list,
and `seatCounts.named` equals the number of seats that actually have someone.

#### Not done

**Term dates and photos.** The Plural CSV carries no term dates — those need the
API or the `openstates/people` YAML. Photos are published as URLs by both
sources and are shipped by neither, because rendering one would be a hotlink of
unknown licence (D20).

**The district popup.** §5.0 step 3 asks for the names there too. Phase 6 has not
been built, so there is no popup yet — the names live on the coverage notice
alone.

### 4.10 Phase 6 — the popup, the modal, and the marker pool (2026-08-12)

Tracker **M05** (in progress) and **M20** (done). Nine screenshots are the
evidence: meeting popup, district popup, district popup *with* representatives,
and all six modal tabs.

`.popup-card` and `.account-modal` are ported to `globals.css` as **plain CSS,
not Tailwind utilities** — 300px, 16px/18px padding, 55vh, a 5px scrollbar are
*ported values*, and burying them in a class string makes them look like
choices somebody made here. `components/map/popup/` holds the JSX. Edia builds
these as HTML strings with `escapeHtml`/`escapeAttr` and `onclick` attributes
because it is vanilla JS; that half is deliberately not ported.

#### The sourcing rule decided what goes in them

**The meeting popup's Representation section is empty, and says so.**
Officeholders attach to *divisions*; a county board or school board is not a
division, and that is tier 3, which is unbuilt.

The tempting move is to fill it with the federal and state people we *do* hold
for that area, since they share an OCD-ID. **That would be a fabricated
attribution.** A US Representative does not sit on the Pima County Board, and
putting them under that heading is the line-17 failure in its most plausible
form — every name would be real, correctly sourced, and in the wrong place.

The **district** popup does show them, because a congressional or legislative
district *is* a division. AZ-6 renders "U.S. REPRESENTATIVE — Juan Ciscomani"
with a source link.

**The Sources tab lists rows whose `sourceUrl` is null** as "no published page"
rather than omitting them. A source list that quietly drops its uncited rows is
worse than none, because it implies everything shown was cited.

#### The marker pool, and why now

`lib/map/marker-pool.ts`. The split is the point: `rebuildMarkerPool` runs when
the **data** changes and creates or removes; `applyVisibility` runs when a
**filter** changes and touches only the pins whose visibility actually flipped.
Narrowing 500 pins to 480 does 20 DOM writes, not 980. A filtered-out pin is
hidden, never destroyed.

`updateMarkerIcon` mutates an existing element rather than replacing it, because
replacing drops focus and these are real `<button>`s somebody may be tabbing
through. `applyVisibility` **returns the number of elements it wrote to** — if
that ever approaches the pool size on an ordinary filter change, the diffing has
stopped working.

Built now deliberately. At 34 fixtures it is invisible; once real ingestion
lands there is nothing small enough left to verify a rewrite against.

#### Three things the screenshots caught that the suite did not

This is the third session running where `pnpm shoot` found what 132 green tests
could not, which is the argument for §8's rule.

1. **Popups landed on top of the coverage notice.** Both were bottom-left. They
   now sit bottom-right, the one corner nothing else claims.
2. **A 40px touch target on every pin was wrong.** It is scoped to
   `pointer: coarse` — the problem is a fingertip against a 14px dot, and a
   mouse needs no help.
3. **Overlapping pins swallow each other's clicks** — tracker **M19**. Found
   because a headless click failed with one marker "intercepting pointer
   events" for another. **The first diagnosis blamed the touch target and was
   wrong:** it reproduces with that rule scoped away entirely, because the 14px
   dots themselves overlap at metro zoom. The comment in `globals.css` records
   the correction rather than the first guess.

A fourth thing looked like a defect and was not: a dark rectangle beside a
selected district is the selected fill at `0.18` opacity, working as designed.
Checking cost one command, which is the same discipline pointed the other way —
**not every anomaly is a bug, and assuming either way without looking is the
error.**

---

### 4.11 Phase 4.6.10 — somewhere to click, and who actually looked (2026-08-12)

Two changes that had to ship together, because each is half an answer. Tracker
**M21**.

#### The ladder

"Select Board — Regular Meeting, Fri Aug 14" was plain text. A reader who wanted
the Town of Newbury had no route out of the card, and the address underneath it
was inert. The app *knew* things it never offered — the body's page, the system
the record came from, coordinates precise enough to navigate by.

`lib/registry/links.ts` returns an ordered ladder — agenda, meeting record,
all-agendas portal, body homepage, directions — and **omits every rung it cannot
fill.** There is deliberately no fallback that builds a plausible URL out of a
jurisdiction name. That is the 4.5.3 fabrication wearing a different hat, and it
is worse here because a link *looks* like a promise. An empty ladder renders as
empty.

Every link is `SOURCED` or `DERIVED` **in the type**, not by convention. The only
derived rung is the OpenStreetMap directions link, built from coordinates this
repo already sourced from the Census geocoder, and it renders with a `derived`
tag beside it so it can never be read as a citation sitting among real ones.
OpenStreetMap because it needs no key and no account — nothing about the reader
is traded for the link — and because `CLAUDE.md` rules out Google Maps.

#### The audit, and the default that was lying

Every one of the 265 derived bodies read `NO_SOURCE_FOUND`, and that single value
was doing two opposite jobs: *we walked the ladder and there is nothing to find*,
and *nobody has ever looked*. The second was true of essentially all of them,
because `NO_SOURCE_FOUND` was simply what the derivation wrote.

So `CoverageStatus` gained `NOT_ATTEMPTED` and `SOURCE_BLOCKED`, and
`NO_SOURCE_FOUND` became **a claim requiring evidence** — an audit row in
`lib/registry/coverage-audit.ts` recording an exhausted hunt. Today:

| Status | Bodies |
|---|---|
| `NOT_ATTEMPTED` | 258 |
| `KNOWN_UNCOVERED` | 6 |
| `SOURCE_BLOCKED` | 1 |
| `NO_SOURCE_FOUND` | **0** |

Zero is the honest number and the one worth staring at. Nobody has ever walked
the ladder to exhaustion, so nothing may say so.

Seven real hunts are recorded, every rung including the misses, each with the URL
it was read from. `build-registry.ts` overlays them and **throws** on an audit row
whose `bodyId` matches nothing, because a stale identifier otherwise leaves a body
looking unlooked-at forever. What the overlay does *not* touch is `bodyOrigin`,
`name`, `sourceDataset` and `provenance` — the first version set `bodyOrigin` to
`SOURCED` and `tests/registry-oracle.test.ts` caught it. **Finding a body's
website does not make the body's existence a sourced claim.** That stays
structural and the name stays null, on all 265 rows.

#### Three things the hunts overturned

1. **Vail Unified is NovusAgenda, not Diligent** — tracker **D13**, **D22**. The
   Diligent adapter was scoped as covering TUSD *and* Vail. It does not. Vail's
   own Governing Board page links to `vailschools.novusagenda.com`. The
   `go.boarddocs.com` URL that search results assert is Vail's is **dead in a
   real browser**, and it stays in the audit as a `MISS` rather than being
   deleted — so the next session cannot rediscover it and record it as fact.
   This is D16's lesson repeating exactly: infer a vendor from anything but the
   body's own page and you get it wrong.

2. **The fixture-to-registry join was broken and silent** — tracker **D15**. Five
   of eleven in-clip fixture divisions matched *nothing*: the fixtures carried
   flat identifiers (`state:nh/place:newbury`) while the registry nests and
   suffixes (`county:merrimack/place:newbury_town`). Tucson and the three
   counties happened to match, so the popup looked right in Arizona and simply
   had no body link in New Hampshire, with nothing logged anywhere. **The
   silent zero-match join, third occurrence.** The test now asserts the match
   count *and the denominator*, and names the deliberately out-of-clip Cochise
   divisions explicitly, so a clip can never read as a broken join and a broken
   join can never hide behind "probably the clip".

3. **A feed can return 200, the right content type, and nothing at all.**
   Newbury's `/rss.xml` is a valid RSS document with zero items. Status code and
   content type both say success. Only the body says otherwise — §8's rule
   again, in the place it is easiest to skip.

**CivicWeb is not CivicPlus.** Different companies, confusingly similar names:
CivicPlus builds CivicEngage and the AgendaCenter (Rockaway Township), while
CivicWeb is iCompass, *a Diligent brand* (Newbury). They are separate
`AgendaSourceType` values, because folding them together points one adapter at
two unrelated systems.

---

### 4.12 Phase 4.6.9 / D19 — who actually acted (2026-08-12)

`Meeting.ocdId` is one field, and a meeting can have more than one government in
it. Pima's Board of Supervisors meeting of 2026-08-11 carries "BOARD OF
SUPERVISORS SITTING AS OTHER BOARDS", then a board's name, then "SITTING AS THE
BOARD OF SUPERVISORS". The business in between belongs to that other board.
Without a join, all 124 items record as county-board business.

`lib/meetings/attribution.ts` splits an agenda into the bodies that acted, and
`MeetingBody` is written as the table it will become so the Phase 5.1 migration
is a transcription rather than a redesign.

**Headings are detected by the absence of a matter file, not by capitalisation.**
Legistar attaches a matter file to anything with a legislative record behind it,
so that one field separates business from section titles without depending on a
clerk's house style — "CALL TO THE PUBLIC" is shouted in capitals exactly like
the real switches are, and correctly starts nothing.

**An unresolved heading attributes to nothing, and never to the host.** This is
the whole discipline of the file. The host is the one body we can already see is
*not* responsible — the agenda said so in capital letters — so falling back to it
recreates the precise error the row exists to prevent. Attributing to nobody is a
smaller, truer claim.

#### What measuring found that the tracker row had not

**Pima sat as two special districts that day, not one.** Alongside the Library
District Board there is an **Ajo Domestic Water Improvement District**. Four
segments, 49 items of business, two of them attributed to nobody.

Both resolve to `UNRESOLVED`, and **that is the correct answer rather than a
failure.** Census publishes no boundary for a special district, so the registry
holds no division for either and nothing can honestly be matched. The segment is
recorded as unresolved with its published heading as evidence, which is exactly
the row a later curated-body pass needs.

It is also the 4.7.6 thesis showing up early: a large share of the country's
~39,555 special districts sit inside county feeds *already in Legistar*, rather
than behind 39,555 separate source hunts. Reaching them needs the items told
apart once they arrive, which is this.

#### A conservation law, and the drop it caught

Every item with a matter file must land in **exactly one** segment. The first
version skipped items with an empty title before attributing them, which lost the
single Pima item that has a matter file and no title: 49 in, 48 out, no error
anywhere. The count alone reads fine; the count against its denominator does not.
§8's rule, in the place it is easiest to skip.

Resolution is scoped hard — a candidate body must sit inside the host's own
division *and* the heading must contain its division label — and a test asserts
that a heading naming another county resolves to nothing. Widening that is how a
heading match turns into the name-string join `CLAUDE.md` forbids.

**Still open:** nothing persists the rows (`lib/db/schema.ts` is still
`export {}`), and the adapter does not fetch event items during an ordinary
ingest, so this runs against the recorded fixture rather than in the live path.

---

## 5. Open questions

### 5.1 Vector tiles — RESOLVED 2026-08-12

**Fixed. Kept here because the original diagnosis below was partly wrong, and
the correction is the useful part.**

There were **two independent causes**, and fixing either alone would have left
the map looking broken.

**(1) The worker.** The Turbopack-specific diagnosis below is too narrow.
`maplibre-gl` 6 locates its worker at *runtime*:

```js
function bi(){ let e = import.meta.url; … return new URL(`./${t}`, e).href }
```

That is a template built from a variable, not the static
`new URL("./w.mjs", import.meta.url)` form any bundler rewrites — so **webpack
fails identically**. Verified rather than assumed: `next dev --webpack` yields
the same zero-`.pbf` result and the same MIME-type error, which is what ruled
out the "just use webpack" escape hatch.

The fix is `scripts/build-map-worker.mjs`: an esbuild step bundling the worker
and its shared sibling into one self-contained 461 KB
`public/maplibre-gl-worker.mjs`, wired to `predev`/`prebuild` so it regenerates
on every `maplibre-gl` upgrade. The output is **gitignored** — a committed copy
is exactly the thing that goes stale. The script asserts the bundle has no
unresolved imports left and fails the build if it does.

**(2) The district overlay had a second cause that would have survived the
worker fix.** Attachment waited on `map.once("idle")`, and `idle` requires
`style.loaded()`, which requires *every* source to report loaded. The MapTiler
styles declare a `maptiler_attribution` source that is a vector source carrying
only an attribution string — no `url`, no `tiles`, no layer referencing it. It
has nothing to fetch, so it never reports loaded, `map.loaded()` is never true,
and `idle` never fires. Attachment now keys on `getStyle().layers`, the only
precondition `addSource`/`addLayer` actually have.

**A measurement trap worth remembering.** `.pbf` requests originate *inside* the
worker and are invisible to main-thread resource timing, so `pbf=0` cannot
distinguish a dead worker from a throttled render loop. Tile bucket state is the
reliable signal. Related: MapLibre renders on `requestAnimationFrame`, which
browsers stop delivering to an occluded tab — a genuinely working map reports
zero rendered features if the window is covered.

---

**Original diagnosis, 2026-08-11, retained for the record:**

The chain:

1. `maplibre-gl-worker.mjs` (18.2 KB) is **not self-contained**. Its first
   statement is `import{…}from"./maplibre-gl-shared.mjs"` — the 470 KB module
   holding MapLibre's shared internals.
2. Turbopack copies the worker into `/_next/static/media/` **byte-for-byte**
   (verified by file hash), treating it as a static asset rather than a module.
   The literal specifier `./maplibre-gl-shared.mjs` is never rewritten.
3. Turbopack *does* emit the sibling — but content-hashed, as
   `maplibre-gl-shared.<hash>.mjs`.
4. So the worker requests an unhashed `./maplibre-gl-shared.mjs`, which **404s**.
   Module evaluation fails; the Worker fires an `error` event with an empty
   message, which MapLibre does not surface anywhere.
5. **In MapLibre, vector tiles are fetched from inside the worker.** With the
   worker dead, zero `.pbf` requests are ever made. Confirmed by resource
   timing: `style.json` ✅, `tiles.json` ✅, `sprite.json`/`sprite.png` ✅,
   `.pbf` **0**.

Everything downstream follows: `tilesLoaded=false` forever, no `load` event,
`renderedFeatures=0`, and only the background layer painting.

Two earlier "fixes" were both wrong about the cause and neither helped:

- `setWorkerUrl("/maplibre-gl-worker.mjs")` + vendoring the worker into
  `public/` — this replaced a 404 on the *worker* with a 404 on the worker's
  *dependency*, since only the one file was copied. Same symptom, different
  line.
- `prewarm()` for the Strict Mode double-mount — a real concern, but not this.

Candidate fixes, cheapest first:

1. **Vendor both files** into `public/` (`maplibre-gl-worker.mjs` +
   `maplibre-gl-shared.mjs`, ~489 KB) so the relative import resolves. Works
   without touching the build, but pins two minified files that drift on every
   `maplibre-gl` upgrade.
2. **Pre-bundle the worker** into one self-contained file (esbuild, as a build
   step) and point `setWorkerUrl` at it. Cleaner; adds a build step.
3. **Downgrade to `maplibre-gl` 5.x**, which inlines the worker as a blob and
   has no sibling-import problem. Costs an API migration — v6 dropped the
   default export and `map-canvas.tsx` is written against v6 named imports.
4. **Report upstream.** This is arguably Turbopack's bug (raw-copying an `.mjs`
   asset containing unrewritten relative imports) and arguably MapLibre's
   (shipping a worker entry that is not self-contained). Either way it will hit
   every Next 16 + maplibre-gl 6 project.

**Outcome:** option 2 shipped. Option 1 was rejected as stale-on-upgrade, and
the framing of this list as "a Turbopack bug" was itself wrong — see the
correction above. Reporting upstream (option 4) is still worth doing and has
**not** been done; it is MapLibre's runtime worker-URL derivation that no
bundler can follow, so the report belongs there.

### 5.2 Everything else

1. ~~**Which real meeting source lands first?**~~ ~~**Answered 2026-08-12:
   Legistar.**~~ **Fully answered 2026-08-13: the composite.** Four zips
   across three states admit no single vendor, which settled
   composite-versus-hold-the-mock. `lib/sources/composite/` is the app's
   active source, fanning out over legistar, civicplus, onbase, apptegy and
   diligent children — §9.
4. ~~**What is the persistence design?**~~ **Scheduled, no longer
   indefinitely open (2026-08-13):** persistence (D10), search logging (A06)
   and the transparency page (T01) ship together next session, none alone.
   The composite deliberately runs from memory with a short TTL, which D10's
   row already permits.
5. ~~**Where are the actual product constraints?**~~ Resolved: `CLAUDE.md` is
   present and intact (9.9 KB). §3.5 still applies as a fragility warning.

8. **Do the sub-congressional OCD slugs match the canonical list?** **Answered
   2026-08-12, and the answer is no.** Checked against
   `opencivicdata/ocd-division-ids` (194,977 identifiers) the same way the
   congressional ones were. `state:az/school_district:*` matches nothing at
   all — the canonical form nests under county and suffixes the name
   (`state:az/county:pima/school_district:tucson_unified_district`). New Jersey
   places nest under county; New Hampshire's do not. Full evidence in §4.3.

   This is no longer a "verify before Phase 5" item — it **blocks the Phase 4.6
   body registry**, because `bodies.ocdId` is the join and building it on keys
   known to be wrong hands Phase 5 a broken join. Deciding the convention is
   tracker **D15**. The open question is which way to go: adopt the canonical
   shape wholesale (a rebuild of every committed boundary file, and it is not
   clear the canonical list covers NJ townships), keep this repo's shape as an
   internal key with a reconciliation table mapping to canonical, or something
   between. The choice is the author's — it is hard to reverse once officeholder
   and meeting rows carry the key.
6. **Should road labels be toned down?** At z14+ `basic-v2-dark` draws road
   labels at `#c2c2c2` (luminance 0.538), marginally *brighter* than the amber
   pins (0.523). They are absent at metro zoom, so this only matters if readers
   routinely zoom in three levels.
7. **When does the districts/officeholders rung get built,** and from which
   geometry and officeholder sources?

---

## 6. Known rough edges

**`CLAUDE.md` is fragile.** See §3.5 — it was clobbered once by Next
scaffolding and restored.

~~**README describes the pre-workaround behaviour.**~~ Fixed 2026-08-11. The
README now documents MapTiler as the only tile source, no keyless fallback, and
a "Basemap unavailable" notice when the key is missing, plus a section on the
generated map worker.

~~**The vector path still has `resolveBasemap()`'s OpenFreeMap fallback.**~~
Removed. `resolveBasemap()` returns null without a key.

~~**`public/maplibre-gl-worker.mjs` is a vendored copy.**~~ It is now a **build
artifact**, regenerated by `predev`/`prebuild` and gitignored, so it cannot
drift on upgrade. `public/**` remains excluded from ESLint because the generated
minified file still lives there.

~~**The map error handler swallows unrecognized errors.**~~ Fixed. It now logs
**every** MapLibre error and filters only which ones raise a user-facing notice.
That change paid for itself twice in Phase 4, surfacing an invalid `line-width`
expression and a duplicate-layer loop that were both otherwise silent.

**`pnpm-lock.yaml` carries pre-existing specifier drift.** Three entries
(`dotenv`, `drizzle-kit`, `tsx`) record different version *ranges* than
`package.json` declares. Resolved versions are identical, so nothing is
functionally wrong, but `pnpm install` rewrites those three lines and they show
up as an uncommitted change. This predates the current work.

~~**Coverage is 27 zips.**~~ Resolved: 33,144 ZCTA centroids, `complete: true`.
That also makes the `uncovered` failure mode unreachable today, which is
correct — `resolveZip` only reports it when the table is partial.

**Meeting fixtures still cover four zips.** Boundary data now covers three whole
counties, so a reader can click districts in places that have no meetings behind
them. Honest, and the coverage tier says so, but the asymmetry is new.

**Map-layer test coverage is still thin.** 315 tests (2026-08-15) now cover the cascade, time
handling, OCD identity, the tier axis, district disambiguation, fixture
provenance, county subdivisions and the registry oracle. Nothing tests marker
reconciliation, camera logic, or basemap resolution — which is part of why the
tile problem was found by eye rather than by suite.

**No test drives a React component.** Both Phase 4.5 radius bugs lived in the
store and would have been caught by a component-level harness; today the
components are only ever checked by screenshot. Tracker **M13**.

**`cousub-*.geojson` is built and committed but not drawn.** Merging it into the
municipal layer would render some governments twice — every New Hampshire city
is both a place and a county subdivision, and under the current conventions
those are two different identifiers. Tracker **M14**, which waits on D15.

**The registry does not get that reprieve, and an earlier version of this file
said it did.** `build-registry.ts` reads every file in `public/geo`, so the
place/cousub duplicate has been in `registry.json` since it was first generated
— 32 governments counted twice. M14 is the map layer and is still open; the
registry side is tracker **M17**, and §4.5 has the evidence and the interim
workaround.

**Editing map layer code needs a full reload, not HMR.** The MapLibre instance
is created once on mount and its layers are added imperatively. Hot-replacing
`lib/map/districts.ts` swaps the module but leaves the *already-added* layers on
the live map, so a fixed paint expression does not take effect and the old
errors keep firing from a page that is running new source. This cost real time
once: 18 errors (6 district types × 3 attach attempts) kept appearing in the
Next overlay after the underlying bug was already fixed and committed. If a map
error persists after a change that should have fixed it, hard-reload before
believing it.

**Legacy Tailwind colour aliases remain.** `globals.css` maps the old
ink/paper/signal names onto the new tokens in a marked block, so components not
yet rewritten keep rendering. They should be deleted as those components are
replaced.

---

## 7. Current state of the branch

**Working on `claude/nh-nj-depth-0815`** (2026-08-15, fourth session of
the day), branched from `main` at the PR #37 merge — the session §27
records: the state folders and the zip playbook born (R20), the adapter
window that dropped sixty days of history at every zip (M76), Rockaway's
other two boards and the calendar category that hid them (M77), Morris
Hills Regional and the published-annual-schedule shape (M78), the two NH
hosts that refuse this pipeline (M79, In progress), LegiScan and the join
that fails silently (D49), the four doors reopening the challenger sweep
(D50 round 5, 590 → 592), the street input that asks instead of only
refusing, and the CORS wall the walk found under it (M80). M81 — the
jurisdiction badge — deferred whole and named, nothing half-built.
**test 556 pass · lint clean (5 pre-existing warnings, 0 errors) · build
exit 0**, the two-zip walk `tester-walk-0815c` with zero failures and one
BLOCKED that names its reason.

**Previously: `claude/party-meetings-faces-0815`** (2026-08-15, third
session of the day), branched from `main` at the snapshot-refresh commit
after the PR #36 merge — the session §26 records: party for local
partisan bodies from certified results (M62), the day-not-hour meeting
shape and both archives ingested (M59), the Census geocoder (D53), the
author's three production defects (M72, M73, M74), the challenger photo
sweep that shipped nothing and the doctrine question it raised (D50
round 4), and the future-date inventory split into its two species
(R16). **test 533 pass · lint clean (1 pre-existing warning) · build
exit 0**, the four-zip walk `tester-walk-0815b` green with zero
failures. M75 recorded, not built.

**Previously: `claude/counters-meetings-photos-0815`** (2026-08-15),
branched from `main` at the PR #34 merge — the session §24 records: the
sidebar counters (M57), concluded meetings and the dead Concluded chip
(M58), the mojibake and the two more the scan found (M60), party on the
who-governs card (M61), the uncontested-race answer (M63), and photos
round 3 (D50, 535 → 590 of 750). **test 503 pass (22 new) · lint clean
(1 pre-existing warning) · build exit 0**, the four-zip walk
`tester-walk-0815` green at 60 of 60 with zero console errors.
M59, M62, D51 and D52 recorded, not built.

**Previously: `claude/date-integrity-and-context-mirror-0814`**
(2026-08-14, seventh session of the day), branched from `main` at the
PR #33 merge — the session §23 records: the stamp rule and its four
guards (R14), `context.md` as the seventh mirror file (R15), and three
findings recorded but deliberately not fixed (R16–R18). **test 476 pass
(3 new) · lint clean (1 pre-existing warning) · build exit 0**, the date
scan reporting 1026 dates scanned / 0 failures / 88 allowlisted hits of
117 declared. All five fabricated stamps in `CLAUDE.md` were recovered
from git plus the session transcripts and corrected; the file now
carries no future date. No product surface was touched.

**Previously: `claude/fec-cache-and-question-box-0819`** (session label
`0819`, wall clock 2026-08-14), branched from `main` at the PR #26 merge
— the session §17 records: the
FEC replication fix (D40, the gate), self-funding labels + the photo rule
(D41/D42/D43), the 3-series copy/UI batch (M38–M45), incumbent record
links (B10), and the ask box v1 (A09). **test 391 pass · lint clean (1
pre-existing warning) · build exit 0**, the four-zip walk19 green with
zero console errors. The paragraphs below describe earlier sessions'
branches and are kept as the historical record they were.

**Previously: `claude/restore-representation-session-0814`** (2026-08-14),
branched from `main` at the PR #20 merge — the session §11 records:
regression fix (M23), D28/D29 curated overlay, S2 ballot, M24/M25 defect
fixes, this document set. **test 250 pass · lint clean · tsc clean · build
exit 0.**

**Previously: `claude/composite-source-and-reprioritization`** (2026-08-13),
branched from `main` at the PR #18 merge. This is the session that retired the
mock: the composite is the app's active source and all four target zips return
real meetings at the exact tier — see §9 for the reprioritization it happened
under. **test 197 pass · lint clean · tsc clean · build green.**

The paragraphs below describe the previous session's branch and are kept as
the historical record they were.

**Previously: `claude/link-ladder-and-coverage-audit`**, branched from `main`
at `c94aa9c` (the PR #17 merge). Four commits.

**test 162 pass · lint clean · tsc clean · build green.**

```
dbe4602  Correct two tracker rows that named branches which never existed
cfae75f  Decide the New Hampshire agenda wording       ← D17
226b6cd  Attribute agenda items to the board that acted ← D19, §4.12
42478ba  Give every meeting somewhere to click          ← M21, §4.11
```

**One branch carries all three pieces, and two commit messages say otherwise.**
`226b6cd` and `cfae75f` name `claude/meeting-bodies-join` and
`claude/d17-nh-agenda-wording`. Neither branch was ever created — the session
stayed on the first branch after the first commit and the messages were written
from intent rather than from `git`. The tracker rows are corrected in `dbe4602`
and say so in place; the commit messages themselves are left alone rather than
rewritten, because the correction is more useful visible than tidied away. It is
the same slip D03 records, and it is caught the same way: by asking git rather
than trusting the last thing written down.

What landed: the link ladder and the body coverage audit (§4.11), the agenda
attribution join (§4.12), and the D17 New Hampshire wording. It also corrected
the mock fixtures' division identifiers, which had never matched the registry
for New Hampshire or New Jersey — a join that had been silently matching nothing
since the registry was first generated.

Four PRs landed on 2026-08-12, in this order:

```
8ee9bdb  Merge PR #16 — Phase 6: popup, modal, marker pool   ← M05, M20, §4.10
d3fe6c1  Merge PR #15 — the quota paragraph #14 missed
ac79b33  Merge PR #14 — Plural's 500/day quota recorded      ← D03, §4.9
1568adf  Merge PR #13 — Legistar, vendor review, roster      ← D12, D14, D02
4f5d2ae  Merge PR #12                                        ← where the day started
```

What that added, in one line each:

- **D14** — `docs/vendor-review.md`, one finding per vendor plus the statute
  question. Granicus cleared, Hyland refused, Diligent escalated to B09. §4.7.
- **D12** — the Legistar adapter, verified against the live `pima` client. Not
  yet the app's source; `registry.ts` still resolves to the mock. §4.7.
- **D02, D03** — the federal and state officeholder rosters, both from
  public-domain bulk files, both rendered on screen with their sources. §4.8,
  §4.9.
- **M05, M20** — the popup card, the six-tab modal, and the marker pool. §4.10.
- Opened **D16–D20** and **M19–M20**.

**Two commits went straight onto `main`** — `9af2fbc` and `59fd858`, the
officeholder rendering and Plural. The session had checked `main` out to read a
test count after shipping #13 and never branched again. Tests, lint and build
were green before each, but neither passed through a PR. Recorded because the
tracker briefly named a branch that never existed, and `78cbb9c` corrects it.

Everything earlier — Phase 4.6.6, the FUNCSTAT fix, the session lifecycle work
(M16, M17, R07–R10) — is also in `origin/main`.

**An earlier session opened on a repo that looked empty, and that is worth
knowing because it will happen again.** The working tree was on `main` at `64fee33` —
the initial "Add files via upload" commit, carrying only `CLAUDE.md`. No `app/`,
no `lib/`, no `docs/`, no `package.json`. Nothing was lost: `origin/main` was 26
commits and 118 files ahead, local `main` held zero unique commits and was a
strict ancestor, and no untracked file collided with a tracked path, so
`git merge --ff-only origin/main` restored it losslessly.

The cause was structural, not a one-off. `pnpm handoff --ship` merged the PR
through `gh` and left the session on the feature branch; nothing ever
fast-forwarded local `main`. So it fell a whole session behind every time, and
the next person to check it out saw an apparently empty project. The plain
`handoff` check could not catch it either — it compared the branch against its
own upstream and `main` against the branch, but never local `main` against
`origin/main`.

**Fixed 2026-08-12, tracker R07.** `--ship` now fast-forwards local `main` after
the merge, using `git fetch origin main:main` — it moves the ref without
touching the working tree and refuses anything that is not a fast-forward, so a
diverged `main` is reported rather than flattened. From `main` itself it is a
`--ff-only` merge, since git rejects that fetch form for the checked-out branch.
The plain check reports a stale local `main` as a warning with the command to
fix it, `pnpm session:start` checks the same thing before work starts (R10), and
`git-state.txt` records it in the mirror (R09).

Three surfaces now report it and one fixes it, which is deliberate: this failure
is silent by nature and cost a session before anyone noticed.

The older pattern still applies and is the same family: a PR merges from a
snapshot, so anything pushed after it was opened is left behind silently. That
stranded two commits after PR #2. **Check what `main` actually has rather than
trusting the last thing this file said about it.**

`.env.local` is gitignored and holds the MapTiler key,
`NEXT_PUBLIC_MAPTILER_STYLE=basic-v2-dark` and
`NEXT_PUBLIC_MAPTILER_STYLE_LIGHT=basic-v2`. The key appears in no commit in the
history — verified before pushing.

### The port from EdiaStratMap

Phases 0–4 of a port of `github.com/SeanEdia/EdiaStratMap`'s visual language and
interaction patterns, so this repo is a shell its author already knows how to
modify. Ported: the token system and both themes, DM Sans + JetBrains Mono, the
340px sidebar, the tier view toggle, cascading scope selectors, stats, search
with autocomplete, radius and near-me controls, filter groups, the legend, the
count badge, the list overlay, and the welcome card.

**Not ported, and deliberately so:** Leaflet, vanilla-JS `innerHTML`
construction with `escapeHtml`/`onclick` attributes, and the sales data model.

### Where the phases stand

> **Phase standings updated 2026-08-13 (§9):** the mock is no longer
> `active` — the composite serves real meetings in all four zips. Phase 4.7's
> build work is **suspended until after November**, except 4.6.4
> (`agendaSourceType` routing), which is retained as the national hook because
> it is what makes adding a body a registry row instead of a code edit.
> **Phase 8 (responsive, mobile bottom sheet) is promoted from deferred to
> required** before the product is shown to anyone — a reader deciding in a
> parking lot is deciding on a phone. The list below predates that and stands
> as history.

- **0–4 done** — worker, design system, shell, welcome overlay, district
  overlays with click-to-select.
- **4.5 done** — the four defects found in testing. §4.2.
- **4.6 mostly done.** The registry is generated and tested (§4.3, §4.4), the
  coverage language is on screen (§4.5, M16), the place/cousub duplicate is
  resolved at build time from Census `FUNCSTAT` (§4.6, M17), and the link ladder
  and coverage audit are in (§4.11, M21). What remains: populating
  `agendaSourceType` for the *other 258* bodies (4.6.4 — seven now carry one
  from a real hunt), the `meeting_leads` table (4.6.5), and the reader
  disambiguation prompt (4.6.3), which is approved as of 2026-08-12 with
  device-local storage. The "I want this" control and `demandCount` (4.6.3a)
  are still unbuilt and still have no table to write to.
- **The meetings track has started.** D14 (the vendor and statute review) is
  done and D12 (the Legistar adapter) is built and verified live, though not yet
  the app's source — §4.7. D13 (Diligent) is unblocked but should try the
  subscribe channel and the district's own site before the portal. D16 (Tucson,
  which is Hyland OnBase and not Legistar) says do not build the portal route.
- **Phase 6 popup and modal are built** (§4.10) — the popup card, the district
  and meeting popups, the six-tab modal including Sources, and the marker pool.
  Phase 7 (notes, activity, conflicts, export, ingestion console) and Phase 8
  (responsive, bottom sheet) remain.
- **4.7 not started** — national scale: vector tiling, the Census of
  Governments universe, vendor tenant enumeration, special districts.
- **Phase 5 tier 1 is done** — the federal roster, §4.8. Tier 2 (state
  legislators, Plural Open) is unblocked and takes the same shape. Neither
  needed a database, and neither has been rendered yet.
- **5–8 remain** — officeholders and the first real tables (which extend the
  registry rather than replacing it), popup and full-screen modal, the ported
  subsystems (notes, activity tracker, elections layer, conflicts, export,
  ingestion console), and responsive.

Two bodies the oracle names that the derivation **cannot** produce, and they are
the interesting output rather than a failure: **Pima County Supervisor District
4**, because Census does not publish county supervisor districts at all, and the
**Southeast Regional Council**, because it is not a division and never will be.
Both need the bodies-without-divisions path — the schema already allows it via a
nullable `Body.ocdId`, and nothing populates it yet.

---

## 8. Picking this up next

**The repository is `C:\Users\seanj\dev\we-the-people`** and always will be.
Check `CLAUDE.md` is roughly 10 KB before doing anything — §3.5 explains why, and
`pnpm session:start` now checks it for you.

### The two bookends, and what they have in common

`pnpm session:start` runs first, `pnpm handoff` runs last. Between them they
check five things, and **every one of them is a state that lies quietly if you
do not look:**

| What | How it presents | What it actually is |
|---|---|---|
| stale local `main` | an empty repo | R07 — `main` a session behind (now also *fixed* by `--ship`, not just reported) |
| clobbered `CLAUDE.md` | a repo with no constraints | overwritten by scaffolding |
| stale dev server | a working build | last session's build on 3000 |
| unsynced mirror | nothing at all | the orienting docs gone stale |
| unmerged branch | work that is "done" | work only on this machine |

None of the five announces itself. Each presents as a plausible working state
that happens to be the wrong one, and the first three have each cost this
project a session already. That is the argument for a scripted check at both
ends rather than a habit of looking.

### Working rule: verify the result, never the absence of an error

**Confirm a scripted edit landed by grepping for what it was supposed to
produce. A string replacement that matches nothing succeeds loudly and changes
nothing.**

`sed`, a scripted `String.replace`, a regex rewrite over a doc — all of them
exit `0` on zero matches. There is no error to notice, so the only signal that
the edit worked is the edit itself, and checking for it costs one command.

This is the same shape as the five states above, one level down: not an
environment that lies, but an *operation* that reports success for having done
nothing. **It has now happened repeatedly in this project**, in different
disguises (later sightings: the tail-masked exit code and the NovusAgenda
200-with-zero-meetings HIT, both §10; the officials panel, 2026-08-14):

| Instance | Presented as | Actually |
|---|---|---|
| The raster basemap fallback | a styled dark map | the vector style never loaded — §5.1 |
| Zero-match identifier joins | a clean build | `cd:0` and NH `sldl:` matching nothing — §4.8, §4.9 |
| The dev server on another port | a working page | last session's build on 3001 — the `predev` guard |
| PR #14's documentation gap | a green ship | a `String.replace` that matched nothing |
| The tail-masked exit code | build green | `\| tail -3` reporting tail's status, not the build's — §10 |
| NovusAgenda's empty archive | a wired source (HIT) | 200 with zero meetings, recorded as working — §10 |
| **The officials panel at the exact tier** | a clean demo with real meetings | the only surface rendering representation (`coverage-notice.tsx`) returned null on `exact`; the composite made every zip exact, so 537 federal officials and three state rosters left the page with every test green. Guarded now: the render gate lives in `lib/registry/representation.ts` and `tests/representation.test.ts` holds it against the committed rosters — a panel whose store is populated may not render nothing. 2026-08-14, M23 |
| **The district-type checkboxes with the overlay off** | broken checkboxes ("no lines change when selections are made") | the state→render path was measured working at production's exact commit — check, uncheck, select all, clear, both themes, all four zips. What reproduced: with "Show districts" off, the group stayed fully interactive and every click changed state with zero visible effect — a *state change* no initial-render guard could see. Guarded now: the intent rule and the drawn-types derivation live in `lib/state/district-intent.ts`; touching the group turns the overlay on (except clear), and `tests/representation.test.ts` holds both. 2026-08-14, M27 |

The first three are now guarded by code — `resolveBasemap()` returns null rather
than substituting, the officeholder builds print matched-against-held counts,
and `predev` refuses the port. The fourth is a habit, because there is no
sensible way to make every text edit self-checking.

So the habit, stated plainly:

- **After a scripted edit, grep for the new text.** Not for the absence of an
  error, and not for the file's mtime. Note that these files are **CRLF** and
  prose wraps, so a phrase that spans a line break needs
  `tr -d '\r' < file | tr '\n' ' '` before matching — a zero from a naive grep
  is itself ambiguous, and checking which kind of zero it is takes one command.
- **After a build that reconciles two datasets, print the match count** — and
  the denominator beside it, or a clip reads as a failure and a failure reads as
  a clip (§4.9).
- **After a visual change, `pnpm shoot`.** The Officials stat card read `0`
  beside three rendered names with 117 tests green; only the screenshot caught
  it. Screenshots are evidence, not confirmation — take them expecting to find
  something.

The general form: **an operation that can do nothing must be asked what it
did.**

### Working rule: a MISS is dated, and failures are recorded before the ship

**A recorded MISS is a fact about one attempt — this URL, this method, this
date — never a verdict about the record.** Failing Tuesday does not mean
failing Thursday: sources come online, sites get rebuilt, feeds get
populated. Any hunt older than ~30 days is presumed stale and worth
re-running before its misses are believed. Staleness is checkable, not
remembered: every audit record in `lib/registry/coverage-audit.ts` carries
`attemptedAt`, and the consolidated MISS list in `docs/source-ladder.md`
dates its entries.

And before any handoff ships: **every approach that failed this session goes
into `source-ladder.md` or this section**, in enough detail that a future
session can either avoid it or deliberately retry it. An unrecorded failure
will be paid for twice — once when it happened, and once when the next
session rediscovers it from scratch.

### Starting a session: `pnpm session:start`

```
pnpm session:start            check, then start the dev server
pnpm session:start --check    report only, start nothing
```

**Then read `docs/defects.md` before anything else** (since 2026-08-14):
it is the author's production scratchpad. Triage anything new into tracker
rows and mark each entry with the row ID it became — the author types
observations; the session does the bookkeeping.

Three checks, then it brings up the dev server through `pnpm dev` — through the
package manager deliberately, so `predev` runs and regenerates
`public/maplibre-gl-worker.mjs`.

```
  ok   main         local main matches origin/main
  ok   CLAUDE.md    10.1 KB, intact
  ok   port         3000 is free
```

1. **Local `main` is not stale.** Fetches, compares against `origin/main`, and
   on a miss prints the commit count and the `git merge --ff-only origin/main`
   that fixes it. This is R07: `handoff --ship` merges the PR through `gh` and
   leaves the session on the feature branch, so nothing ever fast-forwards local
   `main`. It is why the repo once opened looking empty (§7). A *diverged* `main`
   — commits on both sides — is reported differently and does not get a
   fast-forward suggestion, because `--ff-only` would refuse.
2. **`CLAUDE.md` is roughly 10 KB.** Under 1 KB, or containing only
   `@AGENTS.md`, means it was clobbered: stop, **do not reconstruct it from
   memory**, restore from the mirror. The command is printed, and it says so
   loudly if the mirror is not reachable either. Outside 8–14 KB is a warning
   rather than a failure, since the file legitimately grows.
3. **Port 3000 is free**, then start the dev server.

It exits non-zero on any failure, same contract as `handoff`. `--check` is the
form a hook wants, since the plain form ends in a server that never exits.

### The dev server

`pnpm dev` writes the `next dev` pid to `.dev-server.pid` in the repo root
(gitignored) and removes it on any exit it lives to see. A `-9` leaves the file
behind, so every reader checks the pid is alive rather than trusting the number.

Two details that are not obvious and were measured, not assumed:

- **The pid that holds the socket is not the pid in the file.** Next runs the
  server in `start-server.js`, a *grandchild* of `next dev`. Measured on
  2026-08-12: file recorded 5544, port 3000 held by 5816. So a kill must take
  the tree (`taskkill /T /F /PID <pid>`), and "does the file match the occupant"
  is a descent test, not `===`. An identity test would report this repo's own
  server as a stranger's and withhold the kill that works.
- **`pnpm dev` runs Next under node directly**, not through the `.cmd` shim. The
  old `"dev": "next dev"` put `cmd.exe /d /s /c next dev` between pnpm and Next,
  and killing a shim on Windows can orphan what it launched.

`predev` **refuses to start when 3000 is in use** rather than letting Next slide
to 3001. It prints the occupying pid, whether it is this repo's own server, and
the command to kill it. Sliding to 3001 is the failure worth preventing:
`scripts/shoot.mts` targets a fixed `http://localhost:3000`, so every screenshot
would be of the old build — and of the old map worker, since `predev` is where
that bundle is regenerated and a server that never restarted never regenerated
it. The check runs before the worker build so a refusal costs nothing.

`pnpm handoff` stops the dev server before syncing the mirror, as its own
checklist line. Non-fatal when nothing was running, and it will not kill a
process on a guess: something on 3000 with no matching `.dev-server.pid` is
reported as foreign, with the pid and the kill command, for a person to decide.
**If the port is still held after the kill it fails and exits non-zero** — a
handoff that reports the session closed while something is still serving is a
false report, which is worse than no check.

### Ending a session: `pnpm handoff`

Run it last. It checks the five surfaces that have to agree, and does the two
jobs that are pure copies:

```
pnpm handoff            check, sync the mirror, export transcripts
pnpm handoff --check    report only, touch nothing
pnpm handoff --ship     the above, then push, open a PR, merge it, and
                        fast-forward local main
```

**Say "session ending — start handoff"** and the whole close happens: `state.md`
is brought current, the tracker rows are updated, then `--ship` runs. The next
session starts on a merged `main` with nothing outstanding.

```
  ok   working tree    clean
  ok   branch          matches origin/<branch>
  ok   main            carries everything on this branch
  ok   main tree       identical to the local tree
  ok   local main      matches origin/main
  ok   pull requests   none open
  ok   git state       git-state.txt written to the mirror
  ok   dev server      pid 5544 stopped, port 3000 free
  ok   mirror          5/5 identical
  ok   transcripts     4 exported
```

It exits non-zero when something needs fixing, so it can gate a hook later.
Without `--ship` it only reports on push, PR and merge rather than doing them.

**`--ship` will not commit for you.** A commit needs a message saying *why*, and
generating one from a diff produces exactly the uninformative history the
tracker rules exist to prevent — so it refuses on a dirty tree and says so. It
reuses an open PR rather than opening a second one for the same branch, and it
re-fetches after merging to confirm `main` really took everything, because a PR
merges from a snapshot and has twice left later commits behind.

**`--ship` closes both ends of the branch's life** (R07). It pushes `-u` for a
branch that has no upstream yet, rather than refusing — a branch created this
session having no upstream is the normal case, and refusing meant the first
ship of every session failed until someone ran `git push -u` by hand. And it
fast-forwards local `main` after the merge, so the session ends on refs that
agree. Both ends had assumed a branch that already existed on the remote and a
local `main` that somehow kept itself in step.

Two behaviours worth knowing, both learned the hard way:

- **It fetches first.** Every count is meaningless against a stale remote, and
  twice in one session a branch-state claim in this file was wrong because it
  was written before a fetch.
- **It refuses to overwrite a diverged mirror file.** If a mirror copy matches
  neither the working tree nor the last commit, it holds something the repo does
  not, and copying over it would lose that. It says so instead.

`WTP_MIRROR` overrides the G Drive path for a machine with a different drive
letter.

State as of 2026-08-12, verified rather than assumed:

- **R07 is fixed.** `--ship` fast-forwards local `main` and pushes `-u` for a
  branch with no upstream; the plain check and `session:start` both report a
  stale local `main`. If the repo ever still looks empty, it is not — §7.
- **315 tests, lint, tsc and build all pass.** (Updated 2026-08-15; was 281 the day before.) M16, M17, M21, R07, R09, R10,
  D14 and M20 all Done with evidence in the tracker. D02, D03, D12 and M05 are
  **In progress** with the evidence recorded and the reason each is not Done
  stated on the row — the Legistar adapter is not the app's source, the rosters
  do not carry votes, and the popup has no direct marker path yet. D19's join is
  built but nothing persists it; D17's wording is decided but renders for
  nobody, because no hunt has been exhausted.

  **`git-state.txt` reads this line, so a stale number here becomes a false
  report in the mirror** — it did once, reporting 79 after the suite had reached
  107. The count lives in three places in this file (§1's command table, §6's
  coverage note, and here); update all three or the lowest one wins.
- R10 added `pnpm session:start` and the dev-server lifecycle. It found a real
  stale server on its first run: a `next dev` from 4:06 PM still serving after
  that session's handoff, which is the gap it exists to close.
- R09 added `git-state.txt`, so the mirror is now seven files: six copied, one
  generated — `vendor-review.md` joined on 2026-08-12 with D14. It carries no tests — it is a handoff script, not app code, and the
  suite does not reach it. Verified by running it against a scratch mirror and,
  for the behind path, a throwaway clone with local `main` reset back.
- The G Drive mirror and `transcripts/` are current as of the end of that
  session.

**External sources are cleared.** The author approved building adapters against
**Granicus Legistar, Diligent Community/BoardDocs, Congress.gov and Plural
Open** on 2026-08-12, which satisfies the CLAUDE.md ask-before-adding gate for
those four. Recorded on tracker rows D02, D03, D12 and D13. It is clearance to
build — it is **not** a D14 vendor-and-statute finding and it does not answer
B09, both of which still stand on their own.

~~**The next piece of work is D14 → D12.**~~ **Both done 2026-08-12** — §4.7,
and `docs/vendor-review.md`. **Tucson's slug is no longer unknown either: there
isn't one.** Tucson is not a Granicus client; it runs Hyland OnBase Agenda
Online, found by following the clerk's own agenda link exactly as the 4.6.7 CMS
rule says. Hyland's terms forbid the portal route, so D16 goes to the City
instead. Do not spend another request guessing Tucson slugs.

**The next piece of work, in the order it should be taken** (superseded
2026-08-13 by the reprioritization — §9; the earlier list is preserved in git
history):

1. **Next session: persistence, search logging and the transparency page
   together** (D10 + A06 + T01, item 3 of the reprioritization). They ship
   together or not at all — collecting silently and disclosing later is the
   failure this product cannot survive. The two-store constraint and its
   tests are already in place; the meetings vintage column decided in §9
   lands with this schema.
2. **Then the 4.6.3 reader prompt** — approved, wording supplied verbatim in
   the reprioritization document, device-local storage settled. Compute the
   counts in the template (report what 85641 actually resolves to); picker
   first, street where the picker cannot help, neither gated on the other.
3. **The session after: the ballot build, then the candidate corpus** —
   curation per jurisdiction into the shape `docs/ballot-research-2026.md`
   describes, behind a MeetingSource-style contract (§0a). The corpus comes
   after the ballot because the ballot says which candidates matter.
4. Standing errands whenever a browser is at hand: the Kearsarge calendar id,
   Newbury's other bodies, the Merrimack calendar XHR, the Morris County
   venue citation — `docs/source-ladder.md` has the queue.

**What still needs the author** (updated 2026-08-13 — D15 is decided and the
4.6.3 wording has been supplied, so the earlier two-item list is done):

1. **The V-block (V01–V06) and C01** — buyer calls, Locunity, the mock
   export. All P0, all genuinely the author's work, none started.
2. **The drafted letters** (`docs/email-diligent-legal.md`,
   `docs/email-tusd-clerk.md`) — sending is the author's call; either reply
   moots part of B09.
3. **D08's pricing call** — Democracy Works licensing terms and cost; the
   research is done, the phone call is not.
4. **B08** — the separation agreement, before signing.

---

## 9. The 2026-08-13 reprioritization — four zips are the product

Recorded the day it took effect. The full directive lives with the author;
this is what changed and why, for a session reading cold.

### Why

The product exists to answer four questions for an ordinary person: what is on
my ballot, what do these measures actually say, where do the people on my
ballot stand on what I care about, and what is happening near me that I do not
know about. Only the fourth had been built, and it had been built on fixtures.

There is a hard date. The general election is **2026-11-03**, and the product <!-- expected-future: general election day; verified against lib/ballot/election-dates.ts, which carries it per state with the election authority's own URL. Read 2026-08-15. R16. -->
has to be useful from about October 1 — which decides scope: **depth in four
zips beats breadth everywhere.** 85701 Tucson AZ, 85641 Vail AZ, 07866
Rockaway Township NJ, 03255 Newbury NH are no longer a test set. They are the
product.

### The election dates, verified at the states' own sites (2026-08-13)

Full sourcing in `docs/ballot-research-2026.md` Part A. Plan against these,
not against approximations:

### The 4.6.3 narrowing prompt — the approved wording, verbatim

Supplied by the author 2026-08-14 (session brief item 0b), recorded here so
M26 can never again be blocked on a missing record. This is the chosen copy —
build against it exactly; do not paraphrase, do not improve it.

> 85641 covers 4 municipalities and 4 school districts. Do you want to
> narrow it?

On yes:

> What's the street you live on? That will help us narrow it for you — no
> house or apartment number needed.

The counts in the template are computed, never literals — report what the
zip actually resolves to. The ambiguity trigger is computed too: no prompt
where the answer would not change what is listed. Spec as previously
approved: device-local only (`useSyncExternalStore`, keys
`wtp.selected_divisions` and `wtp.selected_street`), never transmitted,
never tied to an account; the yes/no entry point makes declining the default
path; picker first where it can resolve, street where it cannot; neither
path gated on the other; whatever is not narrowed stays fully listed; street
index built offline from TIGER, nothing leaves the device.

| State | Registration deadline | Mail ballots go out | Early voting |
|---|---|---|---|
| Arizona | Oct 5, 11:59 p.m. | Oct 7 | begins Oct 7; mail-ballot requests until Oct 23 (azsos.gov 2026 election info + calendar; pima.gov) |
| New Jersey | Oct 13 | Sep 19 (VBM mailing begins, 45 days out) | in person Oct 24 – Nov 1; sample ballots mailed by Oct 21 (nj.gov official 2026 timeline PDF) |
| New Hampshire | no fixed statewide deadline — town clerk up to 6–13 days out, or same-day at the polls | no universal mail voting; absentee-by-excuse only | none in person (sos.nh.gov) |

The product must therefore be *complete for these zips* by mid-September:
New Jersey voters start receiving live ballots **September 19**.

### What is suspended until after November

The national build: Phase 4.7's work (vector tiling, Census of Governments
universe, vendor tenant enumeration, national payloads, the special-district
pipeline), M12 (school overlay split), M18 (FUNCSTAT=C, latent with zero C
rows in the clip), D20 (portraits and term dates), Tier 3 curated locals
except bodies on the four zips' ballots, and any adapter for a body that does
not serve one of the four zips. Suspended rows keep their place in the tracker
with priority lowered and a note — never deleted, never marked Done.

**Not suspended: 4.6.4**, the `agendaSourceType` routing, because it is the
mechanism that makes adding a body a registry row rather than a code edit —
built this session as `lib/registry/source-wiring.ts` plus the composite's
capability map.

### Why the national constraints stay while the national build stops

Avoiding rework at scale was the entire reason Phase 4.7 was designed before
4.6 finished. Everything built for the four zips must work unchanged at
90,837 local governments: curation is an adapter, not a literal (§0a — the
venue cache and comment-access rows are curated *into the shape a feed
fills*); adding a body never means editing code (§0b); venue geocoding is a
cache keyed on `(sourceId, rawLocationString, bodyOcdId)` (§0c); nothing
assumes geometry is a committed file (§0d); every division carries a
vintage-bearing `sourceDataset` and a test asserts it (§0e — the
redistricting trap, unfixable later); provenance survives at scale (§0f —
distribution verified: 940/940 divisions TIGER_GENZ2025, 265/265 bodies
DERIVED); townships are first-class (§0g); special districts arrive through
county feeds (§0h).

**One §0e decision recorded rather than taken:** meetings are transient this
session (in-memory, short TTL), so no meeting row yet persists a division key
across a redistricting boundary. When the meetings table lands (next
session), it carries a division-vintage column from day one. Cheaper to
reverse than to guess: no downstream rows exist yet to inherit a wrong shape.

### What the session produced

The composite build (§5.2 item 1 answered), agenda documents as append-only
first-class records, ten recorded source hunts with two corrections (Vail's
NovusAgenda tenant is an empty pre-2017 archive; Tucson's Hyland conclusion
reversed and built), the public-records / no-recommendation / two-store
constraints in CLAUDE.md with their guard tests, SOURCE_BLOCKED removed, the
D17 gating split, M14 rendered, GEOID retained, per-body comment access
curated and rendered, and the ballot/candidate research recorded in
`docs/ballot-research-2026.md`. Phase 8 (responsive, bottom sheet) is
promoted from deferred to **required** before the product is shown to anyone.

The live gate the whole session was pointed at, measured 2026-08-13:

| Zip | Meetings | Tier | Sources |
|---|---|---|---|
| 85701 | 5 | exact | onbase 2, diligent 2, legistar 1 |
| 85641 | 3 | exact | apptegy 3 |
| 07866 | 5 | exact | civicplus 3, apptegy 2 |
| 03255 | 1 | exact | civicweb/diligent 1 |

Real meetings, no fixtures, screenshots in `screenshots/composite-<zip>.png`.
Bodies still without a wired source: Morris County and Morris Hills Regional
(07866); Merrimack County and Kearsarge Regional (03255) — all four have
recorded hunts and named next steps in `docs/source-ladder.md`.

### The brief is stale on phase ordering

`claude-code-brief-map-rebuild.md` lives outside the repo and was not present
on this machine or the mirror at the time of this reprioritization, so its
status table could not be updated. **It is now stale on phase ordering —
Phase 4.7 is suspended, Phase 8 is required — and this file is authoritative
over it**, which is what the brief's own precedence rule already says.

---

## 10. The 2026-08-13 deploy-and-demo session

The session that turned the branch into something a tester can open on a
phone. Branch `claude/deploy-snapshot-and-demo`, PR #20. Everything below is
committed and verified; **test 226 pass · lint clean · build exit 0**
(verified by exit code — see the working-rule note below).

### The deploy, pinned

Netlify project `sparkwtp` was already connected and deploying on
autodetected settings. What was wrong with those settings was exactly one
thing: the build ran the image's global pnpm while the repo pins pnpm
10.33.0. `netlify.toml` now pins the build command
(`corepack enable && corepack pnpm run build`), Node 24, and the publish and
functions directories. **Verified from the deploy log for `458755e`, not
from the green line**: "Installing npm packages using pnpm version 10.33.0"
(install side) and the pinned command echoed (build side). The unlisted
posture is platform-level visibility plus `robots.txt` disallow-all and
`X-Robots-Tag: noindex` on every route from both `next.config.ts` and a
`netlify.toml` header rule. No app-level gate exists, deliberately.

The deploy pipeline also proved itself mid-session: the one commit whose
local "build green" claim was false (see below) failed its deploy preview
with the same error, and the correction went green.

### The snapshot — production never fans out

The composite's live fan-out cannot ship: five serialized vendor fetches
outlive a serverless timeout, and a fetch per visitor against a public
body's portal is the rate degradation `CLAUDE.md` forbids. `pnpm ingest
composite` now writes `data/meetings-snapshot.json` — generatedAt,
per-source counts and failures, meetings, append-only agenda documents —
and the app reads the file. Committed so the build is deterministic, agenda
changes are diffs, and a failed refresh leaves the last good snapshot
serving stale-but-honest data. `lib/meetings/snapshot.ts` is the only
module that knows the path (the 90,000-government version swaps that module
for a store, nothing else). The validator refuses a snapshot whose sources
do not state integer counts — the count invariant as mechanism, now also
written into `CLAUDE.md`'s non-negotiables. The reader always sees "Last
checked" (`data-freshness.tsx`), and a failed source is attributed to the
bodies it serves in the coverage notice. Refresh: GitHub Actions cron every
six hours, committing to main only when the file changed;
`WTP_MEETING_SOURCE=composite` keeps the live fan-out for local work.
Current snapshot: **66 meetings from 7/7 sources, 16 agenda document
versions**.

### The two county adapters, and what the second pass found

`iqm2` (Morris County) is built on `Citizens/Calendar.aspx?From=&To=` — the
ladder had recorded the RSS pseudo-feed, but the calendar page is
server-rendered with the *forward* schedule, and its row tooltips publish
the venue with street address, which closed the venue-citation browser
errand without a browser. `revize` (Merrimack County) reads the homepage
upcoming-meetings block for meetings and matches agenda/notice PDFs by
filename date; the county's own notice PDFs decoded "OCH - Concord" to
163 N. Main St. **A measurement overturned a recorded claim, preserved in
the audit row**: the earlier note said both Merrimack bodies meet in
Boscawen — the Board in fact alternates venues per meeting, so venue rows
key on observed strings only and anything unobserved drops counted.

Gate movement: **07866 went 5 → 11 meetings**. 03255 holds at 1 on the
exact rung because Merrimack meets ~33 km out — the widened-rung exerciser,
as designed.

### Tucson depth: what the hunts returned

PCC's governing board is a live Diligent tenant
(`pima.community.highbond.com`, service verified) — one wiring row from
live, blocked only on the registry having no division for a community
college district. That identifier decision is deliberately not taken here:
tracker **D28** holds the options. The city's dozens of boards need a
second-body-per-division convention (**D29**) plus an HTML adapter; RTA and
PAG are not Legistar clients (verified beside a control); tucsonaz.gov
publishes no machine feed (four endpoints 404). All rungs recorded in the
ladder and audit. Comment access: honest UNKNOWN rows for both new county
boards.

### Persistence (D10) and the vintage, as implemented

Three tables in `lib/db/schema.ts` with a generated migration: `meetings`
(keyed on the source-namespaced id), `agenda_documents` (append-only,
`meetingId@contentHash`), `search_log`. **Every `ocd_id` column is paired
with a NOT NULL `division_vintage`** — the §0e decision as columns, guarded
structurally in `tests/db-schema.test.ts` along with: no identifier column
and no foreign keys on the search log, and no ranking vocabulary in any
column name. Adapters do not write yet; meetings serve from the snapshot.

### Search logging and /transparency, together

The log writes: SEARCH server-side from `/api/meetings` (zip as
`approximate_location`, resolved OCD-IDs with vintage, tier/radius/count),
and MEETING_OPENED / BODY_OPENED / DISTRICT_SELECTED / FILTER_APPLIED from
the client through `POST /api/log`. No identity by construction — schema,
write-path fragment rejection, and a client that sends no cookie and mints
no id. `/transparency` shipped in the same commit, scoped honestly to an
unlisted demo, linked from the welcome overlay and the sidebar footer.
`tests/search-log.test.ts` makes the coupling structural. **Author step for
production logging: set `DATABASE_URL` in the Netlify environment and run
`pnpm db:migrate` against Neon once.** Until then `/api/log` answers 202
accepted-not-stored and nothing breaks.

### Phone width, and the landing state

Below 640px the sidebar is a slide-over drawer behind a 44px toggle, the
map takes the whole screen, the meeting panel is a bottom sheet pinned to
the viewport edge, popups span the width, and the legend hides (decision:
three stacked cards on a six-inch screen; revisit if a tester asks what
the pin colors mean). The welcome card now names the four covered places
as one-tap buttons, says what comes back, and states coverage honestly.
Gate met with screenshots of all four zips at 390×844 plus the
welcome/drawer/sheet states (`scripts/phone-states.mts`).

### Session-open now starts the server it used to only guard

`session:start`'s port check kills a stale dev server it can attribute to
this repo (pid-file match) instead of failing; a foreign occupant still
fails. After starting, it waits for `/` to actually serve, then verifies
the pid holding the port descends from the child it spawned and prints the
HEAD sha served. The end-of-session kill in `handoff` stays.

### Two working-rule sightings, preserved

- **The tail-masked exit code.** `corepack pnpm build 2>&1 | tail -3`
  reports tail's exit status, and a commit recorded "build green" on the
  strength of it while the build had failed. Caught one commit later
  (and independently by the deploy preview failing); the correction is its
  own commit. Verify a build by its exit code, never through a pipe.
- **Tree-shaking hid a client-graph leak.** Client value-imports of
  `RADIUS_LADDER_KM` reached `node:fs` through query.ts → the meeting
  registry → the snapshot source. The production build shook it away and
  went green; the dev server, which does not shake, panicked on every
  request. The boundary is now structural (`lib/meetings/constants.ts`).
  A green build is not evidence about the dev server, or vice versa.

### Decisions taken as cheaper-to-undo, with the rejected alternative

- Snapshot keeps only succeeding sources' meetings on a partial refresh
  (rejected: carrying a failed source's stale rows forward as if current —
  the silent-fallback shape).
- Agenda retrieval stays capped at 8 per run, prioritized toward meetings
  with no stored document (rejected: raising the cap — politeness first,
  and the 6-hour cadence converges).
- The legend hides at phone width (rejected: repositioning it above the
  sheet — three stacked cards).
- Foreign processes on port 3000 still fail session:start rather than
  being killed (rejected: kill-anything — we do not kill what we cannot
  attribute).
- OnBase's PHA board and joint meetings stay dropped-and-counted
  (rejected: guessing City Hall — a pin in roughly the right place is a
  fabricated citation wearing a map marker).

---

## 11. The 2026-08-14 regression-and-restoration session

Branch `claude/restore-representation-session-0814`. Ran unattended under
the standing rules plus one the author fixed for every trade: **correct
first, fast second** — now a constitution section in `CLAUDE.md`.
**test 250 pass · lint clean · tsc clean · build exit 0** on every commit.

### The regression: success in meetings deleted representation

The author found production thinner than the build before it — the 537
federal officials, the state legislators and the governing-body list were
not reaching the page. Diagnosed before touching anything, against a local
production build of the deployed commit (production itself is 401-gated to
every plain client — that is the unlisted posture working):

| Surface | 85701 | 85641 | 07866 | 03255 |
|---|---|---|---|---|
| Meeting list | intact (4, exact) | intact (3) | intact (11) | intact (1) |
| District overlays | intact (119 feats) | intact (82) | intact (116) | intact (73) |
| Officials/representation panel | **absent** | **absent** | **absent** | **absent** |

The API shipped 6 named officials per zip; nothing rendered them. **Cause:**
`coverage-notice.tsx` — the only surface rendering representation —
returned null on the `exact` tier, a gate present since the first map
commit. Invisible while the demo zips sat on widened/gap rungs; the
composite serving real meetings made every zip exact and silently deleted
the officials with every test green. Not the node:fs boundary, not
tree-shaking, not the registry rewiring, not a dropped prop — all four
prime suspects checked out clean (the Netlify function trace includes every
data file; the route returns full coverage).

**Fix and guard:** the render gate moved to `lib/registry/representation.ts`
where `tests/representation.test.ts` holds it against the *committed*
rosters and geometry — a panel whose store is populated may not render
nothing, at any tier, at any of the four zips. Same-shape guard for the
district overlays (every layer's committed file must hold features). The
notice now renders on exact as "Who governs here" with an all-wired lead;
amber stays reserved for failure rungs. Sighting added to §8's table.

### D28/D29 as decided: no identifier minted, bodies first-class

`Meeting.ocdId`, the wiring rows and the venue-cache key all admit null; a
null-division meeting is local-tier by construction (`tierForMeeting`); the
convention question moved whole to tracker **D31** with this session's
evidence in it. New `lib/registry/curated-bodies.ts` overlay (58 rows,
checked at build): PCC's Governing Board live through the existing diligent
adapter, the PHA Board (its own agenda proved the Mayor and Council sit as
its board in the M&C Chambers — venue cited to that agenda), and all 56
boards/commissions in the Tucson Clerk's own directory, names verbatim.

The find that unlocked meetings: the Clerk's directory renders nothing to a
plain client because it embeds `clerksboards.tucsonaz.gov` — which
server-renders every board page (schedule, location, current agenda) to
this project's polite UA. The new `clerksboards` adapter expands the
Clerk's published schedules (two grammars; anything else drops counted;
cancellation only from the Clerk's own "(Canceled)" agenda title). Five
boards wired live with cited venues; 51 KNOWN_UNCOVERED. Registry: 940
divisions, **323 bodies**. Coverage language now splits governing bodies
from advisory ones so "N bodies govern" never counts a committee.

The four-zip gate after the refresh — **85 meetings from 8/8 sources**,
85701 now visibly the deepest zip (the author's demo):

| Zip | Meetings | Tier | Sources |
|---|---|---|---|
| 85701 | **17** (was 5) | exact | clerksboards 10, diligent 4 (incl. PCC 3), onbase 3 (incl. PHA) |
| 85641 | 3 | exact | apptegy 3 |
| 07866 | 11 | exact | iqm2 6, civicplus 3, apptegy 2 |
| 03255 | 1 | exact | diligent/civicweb 1 |

### S2: the Morris County ballot shipped (September 19 is the clock)

`/ballot?zip=07866` renders every contest a Rockaway Township voter sees on
2026-11-03, curated from the county clerk's own filed-candidate PDFs into <!-- expected-future: general election day. R16. -->
`data/ballot/nj-morris-2026.json` behind a `BallotSource` contract parallel
to `MeetingSource` (D08's national feed becomes a source swap): US Senate
(4 candidates), US House NJ-11 (3), County Commissioner (2), Rockaway Twp
BOE vote-for-2 plus unexpired (4), Morris Hills Regional's Rockaway seats
(2) — and two **cited absences**: the clerk's own "NO LOCAL ELECTION" for
the township, and no statewide public question as of the state's 07/27
update. The NJ date strip (VBM mails Sep 19, registration Oct 13, early
voting Oct 24–Nov 1) cites the state's official timeline PDF and is shaped
for AZ/NH next. Neutrality: alphabetical order (the clerk's ballot-position
drawing is a scan with no text layer — recorded miss), incumbency null
(the filing does not state it), guard tests extended to the ballot shapes
*and* the committed JSON, and the transparency page now says: ballot
information is presented as filed; we never suggest how to vote.

### The defects intake, and the first two fixes

`docs/defects.md` is the author's standing production scratchpad (mirrored
to Drive): dump observations freeform; the next session triages into
tracker rows and marks each line. **Session-open step: read it first.**

- **M24 — "Reset all" did not work.** Two compounding faults: the handler
  reset only `filters` while five control groups had grown around it, and
  the active-count treated the *default* district-type view as active — so
  a fresh page read "Filters 1" and the button visibly did nothing. Fix is
  structural: `lib/state/reset.ts` is a registry of resettable controls;
  reset and the badge derive from it; `tests/reset-registry.test.ts` fails
  the build when a `UiState` field arrives unregistered. Reset means
  return-to-default-view and never closes selections. "Show districts"
  stays a persisted preference, declared with its reason.
- **M25 — district types gained "select all" / "clear"** in the existing
  link style. The default view stays three types; Reset all returns to it.

### S1 deferred, and why that is recorded rather than hidden

Tracker **M26**: the approved verbatim wording for the 4.6.3 prompt is not
in the repo (state.md says it lives in the author's reprioritization
document), and substituting wording the author specifically approved
differently would violate the build-exactly-as-recorded instruction. The
session brief's own cut order ranks the ballot above S1, and the ballot
shipped. **Author step: paste the approved wording into this file (or
commit the reprioritization document) and M26 unblocks.**
*(Resolved 2026-08-14, the following session: the author supplied the
wording in the session brief and it is now recorded verbatim in §9. M26 is
unblocked and can never again be blocked on a missing record.)*

### Also in this session

- The retry rule is now a working rule in §8: a MISS is a dated fact about
  one attempt, hunts older than ~30 days are presumed stale, and every
  failed approach is recorded before a handoff ships. `attemptedAt` already
  dates every audit record, so staleness is checkable rather than
  remembered.
- Ladder gained the 2026-08-14 rung set: the embedded frame's own host, the
  UA-sensitive bot wall, OnBase `ViewDocument` behind the `Downloadfile`
  interstitial, the body's own agenda PDF as venue citation, the statutory
  annual Public Notice Statement, and published-schedule-as-feed.
- One extraction failure recorded honestly: OnBase's PHA agenda stored with
  `extraction: failed` because the `Downloadfile` URL serves a JS
  interstitial to non-browsers; readers get the working link in a browser,
  and switching the adapter's agenda link to the `ViewDocument` form is a
  small open improvement noted here rather than silently fixed.

### Decisions taken as cheaper-to-undo, with the rejected alternative

- Representation renders always on exact (rejected: a separate sidebar
  officials panel — two surfaces reading the same store drift).
- The who-governs card is uncollapsed on phone (rejected: collapsing —
  wait for a tester to say it crowds; the author asked for restoration).
- PHA and PCC boards carry `bodyClass: GOVERNING` as governing boards of
  their own entities; curated rows tag by class, derived rows by division
  type (rejected: minting a new class — D31's question, not this session's).
- The Joint M&C/Pima meeting stays dropped-and-counted (its venue varies
  per meeting — the Merrimack lesson).
- "Show districts" excluded from Reset all as a persisted preference
  (rejected: threading reset through the localStorage hook).
- S1 deferred with the author step recorded (rejected: shipping substituted
  wording).

---

## 12. The 2026-08-14 second session — the friction constitution, and the product becoming reachable

Branch `claude/restore-representation-session-0814` (continued), seven
commits. **test 281 pass · lint clean · tsc clean · build exit 0**, each
verified by exit code and screenshot per change.

### The constitution (0a/0b)

- **The friction rule is CLAUDE.md's third non-negotiable**, with its four
  exceptions enumerated by number so a change claiming one can be checked
  mechanically: (1) the capture-point transparency disclosure, (2) the
  narrowing prompt's optionality, (3) consent to collection, (4) coverage-gap
  honesty. Everything else goes.
- **M26's approved wording is in §9 verbatim** — it can never again be
  blocked on a missing record — and the prompt is now built against it (below).

### M27 — the "dead" district checkboxes (eighth sighting, §8's table)

Diagnosed before fixing: the state→render path measured **working** at
production's exact commit, every variation. What reproduced: with "Show
districts" off, the checkbox group stayed live and every click changed state
with zero visible effect. Fix is intent — touching the group turns the
overlay on (except "clear"), the rule pure in `lib/state/district-intent.ts`,
the guard family extended to the state-change path.

### M28 — the friction batch, 2a–2j in one pass

Google-Maps directions (universal link); the ballot bubble top-right, same
tab, zip attached, following the settled viewport, honest coming-soon (now
retired — all three states covered); the sidebar one pattern at every width;
dots colored by government level with split-ring mixed venues and the legend
back at phone width; the who-governs card shrinking to a recoverable fab on
engagement; scroll-and-settle rebuilt (gesture-only, debounced, guarded,
camera never fought, `nearZip` resolved server-side, the search log staying
zip-level); coverage sentences inverted to lead with what we track. Headless
note: Playwright's mouse-drag never ends MapLibre's drag (`isMoving` sticks
true — harness artifact); wheel and keyboard gestures exercise the same
`moveend` path and were the verification route.

### D32 — officials become people you can reach

Contact on the rosters (state email/phone via the CC-0 bulk; federal was
present); 8 of 10 wired federal portraits from the GPO pictorial directory
with license recorded per image and both misses recorded with reasons
(member-courtesy images are unknown-license and unknown is not clearable);
the rep popup (photo/initials, contact links, official page, campaign site
labeled as such, what-this-office-does); office blurbs as tested data in the
author's register; `campaignUrl` curated with per-entry verification (10
verified, misses in the ladder).

**The statement corpus is filling**: `lib/corpus/types.ts` +
`pnpm corpus:fetch` — 30 of 32 targets snapshotted (official pages and
campaign sites for all 22 wired officials), append-only, content-addressed.
**The change-marker design constraint is recorded for next session's
position rendering**: every displayed position carries its "last checked"
date; when a source's current snapshot differs from a prior one, the surface
shows a visible "this page changed since we last checked" marker with the
prior date and, as rendering matures, access to what it said before. The
never-characterize rule applies to change too — the surface says THAT it
changed and shows both records, never an interpretation. **Positions are not
rendered yet**: the three-answer machinery (matched / searched-and-nothing /
not-yet-collected, denominators attached) is next session's first item, and
bio rendering waits with it.

### D33 — the Arizona and New Hampshire ballots (S3)

Pima County from the SOS candidate filing with primary-stage honesty (the
July 21 primary is canvassed, the general list unpublished, so every filed
candidate renders with a computed narrows-when note — never a news-reported
nominee); eleven statewide measures carrying the Legislative Council's
adopted analyses with official question text honestly pending; the cited
absence of a Senate race. Merrimack County through the UA-sensitive bot
wall: the open Senate seat (13 filed; Shaheen not running), the two-seat
House district, five county offices, and **the November finding stated as
the system working** — town and school matters decide at the March town
meeting, cited to the SOS political calendar. `BallotSet.coverageNotes`
carries our own gaps distinctly from authority absences; a per-state ballot
registry closes 2e.

### D02 — the votes corpus (federal roll calls)

`lib/votes/` + `pnpm votes:fetch` + committed snapshot: 20 rolls per
chamber, identifier sets compared before trusting (100% both chambers,
preserved in the artifact; the Senate keys on LIS ids and
legislators-current.json bridges), official bill titles from Congress.gov
with the title's source recorded per vote. **A caught wrong number**: the
first run shipped a party subtotal as the House tally (roll 264, 76–136 vs
the real 76–350) — the last `yea/nay-total` pair is the chamber total, and a
test pins it. The rep popup's Recent Votes: official words first, four
unmistakable states, the chamber's result, links to the roll call and the
bill's official summary, a legend saying the colors state *their vote*.
Refresh is manual; wiring into the six-hour cron is open. **State roll
calls (research note)**: AZ (apps.azleg.gov per-bill floor votes), NJ
(njleg.state.nj.us per-bill lists), NH (gc.nh.gov per-bill tables) — all
server-rendered, none verified machine-readable; each needs its own hunt.

### M26 — the narrowing prompt, built

The TIGER ADDRFEAT street index (91,923 edges across the three counties,
midpoints resolved against the registry geometry) writes per-zip files for
exactly the 123 zips where the answer would change — the trigger and the
template's counts are computed (85641: 1 municipality + 3 school districts;
07866: 3 + 4, the borough-vs-township picker rendering the identifier
lesson). The approved wording verbatim and test-pinned; declining
effortless; the street matched on-device against a downloaded list — the
two approved localStorage keys, a no-network test on the hook, the
transparency page extended. Narrowing filters the who-governs card per
type; whatever is not narrowed stays fully listed; visible undo.

### A08 — the routing knowledge base (no UI, by design)

Nine cited topic routes on the office blurbs and registry body types; a
pure `resolveRouting(topic, coverage)` grounding steps in real bodies and
rosters with the denominator carried; refusals as tests (unmapped topic →
the stated refusal; thin area → gaps stated, nothing guessed; a real body
with no roster says which half is missing); the author's two golden cases
pass against the real Tucson registry. Party cannot enter routing —
mechanically tested. **The chat surface needs, before it ships**: the
abuse-policy gates for a free-text entry, an explicit logging decision
disclosed on the transparency page before launch, and topic matching that
never silently maps an unmatched concern.

### Also recorded

- The OFFICIAL_OPENED search-log event was deliberately NOT added — a new
  event type extends the transparency page's disclosure, which is the
  author's call. Open question on D32's row.
- Committed leftover `lib/state/defaults.tmp.txt` removed; two pre-existing
  lint warnings cleaned.
- The background-agent route died twice with the host process mid-session;
  research was completed inline. Worth knowing before delegating hunts.

---

## 13. The 2026-08-15 session — the sensor turns on, and the product speaks plain language

Branch `claude/reactions-and-plain-language-0815`, seven commits plus a
cron merge. **test 315 pass · lint clean · tsc clean · build exit 0** on
every commit, each verified by exit code; screenshots per change. The
brief is committed at `docs/session-brief.md`; the host process died three
times mid-session (all on browser-heavy steps — the last driving
results.arizona.vote), and each resume worked from the last commit
forward. Browser-heavy work goes last, and documents beat portals.

### P03 — reaction capture, whole (the first user-writable surface)

"Do you like this vote?" Yes/No/Unsure on every federal roll-call row,
one reusable control keyed by target type + id (votes wired; measures and
agenda items later). The `reactions` table is the third collection store:
identifier-free like the search log, tier-stamped from row one
(`ANONYMOUS`; `LOCALITY_VERIFIED`/`VOTER_MATCHED` designed into the enum),
divisions + vintage resolved server-side on the search-log basis. The
continuity wrinkle solved honestly: a random browser-minted key
(`wtp.reaction_key`), stored ONLY hashed, enabling overwrite-on-change and
nothing else — no other table, no export; clearing it orphans prior rows
as anonymous rows. CLAUDE.md's two-stores constraint became **the n-stores
constraint**, guarded structurally (`tests/db-schema.test.ts`: no shared
joinable column, no FKs anywhere, the key column on reactions alone). The
aggregation contract is born tested (`lib/signal/aggregate.ts`): per-
division tier-split tallies, every tier present even at zero, n stated.

**T03 demo-grade by decision** (the site sits behind the platform
password): enum-closed validation, target ids checked against the votes
snapshot, 4 KB payload cap, fail-closed 400s, sliding-window limits
(15/min per key, 60/min per IP, instance-local, IP never stored) — burst
demonstrably 429s at 16 of 15. **Deliberately deferred**: adversarial-load
work, abuse-pattern detection, shared limiter state, the T05 review path —
all preconditions of removing the password, living in tracker **T08**.
The one wording decision recorded: the brief put the disclosure sentence
behind the "why we ask" link; CLAUDE.md requires aggregated-AND-sold
visible at the capture point, not behind a link — CLAUDE.md won ("Your
answer joins anonymous local totals we may sell. We never know who you
are.", always visible; the link expands the fuller text). OFFICIAL_OPENED
(1d, author-approved) shipped with its transparency line in the same
commit. **Author step unchanged from D30: reactions store rows only once
`DATABASE_URL` is set in Netlify and `pnpm db:migrate` has run; until
then the endpoint answers 202 accepted-not-stored.**

### 2a — the settle fetch, and the failure that now names itself

Diagnosed first: both request shapes (settle, zip) measured healthy
against dev AND a local production build; production logs need the
author's Netlify login (CLI unauthenticated — recorded in the ladder). So
the failure was made to speak: the SEARCH FAILED card now prints the HTTP
status or "never got an answer", gains a one-tap retry, and **a failed
fetch never leaves confident zeros standing** — stats render "—" with
"couldn't check" (districts stay numeric; they draw from committed files
and are genuinely intact), the count badge says couldn't-check, the
district popup's Upcoming says couldn't-check. The rule joined the
standing family (ninth sighting): *a failed operation may not render as an
empty success* (`deriveStatsView`, held in `tests/representation.test.ts`).
The one settle-only failure a client can manufacture — an unwrapped
longitude — is fixed with `.wrap()`. Gate: pan 85641 → Tucson with no zip
change turned 3 meetings into 11 via a settle-shaped request; a killed
fetch showed couldn't-check everywhere; retry recovered (settle-1/2/3
screenshots).

### 2b — the analyses render (match-then-deny, reversed)

All 11 AZ measures carried the same shape: analysis linked, text absent,
scopeNote claiming the language unpublished. `scripts/fetch-measure-analyses.mts`
retrieves and extracts every Legislative Council analysis (11/11; Prop
319's adopted link is broken at the Legislature's own site — the draft
ships labeled as the draft, primary URL retried each run). The measure
card now renders: labeled plain-language summary → the Council's text
VERBATIM → the honest narrower pending note → the citation.
`tests/measure-summaries.test.ts` holds citation-exactness both ways and
bans advocacy vocabulary.

### 3 — the two-tier popup architecture

Compact glance cards (visible close + full-width More) → the one-at-a-time
large tier, with the subsume rule enforced in one place (`openLarge`).
The meeting large surface reads what-first: body + sitting, when, where,
**what this meeting is about** (stored agenda text via `/api/agenda`,
public hearings called out in their own banner, extraction failures
honest), then how to be heard. The rep surface re-housed: compact =
identity + contact; large = votes + reactions + office blurb
(`official-modal.tsx`). The list overlay became a centered large surface.
Who-governs: shows once per resolved AREA, expands on a click into a NEW
district or the bubble, never on a pan; explicit minimize; **a zip change
clears every popup, selection, and hit** (the stale-reps bug). Last
checked demoted to a chrome-less footnote. Gate: `scripts/popup-states.mts`
with printed counts; two defects its screenshot caught (hex entities
rendering literally; "X — X" duplicated titles) fixed the same commit.

### 4 — the plain-language layer

4a: no OCD-ID, slug, or enum value renders anywhere; `Copyable` deleted
product-wide (the reader gesture is expansion); the rule is a CLAUDE.md
non-negotiable. 4b: every vote row states its type in plain words from
keyed data (`lib/votes/vote-explainers.ts`, twelve types, definitions
cited in-file, unmatched renders nothing). 4c: the TUSD notice channel
hunted and wired — `noticeUrl` on the wiring row feeds agenda retrieval
for scheduled meetings with no published agenda; the Aug 25 special
meeting renders its notice with the Palo Verde ITM public hearing (gate
screenshot tusd-aug25-notice.png). 4d: notice summaries keyed by meeting
AND content hash, so a summary dies with the exact version it summarizes.

### 5 — officials completeness (5d cut, as the brief sanctioned)

`lib/registry/body-rosters.ts`: five wired bodies' rosters curated from
the bodies' OWN pages with officeholder discipline — TUSD (roles + term
expirations), Pima BoS (five districts, chair/vice-chair), Tucson M&C
(the mayor + six wards, published contact), Vail USD, Newbury Selectboard
(term-end dates). Rendered on the compact meeting card and the modal's
Representation tab; a roster name opens the person's full card. The mayor
blurb was rewritten after checking Tucson's charter: council-manager, so
where power sits is stated honestly. The no-mayor case is a stated fact
("This area isn't a city or town — it has no mayor or city council. The
Pima County board is the closest thing here."). No local photos: the
cities' portraits are unknown-license and unknown is not clearable. NJ
rosters are recorded open hunts. 5d (sidebar counts as doors) was the
sanctioned first cut — taken and recorded.

### 6 — the certified canvass, and the map keeping its word

The AZ general lineup renders from the State of Arizona Official Canvass.
The statewide PDF is a 19 MB scan with no text layer and the results
portal is a bot-walled host-killer — the route that worked was extracting
the PDF's embedded page JPEGs and reading the winner-starred tables by
eye, with the method stated in the citation. Twelve contests; write-in
winners noted as facts (Karp, Swing); one race decided by certified totals
where the star was illegible; one canvass-vs-filing divergence ruled by
the canvass (Slawson absent; Karp is the LD-19 senate nominee). The
filing fallback retires only for lineup contests. Map: district deselect
by the same gesture (6d), the fixed muted legend (6e), deliberate per-zip
first-view zooms (`lib/map/initial-zoom.ts`, values recorded with reasons,
6f), pointer cursors in one rule (6g), back-to-map and top-of-card source
links on the ballot (6b/6c).

### Decisions taken as cheaper-to-undo, with the rejected alternative

- The disclosure sentence rides visible under the reaction buttons
  (rejected: the brief's link-gated verbatim sentence — CLAUDE.md's
  no-link rule wins under correct-first).
- Reactions live in the rep surface's LARGE tier with the votes (rejected:
  duplicating the control at both tiers — one write path, one surface).
- The canvass was read from page images by eye, method disclosed
  (rejected: 15-county text-canvass summation — higher parse risk across
  fifteen formats than transcription from the winner-starred state
  document; rejected: driving the results portal — three host crashes).
- Prop 319 ships the Council's DRAFT analysis labeled as such (rejected:
  claiming absence while the Legislature's own index links the adopted
  file — the link is broken at the source and says so).
- The cron-refreshed snapshot on main was merged by keeping the branch's
  (rejected: taking the cron's — it predates the notice channel and the
  entity decoding; the next cron run regenerates under the new code).
- `session:start`'s CLAUDE.md size expectation moved to ~17 KB with a
  wider band (rejected: leaving the standing warn — a check that always
  warns teaches sessions to ignore it; the clobber signature is a tiny
  file and the floor still guards).

### State as of 2026-08-15

- **315 tests, lint, tsc, build exit 0** — verified by exit code.
- The reaction sensor is live end-to-end pending the author's
  `DATABASE_URL` step (until then: 202 accepted-not-stored, honest).
- Four-zip gate unchanged at 82 meetings / 8 of 8 sources / 43 agenda
  documents (the cron merge kept the branch's richer snapshot).
- Open next: NJ/NH body rosters; provisions on measures (P01) and
  reactions attached to them; 5d sidebar doors; T08 before any public
  reachability; the author's Netlify-log look at the settle failure if it
  recurs (the card now names the cause on its face).

---

## 14. The 2026-08-16 correctness session — the ballot tells the whole truth, and the links all resolve

Branch `claude/nh-ballot-kelly-standard-0816`, six commits. **test 325
pass · lint clean · build exit 0** on every commit, verified by exit code;
the session ran unattended under the standing motion (reversible decisions
taken and recorded, irreversible ones parked in tracker rows, browser-heavy
work last). This was the second-to-last build before the first outside
tester.

### 1 — The NH November finding, corrected in place (the overturn preserved)

The shipped thin-November claim was true ONLY for town and school offices
(March town meeting). For state and federal offices, 2026-11-03 is one of <!-- expected-future: general election day. R16. -->
the largest ballots in the country. What was wrong and is now fixed, all
from the SOS's own documents fetched this session:

- **Executive Councilor District 2** and **Merrimack County Commissioner
  Second District** were parked in coverageNotes as unmappable. The SOS's
  2022-2032 assignment documents place Newbury in both; the contests now
  render with their filed candidates (Liot Hill D / Menard, Strathdee R;
  Ribas D / Bilodeau, French R), keyed to Newbury's town division.
- The House district verified: **Merrimack 7 = New London + Newbury, two
  seats — and NO floterial covers Newbury** per the SOS assignment PDF.
  **This corrects §2's earlier claim** that Newbury sits in two House
  districts; that claim described NH's floterial system generally and was
  never true of Newbury specifically. The partition test stands.
- A new honesty note: nomination-paper candidates (the independents' route)
  are certified by September 2 and cannot be listed yet — stated, because
  the press already names one for EC-2.
- 03255: 10 → 12 contests, 41 → 47 candidacies. D33 corrected in place.

### 2 — The Kelly standard

- **`pnpm officials:enrich`** reads the legislatures' OWN rosters: AZ 90/90
  members re-pointed at current-legislature pages with phones and the
  email form (the CSV shipped legislature-55/56 URLs — the author's Diaz
  defect, now closed: correct page, phone, contact form, and
  lupediazaz.com in campaign-sites); NJ 119/120 re-pointed at official
  njleg bio pages with contact forms (caucus-site URLs retired); NH 0/410
  — gc.nh.gov resets TLS to non-browser clients, rung recorded.
- **`pnpm officials:audit`** fetch-verifies every division-linked
  official's page and writes `docs/officials-audit.md`: **661 audited, 577
  verified (556 by content, 21 via the roster chain — njleg bios are
  client-rendered SPAs), 0 misses, 84 inline-unverifiable (NH)**. A 200
  that lands generic is a MISS by construction (the check demands the
  member's name in the page).
- **40 candidate links hunted and fetch-verified** across all three states
  (`data/ballot/candidate-links-2026.json`), official site first, campaign
  site labeled; every absence is a recorded MISS or NOT_ATTEMPTED hunt.
  The verification rule earned its keep twice: kellyayotte.com now serves a
  DIFFERENT politician's page (hers is kellyfornh.com), and gowanforaz.com
  — listed by the state's own voter guide — timed out on three attempts.
- **Registration checkers (2c)** for AZ/NJ/NH, each the authority's own
  tool, chain-verified, prominent on the ballot page.

### 3 — The defect batch, and what the tester pass measured

3a what-first titles everywhere (`meetingHeadline`/`locationLine`, the Vail
card pinned in tests); 3b the narrowing modal (forced response, never
forced narrowing; decline persists inside the existing storage key); 3c the
one-time acknowledged disclosure (CLAUDE.md record updated — the
always-visible line retired; an unacknowledged tap parks, never records);
3d CANDIDATE reactions on every ballot candidate with server-side target
validation and extended neutrality guards; 3e the mayor surfaces in
who-governs (rendering path, as the author suspected — the roster only fed
meeting cards); 3g the 90-day backward window with the recent past riding
along on successful rungs (tier still earned by the future; canceled never
fills an empty map — re-pinned in tests) and the slider counting negative
days so left = further past; 3h senators label on its own line, larger
expansion portraits, blurb on top, legend under the popup layer,
mm/dd/yyyy everywhere.

**3f, diagnosed before fixing (measured live, screenshots on file):**
selection shading was never broken — the whole-viewport tint in
`shading-1-selected.png` is Pima's fill. What reproduced: the 6d
same-gesture deselect lived only on the single-hit path, and a click is
almost never a single hit, so "click again to unshade" never engaged. The
picker now marks the selected district and choosing it deselects; verified
by the screenshot pair.

### 4 — Plain-language bill summaries, and the wrong-slug catch

Eleven bills in the vote window carry hand-curated summaries (labeled ours,
cited to the CRS summary version each paraphrases, expansion-gated on the
vote row); three are pending with reasons — including H.R. 5334, whose
number was reused as a vehicle so the on-file CRS summary describes a
different act (the match check that caught it is now the curation rule).
Found while matching: **the snapshot's billUrl builder collapsed every
resolution type to `-bill`**, sending readers to unrelated real bills
(H Con Res 113 → house-bill/113). Slug map fixed, snapshot regenerated
(8674/8674, 2000/2000, 34 titles), and `votes:fetch` prints unsummarized
bills entering the window.

### 5/6 — Deferred whole, as the cut order sanctions

FEC funding surfaces deferred WHOLE (a funding surface without tags and
ripcords is the forbidden configuration); the **ripcord doctrine** itself
is now a CLAUDE.md constraint, and D34 carries the flags
(`ripcord.fecContributorDisplay`, `ripcord.fundingReactionsInAggregates` —
the second ships PULLED), the D23 question, and counsel as closer.
Positions (the three-answer machinery) deferred first per the cut order —
D35 holds the design as specified, unchanged. Polishing what the tester
will touch outranked finishing new surfaces this session, by instruction.

### The tester pass

`docs/tester-pass.md` — four zips at phone width, surface-by-surface
pass/fail, links fetched, screenshots. Two fixes landed during the pass
(3f, list-row dedupe). Its "open items" section is the final session's
punch list seed.

### Decisions taken as cheaper-to-undo, with the rejected alternative

- EC/commissioner contests key to Newbury's town division (rejected:
  county/state division — would render the wrong district to other towns'
  readers; the town-level assignment is what the SOS documents source).
- AZ enrichment nulls the CSV email and ships the legislature's email form
  (rejected: keeping the unverifiable address the author found dead).
- Enriched provenance points at the roster page that names member,
  district, party, and link together (rejected: keeping Plural cited for
  fields it no longer supplies).
- The mayor line renders the roster's "Mayor" role only, in who-governs
  (rejected: full rosters in the card — they stay on the body's meeting
  surfaces).
- The one-time disclosure ack is a new device-local key (rejected: a
  server-side record — identity-free by construction).
- NJ bio pages verdict VERIFIED-VIA-ROSTER, stated as a chain (rejected:
  content-sniffing an SPA and calling 20 real pages misses).
- The nomination-paper route renders as a coverage note until the SOS
  certifies (rejected: naming the press-reported independent — not ours to
  claim).

### State as of 2026-08-16

- **325 tests, lint clean, build exit 0** — verified by exit code.
- The four-zip gate unchanged on meetings; the ballot gate now: 03255
  twelve contests with EC/commissioner, all four zips carry links,
  checkers, and candidate reactions.
- Open next (the final session's punch list): `docs/tester-pass.md` open
  items; D34 (FEC behind ripcords, counsel closes); D35 (positions
  three-answer machinery, A07 in full); NH hunts marked NOT_ATTEMPTED;
  NJ/NH body rosters; T08 before any public reachability.

---

## 15. The 2026-08-17 final-prep session — depth for the tester's two states, and the denominator stops being ours

Branch `claude/final-prep-nh-nj-depth-0817`, eleven commits, run
unattended under the standing motion. **test 349 pass · lint clean ·
build exit 0** on every commit, verified by exit code. The tester lives
in New Hampshire and is moving to Morris County, NJ — where breadth and
depth traded, depth in her two states won, by instruction.

### 1 — The author's words

The welcome overlay's mission text is the author's six sentences,
VERBATIM, pinned sentence-by-sentence in `tests/welcome-copy.test.ts`
(the pin normalizes JSX wrapping and entities to the rendered text). And
"sell" retired from every reader surface for "aggregates may be
licensed" — the commercial fact stays plainly stated, only the verb
changed; the reactions test asserts both directions (the word present,
sell/sold absent).

### 2 — NH/NJ depth

- **2a, the earned absence.** No statewide question is on NH's November
  2026 ballot. Earned, not assumed: every 2025-2026 CACR enumerated dead
  (6 right-to-compute ITL'd; 12 tax-supermajority failed the House 3/5
  193-148 in May; 14, 15, 21, 24 failed in March; 28 killed), and the
  SOS's own 2026 Election Details page — read in a real browser; the
  host 403s every automated client including the pipeline's former
  browser-UA rung, which has CLOSED — lists no question and no voters'
  guide the way 2024's did. The absence ships in the ballot file with
  SOS provenance; the CACR enumeration rides as a coverage note; the
  Ballotpedia "lead" resolved to the DEFEATED 2024 judicial-retirement
  question. gc.nh.gov is unreachable from this environment ENTIRELY —
  TLS-reset to curl/node/WebFetch and failed even to the real browser;
  every rung recorded (`docs/source-ladder.md`, the 2026-08-17 set).
- **2b, Kelly-standard cards.** Every ballot candidate renders a CARD —
  photo (campaign-site source, the author-adjusted rule for challengers,
  every URL HEAD-verified `image/*`, labeled), bio in the candidate's
  own site's words with a read date, published contact, official site
  first + campaign site labeled, party as filed. 17 cards curated (11
  NH including Goodlander's official-House-page bio read in a real
  browser, 6 NJ, plus the AZ governor pair); absences are recorded
  hunts; the domain trap re-sighted (andybiggs.com is a safari
  photographer — only fetch-verified biggsforarizona.com is citable).
  AZ beyond governor: NOT_ATTEMPTED per NH/NJ-first, recorded.
- **2c/3d, the walls.** New rungs walked and recorded: schannel curl
  (all TLS profiles) reset by gc.nh.gov; gencourt.state.nh.us DNS
  retired; Wayback rate-limited at attempt; sos.nh.gov's Akamai wall now
  403s browser-UA curl. **Kearsarge's wall CAME DOWN** — a browser-UA
  fetch from this machine returned the full members page, and the
  nine-member board is curated with towns, terms, committees (Newbury's
  representative, Kristen Schultz, also chairs the Selectboard).
- **2d.** Ledger-caps surnames render as names (`lib/ballot/name-case.ts`
  — Mc/O'/exceptions-map/particles/suffixes, display-only, fires only on
  all-caps input, mixed-case passes byte-identical; tested).
- **2e.** "Newbury isn't a city — it has no mayor. The Select Board runs
  the town." renders in who-governs with all three members tappable; the
  Select Board has its own register explainer (RSA 41 basis); the
  pattern is generalized to any select-board town.
- **The stranger test and the denominator rule are CLAUDE.md
  constraints** — completeness judged by the reader who has never been
  there, and coverage claims measured against the official universe,
  never our own records.

### 3 — The completeness audit (docs/coverage-audit-by-county.md)

The 2022 Census of Governments government-units listing is the committed
Layer-1 denominator (`data/audit/gus-2022-clip-counties.json`): **Pima
50, Morris 98, Merrimack 63 governments.** Findings: municipal and
school layers are COMPLETE in all three counties, name-by-name —
Sunnyside and Amphitheater were registry divisions all along (the
author's catch was a surface gap, not an existence gap). The structural
gap was SPECIAL DISTRICTS (60 across the counties, zero in the
registry) plus the no-boundary school tier. Fixed for everything serving
the four zips: ten curated bodies (RTA, Rio Nuevo, Rincon Valley FD,
Corona de Tucson FD, Pima JTED, RVRSA, County College of Morris, Morris
County Vocational SD, and the two county conservation districts),
homepages fetch-verified, coverage honestly NOT_ATTEMPTED; the other 45
are the enumerated backlog. Registry: **333 bodies.** Layer 2 and the
roster column live in the audit; new rosters this session: Kearsarge
(9), Rockaway Twp council + mayor (10, with per-member phone AND email),
Morris County commissioners (7), Merrimack County commissioners (3 — the
county's FY2025 annual report is the source; the county site's own
index page is STALE and the audit says so).

### 4-8 — The surfaces

- **4a save-my-picks**: per-contest (measures included) to
  `wtp.ballot_picks`, DEVICE-LOCAL ONLY — no network path in the module
  (test-pinned), "pick" a banned column name schema-wide, "Saved on this
  device only. We never see your picks." on every surface with the
  difference from reactions named, transparency paragraph same commit.
- **4b office explainers** for every candidacy contest on all three
  ballots (executive councilor, register of probate, mine inspector, the
  lot), guard-tested with the ballot files as the denominator.
- **5 votes polish**: summary open by default; a mechanical "what a No
  vote did" line on all 12 vote types (no-advocacy tested); attribution
  once at the section top.
- **6 meetings**: concluded meetings drop Directions and to-be-heard and
  gain what-happened (curated-minutes store shipped with the honest
  not-yet state; curation is the browser-phase worklist) plus the office
  phone derived mechanically from the rosters' shared base line; .ics +
  Google Calendar on every upcoming meeting (90-minute estimate stated
  as an estimate); the county large popup lists all county-area meetings
  and the commissioners; governing bodies sort before advisory.
- **7 the mover's page** (`/about-area?zip=`): seven questions per state
  (marijuana, vaccinations, firearms, income tax, vehicle, voter
  registration, property tax) ×3 states, every answer one-two register
  sentences cited to the official agency — NJ/AZ fetch-verified, all six
  NH citations verified in a real browser with three URLs corrected.
  Title decision recorded for the author: "Moving here? The basics" /
  "The basics of living here".
- **8a doors**: the four stat counts open the lists they count; the
  one-large-surface rule holds in both directions; the reset-registry
  guard forced the view-state decision.

### 10 — The tester pass (docs/tester-pass.md, superseded)

Four zips at 390×844 as a stranger (hers first), 74 checks green, zero
console errors. The walk caught and the session fixed a real 8b defect:
a door opened from the phone drawer rendered UNDER the drawer's backdrop
and every tap died there — opening a door or the list now dismisses the
drawer. Harness findings recorded: chrome labels uppercase via CSS (all
body-text checks case-insensitive), and the in-app Browser pane cannot
composite unattended — the repo's headless Playwright drivers are the
tester harness of record (`scripts/tester-walk-0817.mts`).

### 9 — Deferred, said plainly

**FEC (D34) deferred whole, again.** The cut order names it first and
this session hit genuine duress: the never-cut items consumed it. The
framing correction is recorded on the row — counsel closes the RIPCORDS
(via D23), not the build; the build is next session's largest item.
Also T02 verified-and-extended per 10b: tier-weighting, never mandatory
authentication; no reader-facing auth without the author's explicit
direction.

### Decisions taken as cheaper-to-undo, with the rejected alternative

- The mission text renders as six short paragraphs in the existing
  welcome-msg style (rejected: one block — the author's line breaks are
  the rhythm).
- Bios are the candidate site's own words, quoted and attributed, even
  when thin or promotional (rejected: writing our own factual bios —
  characterization by us, exactly what the rule forbids).
- Special districts enter as `curated:` bodies with COG_2022 dataset and
  NOT_ATTEMPTED coverage (rejected: waiting for the D31 identifier
  convention — a real government missing from the registry is the worse
  state).
- The Merrimack commissioners roster cites the county's FY2025 annual
  report over the county site's stale index page (rejected: the page —
  it names a former commissioner; the minutes confirm the report).
- The office phone derives from the roster's shared base number
  (rejected: hunting separate clerk numbers — the rosters' cited pages
  already publish the office line).
- Calendar events carry a 90-minute estimated end, stated as an estimate
  (rejected: zero-length events — they render uselessly everywhere).
- The county door's membership test is the state prefix (correct while
  local coverage is clipped to one county per state; noted to revisit at
  expansion).

### State as of 2026-08-17

- **349 tests, lint clean, build exit 0** — verified by exit code.
- Ballot gate: 03255 carries 12 contests + the earned no-measure
  absence; all four zips carry cards, explainers, picks, registration
  checkers, and the mover's page.
- Open next: D34 (FEC, the largest item); D35 (positions machinery);
  Rockaway BOE full names; Goodlander portrait; minutes-summary
  curation; the 45 backlog special districts; T08 before any public
  reachability.

---

## 16. The 2026-08-18 session — FEC first and whole, the wiring debt paid, and the long way to NH

Branch `claude/fec-funding-and-final-prep-0818`, run unattended under the
standing motion. Wall clock for the whole session: 2026-08-14 — the
repo''s session labels run ahead of the calendar, so data fields
(collectedAt, verifiedAt) carry the wall clock and docs carry the label,
the split the repo already used. **test 371 pass · lint clean (one
pre-existing warning) · build exit 0** on every commit, verified by exit
code. The last session before the outside tester.

### 1 — FEC funding surfaces (D34), first, whole

Built first per the author''s explicit order after two deferrals. The
identifier match rate printed BEFORE the adapter, per spec — and the
print caught the denominator bug (a governor''s division is the state
root exactly like a US Senate seat''s; federal is decided by contest id
now) plus three name traps (suffixes 422''d the search, compound
surnames and nicknames broke position matching; an election_years filter
untangled Scott Brown''s 2014 id from his 2026 one). Final rates: roster
10/10 by bioguide bridge, ballot 29/38 by scoped search — the nine
misses are filers with no FEC registration (under $5,000 raised, no
requirement), each recorded and rendered as an earned absence with that
explanation.

- **Snapshot pattern**: `data/fec/fec-2026.json` (73 KB) committed;
  `pnpm fec:fetch` (121 serialized requests, Retry-After honoured);
  weekly refresh workflow `.github/workflows/refresh-fec-snapshot.yml`
  — **needs FEC_API_KEY as a repo secret, an author step**. The key
  lives in fetch-script environments only; a guard test walks app/,
  components/, lib/, hooks/ asserting no runtime file mentions it.
- **Strict cycle honesty**: only 2026-cycle totals ship; a dormant
  committee''s stale filing is an absence with its old coverage date
  named (Fernandez''s 2020 money nearly wore a 2026 label).
- **The ripcords live in code** (`lib/ripcords.ts`): each carries its
  question, closer (counsel via D23 — nobody else), tracker rows, and an
  env override so each is flippable in tests and by ops.
  `ripcord.fecContributorDisplay` ships LIVE — pulling it empties the
  contributor display AND the CONTRIBUTOR_REACTION write path (the
  validation set derives from the same switch).
  `ripcord.fundingReactionsInAggregates` ships PULLED —
  `aggregateReactions` filters both funding reaction types while pulled,
  so nothing derived from them can enter an export. Both flips are
  demonstrated in `tests/funding.test.ts` (18 tests), and lib/signal
  provably never imports the funding corpus.
- **Surfaces**: `components/funding/funding-section.tsx` on every
  federal candidate''s ballot card and (via `/api/funding`) the official
  modal. Plain register: "This campaign has raised $6.2 million… About
  8% of the money came from small donors — people who gave under $200 in
  total." Contributors listed exactly as filed, cited, never
  characterized. State/local races carry the honest state-systems note.
  Reaction targets key on the FEC candidate id so the same committee
  gets the same answer on every surface.
- **Transparency page** gained the Campaign money section in the same
  commit, including the aggregate exclusion stated plainly.
- Gate met with counts: 85641 4 / 07866 7 / 03255 19 funding sections;
  Ciscomani''s modal verified (`funding-ciscomani-modal.png`,
  `funding-ballot-*.png`).

### 2 — Sunnyside and Amphitheater wired live (D39)

The honest diagnosis first, recorded on the row and here: the D38
audit''s "complete" was the REGISTRY layer only — the wiring layer
(sources, rosters, comment access, anything a reader sees) was never
delivered, and the report implied more than shipped. The author''s
"like nothing happened" was correct about every reader-visible surface.

- **Sunnyside**: a Diligent/Highbond tenant found via the district''s own
  agenda page — one wiring row, no new code. Its MeetingTypeName carries
  the SITTING name, so `bodyNameFor` now lets a cited `typeName:` config
  override win. 7 meetings in the snapshot, 4 upcoming — pins inside
  85701''s first rung.
- **Amphitheater**: BoardBook Premier (Sparq Data Solutions), a NEW
  vendor — adapter `lib/sources/boardbook` (server-rendered archive,
  per-row venue name AND street address, public agenda links; notices
  post days ahead so an empty upcoming window is the portal''s honest
  state), vendor-review section, recorded fixture, counted drops.
- Both boards: coverage audits COVERED/LIVE with full rungs, 5+5-member
  rosters from the districts'' own pages, comment access (Call to the
  Audience; blue/yellow speaker forms), three Census-geocoded venue rows.
- **Found while gating, the M31-class miss**: the district popup''s
  roster lookup was `#governing`-only while school boards are `#board` —
  every school district, TUSD included, rendered "no sourced
  officeholder" over a curated roster. `governingRosterHoldersForDivision`
  tries both suffixes; wired into the district popup, the meeting-popup
  fallback (a Sunnyside pin seen from downtown names its board), and
  `holdersFor`; test-pinned.

### 3 — NH legislator contacts, the long way

The Wayback rung left open on 08-17 paid. CDX enumeration of
`gc.nh.gov/downloads` surfaced the General Court''s OWN downloadable
member directory — `members.txt`: name, chamber, county, district,
address, phone, email, party, committees — captured 2026-04-07, current
legislature, read through the Archive without touching the wall.
`officials:enrich` gained the NH pass (chamber + county + district via
the registry''s Census labels + name; directory-marked Former rows never
match): **389/410 enriched — phone on 251, email on 386**, 21 misses
printed with reasons. The tester''s three (Innis Senate D7, Sargent and
Ebel Merrimack 07) all carry directory phone + email, verified on
screen. Photos stay a recorded miss (walled member pages, unknown
license). Refresh: re-point `NH_MEMBERS_TXT_ARCHIVE` at a newer capture
— or the live file the day the wall drops. Rungs: the ladder''s
2026-08-18 set.

### 4 — The punch list

- **4a**: the Rockaway Township BOE surnames-only defect closed — the
  district''s own Apptegy page (`/page/board-members`) publishes full
  names, roles, terms, per-member emails, reachable by plain GET (the
  "defeated the pipeline" finding was about the events API, not this
  page). Seven members curated; the roster renders from the BOE meeting
  card.
- **4b**: Goodlander''s public-domain official portrait fetched (the
  unitedstates/images repo caught up) and her ballot card now serves the
  committed copy with its license label. Grijalva and Mejia remain
  honest misses (404 in the repo; Congress.gov depiction is
  license-unknown and unshippable).
- **4c**: the first two minutes summaries — Pima BOS 7/28 (the
  treasurer appointment, the IDA reconstitution, River Overlook; cited
  to the Clerk''s posted meeting-summary report) and Morris
  commissioners 7/22 (cited to the full minutes). The rest of the
  worklist was checked and recorded: TUSD''s and Sunnyside''s portal
  minutes exist unpublished; Newbury hosts the agenda only. The honest
  not-yet state renders, as designed.
- **4d**: every open tester-pass item resolved or recorded — see the
  superseded `docs/tester-pass.md`.

### 5 — The final walk

Four zips at 390×844 as a stranger, every new surface in the pass: **89
checks green, zero console errors** (`scripts/tester-walk-0818.mts`,
`walk18-*.png`). Two harness findings recorded in the driver (the
sidebar is an aside too; the bottom sheet stalls Playwright''s
scroll-into-view for rows a human can tap). One environment finding: a
dev server started before an enrichment serves stale module JSON —
restart after data regeneration; production builds fresh.

### Decisions taken as cheaper-to-undo, with the rejected alternative

- Funding reactions key on the FEC candidate id, not the app-side target
  key (rejected: per-surface ids — the same committee would collect
  split answers).
- The small-donor share is unitemized individual contributions over
  total receipts, with the method stated in the rendered words
  (rejected: itemized+unitemized over receipts — "small donors" must
  mean the under-$200 class the FEC itself defines).
- The strict-cycle rule (2026 totals only) over latest-available totals
  with a cycle label (rejected: old money wearing this cycle''s label is
  a false claim even labeled).
- The BoardBook adapter parses the org page rather than per-meeting
  pages (rejected: N+1 requests for data the archive page already
  carries).
- Goodlander''s card serves the committed local portrait rather than
  hotlinking the https repo (the D20 never-hotlink rule; the card test
  now admits committed `/officials/` paths that must resolve on disk).
- The NH enrichment pins the 2026-04-07 capture rather than "latest"
  (reproducibility; a moved capture is a deliberate re-point, never a
  silent drift).

### State as of 2026-08-18

- **371 tests, lint clean (one pre-existing warning), build exit 0** —
  verified by exit code.
- D34 DONE — the ripcords are counsel''s to close (D23); nothing else
  waits on it. D39 done. Registry 333 bodies, two more LIVE.
- Open next: D35 (positions machinery, the largest deferred item); the
  45 backlog special districts; Grijalva/Mejia portraits when the
  pictorial repo updates; the 21 unmatched NH members; minutes curation
  as minutes publish; T08 before any public reachability; the author
  steps in "Before you send the link" (the ship report).

---

## 17. The 2026-08-19 session — the replication bug was a cache key, and the product takes questions

Branch `claude/fec-cache-and-question-box-0819`, run unattended under the
standing motion. Wall clock for the session: 2026-08-14 (the label/clock
split of §16 holds). **test 391 pass · lint clean (one pre-existing
warning) · build exit 0** on every commit, verified by exit code; the
four-zip walk19 all green at 390×844, zero console errors. This session
answered the author's production screenshots — the first tester-visible
defect list.

### 1 — The FEC replication bug (D40): diagnosed before fixed, and it was not the join

Production rendered Mark Kelly's exact funding data ($41M/$21M/$24M, 65%
small donors, his contributor rows) on Ruben Gallego's and Adelita
Grijalva's official modals. Every layer the brief suspected measured
CLEAN: the snapshot held three distinct correct records with correct
targetKeys, the roster held distinct ids, the display builder and the
officials lookup keyed correctly. The actual line: the old
`/api/funding?target=` route marked its response `cache-control: public,
max-age=3600` — and the CDN's cache key for function responses dropped
the query string (the documented opennextjs-netlify class; their PR
#2701 fixed the same shape for data requests). First official opened
after a deploy was cached for the bare path and served to every
subsequent official for an hour. Ballot cards were server-rendered
per-path — which is exactly why Butierez showed his own data and the
brief could tell "the officials join collapsed."

The fix removes the class, not the instance: the target now rides in the
PATH (`/api/funding/[target]`), which every cache implementation keys
on; `FundingBlock` and `RecentVotes` are keyed on `holder.id` so a
holder switch discards fetched state structurally. **The uniqueness
invariant is now CLAUDE.md law** (sibling of the count check): a join
producing identical payloads across distinct keys is presumed broken — a
match rate reads 100% while every match points at one row. Guarded three
ways in `tests/funding.test.ts` (D40 family): no two candidates share an
FEC id, committee id, or target key; distinct officials resolve to
pairwise-distinct payloads; no query-keyed API route may mark itself
publicly cacheable (votes/meetings/agenda audited: query-keyed but
uncached, safe). The enrichment audit found 0 values bound to >1 key
anywhere (roster contacts ×537, photos ×8, campaign sites ×12).

Gate evidence: walk19 opens all three modals the reader's way — three
DISTINCT books, each matching the FEC's own API to the dollar (Gallego
$4,345,411; Grijalva $2,285,639), screenshots
`walk19-85701-gate-{kelly,gallego,grijalva}.png`. Production could not
be probed directly (the site password returns 401 to plain clients —
recorded); the mechanism is verified end-to-end locally and the fix is
cache-implementation-independent.

### 2 — Self-funding labeled from the FEC's own fields (D41), the photo rule (D42), the watch item (D43)

Contributor rows now carry `entity_type` and `line_number` verbatim;
`plainContributorLabel` (in `lib/funding/labels.ts` — client-safe, NOT
display.ts, which sits on the node:fs snapshot graph and broke the
browser build on first placement) derives labels mechanically: CAN/13A →
"the candidate's own money" (Butierez's rows, pinned in tests), PAC/PTY/
ORG/COM/CCM → accurate plain labels, IND → none. Snapshot regenerated
twice — the first run left Kelly 5 contributor rows after an FEC 504 and
was NOT shipped short; the rerun recovered all 10 (213 rows, 24
candidates, matching the prior session).

The photo rule tightened: a clean solo portrait or honest initials —
never a screengrab, banner, logo crop, or group shot. All 17 candidate
cards + 8 roster officials eyeballed as fetched: 8 card photos + 8 GPO
portraits pass; SIX fell to initials with rung-by-rung hunts recorded
(Ayotte: WinRed banner, family/crowd shots on re-extract, official
portrait unknown-license per D20; Hobbs: a white-on-transparent WORDMARK
— the author's card; Murphy: file renders blank as fetched; Brown:
two-person candid; Sununu: couple photo, then a banner whose crop is
banned; Harned: canoe selfie). `docs/photo-report.md` lists every
shipped photo with source URL for human verification, sync-guarded in
tests plus a mechanical banner/logo filename check. D43: contributor
individual names render AS FILED — the author's explicit no-change
order, its own tracker row so nobody fixes it in passing.

### 3 — The author's copy batch (M38–M45), words verbatim

3a party colors at all four render sites (display only; unmapped parties
honest gray; both themes, contrast-tuned). 3b plain-language summaries
bold on all four summary surfaces. 3c the moving-here teaser verbatim;
marijuana stays in the section. 3d "What do you think?" 3e the picks
disclosure ONCE at the ballot page bottom with the reactions distinction
(tests re-pinned; not a consent surface — picks are never collected).
3f official analysis collapses by default, verbatim once open, all three
states through one path. 3g the districts card and door share ONE
denominator — `drawnDistrictsOn()` feeds both; the guard asserts stated
N === rendered rows. 3h pans never pop the who-governs card:
`noticeShouldExpand()` is pure and tested; settle refreshes data
silently; explicit gestures still expand. 3i the calendar-links truth:
SHIPPED 08-17 on the compact meeting card only — the sidebar list and
entity modal never got it, which is why the author found it nowhere; it
now rides all three surfaces.

### 4 — Incumbent record links (B10) and the ask box (A09)

"See their voting record" on every incumbent's ballot card opens the
same large official surface the map uses — incumbency from the exact-key
pairing the FEC snapshot already earned (roster id + ballot keys on one
candidate), never a name match; absent or ambiguous joins render no
link. Live: Booker, Ciscomani, Goodlander, Grijalva, Mejia — every
federal incumbent standing in a covered contest.

The ask box — the author's third ask — shipped as v1: routing WITHOUT
generation. Keyword matching (deterministic, tie-or-zero refuses) into
the A08 routing map; answers name real bodies and sourced people with
the denominator stated; both golden cases pass LIVE at 85701 through the
exact function the surface calls. QUESTION_ASKED joins the
identifier-free search log: routed asks log the topic id ONLY; refusals
log the question capped at 200 chars — unanswered questions are the
roadmap. Drizzle confirmed no SQL change. The transparency page covers
the box, the no-AI fact, and the cap in the same commit, coupling
guard-tested.

### State as of 2026-08-19

- **391 tests, lint clean (one pre-existing warning), build exit 0** —
  verified by exit code; walk19 green at all four zips, zero console
  errors.
- The D40 gate PASSED with screenshots against FEC-verified figures.
- Next free tracker ids: A10, B11, D44, M46, P11, R13, T09, V07, X04.
- Open next: D35 (positions machinery, the largest deferred item); state
  incumbent record links when state roll-calls land (B10 is federal by
  construction); the 45 backlog special districts; the ask box keyword
  map growing from refusal logs; T08 before any public reachability; the
  author steps in "Before you send the link."

## 18. The 2026-08-14 session (second session of 2026-08-14) — the pipeline proves itself and the map answers potholes

**Dating convention, changed as of this section (the author's order in
the session brief):** section headers from here on carry the REAL
wall-clock date, disambiguated by sequence when a day holds more than
one session. The date-shaped labels on §13–§17 ("the 2026-08-15
session" through "the 2026-08-19 session") are SESSION SEQUENCE LABELS
that ran ahead of the clock — every one of those sessions actually ran
on wall-clock 2026-08-13/14. History is not rewritten; read those
headers as sequence numbers. Machine-written data fields have always
carried the wall clock and still do.

Branch `claude/pipeline-proof-and-potholes-0814`. An outside tester has
had the link since ~18:32 UTC and production's platform password is
DOWN — found this session: the site loads openly with no auth. Every
claim below about production was made against the live deploy.

### 1 — Reaction honesty (P11): success is earned by the 204, and the pipeline proved end-to-end

The author's decided option two, built and gated: `submitReaction`
returns COUNTED only on the 204; the control renders the
selected-and-counted state only then. Anything else — 500, network
failure, and the 202 accepted-not-stored state (never-happens now the
store is live; if it reappears it renders as failure) — renders
"Couldn't reach the totals — your answer is saved on this device and
wasn't counted." The device-local record writes always. The search log
stays fire-and-forget BY DESIGN — a promise was made at the reaction
capture point and none was made for our own bookkeeping; the difference
is commented on both sides so neither gets "fixed" to match the other.
Tests pin all four outcomes, the control wiring, and the line's two
truths; the walk exercised the arc live with the network cut and
restored (tester-pass.md).

**The gate, met on the deployed site:** one real tap on production
(Katie Hobbs's ballot card, YES, 2026-08-14T20:20:21Z) landed as a
visible Neon row two seconds later — `CANDIDATE
ballot-az-pima:governor|Katie Hobbs YES ANONYMOUS`, 20:20:23Z. Control
screenshot `walk0814b-production-tap.png`; the row pulled by direct SQL
(the author can see it in Neon's table view; the probe was possible
because the password is down).

**The store's ledger, honestly attributed** (query time ~20:25 UTC):
reactions total 4 — the author's two (17:24 and 18:21 UTC, exactly the
brief's facts), plus this session's own two (the dev-walk UNSURE at
20:18:10Z and the production-gate YES at 20:20:21Z, both on the Hobbs
card — dev holds the production DATABASE_URL, so walk taps are real
rows). **The tester has tapped zero reactions so far.** Search log: 359
rows total, earliest 2026-08-13T19:56Z. The tester's clean window
(18:32–19:40 UTC, before this session's walks began writing): 4 rows —
the "my kids school" refusal at 18:49, a SEARCH at 07465 (her own NJ
zip, outside deep coverage — 5 meetings at 25km), a SEARCH at 85701,
and Gallego's card opened at 19:12. Rows at/after 19:40 UTC are this
session's own walks and probes (52).

### 2 — The FEC snapshot refuses to ship thin (D44)

The Kelly-504 eyeball became a mechanism: `lib/funding/guard.ts`
compares the fresh snapshot against the last committed one BEFORE
writing — a falling candidate count, a vanished candidate (absence
recorded or not: a human confirms either, because "the FEC stopped
returning a candidate" is what an outage looks like), or a retained
candidate's contributor rows below prior fails the run with exit 1,
keeps the old snapshot, and says why in the workflow log. A legitimate
shrink ships only by a human rerunning with `--allow-shrink`, recorded
in the tracker. Fixture-tested for the mechanism (the Kelly shape
verbatim), never for the absence of an error; the unattended weekly
refresh now fails loudly instead of publishing a thinner book.

### 3 — The everyday-topics map (A10): the pothole standard

Nine everyday route topics (roads incl. streetlights, trash/recycling,
water/sewer, noise, permits/zoning, animals, parks, snow removal,
property taxes) × four zips = **36 cells: 30 carry a sourced contact
with a real phone or request URL, 6 are recorded misses with reasons —
zero cells silent** (tests assert the accounting). Every shipped number
was read off the government's own page — plain client where the host
allows, real browser where it walls (tucsonaz.gov and newbury.nh.gov
403 plain clients; rungs in source-ladder.md).

The corrections the verification forced, which are the reason it exists:
Tucson's pothole answer is **Tucson 311** (the city's current page; the
old TDOT direct line lives on in 2015-era news stories and was NOT
shipped); Newbury's tax collector and transfer station have their own
lines (763-5326, 763-2289 — the search-snippet draft had the town
office for both); and **zip 07866 crosses the borough/township line**,
so both Rockaway governments answer, each named plainly — the first
draft carried only the Borough while the registry's rosters cover the
Township (the borough-vs-township trap, caught mid-session by the
walk). Two 03255 misses (code enforcement, recreation) RESOLVED to
contacts by the in-browser read of the town's own directory.

The ask box surfaces contacts on routed answers after a ~250ms
presentation beat — "I got you... hang tight..." (the author's words;
never a thinking label — the transparency page says no AI answers
questions and the label must not contradict it). Route and log land
BEFORE the timer; nothing logs in the beat; guard-tested. The refusal
log drove the map: "my kids school" and "I want a bike lane" — both
live refusals from this morning — now route.

### 4 — The refusal log scrubs before it stores (T09)

`lib/log/scrub.ts`: digit runs of 7+ (separators allowed), email-shaped
tokens, and street-address-shaped tokens (number + capitalized words)
become `[#]` — mechanically, at the single write path in
`lib/db/search-log.ts`, so nothing unscrubbed reaches the store
whatever the client sends. Fixture-tested each shape; ordinary
questions (zips included) pass untouched. The transparency page
discloses the scrub in the same commit and the coupling guard enforces
it. `docs/abuse-policy.md` gained the typed-questions threat section —
preserve never render, flag for the author, never auto-report — PENDING
COUNSEL like the rest of that file.

### 5 — The photo census (D45): 16 of 747, counted by script

`scripts/photo-census.mts` walks every person the product renders:
**16 of 747 have a portrait; 731 render initials.** Ballot candidates
8/109; federal officials 8/437 (House rides the national cd layer, so
all attached members genuinely render; senators resolve for the covered
states); state legislators 0/130 (the schema has no photo field);
curated local rosters 0/71 (same). The author's far-more-than-six
instinct confirmed by two orders of magnitude. The named miss list per
surface and state is in `docs/photo-report.md` (superseded, keeping the
six recorded hunts and every shipped photo's sync-guarded row) — it IS
the dedicated photo session's brief input. No hunting this session, by
the author's order.

### The session's own working-rule sightings (recorded so they stop)

- The tracker-edit trap, twice in one session: anchoring a CSV insert on
  the NEXT row's prefix consumes that row. Anchor on the PREVIOUS row's
  tail, and validate with Import-Csv (row count + dupe IDs) after every
  tracker edit.
- PowerShell `Set-Content` after `-replace` mangled UTF-8 (mojibake
  em-dashes) — restored from git and redone with the Edit tool. Bulk
  text replacement in files belongs to the Edit tool, not the shell.
- A Bash heredoc with a backslashed Windows path wrote a junk file named
  by the whole path string and exited 0 — the source-ladder append
  landed nowhere and the "committed" claim was false until grepped for.
  The verify-the-result rule's sixth sighting.

### State as of 2026-08-14 (second session)

- **409 tests, lint clean (one pre-existing warning), build exit 0** —
  verified by exit code; walk0814b green at all four zips.
- The item-1 gate PASSED on the deployed site: tap → visible Neon row.
- Production's platform password is DOWN — the site is openly loadable.
  T08 (the hardening gate) was scoped to "before the password comes
  down"; the author should know it is already down.
- Next free tracker ids: A11, B11, D46, M46, P12, R13, T10, V07, X04.
- Open next: the incumbent-record-link modal could not be opened by this
  session's harness (hydration live, click dead — unproven, queued to
  the author's hand check); the photo session (D45's list); D35; the 45
  backlog special districts; the ask-box map growing from refusal logs.

## 19. The 2026-08-14 session (third session of 2026-08-14) — the tester's feedback lands, and the walk finds the modal killer

Branch `claude/tester-feedback-0814`. The outside tester's recorded
live-demo feedback, triaged and executed as the session brief. All
dates below are wall clock.

### 1 — The Rockaway mayor takes off Tucson's language (M46, GATED — passed)

Diagnosis: the per-office-TYPE mayor blurb in
`lib/officials/office-blurbs.ts` was written for Tucson — the
council-manager sentence, the Tucson charter basis, the Tucson charter
HYPERLINK — and rendered on every mayor, so Rockaway Township's mayor
wore another jurisdiction's content (phone correctly NJ, from the
roster). The uniqueness invariant's sibling in curated words. Fix: the
generic mayor blurb is jurisdiction-neutral by construction; Tucson's
verified copy moved to `DIVISION_OFFICE_BLURBS`, applied only when the
holder's own division matches, resolved mechanically off the roster
carrying them. The mechanical audit (`tests/jurisdiction-content.test.ts`
— per-state place names, domains, phone area codes across rosters,
curated bodies, everyday contacts) found the mayor blurb was the ONLY
contamination. Gate: `walk0814c-07866-mayor-GATE.png`, spot-verified
against rockawaytownship.org.

### 2 — Kearsarge, and every layer defaults on (M47)

Diagnosis: default layer selection — not the registry join (the §4.4
oracle resolves Kearsarge at 03255) and not geometry (the school layer
is committed for Merrimack NH). The school type was missing from
`DEFAULT_DISTRICT_TYPES` and the overlay master defaulted off, so a body
the who-governs card counts was unreachable on the map. All six types
now default on, master on (an explicit off is honored); the
claims-reachable guard extends the stated-N family: every counted body's
division must exist in a default-on layer's committed geometry. Rejected
alternative recorded: the 2026-08-12 one-type-per-tier legibility
default — legibility tuning loses to hiding a claimed body.

### 3 — The governor, the tiers, and the blind spot (B11, M48)

The who-governs card is built from division rows and a statewide
executive is elected by no district on the map — the registry's shape
was the card's blind spot, and the most prominent officer in every state
was missing at every zip. `lib/officials/statewide-executives.ts`
attaches the governor by the senators pattern (state OCD prefix).
Browser-verified before ship (all three sites wall plain clients; rungs
in source-ladder.md): AZ Hobbs — the draft contact path 404'd, corrected
to /constituent-services with 602-542-4331 and engage@az.gov read off
the page; NH Ayotte — 603-271-2121 published, contact page corrected;
NJ Sherrill — the office publishes NO phone; the row ships null plus the
live contact form, because an absence is an absence.

`lib/officials/tier-grouping.ts` (M48) is the ONE derivation every
officials surface reads: LOCAL (rosters) → STATE (legislators, then
governor — order of scope) → FEDERAL (House member, then senators).
Always closest-first — the product's thesis is that the government
nobody watches is the nearest one. "Federal", never "National".
Membership by structure; `namedHolderCount` reads the same derivation so
the stat card's N and the door's rows cannot disagree. The officials
door gained the local rosters its flat list had silently omitted.

### 4 — Tie-or-zero refuses (A11), and the breakdown (B12)

The 85723 defect: `bodiesFor` matched municipal on divisionType +
bodyClass, and the Public Housing Authority — honestly GOVERNING,
honestly attached to place:tucson — swept into the pothole answer. A
routed step now names only a division's OWN governing body (the
registry-minted `#governing`/`#board` slot — structural, never a class
or name match); the fixture test audits every topic route at 85723.

Party breakdowns (B12): pure arithmetic over the snapshot's positions
joined to the roster's party labels, refused unless the per-party sums
equal the chamber's recorded tally exactly (40/40 votes pass). Rendered
as numbers only, parties alphabetical; the honest unavailable line
otherwise.

### 5 — The ballot as a call to action (M49, M50, M51)

The standing header: next election + one-tap add-to-calendar,
registration deadline + link, early voting, and the line answering the
tester's exact confusion. Calendar links consolidated to ONE control
(popup: Apple/Google/Outlook — same .ics, presentation not plumbing).
"Make your voice heard" replaced "To be heard" verbatim. Incumbent
cards: "[Name] currently holds this seat, so there's more information
about them — that's not a bias, it's a record." The picks card (M50,
author-approved): device-local picks drawn onto a canvas, downloadable,
nothing transmitted, constraints held in source; Clear-my-picks with
inline confirm. The 6-batch (M51): measure-card ask weight, the
WALL-CLOCK DATES SWEEP (the session-label convention had leaked future
dates into 246 provenance fields across nine curated files — mapped to
real dates via git history: labels 08-15/16 ran 08-13, labels
08-17/18/19 ran 08-14; a guard now scans every provenance field and
fails on any future date, denominator stated), the five-step first-run
tutorial, the moving-here state-picker line, and the 3-second ask beat
with animated dots.

### 6 — The walk's catch: overlays were killing themselves (M52)

The large official modal could not OPEN at any phone viewport — map and
ballot both. The back-button-closes-modal behavior pushed
`{overlay:true}` onto `window.history`; Next's App Router owns history,
re-rendered the route, and remounted the island holding the modal's open
state — the modal died the tick it opened. Proven by toggling exactly
that line (works at 1280px where the effect skips; both push shapes die
at 390px). This was §18's queued "hydration live, click dead" item, and
it means PHONE READERS COULD NOT OPEN ANY OFFICIAL'S FULL CARD in
production during the tester's demo period. The pattern is removed from
official-modal, entity-modal, and list-overlay; Escape, the close
control, and backdrop click close; the back button navigates.

### Standing rules adopted (X04, CLAUDE.md)

Organizations render as filed, never characterized; every blurb carries
its source class. Guarded where a guard can reach
(`tests/org-characterization.test.ts`).

### Recorded, not built

P12 people's-voice aggregates TABLED by the author (nobody builds it in
passing); T10 the demo-deletion promise with its due condition; D46 prop
sponsors parked; D47 state comparison parked behind the moving-here
link; V07 ed-tech parked; R13 the playbook clause, standing and
permanent. D35 notes the tester independently requested
top-issues-per-candidate.

### State as of 2026-08-14 (third session)

- **435 tests, lint clean (one pre-existing warning), build exit 0** —
  verified by exit code; walk0814c 136 checks green (85701 32, 07866 34,
  03255 31, 85641 31, 85723 8).
- The item-1 gate PASSED with the screenshot, spot-verified against the
  township's own site.
- Next free tracker ids: A12, B13, D48, M53, P13, R14, T11, V08, X05.
- Open next: the photo session (D45's list, author's order); D35
  (positions machinery — tester demand now on record); the 45 backlog
  special districts; the ask-box map growing from refusal logs; T10
  fires at testing end.

## 20. The 2026-08-14 session (fourth session of 2026-08-14) — the locks go on (T08)

Branch `claude/t08-intake-locks-0814`. The author's brief: production is
public with the password down DELIBERATELY (the tester works without
friction, and it stays down); T08's hardening was scoped to precede
public reachability and the order inverted by accident. This session
restored it — T08 and nothing else, locks on the pipes, not the door.
Nothing built here adds friction for a legitimate reader. All dates are
wall clock.

### The protections, and their flags

Everything tunable ships behind a named flag per the ripcord doctrine;
every threshold is separately tunable by env var without a code change
(`lib/signal/intake-limits.ts`); the pull/tune procedure the author can
follow at 2am is **`docs/ripcords.md`**.

- **`ripcord.rateLimits`** (ships LIVE; closer: the author) governs the
  tunable family on both intake routes (`/api/reactions`, `/api/log`):
  in-memory per-device and per-IP sliding windows (cheapest first,
  instance-local), the authoritative cross-instance per-device counters,
  the daily ceiling, velocity quarantine, and same-origin enforcement.
  Defaults: hard 40/min per device, soft (quarantine) 20/min, daily
  ceiling 400, per-IP 120/min reactions and 240/min log events, 500-char
  server cap on any log detail string. VALIDITY is deliberately not in
  the family and never switches off: real target ids from the committed
  registries, closed enums, body-size caps — a tap from the real app
  always passes because the app only offers real targets.
- **`ripcord.reactionIntake`** (ships LIVE; closer: the author) is the
  master: pulled, both routes refuse every write with a 503 before
  reading anything. The app renders normally and a tapping reader sees
  P11's honest line — "Couldn't reach the totals…" — with ZERO client
  change, because the client already earns success only from the 204.
  For live-attack response; procedure in docs/ripcords.md.

### The limiter never touches the store (1d — n-stores under load)

Rate limiting needs transient per-device state; that state lives in its
own table (`intake_limiter`), keyed by `sha256("intake-limiter:" + key)`
— a DELIBERATELY DIFFERENT digest than the store's `reaction_key_hash`
(`sha256(key)`), so two hashes of a secret nobody stores cannot be
joined. Counters only (day bucket/count, minute bucket/count), no zip,
no divisions, no IP, no reaction content, no foreign key; expires on its
own 48-hour schedule via the tripwire's purge. Guarded structurally in
`tests/db-schema.test.ts` and `tests/intake.test.ts` (disjoint columns,
different digests, zero foreign keys). The rule is now stated in
CLAUDE.md beside the store rules. IPs are read for the in-memory window
and discarded — never stored, never logged.

### Quarantine, not deletion (1e)

`reactions.suspect_reason` (`VELOCITY` | `LIMITER_UNAVAILABLE`, nullable
— a why, never a who; migration 0002 applied to Neon and verified by
information_schema query). Rows past the soft velocity threshold land
but are marked; rows written while the counters could not be checked are
marked rather than trusted through. STICKY on overwrite by COALESCE — a
burst cannot launder itself clean by re-submitting slowly; only the
author clears suspects. `rowsEligibleForAggregation` drops suspect rows
FIRST and UNCONDITIONALLY — no flag governs the exclusion; the clean
pool is the only pool aggregates and exports ever draw from.

### The tripwire (1f)

`.github/workflows/intake-tripwire.yml`, daily 10:41 UTC: identifier-free
day counts from both stores → `lib/signal/tripwire.ts` (pure, fixture-
tested) → `docs/intake-report.md`, committed. Flags: a day at or past
max(30, 4× trailing 14-day median) with at least 3 trailing days to
judge against, or quarantine share ≥ 25% on a day with ≥ 12 rows. Every
flag states its count and denominator; no flags renders an explicit
"None." Flagged, never auto-acted-on — the workflow reads counts, purges
expired limiter rows, commits the report, touches nothing else.
**Needs the author's hands: the DATABASE_URL repository secret** — until
it exists the scheduled run fails visibly rather than skipping silently.

### The test wall

`tests/intake.test.ts` (21 new; 456 total) asserts mechanisms, never
absence: script-burst refused at the 6th request with limits lowered by
env (the tunability proof doubling as the burst proof), foreign and
missing origins 403, invented target 400, human pace accepted, both
quarantine reasons excluded from aggregation with n counting only the
clean pool, sticky-COALESCE pinned, digest disjointness pinned, master
ripcord 503 on both routes with the honest line pinned on 503/429, the
tripwire's spike/share/None paths, and the workflow's read-only posture.
Test infrastructure note: `node --test` now resolves the `@/` alias via
`scripts/test-alias-loader.mjs` so route handlers are testable directly.

### The gate (production) — PASSED, both directions

Deploy verified by content (the new transparency paragraph serving),
never by the green light. Then, against `https://sparkwtp.netlify.app`:

- **The human direction** (`scripts/tester-walk-0814d.mts`, 390×844,
  8/8 checks green): a stranger's cold entry at 85701, the quick tour
  skipped, the ask box answering "who fixes potholes" (routed to
  `roads-local`, logged through the hardened route —
  `walk0814d-ask-answers.png`); the first-ever reaction tap parking
  behind the one-time notice (`walk0814d-disclosure.png`), acknowledged,
  landing with EARNED success rendering and no failure line
  (`walk0814d-tap-counted.png`); the answer changed at human pace and
  landing again. The Neon rows, by SQL: `CANDIDATE
  ballot-az-pima:governor|Katie Hobbs UNSURE suspect=null` 23:46:01Z
  (YES overwritten by the change — upsert working), plus the walk's
  SEARCH and QUESTION_ASKED log rows. The protections were INVISIBLE at
  human speed, which is the brief's constraint working.
- **The script direction** (probe script, output logged in §20's session
  PR): a 50-request burst on one device key → 40 accepted with the
  upserted row ending `suspect=VELOCITY` (23:46:21Z), first refusal at
  request 41 exactly (the hard 40/min limit), ten 429s with Retry-After.
  A human-paced probe beside it: 204, row `suspect=null` (23:46:13Z).
  Same shape locally before the merge (23:40Z rows).
- The limiter table held 5 counter rows after both gates — probe keys
  and the walk browser's key, counters only, joinable to nothing.

### The honest limit (recorded per the author's standard)

Slow distributed fakery by a determined attacker rotating devices (fresh
browser key per submission, many IPs, human-paced) remains possible
without accounts. What this session bought: expensive-to-fake plus
visible-when-attempted — per-device velocity and ceilings force key
rotation; key rotation from one IP hits the per-IP window; distributing
across IPs costs real infrastructure; and the tripwire makes volume and
quarantine-share anomalies a flagged line the author sees the next day.
The engagement-weighting and verification tiers (T02/T03) remain the
deeper answer and remain open.

### State as of 2026-08-14 (fourth session)

- **456 tests (21 new), lint clean (one pre-existing warning), build
  exit 0** — verified by exit code. Migration 0002 applied to Neon and
  verified by column query, before the code that writes the column
  deployed.
- This session's own probe rows in the production store, named so the
  tester-activity delta can exclude them: one clean YES on
  `house:119-2:264` (the local human-pace probe, 23:40 UTC), one
  VELOCITY-quarantined row from the local burst probe, and the
  production-gate rows named in the gate paragraph above.
- Next free tracker ids: A12, B13, D48, M53, P13, R14, T11, V08, X05
  (unchanged — this session opened no new rows).
- Open next: unchanged from §19 — the photo session (D45), D35, the 45
  backlog special districts, the ask-box map, T10 at testing end. Plus:
  the DATABASE_URL repo secret for the tripwire (Needs your hands).

## 21. The 2026-08-14 session (fifth session of 2026-08-14) - the faces come back (D20)

Branch `claude/photos-0814`. The author's brief: the ENTIRE session is
photos - the census's 16 of 747 becomes the other number, with the rule
never loosening: clean solo portrait or honest initials; license
recorded or it does not ship; match by stable id, never name-search;
download at build, serve from our origin, strip metadata; never a
screengrab, banner, logo, group shot, or generated likeness. All dates
are wall clock. The session crashed once mid-browser-phase and resumed
from the committed tiers without redoing work.

### The number

**16 of 747 became 476 of 750.** The denominator moved because the three
governors render on every who-governs card and were uncounted - a census
gap fixed the honest way (statewide executives are now a census surface).
Per surface: federal 437/437 (COMPLETE), statewide executives 3/3,
ballot candidates 33/109, curated locals 3/71, state legislators 0/130.

### How each tier landed

- **Tier 1, the GPO bulk fetch:** `scripts/fetch-official-photos.mts`
  widened from the four-zip wired set to every renderable federal
  official, keyed by bioguide, metadata-stripped through the new pure-TS
  JPEG/PNG stripper (`scripts/strip-image-metadata.mts`, unit-tested;
  225 of 427 images carried EXIF that is now gone). One 503 was retried
  to success; the 10 genuine 404s (new members the pictorial mirror
  lacks) were recovered in Tier 3 via Wikimedia Commons P1157 lookups -
  a stable-id join to public-domain congressional portraits.
- **Tier 2, the chambers:** the terms hunt found NO reuse grant on any
  of the three legislature sites - azleg.gov and gc.nh.gov carry bare
  all-rights-reserved footers with no terms page (checked in a real
  browser), njleg.state.nj.us's own disclaimer grants nothing, and the
  NJ.gov executive-portal grant does not cover the OLS site. All 130
  state legislators stay honest initials; the per-chamber findings are
  ON EVERY MISSING ROW in the manifest, FOR COUNSEL. The governors
  shipped anyway - Commons portraits, attribute-verified, licensed.
- **Tier 3, the hand work:** the Commons rung ran for all 181 targets
  (identity by P1157 for members of Congress; position-held + place
  attribute verification for everyone else; 2+ plausible items =
  AMBIGUOUS = miss, never guessed). The challenger blind spot - the
  office SOUGHT is not the office HELD - was found and fixed in a
  corrected second pass (Brown, Sununu, Petersen, Yee, Kolodin, Horne).
  The campaign og:image rung walked all 15 recorded campaign sites: 4
  passed judgment, 11 failed in exactly the canonical classes (logos,
  wordmarks, banner composites, a blank white logo, a novelty-sign
  photo) - each on its hunt. Sitting members on ballots reuse their
  committed portraits (the Goodlander precedent): Biggs, Schweikert,
  Ciscomani, Pappas, Grijalva, Mejia. The 8 pre-existing external card
  photos were localized to our origin (D20's never-hotlink now holds on
  candidate cards too).

### The machinery that outlives the session

- `lib/registry/official-photos.json` is the single license ledger:
  every photo has url/sourceUrl/license/attribution; every absence has
  reason + attemptedAt. `scripts/photo-census.mts` now GENERATES the
  report's officials and candidate-cards tables from the ledger and the
  cards file, so `docs/photo-report.md` cannot drift from what ships.
- Curated locals: `lib/registry/roster-photos.json` is the tiny
  client-safe derivative body-rosters.ts imports (the full manifest is
  server-only); a test pins it byte-equal to the manifest's licensed
  roster rows. Statewide executives carry their photoUrl in
  `lib/officials/statewide-executives.ts` with the license row pinned by
  test.
- Verification: every staged image was eyeballed before shipping; a
  21-member federal sample was cross-checked pair-by-pair against
  bioguide.congress.gov (an independent archive keyed by the same
  bioguide id - same face on all 21); the 390x844 walk hit all four
  zips - 30+ portraits rendering from our origin, zero broken, honest
  initials confirmed where photos failed judgment (Harned, Hathaway).
  Walk caveat recorded honestly: the browser pane could not composite
  screenshots this run, so the walk verified at the DOM level
  (img.naturalWidth, served bytes, HTTP status) rather than by pixels;
  the lazy-images-not-loading scare during the walk was the hidden
  pane suspending lazy-load, not an app defect.

### Open, and for counsel

- FOR COUNSEL: may the product reuse state-legislature member portraits
  under a public-records theory when the chamber site states
  all-rights-reserved and publishes no terms? The finding rows name each
  chamber. Until cleared: initials.
- The jurisdiction-terms rung for 9 smaller local bodies is recorded
  OPEN on their rows (the three largest jurisdictions were checked - no
  grants).
- Ballot misses (76) and local misses (68) all carry their rungs; new
  rungs for the playbook when zip work resumes: bioguide.congress.gov as
  an id-keyed verification archive; Commons P1157 for members the
  pictorial lacks; the og:image rung with its high logo/banner failure
  rate.
- Next free tracker ids: A12, B13, D48, M53, P13, R14, T11, V08, X05
  (unchanged - this session edited D20 in place and opened no new rows).

## 22. The 2026-08-14 session (sixth session of 2026-08-14) — the tester's mobile pass: Arizona bleeds again, and the ballot goes missing on phones

Branch `claude/tester-mobile-pass-0814`. The outside tester ran a full
mobile pass and sent recorded feedback with screenshots. Her overall
verdict was good — navigation smooth, she found everything without the
tutorial, the calendar and election header praised. This session is the
defects underneath that verdict, plus the one finding that is bigger
than any of them. All dates in this section are wall clock.

### 1 — Arizona bled into New Hampshire through the ask box (M53, gated)

The tester asked **"library" at 03255** and was told about **Pima
County, Arizona**. The rendered explainer read "in Pima County the
county board sits as the Library District board" — one jurisdiction's
content bound to another jurisdiction's key, the exact shape of the
Rockaway mayor (M46) and of the D40 cache key, in a third place.

**Diagnosed before fixing, and the diagnosis narrowed the claim.** A
full audit — all 16 topics × all four zips, every rendered sentence and
every rendered link, resolved live against the real registry — found
**exactly two contaminations, both the same libraries template** (it
renders at 07866 and 03255; at the two Arizona zips it is not foreign).
Every *link target* in every answer already resolved correctly from the
reader's own coverage: at 03255 the two bodies were Newbury town
(newbury.nh.gov) and Merrimack County (merrimackcounty.net). So the copy
was wrong everywhere it rendered, and the links were right — the
tester's "tapping through landed on the Pima County Library Board" is
best explained by the sentence itself naming that board as the body to
approach. **The link half of item 1 was already sound and is now guarded
rather than fixed**, which is the honest way to report it.

The fix keeps the sourced Pima fact rather than deleting it: shared
templates are jurisdiction-neutral by rule, and place-specific truth
moves to a step's `divisionWhy`, resolved against the divisions in the
reader's OWN coverage (`lib/routing/resolve.ts`). Pima's reader still
reads "Here the library system is a county library district, and the
county Board of Supervisors sits as its board"; New Hampshire's reads
"in some places the county board doubles as the library district's own
board". This is the topic-template sibling of `DIVISION_OFFICE_BLURBS`.

The guard (`tests/jurisdiction-content.test.ts`) grew three tests: the
shared templates name no covered place at all; every ask-box answer at
every covered zip is free of another state's content **and links**, with
the denominator asserted (64 answers, 200+ rendered strings, and the
test fails if the audit reads too few); and the regression itself, both
directions. Proven by reintroducing the string — three tests fail.

### 2 and 3 — one root cause: an unbounded overlay in a bounded viewport (M54, M55)

The tester: the what's-on-the-ballot floater never appears on her phone,
and the only entry she could find sat at the very bottom of the drawer,
under the browser chrome. **"I don't think I would have found that
without knowing it existed."**

Measured at 390×844 before anything was touched. The bottom overlay
stack was bottom-anchored with **no upper bound**, so the who-governs
card grew to **893px against an 844px viewport** and its top landed at
**y = −113**. Everything above the fold went with it:

- the ballot bubble rendered at y=12 and was painted over by the card —
  present, invisible, untappable (`elementFromPoint` at its centre
  returned a card row, not the link);
- the count badge sat at **y = −166**, entirely off screen;
- the card's own minimize control at **y = −104**, unreachable.

And what *did* stay on top were the fixed controls, sitting over card
text: the hamburger at (12,12,44×44) and MapLibre's zoom column at
(349,0,41×70) — which is item 3, the same defect seen from the other
side. The tester reported two problems; there was one.

Fixes: a `--map-control-band` token reserves the top strip at phone
width and the bottom stack starts below it, so no fixed control ever
sits over readable content; the stack has a definite height and the card
shrinks into it and scrolls internally (`min-height: 0` is what actually
lets a flex child shrink — without it nothing changes); and the top row
sits above the stack by **explicit z-index rather than DOM order**,
because relying on order is what let a tall card bury the ballot in the
first place.

Then the entry itself, because an invisible floater made visible is not
the same as a findable one. A pinned **"What's on the ballot →"** row
now sits in the who-governs card's non-scrolling head — top of the
surface she was actually reading, in words rather than a 10px pill — and
the rail's ballot link moved out of the `mt-auto` footer into the
sidebar header. Verified in-browser: bubble tappable at y=12, card entry
at y=180 still pinned after the body scrolls 298px, rail entry second in
the header.

### 4 — the district-type defaults: the brief's hypothesis was wrong (M56)

The tester saw roughly four of six district types checked and enabled
the rest by hand. The brief's stated likely cause was stale device-local
layer preferences, to be cleared by a one-time versioned migration.

**Diagnosed before building it, and the hypothesis does not survive:
district-type selection is not persisted anywhere.** It lives in the
in-memory UI store and is rebuilt from `DEFAULT_DISTRICT_TYPES` on every
load; the only persisted district key is the `wtp.show_districts` master
toggle, which stores one flag. No device can be carrying a stale layer
selection, and the migration would have migrated nothing. Nor is it a
defaults regression — a fresh load renders all six checked, verified
in-browser.

The actual cause is timing. Her pass began **2026-08-14 18:32 UTC**; the
all-on default (`87812f8`) merged to `main` at **22:59 UTC the same
day**. She was reading the previous deploy, whose default was exactly
three types — congressional, state-house, county — plus the "Show
districts" master toggle, which is the fourth checked box she counted.

Both device profiles the brief asked for were still verified: a fresh
device, and a device carrying pre-fix `wtp.show_districts=1`. Both land
all six on. A device carrying an explicit `"0"` keeps the overlay off,
because that is the reader's own choice and not staleness. **No
migration was built** — recorded here so nobody builds one later — and a
guard now pins the fact that keeps this answer true: the moment a
district-type selection starts being written to device storage, the
defaults stop being authoritative and a migration IS owed.

### 5 — the tester's biggest finding, and a new non-negotiable (B13, B14, V08)

Her words, recorded verbatim because they are the origin of the rule:

> "Karen might be the perfect fit for me, but she has no information
> here. So I'm only going to look at the folks that do have
> information... how could using this app actually impact voter outcomes
> instead of collect information from voters."

This is a neutrality failure none of the existing rules catch. The app
never ranks, never scores, never recommends — and still tilts the race,
because a thin card tracks incumbency and campaign professionalism
rather than merit, and a reader rationally skips the candidates it says
nothing about. Silence is not neutral.

Two things shipped. **The absence is named**: every candidate whose card
carries no photo, no words of their own, no contact and no link now
renders "We haven't found much about this candidate yet." — one
sentence, full stop, no apology and no second sentence, on the card
component itself so it travels to every surface a thin card reaches.
**Of 136 ballot candidates walked, 101 are thin today** (heuristic walk
of the three filed sets plus the certified lineup — the method is stated
because it is not a registry query). That number is the case for B14.

And **equal effort per candidate within a race** is now a CLAUDE.md
non-negotiable: hunts for candidate information run for every candidate
in a contest to the same rung depth, misses recorded per candidate. A
hunt that stops when the well-covered candidates are done has produced a
ranking. B14 (the blurb-equalization hunt) and V08 (the candidate
coverage-gap report, the author's idea — a candidate-side surface
showing a candidate our coverage of them versus their opponents, never
any reader data) are recorded, not built.

### 6 — PAC typing: the funding section says what kind of money (D48)

The author's item, validated by the tester the same day: every committee
in her screenshot read "a political action committee". The
organizations-as-filed rule gains its plain-language layer.

The data path turned out cheaper than feared — the FEC's Schedule A row
carries a `contributor` object with the contributing committee's own
`committee_type`, `organization_type` and `designation`, so no second
lookup pass was needed, only capturing three fields the fetcher was
discarding. The snapshot was re-fetched (121 FEC requests, 213 rows;
**75 of 105 committee rows carry filed typing**, 30 carry none and keep
the honest generic).

`lib/funding/committee-types.ts` is the whole mapping, one
author-reviewable file, derived mechanically and never from a name — a
guard asserts the derivation contains no string inspection at all. Each
label taps open two sentences sourced to the FEC's own pages, both
fetched and verified this session (the committee-type code descriptions
page, and the master-file description page for ORG_TP and CMTE_DSGN).

**Caught by reading the output before shipping**, which is the point of
reading the output: designation `J` (joint fundraiser) files under
committee type `S` or `N`, so a type-first ordering rendered DUCKWORTH
KIM VICTORY FUND as "another candidate's campaign committee" and BOOKER
VICTORY FUND as a plain PAC. The designation is the more specific filed
fact and now wins. Over the snapshot the labels land as: 39 joint
fundraising, 16 hybrid PAC, 16 organization, 16 the candidate's own
money, 7 leadership PAC, 6 PAC connected to a corporation, 3 trade
association, 2 labor union, 1 membership organization.

One guard in this batch failed loudly and deserved to: the
never-type-from-a-name test built its patterns with `new RegExp` over
strings like `"includes("`, which is an unterminated group and throws
rather than checking anything. **A guard that cannot run reads as
green.** Rewritten with plain substrings.

### 6b — photos, round 2: the second door, and 281 more faces (D50, In progress)

The author's decision, into CLAUDE.md: a photo now ships on **an
explicit recorded licence OR an official government-published
portrait** — the portrait a body publishes to identify its own member —
with the source recorded, attribution to that body, and a documented
remove-on-request posture. That posture is now a section on the
transparency page, shipped in the same commit as the rule, because a
remove-on-request promise that the person pictured cannot find is not a
posture. Commercial photography still needs an explicit licence, no
exceptions. Every manifest row now records **which basis** it ships on.

**476 of 750 → 535 of 750.** The manifest holds 721 portraits — 281
under door 2, 440 under a recorded licence — and 410 recorded misses,
each carrying its rung.

**Three wrong faces first.** Katie Hobbs shipped a Gage Skidmore event
candid; the state's own studio portrait replaced it. Checking the other
two governors while there — which the brief asked for and which was the
right instinct — found both also wrong in kind: **Kelly Ayotte was
wearing her 112th-Congress U.S. SENATE portrait**, a different office
and roughly fourteen years old, and Mikie Sherrill a Commons headshot.
All three now carry their own offices' official portraits. New
Hampshire's site 403s a plain client; the portrait came back on the next
rung through a real browser at the same published URL — a public page,
no access control touched, which is the ladder working exactly as
CLAUDE.md describes.

**Then the tier the old rule blocked whole.** Every state legislator's
chamber member page was walked, joined by the chamber's own stable id
already in our roster: **620 attempted, 281 portrait URLs found, 339
misses recorded; 278 staged and shipped, 3 rejected on shape** (banner
crops at 87×152, 200×159, 199×150). By chamber: **AZ 90/90, NJ 118/120,
NH 73/410**.

Three rungs had to be found rather than assumed, and each is worth the
playbook:

- **NJ's member pages are client-rendered** — the served HTML is a
  loading spinner, so the plain-client rung returns nothing.
  Instrumenting `window.fetch` in a real browser surfaced the endpoint
  the page itself calls, `/api/legislatorData/legislatorBio/{rosterId}`,
  keyed by the roster id we already hold. 118 of 120.
- **NH names its portrait files after the member id**, so the first pass
  rejected all 410 for an alt text reading "member picture". Widening
  the confirmation to accept the chamber's own id in the file name — a
  structural signal, stronger than a surname match — recovered 73.
- **NH's remaining 337 are an honest absence on their side**: the House
  serves a literal `nophoto.jpg` for members it publishes no portrait
  of. The miss reason now says that in those words rather than reading
  as our hunt failing.

Of the 278, **59 land inside the census's 130-legislator universe** (the
legislators actually rendered at the four covered zips); the other 219
serve legislators outside current coverage and are banked. Verified
twice by eye: a 22-face contact sheet of staged images before shipping
and a 20-face sheet of the committed files afterwards, the latter also
confirmed serving 200 with real bytes from our origin, 20 of 20.

**What 6b did NOT reach, recorded as open work rather than as a
finding:** the Commons sweep for the 71 remaining NH legislators, the 68
curated locals, the ~76 ballot challengers, and the drafted email rung —
`docs/photo-requests.md` was not written. D50 stays **In progress** and
those rungs are its remaining work. The brief's cut guidance put the
Hobbs verification and the chamber fetches first; both are done, and the
thinning fell on the email drafts, as it authorised.

### 6c — LegiScan, recorded and deliberately not fetched (D49)

Row only. Nothing was fetched, no adapter written, no dependency added —
adding an external source is an ask-before item. The evaluation the row
names is the anchor for a future state-layer session: terms read against
BOTH the free consumer app and the commercial data layer separately,
AZ/NJ/NH roll-call coverage verified specifically rather than in
general, and per-key distinctness proven before any id join ships.

### 7 — the walk

`scripts/tester-walk-0814e.mts`, 390×844, cold entry, all four zips:
**72 checks green, 0 failed** (18/18 at each). `docs/tester-pass.md` is
superseded and carries the gate screenshots and the honest notes.

Two of the walk's own failures were **script** bugs, not app bugs, and
are worth recording because both would have read as red on a working
product: `[data-ask-box]` matches the sidebar rail's hidden copy first
at phone width, so the item-1 gate reported "the ask box is
unreachable" when it was on screen the whole time; and a one-level
ancestor of that input captures the word "Ask" and none of the answer,
so the link check saw zero links. Reading the failure instead of
believing it is what separated them from real defects.

### Deltas since the tester began, 2026-08-14 18:32 UTC

Queried directly, not read off the daily report:

- **Reactions: 20 of the store's 21 all-time rows** landed in this
  window — FEDERAL_VOTE 10, CANDIDATE 7, CONTRIBUTOR_REACTION 2,
  FUNDING_TOTAL_REACTION 1. **2 are quarantined** by `suspect_reason`
  and excluded from every aggregate unconditionally; nothing was
  auto-deleted, and the author decides.
- **Search log: 208 of 511 all-time rows** — SEARCH 66, QUESTION_ASKED
  42, FILTER_APPLIED 41, OFFICIAL_OPENED 40, BODY_OPENED 10,
  DISTRICT_SELECTED 9. The 42 questions are the ask box's roadmap; the
  identifier-free rule is unchanged and the two stores still share no
  joinable column.

`docs/intake-report.md` was regenerated and flags nothing: every day
sits inside the trailing normal range. Six limiter rows remain,
transient, joined to nothing.

### Open, and for counsel

- FOR COUNSEL, and now **narrower**: the all-rights-reserved finding on
  the three legislature sites is no longer blocking, because door 2 is a
  different basis from a licence — these are official portraits a
  chamber publishes to identify its own members, used with attribution
  and remove-on-request. If counsel disagrees with door 2 as applied to
  chamber portraits, **281 rows are a single filter away** (`basis:
  "OFFICIAL_PORTRAIT"`), which is the ripcord doctrine's shape even
  though this is not a flagged feature.
- D50's remaining rungs: Commons for the 71 NH legislators, the 68
  curated locals, the ~76 ballot challengers, and the drafted email
  batch.
- B14 (blurb equalization) is the equal-effort rule's first debt: 101 of
  136 ballot candidates are thin today.
- D49 (LegiScan) is recorded, unfetched.
- Next free tracker ids: **A12, D51, M57, P13, R14, T11, V09, X05**
  (this session opened M53–M56, B13, B14, V08, D48, D49, D50).

---

## 23. The 2026-08-14 session (seventh session of 2026-08-14) — the documents stop making up dates, and the mirror gets a short answer

Branch `claude/date-integrity-and-context-mirror-0814`. Two items, both
about documents making claims that are not true. All dates in this
section are wall clock, read from `pnpm stamp`.

### 1 — Fabricated dates (R14)

`CLAUDE.md` carried three rules stamped `Adopted` for August 16, 17 and
19. Every one of them is later than the file's own last modification and
later than every commit in the repo. The machine clock is fine —
`git-state.txt` stamped `04:01:34Z` on the *following* UTC day is 9:01pm
on the 14th in `America/Phoenix`. So nothing was mistyped: an agent wrote a
*plausible* date because it had none, which is the same failure as a
generated candidate position — a confident claim with nothing behind it,
and worse here, because a stamp says when a rule became law and every
later decision was supposedly made under it.

Five pieces shipped.

- **`pnpm stamp`** (`scripts/stamp.mts`) prints today as `YYYY-MM-DD` in
  `America/Phoenix`. The timezone is the point: `toISOString().slice(0,
  10)` is a day ahead for seven hours out of twenty-four here, which is
  this bug's smaller sibling and produces the same artifact. The day is
  computed once, in `scripts/doc-dates.mjs`, and re-exported by
  `stamp.mts` — three callers need it and a rule about dates enforced by
  three copies of a timezone calculation would be the joke it sounds
  like. That module is plain JavaScript so the pre-commit hook loads it
  with no type stripping in the path.
- **The rule in `CLAUDE.md`**, under the tracker conventions: an agent
  does not know today's date, and a date not read from the system clock
  is a fabrication.
- **`tests/doc-dates.test.ts`** scans `CLAUDE.md`, every `.md` under
  `docs/`, and the Notes and Detail columns of `docs/tracker.csv` —
  Target is excluded deliberately, an intended future date being the
  whole point of a target column. It reports its denominator every run.
- **`.githooks/pre-commit`** runs the same scanner over **staged**
  content (`git show :<path>`, not the working tree — a hook that checks
  the worktree passes a `git add -p` that staged only the bad hunk).
  Installed with `git config core.hooksPath .githooks`, which a fresh
  clone must run. Bypass is git's own `--no-verify`.
- **`pnpm verify-stamps`** (`scripts/verify-stamps.mts`) audits the
  stamps against git and writes `docs/stamp-audit.md`. Not in the test
  gate; it runs a `git log` per stamp and belongs at handoff.

**The stamps were corrected — recovered, not decided.** The first pass
of this session stopped at the report, because the rule is that the
author decides. The author's answer was that they did not know the real
dates and asked whether the transcripts could supply them. They can, and
they agree with git exactly, so a second pass corrected all five from
**two independent sources**: each rule's introducing commit carries an
author date already in `-0700`, and the exported session transcript whose
`Started` → `Last activity` window contains that commit is a second,
unrelated witness.

| Rule | Claimed | Real | Commit | Session window |
|---|---|---|---|---|
| The stranger test | 08-17 | **08-14** | `b25ac80` 00:42 | `323ab34a` 08-14 00:20→01:38 |
| Coverage denominator | 08-17 | **08-14** | `b25ac80` 00:42 | same |
| The ripcord doctrine | 08-16 | **08-13** | `56d8787` 23:27 | `c99995a7` 08-13 22:14→23:31 |
| Distinctness | 08-19 | **08-14** | `8046820` 09:31 | `5c784e1e` 08-14 09:16→12:05 |
| Disclosure (revised) | 08-16 | **08-13** | `8fa5759` 23:07 | `c99995a7`, same as above |

**Widening the audit found the fifth.** The first version searched only
for the word `Adopted` and walked straight past `(Author-revised …)` on
the disclosure rule — it reported eight of nine and called that complete,
which is precisely the failure this audit exists to catch. `STAMP_VERBS`
is now an explicit list and the report prints it, so a stamp nothing
audits is *visible* rather than assumed not to exist.

After the corrections the audit reads **9 stamps, 0 disagreeing, 0 later
than today, 0 `NOT FOUND`**. `CLAUDE.md` carries no future date at all
and the `AUTHOR_DECISION` allowlist group is empty.

**What the audit found before that.** Four wrong of eight, all fabricated
forward — the fifth was still invisible. The
stranger test and the coverage-denominator rule both claim August 17 and
landed 2026-08-14 (`b25ac80`, +3 days); the ripcord doctrine claims
August 16 and landed 2026-08-13 (`56d8787`, +3); the distinctness rule
claims August 19 and landed 2026-08-14 (`8046820`, +5). The other four
stamps checked out exactly. The report stopped there, on the rule that
the author decides and that correcting a date from inside the tooling
would be the same act that caused the defect. What changed that was not
the tooling's judgement but the author's instruction, and the correction
above is still a *reading*, not a decision.

**On the specified `--diff-filter=A`.** The brief called for
`git log -S<clause> --diff-filter=A`. That filter restricts the log to
commits where a *file was added*; `CLAUDE.md` was added once, long
before any of these rules existed, so with it on every stamp returns
`NOT FOUND` and the audit says nothing. It is run verbatim anyway and
reported in its own column, because a specified command quietly swapped
for a working one is how a report starts lying. The recovered dates come
from the unfiltered pickaxe, oldest commit first.

**The scope was six times what the brief expected (R16).** The author
expected three failures. The scan found **122 future-dated occurrences
across 29 file/date pairs** — the three in `CLAUDE.md` plus 117 more,
concentrated in `tracker.csv` (47), `state.md` (24), `source-ladder.md`
(17) and `coverage-audit-by-county.md` (14). Most look like the
session-label convention (§18: labels that ran ahead of the wall clock,
history deliberately not rewritten) and some are genuinely future events
— the general election among them. **They are enumerated, not
excluded.** Every one sits in the test's `ALLOWLIST` pinned to its file
*and its exact occurrence count*, so re-using a tolerated date to write
a new fabricated stamp still fails; every one prints as a warning with a
count on every run. An unenumerated known-failures escape hatch is how a
check stops being one. Sorting the 117 into session labels, real future
events and real fabrications is the author's call, and it is R16.

The three `CLAUDE.md` strings are a separate group in the same list,
`AUTHOR_DECISION`, and each entry is deleted when its corrected date is
approved.

### 2 — `context.md`, the seventh mirror file (R15)

`state.md` is a quarter of a megabyte. It is the wrong artifact to hand
a conversation that only needs to know where things stand — by the time
it has been pasted anywhere there is no room left for the question.
`context.md` is the short answer: the phase standings, every P0 tracker
row, every ripcord with its flag / state / open question / named closer,
the last ten tracker rows whose Status actually changed, and the git
facts. §3.5 carries the full description.

Three decisions worth recording.

- **A new row is not a status change.** Listing them would have filled
  the whole section with `(new row) → Done` from one session and pushed
  out every real transition. New rows are counted and the count is
  stated, so their absence is not silent.
- **Ripcord state is read from `lib/ripcords.ts`**, not from prose. The
  registry is the state of record — `pulled: true` is the committed
  position of the switch — and a prose copy goes stale in a way the
  registry cannot.
- **The 20 KB cap shrinks rather than hopes.** Tracker-change rows go
  first as specified, then the P0 notes narrow, and every cut is stated
  at the top of the file and again in the section it came from. If the
  cascade bottoms out the file says `STILL OVER` rather than quietly
  exceeding the cap. The path was exercised at 17, 14 and 10 KB rather
  than left as a branch nobody has run.

### Found on the way, recorded and not fixed

- **R16** — the other 117 future dates, above.
- **R17** — three places named a different mirror-file count and none
  matched the `MIRRORED` list (§3.5 prose said seven/six while its own
  table listed nine; the `handoff.mjs` header said five). The two
  sentences this session was already rewriting were corrected in
  passing; the durable fix is for the report to *count* the list instead
  of restating it.
- **R18** — `docs/intake-report.md` and `git-state.txt` stamp a bare `Z`
  instant, whose date component reads a day ahead for seven hours of
  every day. Not wrong as an instant, misleading as a date, and the same
  read that made the fabricated stamps look plausible.
- **R19** — `session:start`'s `EXPECTED_KB` is 17 and `CLAUDE.md` is
  26.5 KB, so its size check has been warning on every session open for
  a while. A warning that fires every run is one nobody reads.

`session:start` gained a fourth check on the way (in scope, since an
uninstalled hook is a guard that never fires and never says so):
`core.hooksPath` is local git config, survives no clone, and is now
reported with the one command that installs it. Reported, not repaired —
writing to a person's git config is a different kind of act from killing
a dev server this repo started.

The pre-commit hook refused this session's own tracker rows for quoting
the bad stamps, which is the check working; the rows were reworded to
name the days without the literal strings.

### Evidence

- **476 tests pass (3 new), lint clean, build exit 0.** (Kept on one
  line deliberately: `git-state.txt` reads the last line in this file
  matching a test count and looks for the verdict words on that same
  line — wrapped, the first draft of this bullet reported "recorded
  without a verdict" and no build status at all.) The one lint warning
  is pre-existing, in `scripts/tester-drive.mts`. The date scan reports
  **1026 dates scanned, 0 failures, 88 allowlisted hits of 117
  declared** — allowlisted hits are a warning line on every run, never
  part of the pass. The hook was proven to refuse, not merely to exist,
  by staging a probe date and watching it exit 1.
- **The session crossed midnight in Phoenix, and the guard moved under
  it.** `pnpm stamp` went from `2026-08-14` to `2026-08-15` between the
  correction and the ship, so 29 allowlisted dates stopped being future
  and the observed count fell 117 → 88 with nothing edited. The warning
  line now prints **hit of declared** rather than one number, because a
  count that falls on its own reads exactly like a count someone fixed.
  The allowlist retires itself, entry by entry, as the clock passes each
  date; the declared budget is what pins the inventory. The audit's
  recovered dates are unaffected — commit author dates are historical
  facts already carrying `-0700`.
- `context.md` landed at **18.6 KB of 20 KB, nothing truncated**.

### Open

- **The author's four decisions** are in `docs/stamp-audit.md`: three
  stamps in `CLAUDE.md` to correct or confirm, and the fourth already
  matching. Deleting an `AUTHOR_DECISION` allowlist entry and fixing the
  stamp belong in the same commit.
- **R16** — the 118, unsorted.
- Everything open at the end of §22 is still open; this session touched
  no product surface.
- Next free tracker ids: **A12, D51, M57, P13, R20, T11, V09, X05**
  (this session opened R14–R19).

## 24. The 2026-08-15 session — the counters stop lying, the past comes back, and the dashes decode

The author's production pass again, delivered as the session brief
(committed at `docs/session-brief.md`). Five truth defects, then photos.
Each was **measured before it was fixed**, and three of the five turned out
to be worse or different than reported — which is the argument for measuring.

Branch `claude/counters-meetings-photos-0815`. Test 503 pass, lint clean
(one pre-existing warning in `scripts/tester-drive.mts`), build exit 0,
walk 60/60 across four zips.

### 1 — The sidebar counters (M57), the denominator disease's third sighting

The author saw "6 OFFICIALS" beside an officials popup listing more than
twenty people, and a blank DISTRICTS counter. Measured on production at all
four zips before touching anything:

| Zip | OFFICIALS card | officials door | BODIES card | bodies door |
|---|---|---|---|---|
| 85701 | 6 | 24 | 13 | 60 |
| 07866 | 6 | 31 | 3 | 4 |

**Two counters were wrong, not one, and nobody had noticed the second.**
Both had their own private derivation, correct when written and never
updated as their doors grew. OFFICIALS counted `seats[].representatives`
plus `senators` — the pre-roster shape, which never learned about the
curated local rosters (M05) or the statewide executives (B11), so a mayor,
six council members, a five-seat governing board and five county supervisors
were rendered by the door and counted by nobody. BODIES counted distinct
bodies **with meetings** in the filtered set while its door listed every
body covering the point.

The fix is not "make the numbers agree": it is that a counter is handed the
collection its surface renders — `computeStats({meetings, coverage,
drawnDistricts})` — so a re-derivation cannot drift again. Guarded at all
four zips against the committed registry, and mutation-proven: reinstating
either old derivation fails all four tests.

**DISTRICTS was its own bug and a different one.** It rendered "—", which is
this product's word for *we could not check*, for an overlay the reader had
simply switched off. Spending the couldn't-check dash on a switch made the
one number that was never broken read as the broken one. It says **Off**
now, and its door carries the switch rather than sending the reader to hunt
for a checkbox in the sidebar — the hidden-entry-point defect M27 already
cost a session. The door's title also changed from "Districts here" to
"Districts in view": the list is the viewport's drawn districts, and at
85701 it includes Marana and Oro Valley, which the reader is not in.

### 2 — Concluded meetings (M58): the chip was dead everywhere, not just outside Tucson

The brief's report was that concluded meetings render only at 85701. The
measurement was worse and simpler: **tapping the Concluded chip rendered "0
meetings — nothing matches" at all four zips, Tucson included**, while the
payloads behind those screens carried 24 concluded sittings at 85701, four
at 07866 and two at 03255. The server has been sending the recent past with
every successful rung for weeks. The client's default date window starts at
*now*, so `days < -daysBack` dropped every one of them, and the only control
that names concluded meetings could never match a row by itself.

That is M27's shape one group over: a control that stays fully interactive
while a different control in a different visual group makes every click a
silent no-op — and worse than hidden, because it answers "nothing matches",
which reads as a fact about the government rather than about a slider. A
reader asking for concluded meetings is asking to look backwards, so the
selection now carries its own window (`lib/state/status-intent.ts`, the
`district-intent.ts` precedent). Turning the chip back off does not slam the
window shut: the reader may have dragged it there themselves.

**Per adapter, with counts** (the full ladder is in `docs/source-ladder.md`).
Six of nine already served history — legistar, onbase, clerksboards,
diligent, iqm2, boardbook. Three did not:

- **apptegy** (Vail, Rockaway Township school board) — the vendor serves
  history and *we never asked*. Rungs walked: `from`/`to`, `past=true`,
  `month`+`year`, `order=desc`, `archived=true` all ignored;
  **`start_date=` honoured**, and it survives the feed's own pagination.
  Both orgs now return four concluded board meetings each. The ingest script
  was omitting the window entirely, which read as "give me everything" and
  meant "upcoming only" to any upstream that defaults that way; it states
  the app's own cascade window now.
- **civicplus** (Rockaway Township) — upcoming only, earned: the wired feed
  and the same feed with `startDate`/`endDate` and `from`/`to` returned
  byte-identical documents, and the only two past `DTSTART`s are VTIMEZONE
  boilerplate present in every category id.
- **revize** (Merrimack County) — upcoming only by construction; the block's
  heading is literally "Upcoming Meetings".

Both closed routes now render an honest line at their jurisdiction instead
of an empty list. Both have a **further rung found and not built**: Rockaway's
AgendaCenter archives 214 dated documents back to 2019 and Merrimack's
notices page carries notice/packet/minutes PDFs for seven past meetings —
each publishes a date without a start time, and inventing one to fill
`startsAt` would be a generated fact about a government. **M59** owns it.

### 3 — The mojibake (M60), and two more nobody reported

Every blurb attribution rendered an em-dash as three cp1252 characters. One
operation in the 2026-08-14 photo session round-tripped
`data/ballot/candidate-cards-2026.json` through a bad decode: 28 existing
em-dashes and 130 newly written ones, plus 34 inherited by
`docs/photo-report.md`, which generates its candidate section from that file.
No committed script does this — every one reads and writes UTF-8 through
Node — so the cause was an ad-hoc shell round trip, exactly the class a
guard has to catch.

Repaired at the data, never at the render. Then the repo-wide scan found
**twelve more the author had not reported and nothing else would have**,
separately caused and separately fixed at source:

- `scripts/build-street-index.mts` read TIGER's ADDRFEAT DBFs as **latin1**;
  they are UTF-8. Twenty-two Tucson street names across eight zips shipped
  garbled. Nobody noticed because only the Spanish-named streets corrupt and
  a reader typing "cir" still matched the ASCII prefix. Index rebuilt.
- Diligent's BoardDocs portal serves **genuinely double-encoded bytes** — its
  pages declare and send UTF-8, and the UTF-8 they send spells out the broken
  pair where a guillemet belongs, verified against the raw bytes. Our decode
  is correct and the vendor's text is wrong, so `extractHtmlText` repairs at
  our custody boundary, which is ingest and not render.

**The repair caught itself being wrong.** The first `repairMojibake` ran the
inverse over the whole string and silently turned the 32 em-dashes that had
been written *correctly* into U+FFFD, while reporting success — the
operation-that-can-do-nothing shape wearing a repair's hat. Found by
asserting the em-dash count moved by exactly the number of sequences
removed: 32 + 158 should have been 190 and it produced 158. It is per-match
now, and `scripts/repair-mojibake.mts` refuses to write unless every
sequence is accounted for.

The guard scans all 489 tracked **and untracked** files. It could not see
untracked ones at first, which is how three of its own documenting comments
went unnoticed until the commit that tracked them; those comments now name
the bytes by codepoint, so the guard is not policing a corpus it pollutes.

### 4 — Party on who-governs (M61), and what the silence was hiding

Ayotte read "Republican" on the ballot and nothing on the who-governs card.
**Not a render bug**: every officials surface draws `partyLabel` through one
`Holder` component. The three governors' rows carried `partyLabel: null`
deliberately, on the reasoning that a governor's office page styles itself
officeholder-first — and `RosterHolder`'s TYPE pinned party to `null`
outright, with a comment asserting these are "nonpartisan offices as
published".

All three governors now carry a party from the election authority's own
certified filing, cited per row and verified today: **Hobbs — Democratic**
(AZ SOS nominations filed, text-extracted from the PDF), **Sherrill —
Democratic** (NJ Division of Elections official tally 12/03/2025, found by
walking the Division's archive after a guessed URL 404'd and was discarded
rather than cited), **Ayotte — Republican** (NH SOS cumulative filings
7.16.26 — the same document our ballot record cites; re-fetch today returned
**403 to a plain client, to a browser user-agent, and to a real Chromium
navigation**, and `sos.nh.gov/elections` itself 403s the same way, so the
whole host refuses this network. Recorded, not circumvented).

`tests/party.test.ts` now fails the build if the ballot and the officeholder
row disagree about a person's party or cite different records for it — the
reported defect, turned into an invariant.

**The audit found the bigger thing.** 64 of 86 officeholders at the four
zips carry no party, and walking rung 1 across all twelve curated bodies
showed why: **not one publishes party on its own roster page** — not Pima's
supervisors, not Tucson's mayor and council, not Morris or Merrimack's
commissioners, not Rockaway's township council, several of which are
unambiguously partisan seats. The silence was a fact about the pages being
read as a fact about the offices. Each roster now records `partisanship`
with the record that settled it, all twelve `UNDETERMINED`, so nothing
renders and the open question is stated rather than implied closed. The next
rung is the certified candidate list; **M62** owns it.

### 5 — "Someone else" (M63)

In a race with one name on the ballot the three existing answers collect
almost nothing: Yes is what the ballot forces, No cannot separate disliking
this candidate from wanting a choice at all, and a reader who simply wants
somebody else has no way to say it.

The value is **context-restricted at the write path**, not merely hidden in
the UI: offered on a contested race the same button answers a different
question and both meanings land in one bucket, which is the corruption the
incumbent/challenger split exists to prevent. The permitted set is derived by
counting the committed ballots — four of 136 candidate targets today — so a
contest stops qualifying the moment a second candidate files. The aggregate
carries the new column with a zero on every tally, the way it already carries
every verification tier: a buyer must be able to tell "nobody chose this"
from "this column did not exist yet". No migration — the Postgres column is
plain text and the enum is TypeScript-level. The transparency page explains
the fourth button in the same commit.

### 6 — Photos, round 3 (D50, still In progress)

**535 of 750 → 590 of 750.** Sixty-nine portraits under door 2: 24 NH
senators, 25 NH representatives, 20 curated locals — every one eyeballed on
a contact sheet before shipping, every miss recorded per person with its
rungs. Full accounting in `docs/photo-report.md`, round 3.

The General Court publishes a portrait for nearly every member and we were
shipping 28 of 152. **None of the three causes was a missing photo; all
three were our own confirmation refusing a real one.** The Senate keys
portraits by district rather than member id. Two senators recorded as having
no portrait both had one, thrown away because their pages label the portrait
`alt="NH State Seal"` — a fabricated absence, found only by going to look
instead of believing the record, and now impossible because an image whose
own file path identifies the member survives the junk filter. The House
declares its portrait by template control id (`pageBody_imgMember`) with a
filename id that appears nowhere else on the page.

`scripts/fetch-official-portraits.mts` now regenerates `roster-photos.json`.
Only the Commons ship script did, so shipping roster portraits through door 2
left twenty local officials with a licensed manifest row and no photo on
screen. The sync test caught it — which is what it is for.

**Remaining, named:** 32 NH House members the state itself serves
`nophoto.jpg` for (an honest end state for a 400-seat volunteer chamber, and
what the brief anticipated), 3 portraits too small to be portraits, 1
personal-site link door 2 does not reach, 48 locals with per-person rungs
(two bodies 403 a plain client), and the deferred Commons sweep for the ~76
ballot challengers — the brief's sanctioned cut, taken. D50 stays In
progress for that reason. Equal effort per candidate is unaffected: no
contest gained a portrait for some candidates and not others, because no
ballot candidate gained one at all.

### The walk

`scripts/tester-walk-0815.mts`, four zips at 390×844, as a stranger:
**60 of 60**. It checks what the author reported rather than what the code
changed. `docs/tester-pass.md` is superseded with the results and, more
usefully, with what the walk cannot see.

### Recorded, not built

- **M59** — concluded meetings that publish a date but no start time.
- **M62** — party for local partisan bodies, via certified election results.
- **D51** — independent expenditures, the next funding-content item.
- **D52** — the state money-translation program (umbrella).

### State as of 2026-08-15

- Counters, all four, at all four zips: stated N equals rendered rows.
- Concluded meetings reachable at every wired jurisdiction that has any, and
  an honest line where the vendor serves none.
- Zero mojibake in 489 tracked and untracked files, guarded.
- Party on every governor, sourced to a filing; every roster's partisanship
  stated.
- 590 of 750 rendered people carry a portrait.
- Next free tracker ids: **A12, B15, C05, D53, M64, P13, R20, T11, V09,
  X05**.

## 25. The 2026-08-15 session (second of the day) — the design pass: flagships look like flagships

The session dedicated to the author's bar, verbatim: "Clean. Like Apple
level clean." A real pass with real deliverables, not adjective
sprinkling — and NOTHING behavioral changed except where the brief said
so: routing stayed deterministic, reactions stayed honest-outcome, every
data rule stands. The brief is committed at `docs/session-brief.md`; the
walk superseded `docs/tester-pass.md`.

Session-open honesty: the brief's prerequisite (the truth-and-faces
DEFECT rows Done) was confirmed against the tracker before anything was
touched — M57, M58, M60, M61, M63 all Done; D50 In progress does not
block. The brief also said "use the frontend-design skill"; no such skill
is installed in this environment, so the pass applied its discipline
directly — committed tokens, scale, restraint — and says so here rather
than silently skipping the instruction.

### The system (M64, X05 — items 3, 9)

`docs/DESIGN.md` + tokens in `app/globals.css`, the single source of
truth. Structural labels became `.t-structure` (11px mono 700, tracked,
uppercase, with a hairline shelf rule) and `.t-eyebrow`; the old 9px
whisper — SMALLER than the names it organized — is gone from
who-governs, the door overlay, popup section labels, and the sidebar's
filter headers. The one-line law entered CLAUDE.md: structural labels
organize, content leads, flagship surfaces get flagship treatment, and
reader-facing polish follows the committed tokens.

### The three registers (M67 — item 4)

Explainer voice, tappable links, and sourced data stopped being three
grays: `--voice` (slate-blue) carries the app's guidance, `--link`
(brand amber + dotted underline) carries everything tappable, and data
keeps full-contrast text with mono numerals. Applied across the ballot,
who-governs, the ask box, and funding. `text-muted` remains for pure
metadata only.

### The flagships (M65, M66 — items 1, 2, 2b)

The ask box: raised block, the question as a real heading, an input that
invites, a filled Ask. The "I got you... hang tight..." beat kept its
exact words and ~3s timing (tests pin them) — only the dress changed.
The answer renders under a signal eyebrow with contact cards — the phone
number a large amber tel link, the source line attached.

The ballot: the CTA header gained presence (shelf-ruled header, large
mono date, tinted frame), contest cards became designed objects (title +
right-aligned meta, office blurbs in voice, 64px photos, semibold
names), and the reaction/pick prompts stopped whispering (the standing
prominence rule folded in — the default "What do you think?" now carries
the text register's weight, and every reaction prompt renders at
0.8125rem medium).

Funding: its own framed block; contributor rows read as designed records
(name medium, amount right-aligned mono tabular); the PAC type labels
render as pill badges — six families (teal/cyan/amber/gold/slate/stone),
assigned once in `lib/funding/pill-colors.ts`, never using or
approaching the party palette, tuned per theme, contrast checked at
phone size in the walk. The pill is the tap target; the explainer
behavior and every label are unchanged. `tests/pill-colors.test.ts` pins
map completeness, the palette boundary, and that no pill token value
duplicates a party color literal.

### Footnoted provenance (M68 — item 5)

When the IDENTICAL source line would repeat under every contest, it now
renders a marker (`*`, `†`, `‡`…) at each contest title and the full
citation ONCE at the page foot, anchor-linked. Distinct sources never
collapse; a source used once keeps its inline line. De-cluttering, never
de-sourcing — at 85701 the canvass line renders once instead of nine
times.

### The narrowing chip (M69 — item 6)

The root cause found before fixing: the modal was keyed per zip, and a
settled pan that crossed a ZCTA line changed the notice's zip, remounted
the prompt, and popped the modal again — free panning triggered it
constantly. It is now a passive chip in the who-governs card ("Narrow to
this area?"): never modal, never overlays the map, expands IN PLACE on
tap, collapse costs one tap and decides nothing, and within a session it
only reappears when the resolved area changes. The approved wording
(§9) is unchanged in the expanded state; declining stays one tap and
device-recorded. The interaction rule is recorded in the component
beside the trigger rule it supersedes.

### The street's payoff (M70, D53 — item 7)

Applying a street (or municipality) from the chip now: shades the
containing municipality and school district on the map (a new `narrowed`
feature-state, 0.12 fill — quieter than selection's 0.18, re-applied on
the map's load signals so it appears the moment the polygon does), turns
the boundary overlay on with the municipal + school layers active, and
the who-governs list and DISTRICTS counter refresh through their
existing derivations. Only an APPLY does this — declining or undoing
never touches the reader's overlay settings. The remainder — geocoding
the street to an actual POINT so meetings and officials re-center —
needs a geocoder the repo doesn't have; adding one is an external-source
addition CLAUDE.md requires asking before, and this session ran
unattended. Recorded as D53 with the rejected alternative (shipping a
division centroid as if it were the street's point) named.

### The dialog (M71 — item 8)

"Clear my picks" asks its same question in a real dialog now — portaled
overlay, danger treatment on Clear, Keep focused — consistent with the
pass's dialog language.

### Recorded, not built

**B15 — the key votes tracker** (the tester's ask), doctrine locked at
recording time in the tracker row itself: author-approved list file,
published inclusion criteria, VOTES ONLY, both parties' signature items
by construction, rendered with existing machinery, never aggregated into
any score, honest absences first-class, read-dates + a review pass each
cycle, and the full candidate-entry list preserved. Awaiting the
author's curated list.

### The walk, and its own probe rows

Seven checks green at desktop (1440×900) and 390×844, walked as a
stranger at 85701; BEFORE/AFTER pairs for the ask box, the ballot, and
who-governs in `screenshots/` (`before-*` / `after-*`), including the
old modal (`before-narrowing-modal-desktop.png`) for contrast. No
console errors on any shot.

**Production rows this walk created, named (the probe-rows rule):** the
dev server the walk drove carries the production `DATABASE_URL`, so its
log writes landed in the real search log — six `QUESTION_ASKED` events
("a pothole on my street" ×3, ≈09:55–10:11 local; "who fixes potholes"
×3, ≈10:34–10:36 local; all routed, so topic id only), the zip-search
rows of the walk's map-page loads at 85701 (about eighteen,
≈09:55–10:38), and one settled-view row from the pan test (≈10:37). All were proving the
redesigned surfaces; exclude them from any aggregate over 2026-08-15 at
85701. No reaction-store or intake row was written.

### State as of 2026-08-15, end of the design pass

- The design system is committed: `docs/DESIGN.md`, tokens in
  `app/globals.css`, the CLAUDE.md line. Future sessions build from it.
- 507 tests green (including the new pill guards), lint clean (one
  pre-existing warning in `scripts/tester-drive.mts`), production build
  green, `verify-stamps` clean (11 audited, 0 disagreements).
- `scripts/shoot.mts` gained `--ask`/`--askbeat`, `--fill`, `--scrollto`,
  and tutorial seeding — the walk's driving vocabulary.
- Next free tracker ids: **A12, B16, C05, D54, M72, P13, R20, T11, V09,
  X06**.

## 26. The 2026-08-15 session (third of the day) — party gets proven, the day-not-hour meetings land, and the faces come back empty

Branch `claude/party-meetings-faces-0815`. Six work items, all shipped;
533 tests green, lint clean (the one pre-existing warning), production
build exit 0.

### The one-line version

Every curated local body now says whether its seats carry a party and cites
the certified record that settled it; two archives of past meetings that
publish a date and no hour are ingested and render honestly; a typed street
becomes a point on the map through the Census Bureau's geocoder, or nothing;
three visible defects from the author's production pass are fixed; the
photo hunt for 76 ballot challengers walked both rungs to the end and
shipped nothing, which is the finding.

### M62 — party for local partisan bodies, from certified results

The lead item, and the one with the most hunting in it.

The rule the author set: a local office is partisan or nonpartisan **by law
or charter first**, and only a partisan office gets a party, read from the
certified result of the election that put the person in the seat. Never an
endorsement, a news report, or a party's own site. Certified results or
silence.

All twelve rosters are settled; none is UNDETERMINED any more. **Five are
PARTISAN** (Pima County's supervisors, Tucson's mayor and council, Rockaway
Township's council, Morris County's and Merrimack County's commissioners)
and **seven are NONPARTISAN** (all six school boards plus the Newbury
Selectboard). **30 of 71 curated local members carry a party**, each with
its document, its publishing body, and the day it was read.

Two findings worth keeping:

**A general-election canvass usually does not print party.** Pima's
certified general canvass and Morris County's official summary report both
carry names and vote totals and no affiliation at all. The records that
state party are the **partisan primary canvass** in Arizona — where the
races are themselves headed `DEM Board of Supervisors District 1` — and the
county clerk's **certified winners list** in New Jersey, which has a Party
column the summary report lacks. Stopping one document early would have
produced "no party found" for offices that are unambiguously partisan.

**The same documents prove the negative.** Arizona school board races appear
in Pima's general canvass with no party beside any candidate, and appear in
the party-organised primary canvass under no party heading at all — they are
not in that election. That is the election authority's own record saying
these seats carry no party, which is a far stronger answer than "the
district's page doesn't mention one".

**Two members carry no party, and that is the finding rather than a gap in
effort.** Pima's District 5 was won in November 2024 by Adelita Grijalva;
she left for the CD7 special and the Board appointed Andrés Cano on
2025-04-15. Rockaway Township's at-large seat with this term was certified
to Howard Kritz; Howard Morrison holds it now and appears in NO certified
winners list for 2023, 2024 or 2025 — an absence checked in all three
documents rather than assumed. Neither has a certified result naming a
party, so neither renders one. Arizona requires a supervisor appointee to
share the vacating member's registration and the county's own call for
applications said so; that is a sound inference and it is still not a
certified result, which is what the rule asks for.

The same hunt corrected two wrong term notes that had stood for two years:
Cano was recorded as "Elected November 2024 to a four-year term", and
Rockaway's mayor as holding an "unexpired" term he had already replaced with
a full four-year one in 2023.

**New Hampshire came in at ladder rung 4.** `sos.nh.gov` 403s this network —
the page and the document path, both tried per document, as the author's
ladder instructs. The Internet Archive's dated mirror served both county
results files at 200, and the archive URL with its date in it is what the
rows cite: the document that was actually read. Rung 3 is worth keeping
even though it failed here, because the same trick **worked** on
`newbury.nh.gov`, which 403s its HTML and served its annual report PDF
clean. Same CMS, same wall, different answer per host.

### M59 — we know the day, not the hour

The author approved the schema. `Meeting` gains `startPrecision`, `MINUTE`
or `DAY`. On a `DAY` row `startsAt` carries local midnight as an **ordering
position and never a claim**: the card renders "Time not posted — check the
agenda" where the clock would go, and the calendar link builds an all-day
event carrying the same sentence rather than putting a fabricated hour into
the reader's own calendar.

Counts gained: **Rockaway Township 9 → 22 meetings** (+13 day-only, from its
AgendaCenter) and **Merrimack County 1 → 15** (+14, from the notices page's
dated documents). 27 day-only rows in the shipped snapshot, 126 meetings
total from 9 of 9 sources.

The AgendaCenter category id is the council's own filter value, recorded on
the wiring row rather than guessed, because that page hosts four other
bodies and taking every document on it would file the Planning Board's
meetings under the Township Council. A guard asserts the two categories'
dates never cross.

Archived rows are placed at the body's **sole** curated venue and dropped as
`unknownVenue` where a body has more than one — "they usually meet at the
complex" is a guess the reader would act on.

Both `publishesHistory: false` rows are retired, which took
`allHistoryGaps()` to zero and left the gap-note machinery with nothing live
to stand on. It is now tested through an injected gap rather than deleted:
the next unwired vendor will need it.

### D53 — the street becomes a point, or nothing

The author approved the Census Bureau's geocoder. Wiring it turned up the
fact that shaped the build: **it does not geocode street names, only
addresses.** A bare street returns zero matches on both the one-line and
structured endpoints.

The chip's promise that no house number is needed does not move for an API,
so the module samples the street at four house numbers of its own and asks
whether the matches agree. Within 1.5 km their midpoint is a real point on
the street; wider, the street is too long for one point to mean anything and
the lookup returns nothing. Green Pond Road's samples span 5.6 km and cross
a municipal line — a confident pin there would have put a reader in the
wrong town's meetings, and refusing is the feature. Four of five sampled
streets across the demo zips resolve.

On success the map flies and the query point moves through the existing
settled-view override, so meetings, officials and the sidebar counters all
answer for the street instead of a ZCTA centroid. Every failure returns
`null` and the shipped shading behaviour stands; there is no error state.

The point never leaves the device: no storage, no request to our own server,
nothing added to the search log, and the settled view carries `zip: null` so
the server logs the nearest ZCTA exactly as it already did. **The disclosure
line changed in the same commit** — it used to say the reader's choice is
"never sent anywhere", and once a street name goes to a federal address
service that sentence is false.

### 4c — three from the author's production pass

**M72, the who-governs card off the top at desktop.** Measured before
touching it: the bottom stack 1072px tall against an 800px viewport, top at
y = −272 — the same signature as the phone bug M54/M55 fixed. The upper
bound had been written inside a `max-width: 639px` query because that bug
was found on a phone, which quietly assumed a laptop is always taller than
the card. It applies at every width now.

**M73, the sidebar footer under the map legend at 390px.** The legend is
fixed ambient chrome at z-1100, so it painted over the "Last checked" line.
The legend's placement and the stack's reserved gutter now read the same two
named variables. Two cascade traps on the way, both recorded in comments:
the phone override lost to a later `:root` declaration by source order, and
the stack's padding lost to a Tailwind utility on the same element. Each
first attempt reported success and changed nothing.

**M74, picks from another state's ballot.** Keeping them is right — a pick is
the reader's private note and deleting it for looking at another state would
lose deliberate work — so the missing thing was the sign, not the behaviour.
The jurisdiction is read off the contest id every pick already carries, so
picks saved before today are labelled too. An internal key never renders: no
label, no line.

### D50 round 4 — the challenger sweep ships nothing

Both rungs walked to the end for all 76 ballot challengers.

**Commons, attribute-verified: 0 staged.** 74 no-Wikidata-match — 62 with no
search hit at all and 12 with hits that failed attribute verification — and
2 verified items carrying no portrait. That is the identity discipline
working; a name-only match would have put somebody else's face on a ballot
card. A canonical failure class failing again is the expected result.

**The campaign `og:image` rung: 10 staged, 0 shippable.** All ten were looked
at in one contact sheet. Nine are wordmarks, logos, rally photos or banners;
the tenth is a composed campaign banner, the exact shape D42 tightened the
rule against. **And a doctrine finding, recorded rather than resolved:** the
licence question settles all ten regardless of composition. A campaign site
is neither of CLAUDE.md's two doors, and the rule names campaign headshots
as commercial photography needing an explicit licence. The script that runs
this rung describes itself on the opposite premise. It needs the author's
ruling, not a patch.

Counts unchanged at 590 of 750. The 48 curated locals are named as the
remainder with their rung, per the brief's own cut rule.

### R16 — the future-date inventory learns the difference

The 117 were two species wearing one label. Election day will postdate every
scan until November; warning about it every run teaches a reader to scroll
past the warning, which is the only way that check can actually fail.

Expected-future dates are now **annotated in the document, next to the
date**, with the reason and the record they were verified against. The
annotation lives where a reader who wonders will look, and the two cannot
drift apart the way a second list would. Six shipped, all election day.

A seventh turned out to be neither species — an illustrative retrieval date
inside a hypothetical UI string — and became a placeholder, because an
example that looks like a provenance claim is the confusion this rule fights.

**The allowlist is now the suspicious set and nothing else: 26 entries and
118 declared occurrences down to 16 and 81**, every one session-label
residue. Correcting those is evidence-backed but it is a bulk rewrite of
eight documents, some of whose dates a recorded decision says stay as
written, so it is warned about loudly every run rather than guessed at.

The tracker note written for this item failed its own check by naming two of
the dates in prose. It was reworded rather than allowlisted.

### The walk

`scripts/tester-walk-0815b.mts`, all four demo zips at 390×844 plus a
desktop bound check, **0 failures** — 07866 14/0/0, 03255 12 pass 3 skip,
85701 12 pass 3 skip, 85641 12 pass 4 skip. `docs/tester-pass.md` is
superseded with the full table, including the three bugs the walk found in
ITSELF and the one product observation it surfaced and did not fix (M75, the
meeting panel's lower edge under the legend at phone width — a different
surface from M73, predating this session, recorded rather than patched
blind at the end of a session).

**Production rows this session created, named (the probe-rows rule):** the
dev server the walk drove carries the production `DATABASE_URL`, so its log
writes landed in the real search log. Across roughly a dozen walk runs on
2026-08-15, the rows are **zip-search rows for the map-page loads at 07866,
03255, 85701 and 85641** (on the order of forty, spread over the afternoon
and evening local time) and **a handful of settled-view rows** from the
viewport measurements at 1280×800. All were proving this session's surfaces;
exclude them from any aggregate over 2026-08-15 at those four zips. **No
reaction-store row and no intake row was written** — nothing in this session
tapped a reaction, and the geocoder writes nowhere by construction.

### State as of 2026-08-15, end of the third session

- **533 tests green**, lint clean (one pre-existing warning in
  `scripts/tester-drive.mts`), production build exit 0, `verify-stamps`
  clean (11 audited, 0 disagreements, `AUTHOR_DECISION` empty and staying
  empty).
- New guards: `tests/party.test.ts` M62 family, `tests/day-precision.test.ts`,
  `tests/geocoder.test.ts`, `tests/map-bounds.test.ts`, the M74 additions to
  `tests/ballot-picks.test.ts`, and the R16 additions to
  `tests/doc-dates.test.ts`.
- Next free tracker ids: **A12, B16, C05, D54, M76, P13, R20, T11, V09,
  X06**.

## 27. The 2026-08-15 session (fourth of the day) — the depth session: New Hampshire and New Jersey get their bodies, and the playbook is born

Branch `claude/nh-nj-depth-0815`. 556 tests green, lint clean (5
pre-existing warnings, 0 errors), production build exit 0.

### The one-line version

The two states the author called "light and sparse" got their governments:
07866 went from three bodies to seven and from 22 meetings to 49, and the
adapters stopped silently throwing away sixty days of published history at
every zip. State legislators now carry their voting records. The knowledge
that used to be re-derived every session is a document. And the walk found
that a feature shipped as working last session cannot run in a browser at
all.

### The shape of the session

The author's instruction was density, and the honest way to get density is
not to lower the bar — it is to find the governments that were already
there. Four of the five findings below are the same shape: **something was
being read as "that's all there is" when it was actually "that's all we
asked for."**

- The adapters asked for 30 days of history while the app served 90.
- Rockaway's wired calendar feed carried one body, and a second feed id
  carried two more.
- Newbury's vendor portal carried one body, and the town has four.
- The photo hunt staged one image per candidate, and that image was a
  format designed to be a banner.

None of these threw. Every one of them reported success.

### 1 — The structures are born (R20)

`states/nh/`, `states/nj/` and `states/az/` each hold a `NOTES.md`: that
state's own memory of filing systems, vendor patterns, walls and statutory
posting rules. Nothing was moved into them — the convention is born with
this session's new work rather than by reshuffling history.

`docs/zip-playbook.md` is born, and `CLAUDE.md` gained the clause that keeps
it alive: it is **append-only**, and **every depth run ends with a playbook
diff or an explicit "nothing new," stated in the standing report.** It
carries the definition of done for a zip as ten checkable lines, the source
ladder per jurisdiction type, and the rungs discovered so far — with the
author's own preamble at the top: the rungs written are the rungs discovered,
every new state is presumed to teach new ones, and recording them is the
work rather than a deviation from it.

`CLAUDE.md`'s photo rule was rewritten whole into **four doors**, with the
composition and identity standards lifted out of the doors entirely. A door
is permission to use a source; it is never permission to ship a worse
picture.

New: `pnpm census:zip <zip>` prints the who-governs table for a point —
ingested, located-but-not-ingested, never-hunted — offline, with the vendor
named. It is the playbook's first machine step and it is what found the gap
this session filled.

### 2 — The meetings (M76, M77, M78, M79)

**M76, the one that mattered most and was invisible.** Every adapter carried
`WINDOW_BACK_DAYS = 30`, under a comment claiming it matched the cascade,
while the served lookback had been raised to 90. Sixty days of published,
retrievable history were being dropped **at the fetch**, at every zip, for
every source. No count check could catch it: each adapter honestly reported
what it had asked for, and what it asked for was wrong. The windows now
derive from `lib/meetings/constants.ts` so the two cannot drift again.
Measured: 03255 3 → 7 meetings, Morris County 12 → 20, Tucson's clerk's
boards 15 → 24, Amphitheater 2 → 6.

**M77, Rockaway's other boards.** The township has five bodies on its own
archive page and we were reading one. The finding is that **the boards are
in a different calendar category from the council** — the wired feed is
`catID=25` and carries the council; `catID=30` is a second calendar carrying
the Planning Board and the Board of Adjustment with real start times.
Thirteen of the fifteen ids probed return a 477-byte empty calendar. Both
bodies are wired now, with their archive halves.

Three sibling defects the new rows exposed, all of which predated them:
CivicPlus announces a cancellation by **editing the SUMMARY text**, not by
an iCal `STATUS` property, so two future sittings were rendering as
SCHEDULED; the same notice is pasted into `LOCATION` ahead of the address,
so both dropped as `unknownVenue`; and archive de-duplication was keyed on
the division, so three bodies sharing one `ocdId` would have deleted each
other's sittings.

Two more bodies on that page are registry rows and deliberately **not**
wired: the Environmental Commission's archive stops in 2019 and the Board of
Assessment Commissioners' in 2022. Neither publishes anything the served
window could render, and the township's sitemap and staff directory carry no
page for the Environmental Commission at all.

**M78, and a new source shape.** Morris Hills Regional — 07866's high school
district, and `NOT_ATTEMPTED` until this session — **runs no agenda vendor at
all** and publishes better than most districts that do. Its BOE Meetings page
carries the whole 2026 schedule as a dated list with one sentence under it:
"All meetings begin at 6:30 P.M. and are held in the Board of Education -
Board Conference Room." That is not a vendor, it is a **shape**, and it is
how a very large number of American school boards publish. It is an adapter
now (`SCHEDULEPAGE`), so the next one is a wiring row.

Three rules it was built under: the time is parsed from the body's own
sentence and never defaulted (no sentence means `startPrecision: "DAY"`); the
weekday prefix on the date is required, or a footer date becomes a meeting;
documents join on the date the body wrote in its own link text, never on a
filename. `VENDOR_API: MISS` is on the audit row on purpose — "this district
runs no portal" is a finding about the district, not a gap in the hunt.

**A zip sits in two school districts at once**, and both are its government.
07866 now has **no governing body without a source**.

**M79, the two New Hampshire walls.** Newbury's CivicWeb portal carries
**only the Selectboard** — proven, not assumed: a whole-year query returned
20 sittings and every one was TypeId 10. The Planning Board, Zoning Board of
Adjustment and Conservation Commission are on the town's own site, and
`newbury.nh.gov` 403s every HTML page to this pipeline while serving its
PDFs at 200. `kearsarge.org` is the same wall. Both need the real-browser
rung, which is named as the next rung. **In progress, never blocked.**

### 3 — LegiScan (D49)

State-legislature roll calls for AZ, NJ and NH. The data was never the hard
part; **the join was, and it fails in a way that does not throw.**

New Hampshire numbers House districts within a *county*, and the Census SLDL
code concatenates the county's **zero-based alphabetical** ordinal with the
two-digit number — Hillsborough 12 is `sldl:512`. Two ways of getting that
wrong, both silent, both hit during the build: indexing the county table from
1 gave 10 matches out of 426, which reads exactly like a thin roster; and
zero-padding Belknap gave `sldl:007` against a real `sldl:7` and lost all
nine of its seats. Both now round-trip against **our own committed boundary
labels** — the geojson carries `State House District Merrimack 08` beside
`sldl:608` — so the mapping is checked rather than remembered.

Matching is on **district AND surname**, never name alone. Rates with their
denominators: AZ 24/92, NJ 21/120, NH 85/426 — the large denominators are the
rest of each legislature, which governs outside our clipped boundaries, and
**every roster seat that could match, matched.** Ten were spot-verified by
name and district against both sources; two people did not match and are
named rather than forced.

Retrieval is bulk-first with `dataset_hash` discipline — an unchanged dataset
is never re-downloaded — and the legiscan.com front end is never touched. No
dependency was added: `lib/sources/legiscan/zip.ts` reads the central
directory directly, and throws on an entry it cannot read rather than
skipping it.

**The clip is surface-driven, and the first attempt was wrong in a way worth
keeping.** "The 60 most recent per state" covered **two days** in Arizona,
which votes in bursts — a member absent those two days would have rendered an
empty record that reads as "never votes". It is now the union of each
member's twelve most recent: 72 roll calls, 1,560 positions, 130
officeholders with exactly twelve each.

**The thin-snapshot guard fired during the build**, refused the write and
kept the old file when the clip rule changed. The re-baseline was deliberate.

A party-by-party count is **null** on every state vote and refused rather
than estimated — we hold a fraction of each chamber, so no tally could sum to
the recorded result. LegiScan's CC BY 4.0 attribution ships with the rows
from the API so it cannot drift from the store it describes, and a guard test
asserts a state member's payload carries it and a federal member's does not:
the chambers' public-domain XML must never be credited to LegiScan.

### 3b — The doors reopen the challenger sweep (D50, round 5)

The author's four-door rewrite answers exactly the question round 4 parked.
**590 → 592 of 750**, and the standards did not move an inch, which is why
nine of eleven candidates still ship initials.

The mechanical finding: round 4 staged **one** image per candidate — the
`og:image` — and nine of ten were banners. That is a fact about the *format*:
a share card is designed to be a banner with the name across it. The hunt now
also collects the page's own `<img>` elements, and **both shipped portraits
came from `<img>`; neither was the `og:image`.**

Shipped under door 3, labelled campaign-provided with remove-on-request: Teri
Ann Hourihan (AZ Governor) and Walter "Les" Presmyk (AZ Mine Inspector). Both
are clean solo studio portraits from the candidate's own domain, under files
the campaign itself named `Headshot` — which is also the identity evidence.

Two refusals worth naming: Norton's one photograph carries **Facebook's CDN
filename pattern**, and social-media images are prohibited at every door —
re-hosting one on your own server does not change what it is. Swallow and
Hathaway were refused on **identity, not composition**: their sites carry
several faces and the portrait-shaped images carry no name evidence at all.

A retrieval detail the guard caught rather than a person: Squarespace
content-negotiated a **WebP** for a `.jpg` URL, and the metadata stripper
refused to ship bytes it could not inspect.

The other 65 challengers have no recorded campaign site, so their missing
rung is a **site** hunt, not a photo hunt — named rather than counted as a
photo failure.

### 4 — The street input asks, and the walk finds why it cannot (M80)

The author's ruling: a street whose sampled house numbers disagree on
jurisdiction should be **asked about**, not refused. `lookupStreetInZip` now
distinguishes "we cannot find this street" from "this street crosses district
lines", and the second gets the question — *This street crosses district lines
— what's the house number?* — with `locateAddressInZip` resolving it in one
request. The number lives in component state for the length of that request,
goes only to the Census geocoder, and is cleared in a `finally` whatever the
outcome; three guard tests pin that, including a source scan for the device
store, `localStorage` and our own API.

**And then the walk found what no unit test could.** `geocoding.geo.census.gov`
answers 200 to a server and sends **no `Access-Control-Allow-Origin` header at
all**. No browser can call it. D53 shipped last session as a device-side
geocode and its tests pass — because they run in Node — but nothing
downstream of that call has ever fired in a page, including this session's
question.

This is a transport problem with a **doctrine** answer, which is why nothing
was fixed: the only route that works is a server-side proxy, and both the UI
copy and the geocoder's own guard test promise the opposite — *never stored,
never sent to us*. Making the feature work by quietly retracting that promise
is the author's call, not a session's. **M80** holds the three options.
D53's `Done` status is left as written: its tests really do pass, and history
is not rewritten.

### 5 — Deferred whole, and named (M81)

The jurisdiction badge — *Governs your area* vs *Nearby, different
jurisdiction* — is the session brief's own first cut if the session ran short,
and it did. **Nothing was half-built.** The foundation is already there:
`bodiesAt()` in `lib/registry/resolve.ts` does exactly this point-in-polygon
against the same committed geometry the map draws from, so the badge is a
call to it plus a label. The one design question recorded for whoever builds
it: a meeting whose body has a null `ocdId` cannot be point-tested at all and
needs an honest third state.

### The walk

`scripts/tester-walk-0815c.mts`, 390×844, as a stranger. At **07866**: 49
meetings across 7 bodies (from 22 across 3), both canceled sittings saying
canceled, a state legislator's votes carrying the LegiScan attribution and a
federal member's not, no identifiers and no mojibake on the map or the
ballot, and the thin-candidate line where a portrait is missing. At **03255**:
7 meetings, all Newbury's Selectboard — the county's 15 sit one radius step
out, which is the cascade working rather than a gap.

The street question reports as **BLOCKED** rather than FAIL, naming the CORS
reason. A walk that fails for a known blocked transport teaches the reader to
ignore its failures, which is the defect the walk exists to avoid.

### The playbook diff

Four entries added this run, per the new permanent rule: a town's portal may
not be the town; the published annual schedule as a source shape; probe the
calendar category ids; and check the adapter's own window before hunting a
second source. Plus the LegiScan section — the district mapping that fails
silently, and letting the surface drive the clip.


## 28. The 2026-08-15 session (fifth of the day) — the money tells its whole story, and a bank stops being a donor

**State as of 2026-08-15**, branch `claude/money-story-0815`, merged to
`main`. `pnpm test` 587 passing, `pnpm lint` clean (5 pre-existing warnings
in walk scripts), `pnpm build` green.

The brief was the money: make the funding surface answer the question a
reader actually has, add the hop that answers the next one, and stop a
percentage from lying about a small campaign. Three of those landed. What
they turned up on the way was bigger than any of them.

### The defect the work found: a bank was one of Mark Kelly's biggest donors

Building the second hop meant taking a census of FEC form line numbers, and
the census said something nobody had asked: the "Largest reported
contributions" list — live, shipped, on production — contained line 15 rows.
Line 15 is *offsets to operating expenditures*: a vendor refunding the
campaign. **AMALGAMATED BANK appeared three times on Mark Kelly's card as one
of his largest contributors.** It was his own bank returning fees. Line 14
(loan repayments coming back) was there too, and the new second hop would
have rendered ActBlue's escrow interest — filed under FIDELITY — as its three
biggest donors.

`/schedules/schedule_a/` returns every RECEIPT a committee reports, not every
gift, and nothing had ever asked it to distinguish them. Both hops now keep
contribution lines only — 11\* (individuals, party committees, other political
committees, the candidate), 12 (transfers from authorized committees) and 13A
(a candidate's loan to their own campaign, which already renders as exactly
that). The fetch goes twenty deep and takes the top five after filtering, so
removing a non-gift shortens no list. **75 non-contribution receipts dropped
this run, counted by line** (15: 36, 17: 26, 14: 8, 16: 3, plus two
non-positive rows), because a deliberate clip must not read as a failure.

Two more things fell out of the same run. The FEC returned **HTTP 504** on
Kelly's Schedule A mid-fetch and `fecGet` had no 5xx retry, so a transient
timeout became "zero contributors" — the thin guard refused to publish it,
which is exactly what it is for, and the fetcher now backs off and retries.
And the walk, at 6pm Phoenix, rendered **"read 08/16/2026"** on a funding
card: `new Date().toISOString().slice(0, 10)` is wrong for seven hours out of
every twenty-four here, and every provenance field the run wrote claimed
tomorrow. The scripts call `stamp()` now, and a test fails on any snapshot
date later than today.

### The money, in the order the money happened

Contributions render in two columns — committees and organizations,
individual itemized donors — each sorted by amount **descending**. The five
Booker Victory Fund lines fold into one row reading **"5 transfers ·
$2,885,000"**, the filings one tap away, exactly as filed. The count noun
comes off the FEC's own form line, so a joint fundraiser's transfers are
never presented as single gifts.

The column header says *Committees & organizations* rather than the brief's
*PACs & organizations*. That is a deliberate, recorded deviation: a joint
fundraising committee is not a PAC, and filing it under a PACs header would
characterize it — which the organizations-as-filed rule forbids and which the
same brief item explicitly protects.

**The second hop** ("Give me the tea", the author's exact label) opens a
contributing committee's OWN books under its OWN name. 42 distinct committees
fetched, 199 rows, one (Working Families Party PAC) returning no itemized
receipts and recorded rather than rendered — because "we did not look" and
"there is nothing" must never render the same. The button is playful; every
word inside it is level. D40's distinctness invariant was asserted one level
down: **zero identical-book pairs across 42 distinct ids.**

**The honesty floor**: below $5,000 raised, the small-donor percentage is
replaced by the dollars themselves. Dan Nicholson's $325 no longer wears a
54%.

### The geocoder gets a route, and a promise gets rewritten

The Census geocoder sends no CORS header. **No browser has ever been able to
call it**, which means D53's street features had never once fired in a page —
and no Node test could see it, because Node does not enforce CORS. A stateless
POST proxy now carries the address and writes nothing: no log, no store, no
echo, no cache, guarded by a source scan AND a runtime call.

The old copy said the street was "never sent to us". That became unkeepable
the moment the feature needed a browser, so it was rewritten in the same
commit, on both surfaces and in three places, to the promise an engineer can
keep: *your address passes through our server to the Census Bureau's
geocoder; we never store or log it.* The old sentence is asserted **gone**.

Verified in a real page, which immediately found what no test could: **the
crossing-street question had never been asked once.** Applying a street
minimized the who-governs card, unmounting the prompt — and the answer
arrives about ten seconds later. Green Pond Rd's four sampled house numbers
span 9.49 km, measured, so the lookup said CROSSES every single time and the
input rendered never.

### One person, one photo

The author reported Katie Hobbs wearing her official portrait on one surface
and a stale event candid on another. **The audit found she was one of nine** —
including Consuelo Hernandez, who holds a school-board seat and a legislative
one and wore two different official faces. Photos key to the person now, and
the credit travels with the image, because a government portrait under a
Commons photographer's name would be a worse defect than the duplicate it
replaced.

Risa Lombardo has a face. The earlier miss was recorded honestly and was
wrong in *scope*: the hunt had checked only the home page's `og:image`, which
is a wordmark and correctly failed. Door 3 is the campaign's own portrait
anywhere on its own site, and her About page carries one.

### "School District Not Defined" was both things at once

At the Tohono O'odham reservation area the map named a district *School
District Not Defined*. Diagnosed before touching anything, and both halves of
the author's question are true. It **is** a real gap geometry — Census GEOID
0499997 is a genuine polygon over land inside no unified school district,
adjacent to Indian Oasis-Baboquivari rather than on top of it, which is why
both render. It **is** also a labeling defect. So the geometry stays and the
name becomes the fact: *No unified school district here.*

### Canceled meetings: the zeros were real, and two adapters were not looking

0 of 14 Legistar events since 2026-06-01 mention "cancelled" in any field
(`EventAgendaStatusName` is "Final" on all fourteen). 0 of 20 Apptegy events
per org, for Vail and Rockaway. So the zeros the author doubted are real,
with denominators. But **Apptegy had no cancellation check at all**, and its
schema carries no status field, so the first cancellation either district
ever published would have rendered as a meeting going ahead. Both adapters
look now.

### The key votes: sixteen verified names, and a named remainder

B15's list is the author's and locked — 20 law rows (April 2024 as four
siblings, because the House voted four separate bills) and 16 nominations.
The criteria sentence renders on the surface, verbatim. **The chamber rule is
structural**: a card is handed only its own chamber's array, so a House card
cannot show a Senate-only entry as a vote even by mistake.

**All sixteen nominations verified** against the Senate's own roll-call
record, matched on surname AND the author's recorded tally — a name match at
a different tally is a cloture vote or an earlier failed one, and taking it
would put a member against a vote they never cast. Sixteen for sixteen,
sixteen distinct roll calls, zero misses.

**0 of 20 law rows carry a verified roll call, and the reason is structural.**
The Senate publishes every vote under the bill's OFFICIAL LONG TITLE, never
its popular name: the Inflation Reduction Act is filed as "A bill to provide
for reconciliation pursuant to title II of S. Con. Res. 14". Typing a bill
number here from memory is precisely the assumption this product refuses, so
none was typed. **B17** records the route that closes it — the congress.gov
API, whose key is already present.

### What was cut, and why

The brief's own cut order was followed. **6c** (school-life routing), **6d**
(the ask-box classifier), **6f** (the jurisdiction badge, deferrable twice by
the brief's own instruction) and **7b** (the 81 session-label dates) were not
built. Item **5**'s rule entered CLAUDE.md; its sweep did not run. Nothing was
half-built, and every one of them is a tracker row.

## 29. The 2026-08-15 session (sixth of the day) — the truth session: two hosts open, every division card confesses, and the laws get their votes

The brief's frame was "a class of false claims live on every division card",
and that turned out to be the honest description of three of this session's
items: a card denying people it holds, a counter answering a question nobody
asked, and a page telling the reader how plainly it was speaking.

### The browser rung, and the guess that would have been wrong (M79)

`kearsarge.org` and `newbury.nh.gov` answer **403 to this pipeline and 200 to
a browser**. Between them they were hiding a school board's whole two-year
calendar and a town's three land-use boards.

The measurement is the part worth keeping, because the obvious fix is not the
fix:

| Client | Headers | Result |
|---|---|---|
| Node `fetch`, civic-index UA | ours | **403** |
| Node `fetch`, full Chrome header set | Chrome's | **403** |
| `curl`, the *same* Chrome header set | Chrome's | **200** |

The filter reads the **TLS/HTTP2 client fingerprint**, not the `User-Agent`.
A session that swapped the UA, got another 403 and recorded "the browser rung
is closed" would have written down a wall that is not there.
`politeGetText(url, { profile: "browser" })` sends the browser header set
in-process and re-issues through `curl` on a 403; the contact address stays
in the `User-Agent` either way. No login, no token, no robots directive names
these paths, and every page is one a public body is obliged to publish.

Behind the wall: Kearsarge publishes its whole 2026-2027 board calendar as a
month table with the board's own words beside the dates — "Staff
Nominations", "Budget Presentations", "Warrant Discussion" — plus two bullets
naming the time and the place. The 2026-08-13 audit had recorded **165** Main
St from a search snippet; the page says **114**, and the page wins. Newbury's
own site carries three boards its CivicWeb portal does not.

Three new source shapes were born, dispatched by a `shapes` key and unioned
by date. **`month-table`**: the year is the whole problem, tracked by a
stated year AND by a backwards month ordinal, because a schedule filed twelve
months early is invisible until a reader shows up at an empty room.
**`dated-list`**: scoped to the body's own block and scanned per match rather
than per line, because the commission writes "June 9,2026" and puts two dates
in one paragraph. **`agenda-list`**: Drupal's own `dc:date` with the offset in
it, bound to one board by a path prefix — the town's template gives every
board identical markup — and **the link text names the DOCUMENT, never the
sitting**: a card titled "Agenda" is a government meeting named after the
piece of paper we found it in.

**schedulepage went from 1 body / 3 meetings to 4 bodies / 26.** Three drops
are counted and all three are rows the board's own table carries in meeting
shape and which are not meetings: the town election and two filing deadlines.

**One board was left out and is named.** Newbury's Zoning Board of Adjustment
publishes four 2026 agendas and its meeting PLACE on no rung walked — not the
department page, not three agendas read in full, not the town's events
listing. Both sibling boards state theirs in their own words. Borrowing one
for this board is the guess the venue table exists to refuse, so it is a
curated `KNOWN_UNCOVERED` row with the venue named as the next rung, and a
test that makes wiring it later a deliberate act.

Two published contradictions were recorded rather than smoothed: a Zoning
agenda dated `2026-08-13` in the CMS field and `Wednesday, August 12, 2026`
in its own heading, and another timed `7:00am` in the field while its items
run from 7:05 p.m.

### The class defect: every legislative division card denied its own member (M86)

Diagnosed before fixing, and the diagnosis narrows the report while
confirming its shape. A division's people live in **two** stores: legislative
seats in the officeholder index the coverage summary exposes, local
governments in the curated body rosters. The small popup asked both. The
large battlecard asked the rosters alone — so **every congressional,
state-house and state-senate card at every zip denied its own officeholder**:
twelve cards, the three division types with the largest overlays on the map.
County, municipal and school cards were already right.

That is a parallel join, which is why it drifted: two surfaces answering one
question from different stores eventually disagree, and the one nobody
screenshots stays wrong. There is one resolver now —
`representationForDivision` — read by the popup, the battlecard and the
districts door, and the honest empty line comes from one place too. Guarded
**as a class, per division type**, with the six types stated as the
denominator so an empty pass cannot pass for a clean one; the guard was
proven to fail without the fix, listing exactly the twelve cards.

### The counter that answered a question nobody asked (M87)

"179 DISTRICTS" read as a claim the reader is governed by 179. The door said
"in view"; the tile said nothing, and the tile is the one on screen. In-view
is labelled as such now — verified live at 85701 reading **"29 DISTRICTS IN
VIEW"**. And once a street address has resolved, a second mode leads with the
count of districts whose boundary CONTAINS that point, keeping the in-view
number underneath. A zip centroid never qualifies: a ZCTA crosses city,
county and school lines. Both modes carry the stated-N guard — the door
renders exactly the rows the tile counted.

### The author's ruling on funding reactions (D61)

`ripcord.fundingReactionsInAggregates` flips **LIVE**, with the ruling
recorded verbatim beside the flag: what is licensed is reader-attention
signal, never FEC-derived data. The distinction the original framing
collapsed is that § 30111(a)(4) restricts commercial use of the contributor
DATA, and a reader's anonymous feeling about a display is neither that data
nor derived from it. That separate question is untouched and still counsel's.
The switch stays as a belt, and the test now demonstrates it in the position
it is *not* shipped in.

The funding question is the author's — "How do you feel about how this
campaign is funded?" with Love it / Like it / Don't like it / Hate it / Don't
care. The five values go through the server-side validity table and are
accepted only on funding targets, **and the gate runs in both directions**:
`YES` on a funding target is refused too, which is what stops a stale client
blending instruments. Verified live: `LOVE` on a funding target → 204, `YES`
on a funding target → 400, `LOVE` on a vote → 400.

**Scale versioning is the data-honesty half.** Every row carries the
instrument that produced it, derived server-side from the target type.
Aggregates key on it, so a v1 funding tally and a v2 funding tally are two
rows and never one — one denominator over both would report a trend caused by
the question changing and nothing else. Migration 0003 applied to Neon and
verified by column query: 22 existing rows backfilled to version 1.

### The page that kept telling you it was being honest (M88)

1,591 reader words to 1,448 — 143 cut, and the number is stated because
"shorter" with no number is the same shrug as "it works". Out: the
meta-language, the build-fails-on-a-new-column line twice over, and the
duplicate never-tells-you-how-to-vote sentence.

The read-aloud found something to **add**: the photographs section still
described **two** doors after the photo rule grew to four. A page about
photographs of real people cannot be out of date about which photographs it
ships. Every coupling guard across five test files passes unchanged.

### The ask box's second rung (A12)

The keyword matcher refuses on questions a person could route in a second.
The classifier asks a model one thing — which curated topic — and its entire
output is one identifier from a closed list, or NONE. **It writes no sentence
a reader sees.** Keyword-first is structural: the classifier's id is read
only after the deterministic matcher returned null. The closed enum is
checked twice, on the wire and again here, because a schema is a promise made
by a server and a topic id is a claim about a government.

Verified live at 85701: *"the light outside my house has been out for a
week"* — no curated keyword in it — came back **Streets and roads**, with
Tucson's Street Maintenance and the 311 line. That is the classifier's first
real answer.

No dependency was added: plain `fetch` against the Messages API, the same
choice LegiScan got. The rejected alternative was the Anthropic SDK, declined
because this repo's convention is to avoid a dependency for one endpoint and
the author was not available to approve one.

### The laws get their roll calls, and one was nearly the wrong vote (B17)

**0 of 20 to 18 of 20.** The route is congress.gov's own record: the
public-law lists, then the titles endpoint where a law's popular name
actually lives ("Popular Titles | Inflation Reduction Act of 2022"), then
that bill's recorded votes carrying the chamber's own URL. No bill number is
typed anywhere.

The April 2024 shape resolves mechanically. The House voted on four separate
bills; the Senate voted them as one vehicle, so the enacted law carries the
Senate's single vote and **no House vote at all**. The four siblings get
their House votes through the enacted law's own related-bills list — four
different House roll calls, one shared Senate roll call.

**The catch this run made before it shipped.** Matching BSCA's `whichVote`
"final passage" on the literal words picked House roll 212 — "On passage
Passed 230-190" — which is the House passing its own unrelated Byrne-grant
version of S. 2938 in May. The vote on the gun law is roll 299 in June,
234-193. That would have put every House member against a vote on a different
bill under the name of the law that made news. So the rule is stated rather
than guessed: passage and concurrence questions only, then the last of them
by the chamber's own timestamp, because that is the vote on the text that
became law. The rejected alternative was refusing all eight two-vote entries.

Also fixed: `/\bconcur\b/` matched none of the Senate's own "Senate
CONCURRED in the House amendment" final actions, which is how BSCA and CHIPS
first came back as "no passage or concurrence question" on bills whose
concurrence votes were right there.

Two misses, both correct refusals: the shutdown entry has no unambiguous
popular name among a congress full of appropriations laws, and the
stock-trading ban has not become law and says so on the card.

### The probe row this session created

One row, named per CLAUDE.md's standing order: a `FUNDING_TOTAL_REACTION` on
`H2AZ02360` (Ciscomani's FEC id) with the answer `LOVE` and
`scale_version: 2`, written 2026-08-15 during the verification walk against
the same Neon database production uses. It is the only `scale_version = 2`
row in the table, which is what makes it findable without an investigation.
The two refusals beside it (`YES` on a funding target, `LOVE` on a vote) were
400s and wrote nothing.

### What was cut, and why

The brief's own cut order was followed. **7**'s remaining PRL evaluation
(license read verbatim off the JS-rendered data page, coverage table, join
rates) and **6**'s town-hall survey were deferred and are tracker rows
**D62** and **B18**, each carrying the rungs the next session starts from
rather than a summary. **8**'s Facebook sweep (**X07**), **8**'s session-label
dates (**R16**), **6c** school-life routing and **6f**/**M81** the
jurisdiction badge were not built. Nothing was half-built.

## 30. The 2026-08-15 session (seventh of the day) — mobile round two: the phone gets its gestures, and one colour stops meaning seven things

**Branch** `claude/mobile-round-two-0815`. The author's brief was a mobile
pass plus a standing bar — "Apple level clean" — and one data item at the
front. Twenty-one numbered items; everything below is interaction and
rendering except item 0, and no data rule changed.

### 0. Newbury's Zoning Board goes live, and the venue was never missing

The board had sat at `KNOWN_UNCOVERED` for a day because its meeting PLACE
appeared in no prose on any rung walked: not the department page's text, not
three agendas read in full, not the town's events listing. The prior session
recorded that honestly and named the next rung as the board's approved
minutes.

It was on the department page the whole time, in **markup**. The page carries
a "Contact Info" pane with a vCard `street-address` block — `937 Route 103 /
PO Box 296 / Newbury, NH 03255` — beside a `See map: Google Maps` link whose
query string is the address. The author found it in his own browser through
the map link. Verified here by live retrieval (200 through the browser rung)
and the Census geocoder re-run rather than copied from the sibling rows.

One venue-cache row and one wiring row took the body from KNOWN_UNCOVERED to
LIVE, exactly as the prior session's note predicted and on a rung it did not
name. **The refusal to infer the venue from the sibling boards was still
right**: the independent answer agrees with them, which is the one thing an
inference could never have proven.

**Counts with denominators.** The page publishes SEVEN dated sittings across
2025–2026; the served window (90 back / 60 forward) admits exactly ONE from
today — the 2026-08-13 sitting — and the other six are outside it. That is a
clip, not a failure, and the test asserts both numbers so neither can
silently become the other. `unknownVenue` drops: 0. The composite snapshot
went from 4 schedulepage bodies to 5, 26 meetings to 27, 229 total from 10/10
sources.

**Playbook diff (R13), four entries.** "Prose said no; ask the markup" — grep
retrieved HTML for `street-address`, `adr`, `vcard`, `maps.google`, `ld+json`
BEFORE hunting a second source, and read the address out of a map link's
query string where the visible text does not carry it. "A hover-only menu is
invisible to a click-walking rung" — newbury.nh.gov reveals its boards list on
HOVER with no click, so read the nav's markup and never treat a menu that did
not open as evidence about what a town publishes. "The town's one building,
and the label it uses." And Newbury's fourteen-body observed universe, from
the author's own read of that menu, recorded as a denominator: four wired,
ten `NOT_ATTEMPTED`.

### The palette pass, and the token that was never real

The author: "I don't know how I feel about all this gold font." He was
describing a defect, not a preference. `--link` aliased `--accent-local` and
`--signal` aliased it again, so ONE colour carried links, structural labels,
seat titles, counters, tier headers, focus rings and active chips. A colour
that means seven things means nothing, which is why the screen read heavy —
the eye had no way to tell which gold was the one to act on.

What changed is the DISTRIBUTION, not the hue. `--link` is the one
interactive accent and now marks only tappable things. `--action` /
`--action-on` are the filled primary action, reserved for the ballot pill and
Ask. `--label` is new and neutral: type tags, seat titles and section eyebrows
carry weight instead of colour. Counters went back to the data register. Tier
accents and party colours are untouched, and so are the pill families.

**`pnpm contrast` is the new guard, and its bar is the tester's, not
WCAG's.** Her field finding was that gold-on-light is unreadable in phone
glare — which is a WCAG *pass* that means nothing outdoors, because direct
sun raises a display's black level by more than the whole contrast budget of
a 4.5:1 pair. The script reads the tokens out of `globals.css` (never a copy)
and holds every reader-facing pair to **7:1** against the surfaces it actually
renders on, in both themes, with each exemption listed and reasoned. Light
`--link` measured **2.90:1** — below AA, never mind glare. Eight tokens moved;
every pair clears now.

**Found by the work: `--signal` was never a real custom property.** It existed
only inside `@theme inline`, which is Tailwind's *inline* form — it teaches
the compiler to substitute values into utilities like `text-signal` and emits
no variable. So `text-signal` worked and every one of ~20 arbitrary usages
resolved to nothing: `border-[var(--signal)]`, `bg-[var(--signal)]/5`, and the
raw `var(--signal)` in the stylesheet. DESIGN.md's own "filled amber Ask
button" was an unfilled outline. "What's on the ballot" inside the
who-governs card — the entry a whole session was spent making findable — had
no accent border and no tint. Every reaction control's selected state, the
funding pill frame, the tutorial dots and the agenda notice were unstyled.
This is the empty-success shape in CSS: a declaration naming an undefined
variable fails silently and reads exactly like one that works. Caught by
reading a computed style rather than a stylesheet, which is now the rule.

### The overlap audit, and what the reported collision actually was

The author reported "the sidebar footer collides with the map legend at
mobile width". Measured before touching: the footer is not special. The
legend is `position: fixed` at z-1100 over a z-1000 drawer, so it paints on
whatever the reader has scrolled to — his screenshot caught the footer, ours
caught the DATE RANGE heading. A fix aimed at the footer would have moved the
collision rather than ended it. The legend explains pin colours on a map the
drawer is covering, so it hides while the drawer is open.

`pnpm overlaps` walks nine states at 390px and reports every rectangle
intersection between floating chrome and readable surfaces. It found a second
one nobody had reported: **the sidebar-count doors sat at `z-40`** while every
other large surface is 1200–1300 and the legend is 1100, so a door rendered
UNDER the pin-colour key. Both clean now, 0 across 9/9.

Two traps the walk had to be taught, both familiar: `getBoundingClientRect`
is layout rather than paint (so rects are clipped to their scrolling
ancestors), and no inner named functions inside `page.evaluate` (esbuild
rewrites them to a `__name` helper the page does not have). And the first
version printed "skipped" for two states it never reached and then reported
zero overlaps across six — a clean bill of health for work it had not done.
An unreached state is a failure now.

### The battlecard, rebuilt

Every major block is a collapsed pill header with identity open above them.
The order is recorded in DESIGN.md: identity → what-this-office-does → contact
→ money → votes. The office explainer sits ahead of the author's four because
of the stranger test — a reader who does not know what a ward council member
IS cannot use a phone number or a donor list.

The section SET is identical per office class, and that is the equal-effort
rule enforced at the component: hiding a section because it would be empty
makes the well-covered candidate's card taller and more substantial, which is
a layout thumb on the scale.

The votes split into two columns, both collapsed. **Recent** is the last 20
roll calls, count-based rather than time-windowed because a congress votes in
bursts, and nothing is filtered — voting to table a bill is voting to kill it
without going on record, so the procedural rows are where a position often
lives. **When it mattered** is the B15 list with its published criteria at
the head and two collapsible sub-groups. A House card collapses the sixteen
nomination entries into the one honest line rather than repeating it sixteen
times.

**Found by wiring it, and it is the session's worst near-miss.** The
key-votes component was written to render a position per member per roll
call, and there were no positions in the product at all — B15 resolved WHICH
roll calls, B17 verified them, neither fetched how anyone voted. With nothing
to render it fell through to its default: **"Did not vote"**, a specific,
false, checkable claim about a named member of Congress, on every row. It had
never been visible because the section had not been wired to a surface.

`pnpm key-votes:positions` fetches all 52 cited roll calls. Counts: 52 of 52
fetched, 6,162 current-member votes of 7,773 recorded in the House, 2,889 of
3,398 in the Senate — the gaps are members who have left office, which is the
expected and correct shape. The Senate's nomination entries cite `.htm` pages
because that is where a reader should be sent; the machine-readable sibling is
`.xml`, and the first run reported sixteen zero-parses rather than writing
sixteen empty maps. A null position now says WHICH gap it is: "Not in this
chamber for this vote" (we hold the roll call, they were not in it) or "We
haven't recorded this vote yet" (ours).

Verified live: Mark Kelly, 20 LAWS with 17 positions, 2 entries with no roll
call at all rendering their absence lines, and 1 — the CARES Act, March 2020 —
where he was not yet a senator. The stated N is 20 and counts all of them.

### The rest of the phone

A press outside dismisses the who-governs card and all three compact popups,
the way a native sheet does; the explicit controls stay, because a gesture
nobody discovers is not an exit. The ballot pill is large and filled with an
Ask pill beside it that focuses the ask box already on the page rather than
mounting a third one. Tapping the zip opens a compact entry with device-local
recents.

**The location is session-scoped now** (the author's 6f ruling): a fresh open
asks where you are, and the only thing that outlives the tab is the recents
list. A stale location is the one kind of wrong answer this product cannot
notice on its own — every number under it is correct, for a place the reader
is not.

**The bubble blinked on every pan**, which the tester reported as the card
"keeping reappearing and disappearing", and the cause was not the expansion
rule everyone suspected: `current` is null for the whole gap between a settle
and its answer, and the collapsed card's bubble — a button with no data in it
— hung off `current`. It is held and dimmed through the gap now.

Near me resolves districts, through the same D53 machinery a typed street
uses: same lifetime, same promise, nothing stored. The counter highlight means
"this door is open" on all four tiles instead of being a permanent accent on
one. The calendar chooser is a centered dialog with a mark per destination —
an anchored menu's position is a function of its trigger and a centered one is
a function of the viewport, which is why it clipped at 390px and now cannot.

The clear-picks dialog lost its second sentence. Half of it was untrue: the
picks were never sent, but the taps that made them joined anonymous totals and
this button cannot un-join them. The fix was subtraction, not a longer
sentence.

### Four rulings recorded

The sidebar's date range defaults to 90 days back, matching the served window
— it was `now`, so every concluded meeting the pipeline retrieves was filtered
out before a reader could see one. Two tests asserted the old default and were
inverted; one said in its own message that a pass meant rewriting rather than
deleting.

"Not independently verified" retires. When a meeting comes off a town's own
planning-board page there is no independent party who could verify it and none
is wanted — the SOURCE link IS the verification, and the line taught readers
to distrust the most reliable record here. It now renders only for a
`secondHand` provenance, which no adapter sets.

The ask classifier is author-ruled acceptable as built; the flag stays LIVE
and keeps its question, because a ruling is a position on doctrine and
doctrine can move. The last-passage rule is recorded as standing in the
key-votes header, with the reason B17 learned it.

### The probe rows this session created

**None.** No reaction was tapped, no log event was fired, and nothing was
written against production. The verification here is screenshots, the two
audit scripts, and read-only API reads against the local dev server. Stated
because the standing order requires it either way: a session that created no
rows says so, so the absence is a finding rather than an omission.

### The deploy did not land, and this is the one thing this session could not close

`main` carries everything: PR #42 merged at `a7939a5`, local main
fast-forwarded, no branches open. `pnpm build` is exit 0 on this exact tree,
so the code compiles.

**Production is still serving the previous build 45 minutes after the merge**,
and it was checked twenty-two times over that window with a cache-buster on
every request, so this is not an edge cache holding a stale page:

- `GET /api/votes?member=congress:K000377` returns `chamber: undefined` and no
  `keyVotes` key at all — the old route's shape.
- `GET /api/meetings?…&zip=03255` returns 30 meetings and **zero** Zoning
  Board rows; local returns 31 with the ZBA at "Newbury Offices".
- The front page's HTML contains no `ballot-pill`, which the new floaters
  cannot render without.

The Netlify build log is the next rung and it needs the author's login — the
same wall §12 recorded when a production cause had to be instrumented instead
of read. So the honest statement is: **shipped and merged; not yet verified
live.** Either the build is queued behind something, or it failed for a
reason that does not reproduce in `pnpm build` locally (an env var, a
Netlify-side limit, a plugin). Everything in this section's claims about
behaviour is verified against the local dev server at the merged commit and
against the walk's twenty checks; none of it is verified on production yet.

> **Closed 2026-08-16 — §31.** The build had failed, not queued, and the
> cause was in this session's own tree: `scripts/walk-0815g.mts` did not
> type-check. This paragraph stands as written rather than being edited into
> hindsight — it was true when written, and the honest form of a wrong guess
> is a correction beside it. The two suspects it names ("an env var, a
> Netlify-side limit, a plugin") were all wrong; §31 has the diagnosis, and
> **§30 is now verified live: 20 of 20 against production.**

### What was cut, and why

The brief's own cut order permitted deferring **3** first, then **6e** whole.
Item 3 shipped. **Not built, and nothing half-built:**

- **6b2, the state-focus map** — the vivid/dim treatment, the border dialog,
  and the release-on-zoom-out. The largest item in the brief and the one that
  needs the most care: it is a new interaction doctrine ("quiet within a
  state, explicit between states"), fifty states plus DC from day one, and a
  crossing detector that must not fire on a wobble. Recorded as **M91** with
  the design captured rather than summarized.
- **6e, See information / Go to website** — the two-action model on bodies and
  districts, including the AZ-6 linking defect the brief names. **M92**.
- **6e3, the who-governs information order** — the card's own open/one-tap-down
  discipline. **M93**. The battlecard's version of this shipped and is the
  pattern it would follow.
- **6g's footnote half** — the repeated proposition blurb and the ask box's
  repeated unsourced-body line. The SOURCE tag, "Why these five?" and the
  moving-here shuffle all shipped. **M94**.
- **6d's age for the three governors** — "In seat until" ships wherever a term
  end is sourced, which is all 537 federal members; the statewide executives
  carry neither a sourced term end nor a birth date, so their cards say
  nothing rather than guessing. Named in **M95** as the hunt it needs.

## 31. The 2026-08-16 hotfix — the deploy gate: a walk script blocked the truck

**Branch** `claude/deploy-gate-0816`. Small session, four jobs: fix the type
error that failed Netlify, answer why the session before it saw a green build,
gate it so it cannot recur, and finally run §30's walk against production.

### The type error, and the guard that replaced it

Netlify's build for `main@705f73b` failed on
`scripts/walk-0815g.mts(313,23): error TS18048: 'found.zba' is possibly
'undefined'`. The site code compiled clean — a **walk script** stopped the
deploy.

The cause is a union that was never a discriminated one. The probe returned
`{ error: number }` on a bad response and `{ total, zba, first }` otherwise,
and the caller narrowed with `"zba" in found`. TypeScript widens a union like
that so both members carry every key, one of them optional-undefined, so the
`in` test narrows nothing and `found.zba` stays `number | undefined`.

Fixed with a real discriminant (`ok: true | false`) rather than a `!`
assertion, and the two outcomes now render as the different things they are:
an unreachable meetings service **throws a named error**, because a
`check(..., false)` would land in the summary looking exactly like "the
Zoning Board is missing from production" — a different and far more alarming
claim. A zero count stays a failed check, loudly, with its denominator beside
it.

### Why the last session's `pnpm build` was green — diagnosed, not guessed

The brief named two suspects. Both were tested before anything was declared.

**Suspect A, a stale `.next` skipping the type-check: wrong.** Running
`pnpm build` on the warm `.next` that session left behind reproduces the
failure exactly — `✓ Compiled successfully in 718ms`, then `Running
TypeScript ...`, then the identical `TS18048`. Incremental compilation does
track newly added files; `tsconfig.tsbuildinfo` did not hide anything.

**Suspect B, the build ran before the file existed: right, and it is the
whole answer.** §30's last `pnpm build` was part of the checks run before the
documents commit. `scripts/walk-0815g.mts` was written *after* that, in the
final-pass step, and between writing it and `pnpm handoff --ship` the session
ran only `pnpm walk:0815g` — never `tsc`, never `build`. The green build was
true about the tree it saw and stale about the tree that shipped.

So the failure is not a cache bug or a config drift. It is an **ordering
gap**: nothing stood between the last verification and the merge. That is
what decided the shape of the gate.

### The gate

`pnpm handoff --ship` now runs `pnpm build` — the exact command
`netlify.toml` gives Netlify — with `tsconfig.tsbuildinfo` cleared first, and
refuses to push if it fails. The diagnostic is printed rather than swallowed,
because Netlify's build log needs the author's login and a gate that only
said "build failed" would move the wall rather than remove it.

**Why the build and not `tsc --noEmit`.** They are nearly the same pass, and
`tsc` is much faster. But `tsconfig.json` includes `.next/types/**/*.ts` — the
route types Next GENERATES during a build — so a bare `tsc` run checks
whatever those files happened to say last time, and a bad route-handler
signature is exactly the class of error it could miss. Running the real
command removes the question instead of reasoning about it.

**Rejected alternative, recorded: a `.githooks/pre-push` hook.** It would
catch a push that bypasses handoff, which handoff by definition cannot. It
loses on two counts. It is installed by `git config core.hooksPath
.githooks`, which is per-clone and which `pnpm session:start` only *reports*
on — a gate that can be silently absent in a fresh clone is not a gate. And
it would fire on every work-in-progress push, which is how a minute-long
check gets `--no-verify`'d out of existence. `--ship` is the single door
everything merges through, it already refuses on a dirty tree, and its output
is the checklist a session actually reads.

**No skip flag, deliberately.** An escape hatch on a gate is how the gate
stops meaning anything.

**Proven, not assumed.** A deliberate TS error was injected into the same
walk script and the gate's exact body run against it: it refused and printed
`scripts/walk-0815g.mts(352,5): error TS2532 · Failed to type check.` The
tree was then restored and `tsc --noEmit` exits 0.
`tests/handoff-gate.test.ts` guards the WIRING — that `buildGate()` is called
before the first push, that its result is acted on, that it runs the same
command `netlify.toml` does, that the incremental info is cleared, and that no
skip flag has appeared. A source scan rather than an execution test on
purpose: running the gate inside `pnpm test` would take the suite from three
seconds to two minutes and would be testing Next rather than us.

### §30, verified live

**The deploy landed.** `main@6a6dbbd`, the gate green in 9s, and production
serving the build ~4 minutes after the merge. Verified with a cache-buster on
every request, against the three signals §30 could not get:

| Signal | Production |
|---|---|
| `/api/votes?member=congress:K000377` | `chamber: senate`, 20 recent, **36 keyVotes**, 20 LAWS of which 17 carry a position |
| `/api/meetings` at 03255 | **31 meetings, 1 zoning-board row** — "Zoning Board of Adjustment @ Newbury Offices", 2026-08-13T19:00 |
| the front page carries the ballot pill | see below — the probe was wrong, the build is right |

**`pnpm walk:0815g` against production: 20 of 20.** Every check §30 could
only make locally — the outside-press dismissal and its survival through a
pan, both floaters, the zip switcher's recents, each tier toggle in its own
colour, the legend clearing the open drawer, both battlecards collapsed to
their headers with the laws group stating 20, a House card saying the
nominations line exactly once, "In seat until" on both, and the Zoning Board
live at 03255. `pnpm pairs prod` filed 17 production screenshots beside their
local pairs. **§30 is verified live.**

### The third signal was a bad probe, and that is a finding

"The front page carries the ballot pill" returns **zero** against a correct
deploy, and it will keep doing so. §30 made the reader's location
session-scoped, so the server render has no zip, so `MapFloaters` returns
null and the welcome overlay takes the screen — exactly as designed. The
class cannot be in the SSR HTML.

The probe was written the same day as the change that invalidated it, which
is how a check ends up measuring the wrong thing while looking authoritative.
Two replacements, both used above: the deployed **CSS bundle** carries
`.ballot-pill`, `.ask-pill`, `.card-section-header`, `.reaction-box`,
`.candidate-avatar`, `.zip-switcher` and `.source-tag` (7 of 7 in
`/_next/static/chunks/0_qcxguehz_71.css`), which is a build-artifact fact; and
the walk drives a real browser with a seeded session, which is a reader fact.
Recorded as **R24** so the next session does not re-derive it.

### The gate's own first version was broken, and running it is what caught that

It used `execFileSync("pnpm", …)`, which cannot run pnpm on Windows at all —
pnpm is a `.cmd` shim and Node has refused to spawn `.cmd`/`.bat` without a
shell since the 2024 argument-injection fix. It threw, the catch treated any
throw as a failed build, and the gate refused a ship over a tree that builds
clean in nine seconds. A false refusal rather than a false pass, so nothing
shipped broken — but a gate that cannot tell "the build failed" from "the
gate could not run" is untrustworthy in both directions, and the two are
reported separately now.

**The guard test could not have caught it**, and that is worth knowing about
the guard test: it scans wiring, and a spawn that never happens is not
wiring. What caught it was running the thing. The same test then caught the
*fix* — it asserted the gate spawned `["run", "build"]` and the fix spawns
one literal command string — which is the assertion doing its job on the
first day it existed.

### Probe rows, and the playbook

**No production probe rows.** Nothing was written against production: every
production request this session was a GET against `/api/votes`,
`/api/meetings`, the front page or a CSS chunk, plus the walk's read-only
browsing. The walk taps no reaction and fires no log event.

**Playbook diff: nothing new.** This session touched build tooling and a
type error; it walked no source ladder and learned no rung.

---

## 32. The 2026-08-16 session (second of the day) — the cards take their final face, the brown dies, and the federal directory is solved in one fetch

Written for a reader with no context on this repo. Branch
`claude/final-face-0816`.

### The sentence that was false on production

The battlecard **Sources tab** rendered *"Nothing on this card came from an
external record"* on the Tucson Unified District card. Every fact on that
card came from an external record: its boundary from Census TIGER/Line, its
governing board from the district's own roster page, its sittings from the
district's own agenda vendor. On a product whose entire claim is sourced
accuracy, that sentence was the worst thing on the screen.

**Diagnosed before fixing, and it was one line.** `districtSubject` in
`components/map/map-entry.tsx` passed `sources: []`. Not "empty because we
checked" — never wired at all. Only the meeting card ever built a source
list, and it built its own inline: a parallel join, which is the shape this
repo has now been bitten by four times, and the one nobody screenshots is the
one that stays wrong.

There is **one assembler** now (`lib/officials/card-sources.ts`), called by
every card class. `SeatHolder` carries its full provenance instead of a bare
URL — which is *why* the tab had to be fed from somewhere other than the rows
it described. Rows merge by publisher and page, so thirty sittings from one
vendor read as one source stating its count rather than thirty identical
blocks. The person battlecard has no tab bar, so it gets the same list as a
collapsible section with the stated N in its header.

**The guard runs against the committed Tucson Unified roster, not a
fixture** — a fixture-only test would have passed on the broken code too.

### The mini card, and the trap that produced it

The author reported Pima's supervisors "reading vertically" in the small
popup. That is a real thing and here is exactly what it was.

The representation rows were `<PopupRow label={holder.officeTitle}>`, and
`.pk` — the key column — is `white-space: nowrap`. A 300px card leaves 264px
for a label and a value. *"County Supervisor, District 2 (Vice Chair)"*
refuses to wrap, eats all of it, the value column collapses to a few pixels,
and `.pv`'s `word-break: break-word` breaks the **name** one character per
line. **"Dr. Matt Heinz" as a vertical column of letters.**

**It was never fixable by tuning a width.** A two-column row whose key can be
arbitrarily long will always eventually starve its value. The rows are
stacked now — name at full width, office beneath — and the same fix went into
the who-governs card, which had the identical pattern and was one long seat
label away from the identical failure.

That is written into the playbook as a rung, because it is a class of defect
and not an incident.

### The cards' final face

The author's rulings, built:

- **The identity header.** Circle portrait with a **NEUTRAL** ring — the
  reference screenshot rings it in the party's red and that is the one thing
  not adopted, because a party-coloured ring makes the photograph itself a
  partisan mark and a nonpartisan office would then wear either a colour it
  has no claim to or a visibly lesser frame. The initials avatar occupies the
  identical circle. Name as the dominant type. One chip row: party **filled**
  in its assigned colour, state / chamber / incumbent as **outlined**
  neutrals, all one height — fill-versus-outline carries the emphasis, never
  size.
- **Voting Record** is one full-width section with two selectors inside it;
  the selected view takes the whole box and selecting one collapses the
  other. `Recent` and `When it mattered` used to float as two headers with no
  parent, in a grid that gave each half the card.
- **Yes and no are pills**, in both views, and a settled reaction wears one
  too. The honest-outcome rendering is unchanged underneath: only a 204 or a
  device-restored selection earns the pill, so a write that did not land can
  never render as one that did.
- **Pictures first within a contest** (item 5b). The trade-off was raised —
  layout position now stacks on the information advantage — and the author
  ruled anyway. Recorded, with the three constraints that keep it from being
  a ranking.

### The chevron defect, diagnosed

`.card-section[data-open] .card-section-chevron` was a **descendant**
selector. CardSections nest — "When it mattered" contains "Votes on laws" and
"Votes on people" — so opening the outer section rotated every chevron inside
it, and the closed sub-groups pointed **up while shut**. The rule two blocks
above it already used a child combinator for the background, so half the pair
had always been right, which is why it read correctly in a diff.

Audited everywhere while in there: the zip switcher's chevron never rotated
at all. `list-overlay`'s triangles and `.funding-type`'s marker are correct.

### The brown dies

The author: *"I hate this brown throughout. Change it to something else
entirely."* The interactive accent was amber — `#ffb000` dark, a deep amber
`#6d4600` light that reads brown everywhere it touched.

It is **azure** now (`#4fc9e8` / `#0a4f61`), system-wide through `--link`,
`--action` and `--signal`. The reasoning is recorded in DESIGN.md because the
choice was constrained rather than free: the accent had to sit clear of every
party colour, every tier accent, `--danger` and `--voice`, and the gaps left
were lime, cyan/azure and indigo. **An accent a reader could mistake for a
party colour is a worse defect than a brown one** — a link that reads as a
party mark is a claim.

Found while doing it: `--color-signal` (the Tailwind alias behind
`text-signal`) aliased `--accent-local` while the real `--signal` property
aliased `--link`, so **one token name had two values depending on which
spelling a component used**. The M96 trap running the other way. Both resolve
to `--link` now.

**Recorded, not done:** the tier accents did not move, so
`--tier-fill-local` in the light theme is still a deep amber on the selected
Local toggle. The brief permits moving Local provided the map legend moves
with it; retuning the legend against the basemap is the author's eye's call,
not a side effect of a link colour.

### One fetch, and the federal directory is solved

`unitedstates/congress-legislators`, **SHA-pinned** at
`4458244308621d0570a15008f46888b7a87645eb`, never `main`. Every count matched
what the brief stated: 537 members, birthday on all 537, FEC ids on 535, X on
505, 1,306 district offices, 49 committees, 181 subcommittees, 3,891
membership rows.

**The thin-guard earned its keep on the first run**, catching that
`committee-membership-current.yaml` is a map keyed by committee id and not a
list — which would otherwise have written a snapshot with zero memberships
and reported success.

**The migration DIFFS; it does not overwrite.** The federal roster already
carried a birthday and term end for all 537, from the same upstream through
its *unpinned* JSON mirror. The author's ruling demotes that to
fallback-and-audit: 537 of 537 matched by bioguide, **0 disagreements**, and
the report at `docs/congress-legislators-diff.md` is written whether or not
it finds anything — "we checked and they agree" and "nobody checked" are
different facts and only one is worth having.

Two boundaries, both guarded: the provenance tag names the **project**, never
"official records"; and it is a **directory**, not a ledger — no votes, no
money, no statements.

**Seen live, and it is the recency exception working:** Adelita S. Grijalva
holds AZ-7 in our roster and carries no social accounts in this pin, because
she took the seat after the pinned commit. Her card renders the absent
channels as absent pills, which is the correct answer.

### What was measured, not assumed

Everything below was read out of a real browser at 1440 and 390:

| Claim | Measured |
|---|---|
| The accent moved | computed `--link` / `--action` / `--signal` all `#4fc9e8` |
| The ring is neutral | `rgb(42, 45, 55)` = `--panel-border` |
| Chips are one height | 28px on all four, party filled, rest outlined |
| Pills stay tappable | 44px on every pill; 8 on Mark Kelly's card |
| Voting Record is full width | section 638px, body 634px |
| The accordion works | Recent selected → When it mattered selected |
| **The chevron defect is fixed** | only the OPEN section rotated; both closed sub-groups `transform: none` |
| Stated N equals rows | Sources 2/2, Committees 11/11, Offices 2/2 |
| Counters stopped overflowing | `scrollWidth > clientWidth` FALSE on all four, both widths |
| No page overflow at 390 | `scrollWidth` 390 = `clientWidth` |
| The vertical text is gone | "Dr. Matt Heinz" in a 208px box over 2 lines — words wrapping |

### Found BY the verification — M112, and it is a P1

Verifying item 1 on production meant opening a real district battlecard. The
Sources tab was correct. Its **Representation** tab was not.

Open any district on the map that does NOT contain the reader's own point and
the card states *"No sourced officeholder for this division yet"* — while we
hold the officeholders. At 85701 the point resolves `sldl:20`, so State House
District 21's card denies **Consuelo Hernandez** and **Stephanie Stahl
Hamilton**, both in the committed AZ store.

**It is not M86 recurring.** The card does use the shared resolver now. But
`representationForDivision` reads `coverage.seats`, and the coverage summary
is point-scoped by construction — it carries only the divisions containing the
reader. Every other drawn district gets an empty array, and the empty array
renders as our gap.

That is **the render-default rule adopted in this same session**, violated by
a resolver rather than by a component. Absence produced by a scope limit is
being stated as absence of a record.

Diagnosed, **not fixed**, and the row says In progress: the honest fix needs
seats for arbitrary drawn divisions available client-side, which is data
plumbing rather than copy. Building it unverified at the end of a session is
how a false claim gets replaced by a differently false one.

### Probe rows, and the playbook

**No production probe rows.** Nothing was written against production this
session. Every request the walk made was a GET against `localhost:3000`; the
production verification is GETs only. No reaction was tapped and no log event
fired.

**Playbook diff — two entries added.** The federal rung is solved once,
nationally, so a new state's depth run starts with the federal tier already
done; and the two-column trap is written down as a rung, with the measurement
that detects it (`lab.scrollWidth > lab.clientWidth`).

## 33. The 2026-08-16 session (third of the day) — the correction pass: the sensor proves it counts, and a district card stops denying people we hold

The author's production pass arrived as the session brief (committed at
`docs/session-brief.md`). Two of its items were truth defects live on
production and they led in order. **No untriaged entries were found in
`docs/defects.md` at session-open** — every entry already carried its row
pointer.

### The sensor was counting. The screen was not saying so.

The author, on production: tapping **Yes** on "Do you like this vote?" BLANKS
the button; tapping **Love it** on the funding question makes it DISAPPEAR.
The brief asked for a diagnosis in one of two directions before any component
was touched, and named the stakes: direction (b) — a swallowed error on the
product's core sensor — would mean the honest-outcome rule had been violated
on production and the report would have to say for how long.

**It is direction (a), and the evidence came out of Neon before a line was
edited.** Three reaction rows landed today under two browser keys:
03:57:38Z `FUNDING_TOTAL_REACTION` H2AZ02360 **LOVE**, 16:26:01Z `CANDIDATE`
`ballot-az-pima:governor|Katie Hobbs` **YES**, 16:36:15Z
`CONTRIBUTOR_REACTION` S0AZ00350 **DISLIKE** — each with its scale version,
`ANONYMOUS` tier, `suspect_reason` null. **The author's own Love it tap is in
the table.** P11's `COUNTED`/`NOT_COUNTED` contract was never violated: the
204 was earned and the settled state was correct. It was invisible.

**The cause is the CASCADE, not the component**, and it was verified on the
production artifact rather than in the repo. In the shipped stylesheet chunk,
`.reaction-choice--settled` sits at byte 59,982 and `.reaction-choice` at
61,497 — the base rule LATER, at the same specificity — so
`background: var(--panel-bg)` won and took the fill back, while
`color: var(--vote-text)` and `border-color: transparent` survived from the
settled rule. Near-white `#fdfaf4` on `#f8f9fa` measures **1.012:1**: no
text, no border, an empty rectangle.

**Light theme only**, which is why it read as a blank rather than as a missing
colour — in dark the same broken cascade measured 15.60:1, so the label stayed
legible and only the fill was gone. Live from the merge of PR #47 (36440d7,
2026-08-16 02:00 −07:00) until this fix; the pill and the defect entered in
the same commit.

The rule is `.reaction-choice.reaction-choice--settled` now, doubled so
source order can never decide it again, and it sits with the control it
modifies. **The guard refuses to read class names and believe them**, because
every class name read correctly while the button was blank:
`tests/reaction-pill.test.ts` taps all nine values across both scales, takes
the class list the control would actually render, resolves it THROUGH the
stylesheet by specificity and source order, and asserts both the expected
`--vote-*` fill and a 4.5:1 floor in both themes. Proven to fail against the
shipped stylesheet: two of six tests fail, naming the fill that was taken
back. Measured after, on a real tap: Yes → `rgb(28,125,76)` at 4.93:1 dark
and 6.73:1 light; Unsure → the neutral at 5.95:1 and 7.51:1.

### A district card was denying officeholders we hold, and it was not a copy fix

M112 was diagnosed by the previous session and left In progress rather than
half-built. **Fixed by RESOLUTION, so the fallback sentence was not needed.**
The measurement, taken before the fix against the committed stores from a
downtown Tucson point: **24 of 24** non-containing divisions we hold
officeholders for rendered zero. Every congressional district outside AZ-7.
Every Arizona state senate and state house district the reader is not in. NH
`sldu:14` and `sldl:1`. Three division types, at every zip, on the largest
overlays the map draws.

The cause was scope, not sourcing: `coverage.seats` is point-scoped by
construction. Seats resolve by the clicked division's own OCD-ID now —
`seatHoldersForDivision` reads the index that was already keyed that way, so
it is the same store, the same rows and the same sourcing with no new data.
The route puts **the division in the PATH**, never a query string: an OCD-ID
is already a path, so every cache keys on it by construction and distinct
divisions cannot collide. That is D40's rule stated where it would bite.

**The render-default rule held throughout.** A gap sentence is never spoken
while the lookup is in flight, and a FAILED lookup gets a third sentence of
its own — not-yet-asked, could-not-check and hold-nobody are three facts and
may not render as one. The battlecard re-derives for the still-selected
division rather than freezing on the looking line.

### The author's card rulings, and one of them reverses last session

**The who-governs list goes back to clean**, which deliberately undoes half of
M109: giving the list the battlecards' full element grammar is exactly what
made it "way overcrowded... a forever scroll". Three things per row — name,
party as plain text in its party colour, source mark. No pills on this
surface. "Their site" gone from every row. **The click grammar is two moves**:
a person's name opens their small card, a body's row opens its LARGE one.
Pima and Tucson used to link straight out from the list; the official site is
a fact inside the card now. Measured at 85701, both themes: 8 person rows, 0
pills, 8 plain-party, 0 site links, 8 source marks, 5 body rows opening a
card, 0 linking out.

**The small popup is three things** — name with its circle, party as the
filled pill, contact pills in one vertical column — with More at the bottom
opening the large card. Measured at 1440: 1 chip, 0 role lines, 0 in-seat
lines, 3 pills in 1 column at 262px each, More at 262px, card 300px. Two
judgment calls are stated rather than buried: **email is kept** in the primary
pill set though the author's enumeration did not name it, because dropping a
published way to reach a representative is friction rather than density; and
**the eyebrow keeps the office title**, because it is the card's structural
label and what went is the role line inside the body.

### The pane that looked empty, and the two funding asks

"When it mattered" was diagnosed against production before anything changed:
`/api/votes` serves 20 recent votes and 36 key votes for a senator, all of
which reach the view. The pane's whole visible content was one criteria
paragraph above two CLOSED bars, because both sub-groups shipped closed at
the top level's size and colour. They open with the pane now and indent as
sub-groups. Measured after: 2137px, 6227 characters, 2 sub-groups both open,
20 entries, 10px indent.

**Campaign money asks once per object.** The second prompt is "How do you feel
about these contributions?" — and the sensors were verified rather than
assumed. They were already distinct at every layer: different target types,
separate rows under a unique index that carries `targetType`, separate
aggregate buckets. **Found by that verification**, and it is the half that
was genuinely broken: the tally's QUESTION label came from the SCALE, and
both funding types share the five-point scale, so the contributions tally
would have exported labelled with the totals' sentence. The label is per
target type now; the buckets do not change and never did. The rewording sits
inside scale v2, so it is filed as a **question rewording** with its date and
reason rather than as a scale break — and a version bump, which changes how
reactions are bucketed and exported, was NOT taken unattended.

### The amber remnant was twenty-eight declarations, not one toggle

The brown-dies pass moved the interactive accent through three TOKENS and
that was the whole of it. Every rule written against `--accent-local`
directly kept the amber in both themes: the page's focus ring, every icon
button's hover, the brand CHANGE, the selects, the search input's focus, the
autocomplete's selection and match bold, the proximity toggle, the filter
checkboxes, the filter chips and their counter, the count badges, the notice
FAB, the list overlay's More, the welcome icon and team buttons — and the
loudest of them, **the welcome overlay's submit button**, the first filled
control a reader ever sees.

The reported toggle was `--tier-fill-local: #6d4600` in light: the dead
interactive brown's own hex, left behind, and disagreeing with the legend
that draws the same tier bright. Light fills the way dark does now, bright
with dark text. **The map is untouched** — no tier accent moved, because
retuning the legend against the basemap is the author's eye's call and a
ruling about the interactive accent does not overrule it; the rejected
alternative and its reason are in M118. **Why it survived a whole palette
pass: nothing measured a tier fill.** All three are on `pnpm contrast`'s list
now, and every pair clears its bar in both themes.

### What was cut, in the brief's own order, and nothing half-built

- **Item 8 (M91, the state-focus map)** — the brief's own first cut, deferred
  whole a second time. Its separable half, the drag rubber-band, is recorded
  with what was ruled out rather than fixed on a guess: there is no
  `maxBounds` on the map, the fly-to fires only on a `location` change,
  `allowAutoFrame` is already false for a settled view, and the map island
  carries no `key` that would remount it. The behaviour was not reproduced,
  and a fix for a cause nobody located is how a false claim gets replaced by
  a differently false one.
- **Item 7 (the single search bar)** — deferred. Both inputs keep working.
- **Item 11 (M94, the proposition-blurb hunt)** — deferred; the walk that
  would close it is the walk item 8 also needs.

### Probe rows this session

**Seven**, every one created by this session's own screenshot walk — five
against a dev server bound to the production database, and two against
production itself in the post-deploy verification. Every one is a
`FEDERAL_VOTE` reaction on `house:119-2:283`, tapped in the Recent pane of a
senator's card, scale version 1, `suspect_reason` null:

| when (UTC) | answer | browser key | run |
|---|---|---|---|
| 17:44:24.396 | YES | `fff8a2e3…` | local walk |
| 17:45:22.502 | UNSURE | `fb4e1906…` | local walk |
| 17:45:43.246 | UNSURE | `d04b2225…` | local walk |
| 17:47:19.666 | UNSURE | `a7438a53…` | local walk |
| 17:47:40.102 | UNSURE | `c2959874…` | local walk |
| 17:58:01.949 | UNSURE | `97982f7e…` | **production** |
| 17:58:23.319 | UNSURE | `9d3b0000…` | **production** |

Seven keys because each browser context the walk opens mints its own, and
within a context the second tap UPSERTS the first — which is the store
behaving exactly as designed, and is why five contexts produced one YES and
four UNSURE rather than five pairs. They are plumbing wearing reader clothes
and are named here so a later exclusion is a filter rather than a hunt.
**No other row was written against production this session**; every other
request either walk made was a GET.

## 34. The 2026-08-16 session (fourth of the day) — the regression net, and the state rises out of the map

Branch `claude/regression-net-0816`. The brief's own framing was the finding:
**past wins die silently, because each session's walk checked only its own
brief.** That is the session in one sentence, and everything below either
builds the thing that stops it or is one of the wins it found already dead.

### The net, and what it caught on its first run

`pnpm walk:all` is the suite nobody owned (R27). Every check carries the
SESSION that shipped the claim, so a failure prints as "the win *e* shipped is
undone" rather than as an anonymous red line. It ran against production
**before anything was fixed** — that run is this session's diagnostic sweep,
and it returned **20 named regressions and 5 checks that could not run**.

Four of the twenty were the walk's own aim, and they are corrected here rather
than softened: `/api/votes` called without its required `member` param,
`/api/funding` called with a slug shape the route has never taken, a wording
change that had moved on, and a document-wide regex reading the hidden welcome
overlay's shortcut buttons and reporting Arizona contamination on a clean New
Hampshire card. **A walk that misses its aim and a product that broke must
never print the same way**, which is why `cannotRun` exists beside `check`.

The rest were real. Three of them are the ones the author had already seen.

### `/about-area` had been answering HTTP 500 at every zip (M121)

The moving-here door, linked from every who-governs panel. Diagnosed to the
exact throw rather than guessed: a Server Component was handing a Client
Component a **render prop**, and a function cannot cross that boundary. React
refuses it outright, and in a Server Component the refusal is a 500 at REQUEST
time — so nothing failed at build, and the route looked half-alive because the
one path that renders no facts (an unresolvable zip) never constructs the
element and answered 200.

A static guard now refuses any function prop on any client component that is
not an `on…` handler, **proven against the exact line that caused it**. It
caught this session's own state-focus overlay an hour later, which is the
guard working; that component takes a live MapLibre projection and cannot
reach a server component at all, so it carries an annotated file-level
exemption rather than a renamed prop. The obvious way past a guard like this
is to call the prop `onProject` and move on, and that would defeat the rule
while making the name worse.

### Kearsarge went dark, and the brief's lead was wrong (M122)

The truth session verified fifteen Kearsarge sittings live. Production showed
**seven meetings from one body** at 03255, against twenty-six from four.

The brief's diagnosis lead was that `curl` is missing in the refresh runtime.
**It is not, and the log disproves it.** The refresh runs on `ubuntu-latest`;
a missing binary rejects with `spawn curl ENOENT`, and every failed run
recorded `HTTP 403`, which is the message `curlGetText`'s own non-2xx path
throws. So curl ran and was refused too. From a residential IP all three hosts
serve 200 to *both* profiles, measured. **The wall is the runner's egress IP**
— not the TLS fingerprint the M79 session found, and not a missing tool. No
header, client or fingerprint change reaches it, and a session hunting one
would have spent a day on the wrong axis.

Two independent defects had produced the outage:

1. **One host's refusal emptied five bodies.** `schedulepage` serves
   Kearsarge, three Newbury land-use boards and Morris Hills Regional across
   three unrelated hosts, through a loop whose first failure threw out of the
   adapter. Morris Hills, in New Jersey, whose own page answered 200
   throughout, disappeared because a New Hampshire school district's WAF did
   not like the runner.
2. **The refresh wrote the absence over good data.** The snapshot with 53
   Kearsarge rows was replaced by one with zero, and the reader was shown an
   empty calendar for a board that sits fifteen times a year.

The second is now a rule in `CLAUDE.md`: **a failed fetch never silently
empties a previously-full surface** — the render-default rule one layer down,
because by the time a null reaches a component the lie is already in the file.
`carryForward` keeps a refused source's last known rows, clipped to the same
window, original `collectedAt` intact, count stated per source; a source that
succeeds and reports no refusal carries nothing, because a body that genuinely
went quiet must be allowed to.

Snapshot regenerated from a runtime that can reach the hosts: **03255 is 31
meetings across 5 bodies**, against the truth session's 26 across 4. Kearsarge
is 15 of 31 — its whole published year.

The neighbouring Kearsarge towns are M123: six towns, every rung recorded in
the playbook, nothing wired and nothing claimed to publish nothing. Sutton
403s the index profile and 200s the browser rung — the same wall, the same
rung that clears it.

### Zooming out was removing pins (M124)

Neither of the obvious suspects. Nothing in the render layer reads zoom at
all, so no cluster threshold and no culling bound. The settle re-query carried
**no radius**, so the server used the ladder's first rung at every zoom level;
a wheel zoom also drags the centre toward the cursor, so once it passed the
re-query threshold a fresh 25 km circle was drawn around a NEW centre and
everything outside it vanished. The reader asked to see more and got less.

Found while verifying the fix, and worth more than the fix: the first draft of
the re-query comparison fell back to the incoming radius when the previous
view had none, so **both sides were the same number by construction**, the
widening never fired, and the walk cheerfully reported "11 → 11 → 11" for a
fix that was doing nothing. The walk now asserts the camera MOVED before it
asserts anything about pins — a green check for an experiment that never ran
is worse than a red one.

### The state rises out of the map (M91)

The largest item, built against the author's own reference. The distinction
that article draws is the whole spec: a **Material card floats above** its
background; a **neumorphic element extrudes from** it, same material. So
inside Arizona's border the map is untouched — no fill, no tint — and the rise
is the dual shadow translated to map layers, one light source at top-left.
Outside is muted **and slightly blurred**, which is why that half is a DOM
scrim with `backdrop-filter` and not a MapLibre fill: no WebGL paint property
can blur what is under it, and a tint pretending to be a blur is half the work
looking like all of it.

Three defects found by measuring rather than looking, and all three would have
survived a screenshot review:

- the CSS compiler **dropped the standard `backdrop-filter`** and emitted only
  the `-webkit-` alias when both were written by hand, so the first pair
  clipped correctly and blurred nothing;
- the scrim was `position: fixed` over the whole viewport and muted the
  SIDEBAR, then at `z-index: 5` sat over the bottom stack and blurred the
  count badge and the freshness line — the reference's own accessibility
  warning happening in practice;
- and the lint fix for a synchronous `setState` **cancelled the pending
  animation frame without clearing the handle**, leaving the
  "already scheduled" guard armed for a frame that would never run. The scrim
  never drew again. It was invisible because the effect re-runs exactly once
  on a first paint — as the outlines land — so the feature worked in a
  screenshot taken before that moment and was dead in every walk taken after.

The **border-crossing prompt** ships with it, entirely missing on production
until now: quiet within a state, explicit between states.

**One conflict is left for the author rather than resolved here.** e's 6b2
says zooming out RELEASES focus. The g3 brief says twice, as his own test,
that the effect holds at every zoom and never disappears. The later explicit
instruction is what shipped; the release rule is not implemented, and only the
shadow's spread scales with zoom.

### The rest, briefly

M94 collapsed the who-governs footnotes (four identical sentences, three of
them naming one town three times). M125 stopped the Sources tab calling an
official-source read "not yet" — a fact read off the Governor of Arizona's own
site, under a link to it, labelled unverified. M126 made the ballot's pick
control name its ACTION, so the private ballot-builder stops reading as the
sensor whose aggregate is sold; D65 is the author's scale-v3 ruling underneath
it. M127 deleted the duplicate contact accordion after auditing it field by
field.

**Deferred in the brief's own cut order: M95 (the governors' two facts) first,
then M123 (the neighbouring towns).** Nothing half-built; both carry their
whole spec, and M123 carries every rung this session walked.

### Production rows this session created

**No reaction row was written, and no ask was submitted.** The standing order
is answered either way, and this session has a wrinkle earlier ones did not
state: **every `/api/meetings` GET writes a SEARCH row** to the production
log (`app/api/meetings/route.ts` calls `logSearchEvent`), so a map settling
on a zip writes one and so does every direct probe. A walk is never row-free,
and prior sessions reporting "no production rows" for GET-only passes were
reporting the reaction store, not the search log.

`pnpm walk:all` counts and prints its own, every run. Against production this
session:

- the first diagnostic run (before any fix): **9 search-log rows, 1 log row**;
- the final verification run after the deploy landed: **17 search-log rows,
  1 log row**;
- plus roughly a dozen more from hand probes of `/api/meetings` at the four
  zips while diagnosing Kearsarge — all GETs at zip granularity, no reaction,
  no identifier.

Every one is a SEARCH event carrying a zip and a tier, which is what the
search log is for and what it holds about anybody. They are plumbing wearing
reader clothes and are named here so a later exclusion is a filter rather
than a hunt.

## 35. The 2026-08-16 session (fifth of the day) — Apple-level clean: the map answers to the reader

The brief's governing standard was the author's own: **Apple-level clean.
Fewer surfaces on screen, nothing repeated, nothing half-open, no element
whose geometry fights its container.** Nineteen items, in a completion order
that put his live defects first and the externally-blocked hunts last, so that
whatever went unfinished would be work waiting on somebody else's server
rather than work he was waiting to see.

That is not how it went, and the honest account of why is the first thing in
this section.

### What the session actually spent itself on

**Item 2 — the extrusion — consumed roughly half of it.** The brief asked for
a MEASURED acceptance check rather than an eyeball one, citing g3's lesson
that three defects survived screenshots and died to measurement. Building that
instrument found three real defects in the thing being measured and four in
the instrument itself, and each one had to be chased down before the next
became visible. The full ledger is in **M129**; the short version is that a
measurement which does not move when the thing it measures moves is not
measuring it, and that fact took four rounds to establish.

The consequence is stated plainly: **items 6, 10, 12, 13 and 16 were not
built**, and item 9 landed only its named case. Each is a tracker row carrying
its WHOLE spec — M134, M136, M137, M138, B19 and M135 — written so the next
session starts from the brief rather than from a summary. Nothing was
half-built and nothing thin was reported as done.

### The mask was bound to the wrong thing (item 1, M128)

The author changed an NH zip to an AZ zip, the map flew to Arizona, and
Arizona stayed blurred. The cause was one line in `activateAt`:

```ts
if (!ocdId) return;
```

It reads as defensive and it is the whole defect. It says *if I cannot
identify a state here, change nothing* — which leaves whatever was raised
before still raised. The mask was therefore bound to the last activation that
happened to SUCCEED rather than to where the reader is, and `stateOcdIdAt`
returns null in three perfectly ordinary situations: the outlines have not
loaded, the zip is in a state we hold no outline for, and the point falls in a
gap of the generalized geometry. All three stranded the mask on the state the
reader had left.

It publishes the null now. No state raised, nothing muted, the map plain —
because **a mask with no owner is the same defect as a stale mask**.

Found while fixing it, and worth more than the fix: `useStateFocus` returned a
fresh object literal every render, so the activation effect in `map-entry`
re-ran on every render and re-asserted the zip's state. That undid an accepted
border crossing one render after the reader accepted it, and cleared the
crossing prompt one render after `noteCentre` raised it. **The border-crossing
clarification could never stay on screen long enough to be read**, and nothing
about that was visible in a screenshot or a test: the effect was doing exactly
what it said, far more often than anyone intended.

### The rise stops being a stroke (item 2, M129)

The author's report — a grey band tracing the polygon with every coastal
vertex showing — is confirmed by the shipped build's own arithmetic. Two
opposed line layers, 4 px apart and 7 px wide, overlap over two-thirds of
their width; white at 0.5 composited over black at 0.42 is grey, on every side
at once. One light source gives light on one side and dark on the other. And a
line layer traces the geometry, so New Hampshire's 256-point coast drew every
digitized vertex.

The rejected alternative is recorded because it is the obvious one: widening
the blur relative to the width is a one-line change and it cannot work. The
defect is not the blur radius; **a stroke follows the path and a shadow
follows the light**.

So the rise is two blurred SILHOUETTES of the state, offset in screen space,
masked to the outside by a FEATHERED mask — a clip is binary, and a binary
edge on a shadow that is at ~97 % of peak where it meets the shape is exactly
the line being objected to. Rings are simplified in screen space at 0.9 px,
which is zoom-adaptive by construction.

**The instrument found what the eye did not.** `pnpm measure:extrusion`
subtracts the effect from its own frame and reported peaks of 130–165 and
adjacent steps of 165–202 where a blurred shadow cannot exceed six. Two causes,
both invisible in a screenshot because a strong soft-cornered wash over a map
still looks deliberate:

- the mask and both shadows were fed the CLIP path — the viewport rectangle
  followed by the state's rings, even-odd, which describes *everything except*
  the state. The mask was inverted and the thing being blurred was a
  viewport-sized rectangle with a state-shaped hole in it;
- the SVG filter regions defaulted to `objectBoundingBox` at `-50% / 200%`,
  which at neighbourhood zoom is tens of thousands of pixels. Chromium clamps
  rather than fading, and a clamped filter region does not fall off — it cuts.

The instrument's own four wrong turns are in M129 and in the script's header,
because each was a way of measuring something other than the subject: basemap
tiles arriving between the two shots; text antialiasing flipping when the
`backdrop-filter` element's compositing layer was destroyed (which `display:
none` and `backdrop-filter: none` do identically, hence identical wrong
numbers through several code changes); the app's own chrome sitting over the
region; and finally the basemap's place NAMES, which the mute blurs, changing
single pixels by more than a hundred units. The step is measured on 8×8 block
means now, where a letterform averages away and a stroke does not.

**Final numbers, four frames: peak 141 / 147 / 168 / 167; steepest gradient
5.29 / 4.49 / 5.43 / 3.97 per pixel against a limit of 6.** Dark theme's light
and shade lead correctly by 280 px and 66 px.

**Open and named (M131):** the light theme's two lobes measure near-coincident
(−22.5 px and −3.0 px against a +4 px floor). The highlight reads on the
author's frames and the test cannot yet prove the asymmetry there. It is not
smoothed over and the threshold was not lowered to pass it — the run reports
two failures across four frames, and says so.

The mute's own edge got the same treatment for a reason the author's frames
made obvious: Arizona's northern, eastern and southern borders are straight
lines, so a binary clip along them drew a crisp rectangle and the state read
as pasted on rather than raised out. CSS `mask` referencing an SVG mask would
have fixed it in one line and **is not honoured on an HTML element in
Chromium** — proved by the frames not changing at all. So the mute's COLOUR
moved into the SVG, masked by the same feather, and only its blur and
desaturation stay on the hard-clipped scrim, where a 1.1 px blur has almost no
luminance step of its own.

### One state, one set of boundaries (item 3, M130)

Two mechanisms, because the item is both a correctness rule and a load win.
`filesFor(type, state)` fetches only that state's files — and a NULL state
returns nothing at all, which is the item's rule rather than a defensive
default. Every layer also carries `["==", ["get","state"], abbr]`, because
`county-us.geojson` is national by design and without a filter a New Hampshire
reader saw Pima County's outline at regional zoom. The filter is what makes
the rule ASSERTABLE: the walk reads it back off the map rather than trying to
photograph the absence of a line.

**The load win, measured:** `cd119.geojson` is 1,592 KB — larger than every
other geo file put together — and was fetched at every zip. Per state it is
23 KB in Arizona. That is a **1,569 KB reduction on the largest single asset
the screen loads**, and it counts toward item 15's budget, which is otherwise
unmeasured (M139).

### The zip gets a shape (item 4, M132)

The geometry did not exist. `pnpm zcta:outlines` pulls ZCTA polygons from
Census TIGERweb for every zip whose committed centroid falls inside a covered
state: **404 of 404 in Arizona, 245 of 247 in New Hampshire, 593 of 595 in New
Jersey**. The five misses are zips with a centroid and no area, which is a real
answer and is stated rather than retried.

It is SERVED, not shipped. 1.06 MB across three states, 599 KB for Arizona
alone, and the reader looks at exactly one polygon — so the files stay in
`data/zcta` and `/api/zcta/<zip>` hands back the one feature, about 300 bytes.
The zip is a PATH segment per D40's rule, because the response is publicly
cacheable and a shared cache is only guaranteed to key on the path.

### The camera stops being taken back (item 5, M133)

The author's own detail is the diagnosis and it rules out the obvious suspect:
inertia continues a motion and never reverses it, so a glide back to the
STARTING POINT is a reframe. It is the 2,800 ms auto-frame, flying the camera
to a box built around the zip's own centroid. `allowAutoFrame` did not catch it
because it is about where the RESULT came from, not about what the reader has
done since — so every pan inside a zip-driven result's lifetime was living on
borrowed time, and the venues array only had to change once to re-arm the
timer. The gate is the reader's own hand now, checked inside the timer as well
as before it, because the whole defect lives in the 2.8-second gap.

### The panels stop shouting (items 7, 8, 11, 14, 15)

Filters opens CLOSED and now holds "Limit radius" and "Show districts"; "Near
me" stays outside, because it answers *where is the reader* — the same job as
the zip — while the other two narrow what is already on screen. District types
is collapsed with its count on the header, because a closed group with no
state on its header is a question rather than an answer.

Meeting groups open closed too, and **upcoming meetings lead**. With ninety
days of history in the serving window, a plain ascending sort put three months
of finished meetings above everything a reader could still attend. The two
halves run in opposite directions on purpose: the list reads outward from now.
A finished sitting carries a filled "Concluded" pill and a cancelled one
"Cancelled" in its own shade, because those are different things to know
before travelling to a building.

**Both of Grijalva's numbers render, labelled, district first.** The district
lines were in the directory payload that only the offices section ever asked
for, so the row showed the Washington one and called it "the phone" — a reader
wanting to reach their representative about something local was handed the
number furthest from the answer. The fetch became a shared hook, so the two
surfaces make one request between them and cannot disagree about whether it
landed.

A selected answer now carries a tick or a cross everywhere — props,
candidates, picks, votes. **The mark is the carrier and the colour is
reinforcement**, which is an accessibility requirement rather than a
preference: roughly one reader in twelve cannot separate this green from this
red, and a state carried by colour alone is a state they cannot read. The
five-point scale's group dividers went from 1 px at 0.85 opacity — "barely
visible", and a divider a reader does not register cannot stop the middle
button reading as the default — to 2 px at full strength.

The who-governs card's dividing lines now fall only between LOCAL / STATE /
FEDERAL, which is where the reader actually changes government, and the
moving-here line reads exactly "Moving here? Know the basics →".

### The one list surface still throwing readers out (item 9, M135)

The sidebar's Bodies door rendered each row as an outbound link, so tapping
Pima left for pima.gov before the reader had been told anything about Pima. It
opens the same battlecard the who-governs list opens, built by the same
subject builder — two doors onto one card, never two cards.

The audit's count, because the count is the finding: **40 external links
across reader surfaces; 39 are INSIDE cards**, which the item explicitly
permits, and 1 was a list row sending the reader out. The districts panel, the
meetings list and the search results have NOT been walked row by row; that is
the open half and it is stated as such.

### The net grew, and three of its own aims were corrected (R28)

Twelve checks appended. Three existing aims corrected — not softened — and
each was found by running the suite rather than by reasoning about it. The
worst of them: the hop check wrote `sessionStorage` and reloaded, and `openAt`
installs an init script that rewrites the location on every navigation, so the
reload put the original zip straight back. **It was measuring its own fixture,
and on a build where the defect was fixed it would have reported the defect
anyway.**

Green locally: 131 of 131, zero could not run.

### Production rows this session created

Every row is named, per the standing order.

- **3 rows from the first browser probe** (23:47:05Z–23:47:31Z): two
  `FILTER_APPLIED` rows carrying the default tier set, and one `SEARCH` row at
  **03255** (tier exact, 25 km, 31 meetings). These came from a single page
  load in the in-app browser pane while diagnosing item 1.
- **The local Playwright runs write to PRODUCTION**, because `.env.local`
  holds the production `DATABASE_URL`. The measurement passes, the frame
  shoots and the local `walk:all` runs each load the app at 85701 and 03255,
  and every `/api/meetings` GET writes a SEARCH row. The final local walk
  reported **25 search-log rows and 13 ask/log rows** for that run alone; the
  earlier diagnostic and measurement runs account for the rest.
- **No reaction was tapped and no ask was submitted at any point.** Every row
  is a SEARCH, a BODY_OPENED or a FILTER_APPLIED event carrying a zip and a
  tier — what the search log is for, and what it holds about anybody.

They are plumbing wearing reader clothes, named here so a later exclusion is a
filter rather than a hunt. **C05** is the row where that filter gets built.

## 36. The 2026-08-16 session (sixth of the day) — the mask stops muting the state the reader is standing in, and the panel stops needing a mouse

Two items, both P0, both only observable on production in a real browser, and
both misdiagnosable in a way that would have cost a day. They turned out to be
the same defect seen from two sides.

### The specification, and what was actually wrong

The author's model: one state is ACTIVE at a time and the zip sets it. The
ENTIRE active state renders crisp, sharp and raised — every corner of it, at
every zoom, indistinguishable from the plain base map except for the raised
edge at its border. Every other state renders blurred and lowered. Only the
active state's per-state geometry loads. With NO active state — before a zip,
or at a zip we do not cover — nothing is muted, blurred or raised at all.

What shipped did the opposite of the first clause. At the zoom a reader lands
on from a zip, the ENTIRE frame was muted and blurred: no crisp region
anywhere, with the reader standing in the middle of the active state.

### Item 1's diagnosis — measured, not read

The mute is a DOM scrim carrying `backdrop-filter`, clipped to "everything
except the active state" by `clip-path: url(#…)`. The path fed to that clip was
the state's rings projected to screen at FULL EXTENT. Read off production at
z11, Arizona's projected path spans x −10869.4 → 5939.9 and y −16547.3 →
3432.1: roughly **16,800 × 20,000 CSS pixels**.

**Chromium silently drops a `clip-path` that large.** A dropped clip is not a
smaller clip — the scrim then paints over its entire box, which is the whole
map. Proved by holding the topology fixed and varying only magnitude. The test
path is the viewport rectangle minus one enclosing rectangle, evaluated
even-odd, so the clip region is empty at every size and a working clip must
render nothing:

| enclosing box | chroma | detail | verdict |
|---|---|---|---|
| ±2000 px | 17.39 | 20.15 | pixel-identical to the effect-disabled frame |
| ±8000 px | 11.24 | 9.57 | pixel-identical to the broken frame |
| ±20000 px | 11.24 | 9.57 | pixel-identical to the broken frame |

Two other things fell out of the same session at the microscope. The CSS `mask`
on the scrim was **inert the entire time** — Chromium does not resolve an SVG
`<mask>` reference from CSS on an HTML element — so the clip was the only thing
doing the work, and its failure took the whole effect with it rather than
degrading to the mask. And this is the same class as g4's clamped SVG filter
region: Chromium's answer to geometry it cannot rasterize is to DROP it, and a
dropped mask reads as full coverage, which is the loudest possible way for an
ambient effect to fail.

Of the brief's three named suspects it was the second — the region clamped when
the state extends far beyond the viewport — at the clip-path rather than at the
filter. It was not a wrong polygon: the geometry was Arizona's, correctly
projected, all the way through.

### The fix

`lib/map/state-focus.ts#clipRingToBox` — Sutherland–Hodgman, per ring, against
the mask's own region (the canvas plus `FILTER_PAD`), applied after projection
and BEFORE simplification. Nothing outside that box was ever inside the mask
region or either filter region, so the cut removes only geometry that was being
rasterized in order to be thrown away. It is also the cheapest frame win
available: at city zoom the serialized path drops from the state's full ring
count to the handful of points that cross the screen.

**The case that looks identical in the code and opposite on the screen** is
handled explicitly. A ring clipped to nothing means the viewport does not touch
the active state anywhere — pan into New Mexico while Arizona is active — and
the correct render there is a fully muted frame. That used to clear the drawing
and render the map plain, which is the treatment reserved for having no active
state at all. Now an empty `statePath` leaves the mask its white rect and the
scrim its bare viewport rectangle, so the mute is total, which is the truth.
Holes are clipped like any other ring, so a viewport inside one cancels to
nothing under even-odd — a reader in a hole is outside the state.

### The zip shading is gone

The author's ruling: removed from the product, not tuned and not flagged. The
tint, both layers, the source, the `/api/zcta/<zip>` route, `lib/geo/zcta-outline.ts`
and the client fetch are deleted. The committed ZCTA geometry stays in the
repository, unused. A reader's zip now costs the map no request and no layer.
Its walk check is RETIRED with the feature and replaced by its opposite — "the
zip draws nothing on the map" — so the suite's count changes for a stated
reason rather than reading as a regression.

### Item 2 — the panel that would not paint

The author clicked meetings at 85701. The header read "86 meetings", Sort and
Group rendered, and the list body was blank until the mouse moved over it. A
phone has no hover, so a mobile reader taps meetings, sees a count above
nothing, and concludes we hold nothing — a stated-N versus rendered-rows
violation produced by a paint bug.

**The DOM was never wrong, and that is the diagnosis.** Every reproduction
against production found the six group headers present, at real coordinates,
with counts summing to the header's own number, and none of it on screen.
`getBoundingClientRect` is layout, not paint. The missing SUBSET varied between
runs — at 1280px the panel lost its ground, its header and both selects while
the group rows painted; at 390px it lost everything — which is a compositor
that never painted a layer, not a component that never rendered.

The cause is item 1, one layer down. The scrim carries `backdrop-filter`, and
while its clip was being dropped it covered the entire viewport; the list
overlay carries a `backdrop-filter` of its own and stacks directly on it over
the map's WebGL canvas. Two backdrop surfaces deep, Chromium did not paint the
upper one's contents until something dirtied the layer — which a pointer move
is. With the scrim removed first and nothing else changed, header luminance
went from 16 to 25.3 at 1280px and from 10 to 26 at 390px, and the phone's body
detail from 0.0 to 3.8.

**The failure is intermittent, so remedies were measured as rates.** The first
A/B looked decisive and was not — the control arm painted on its second run.
Removing the overlay's own `backdrop-filter` was tried and rejected on the
numbers (0 of 4 at 390px, no better than control); promoting the panel to its
own layer, 2 of 4. It is not the upper surface that has to go.

Item 1's fix removes the full-viewport scrim wherever the reader is inside the
active state. That is most of item 2 — but only most, because panning outside
the active state brings a full-viewport scrim back, correctly this time, and
the panel would blank again. So the scrim is additionally SUSPENDED while any
full-screen overlay is open. That half is a rule and not a workaround: a reader
looking at a modal cannot see the map through it, the scrim has nothing left to
say to them, and the one thing it can still do is cost them the content they
opened.

### The checks, which are what would have caught this

The existing `pnpm measure:extrusion` passed at full marks on the broken build.
It measures how SMOOTHLY the effect's edge falls off; it cannot tell a smooth
gradient over the right area from a smooth gradient over the whole map. **A
visual measurement that cannot distinguish correct from incorrect coverage is
not a correctness test** — it has to assert WHAT is affected, not only how
smoothly.

`pnpm measure:focus` is that assertion. Every sample is a lng/lat — a real
place — projected through the live map's own projection, so the check follows
the geometry exactly as the mask is supposed to:

- **Interior**, deliberately far from the entered zip (north Tucson and Drexel
  Heights at city zoom, the corners of the state further out): identical to the
  effect-disabled frame.
- **Effect-off equivalence**, with sample points held outside the raised edge
  by a distance read off the SHIPPED spec for that zoom rather than by a
  constant — 70 px at neighbourhood zoom, 41 px at continental. A fixed
  exclusion would either fail a correct build or get loosened until it proved
  nothing, and at continental zoom it exceeded New Hampshire's own width. Where
  a state is smaller on screen than the rise reaches, the whole state is edge
  and the interior claim is genuinely unmeasurable; those frames fall back to a
  claim that is measurable at any size — the state's middle must be far less
  changed than the land outside it.
- **Exterior**: each point compared against ITSELF with the effect off, never
  against an interior point somewhere else. Terrain varies; the effect is the
  only thing allowed to differ between the two frames.
- **Data scoping**, off the network log and the style rather than inferred.
- **No active state**, with no zip and at 06716.

`pnpm measure:panels` is item 2's. It opens the panel with a DOM `click()`
issued from inside the page at all four zips at 390×844 and 1280×900 — **the
mouse never moves**, because hovering is the thing that repairs the defect —
and it asserts on PIXELS, in the brief's order: the body is not empty on first
paint (the collapsed group headers, not a blank area), the group counts sum to
the stated count, and expanding ONE group paints exactly its own stated rows.
It deliberately does not assert that every meeting renders on open: groups are
collapsed by design since g4 item 11, and that assertion would fail a correct
build. Every assertion is repeated and reported as a rate. The same pass audits
the bodies, districts and officials doors the same way.

### A correction, recorded because it was shipped before it was caught

The first production run of `pnpm measure:focus` came back 34 of 35, and the
one failure was read as a real defect: at 03255, continental zoom, light theme,
"the state's middle" moved 4.63 luminance units against the effect-disabled
frame. `capSpecToSpan` was written and shipped against that number — the rise
capped by the size of the shape it marks, so that a state smaller than its own
shadow is not muted by it.

**It was the wrong diagnosis and it fixed nothing that had been reported.** At
z4 New Hampshire is 45 × 82 screen pixels and the cap does not bind there at
all — span/6 is 7.5 against a feather of 4 — and the number did not move. What
was actually happening is that the check's most central REACHABLE sample was
Berlin, in the far north-east, because the central ones sat under cards; it is
4 px inside the border, well within the mask's own 12 px ramp. The check was
measuring the transition and calling it the interior.

The check now refuses that frame by name rather than failing it: "the most
central reachable point (Berlin) is only 4px inside the border, within the
mask's own 12px ramp — this state has no interior at this zoom." A check that
cannot reach its subject has to say so. Reporting it as a defect sends the next
session after a bug that is not there, which is exactly what it did here.

`capSpecToSpan` is KEPT, with its comment corrected to say what is true: the
property is real below z4, where a state genuinely does become smaller than the
rise that marks it, and the specification is that the entire active state
renders crisp at every zoom. It is not what fixed anything.

`pnpm measure:fly` is the performance half — first contentful paint, largest
contentful paint, the first moment the map answers a camera probe, and frame
timing across the fly-in, all cold with the HTTP cache disabled. Its own first
run reported a perfectly smooth zero-frame fly-in, because the recorder was
passed as a function and `tsx` compiled it into a call to esbuild's `__name`
helper, which does not exist in a browser. It is passed as source text now: a
string is compiled by nobody, and a recorder that throws on its first line
reports the map never moved.
