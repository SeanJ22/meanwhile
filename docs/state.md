# Project state

Written for someone opening this repository with no prior context. It describes
what is real, what is scaffolding, why things are the way they are, and what is
still unresolved.

Last updated: 2026-08-12, after Phase 4.5 and the first half of Phase 4.6.
Branch: `claude/civic-map-entry-screen-4ey1cs`, pushed, with **PR #3 open**
against `main`. See §7 — checked against `origin`, not assumed.

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

There are still no accounts, no persistence, and no live meeting data.

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
| `corepack pnpm dev` | Development server |
| `corepack pnpm build` | Production build |
| `corepack pnpm test` | `node --test` over `tests/` — 68 tests |
| `corepack pnpm lint` | ESLint |
| `corepack pnpm ingest mock` | Run one source adapter end to end |
| `corepack pnpm zcta:fetch` | Rebuild zip centroids from Census (see §3.2) |
| `corepack pnpm districts:fetch [type...]` | Rebuild boundary layers (see §2) |
| `corepack pnpm registry:build` | Regenerate the division and body registry (§4.4) |
| `corepack pnpm shoot <name>` | Headless capture of what actually rendered |
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
  `zip-coverage`, `fixture-provenance`, `subdivisions`, `registry-oracle`.
  **68 total.**

### The division and body registry — `lib/registry/`

**New in Phase 4.6, and it is the piece that connects the other two.** The app
had polygons and it had meetings and nothing joined them: a point could resolve
to Vail Unified School District and the app still could not say that district
has a governing board.

`pnpm registry:build` generates `lib/registry/registry.json` — **940 divisions,
297 bodies** — from the committed boundary files. Committed like the geometry
and the ZCTA centroids, so nothing at runtime needs a database.

| File | Does |
|---|---|
| `types.ts` | `Division`, `Body`, and the enums — `BodyClass`, `CoverageStatus`, `BodyOrigin`, `AgendaSourceType`, `SourceDataset`, `CanonicalMatch` |
| `derive.ts` | Division type → the bodies it implies, and the LSAD table that decides whether a polygon governs at all |
| `resolve.ts` | Point → divisions → bodies. Pure; geometry is an argument, so it runs in a test, on a server, or against tiles later |
| `registry.json` | The generated output |

Full numbers, the four-zip oracle, and the identifier decision are in §4.4.
**Not yet wired into any screen** — the coverage language of 4.6.6 is the next
piece, and it is what turns "0 meetings" into "Vail Unified has a governing
board; we do not have its calendar yet."

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

**To replace with a real source:**

1. Add a directory under `lib/sources/<name>/` exporting a `MeetingSource`.
2. Change the one `active = resolve(...)` line in `lib/meetings/registry.ts`.
3. Add an entry to the `SOURCES` map in `scripts/ingest.ts`.

That is the whole swap for *reading*. **Writing is not solved** — see §3.3. The
mock's `upsert()` deliberately does nothing and reports every record as
"updated", because persisting fixtures would put fake public meetings into the
same table real ones will land in.

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
branch. It holds five files, flat:

| Mirror | Repo |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` |
| `abuse-policy.md` | `docs/abuse-policy.md` |
| `state.md` | `docs/state.md` |
| `tracker.csv` | `docs/tracker.csv` |
| `types.ts` | `lib/sources/types.ts` |

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
`lib/registry/registry.json`: **940 divisions, 297 bodies.** Committed the way
the boundary files are, so nothing at runtime needs a database — which matters,
because `lib/db/schema.ts` is still `export {}`.

| Division type | Divisions | Bodies | Why |
|---|---|---|---|
| county | 3 | 3 | one governing body each |
| place | 272 | **153** | 119 skipped — CDPs and CCDs have no government |
| school_district | 141 | 141 | one governing board each |
| cd / sldu / sldl | 524 | **0** | a legislative seat is not a body that meets |

The two zero rows are the point. **119 statistical divisions produced no body**,
and **524 legislative districts produced none either** — a district elects a
seat in a chamber that sits elsewhere, and Arizona's districts elect three
people between two chambers, so the district is not even one seat.

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

1. **Which real meeting source lands first?** `types.ts` names both Granicus
   Legistar and Democracy Works. The mock is Legistar-shaped, which implies
   Legistar, but nothing commits to it.
4. **What is the persistence design?** `upsert()` exists on the interface and
   does nothing in the mock. Tables, migration, and conflict strategy are all
   unspecified. This blocks any real source.
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

**Map-layer test coverage is still thin.** 68 tests now cover the cascade, time
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

Branch `claude/civic-map-entry-screen-4ey1cs`. Working tree clean. Verified
against `origin` on 2026-08-12 rather than assumed — an earlier version of this
section was counting against a stale `origin/main`.

**Everything is pushed.** The branch and
`origin/claude/civic-map-entry-screen-4ey1cs` are identical — nothing exists
only on one machine.

**[PR #3](https://github.com/SeanJ22/We-The-People/pull/3) is open** against
`main`, carrying all of Phase 4.5 and the first half of 4.6: 8 commits, 34
files, `MERGEABLE` / `CLEAN`. **It is not merged.** Until it is, `main` does not
have this work.

```
8a461fd  Correct the branch section against origin
13dce33  Bring state.md and the tracker current through 4.6
bb63c41  Generate the division and body registry               (Phase 4.6)
05cbd59  Build the boundary data the derivation rule needs     (Phase 4.6)
e4ecc1e  Record the transcript step, fix the branch line
38f7bf0  Fix the four defects found testing the Phase 4 build  (Phase 4.5)
05e9f4b  Note the transcripts folder in the G Drive mirror     ← stranded by PR #2
4ff074c  Note that map layer edits need a full reload, not HMR ← stranded by PR #2
----------------------------------------- in origin/main below this line -----
07aee63  Mirror tracker.csv to G Drive, document the mirror rule
2194696  Bring docs/state.md up to date with phases 0-4
619b839  Add seven district overlays and click-to-select       (Phase 4)
973a5eb  Replace the entry notice with the welcome overlay     (Phase 3)
a0d47cb  Port the EdiaStratMap application shell               (Phase 2)
3c2867f  Fix the MapLibre worker and port the design system    (Phase 0+1)
0d5442d  Fix district overlay never fetching its boundary file (pre-existing)
89d5606  Note OCD at-large discrepancy risk on D07             (pre-existing)
39cd657  Add national congressional district overlay           (pre-existing)
```

The bottom two of the eight predate this session: **PR #2 closed at `07aee63`
and left them behind**, which is worth knowing because it is how two commits sat
unmerged for a day without anyone noticing.

**`origin/main` holds nothing this branch is missing.** It is at `149df6d` and
its two commits are both pull-request merges *of this branch* — PR #1 at
`b162fdc`, PR #2 at `149df6d` — with no original work of their own
(`git log --no-merges HEAD..origin/main` is empty). Its tree is byte-identical
to `07aee63`, an ancestor of the current HEAD. The merge base is `07aee63` and
`git merge-tree` reports no conflicts, which is why the PR is `CLEAN`.

So "2 behind `main`" is bookkeeping, not lost work, and a rebase would recover
nothing.

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

- **0–4 done** — worker, design system, shell, welcome overlay, district
  overlays with click-to-select.
- **4.5 done** — the four defects found in testing. §4.2.
- **4.6 half done.** The registry is generated and tested (§4.3, §4.4). What
  remains: wiring the coverage language of 4.6.6 into the UI, populating
  `agendaSourceType` per body (4.6.4), the `meeting_leads` table (4.6.5), and
  the reader disambiguation prompt (4.6.3) — **which is a hard stop**, because
  it adds a user data field and CLAUDE.md requires asking first.
- **4.7 not started** — national scale: vector tiling, the Census of
  Governments universe, vendor tenant enumeration, special districts.
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

**The repository is `C:\Users\seanj\dev\we-the-people`.** There is an empty
folder of the same name on the Desktop under OneDrive; it is a leftover and has
never held the code. Check `CLAUDE.md` is roughly 10 KB before doing anything —
§3.5 explains why.

State as of 2026-08-12, verified rather than assumed:

- Working tree clean, branch pushed, **PR #3 open and unmerged**. Merging it is
  the first thing, unless it has already been merged.
- 68 tests, lint and build all pass.
- The G Drive mirror and `transcripts/` are current as of the end of that
  session.

**The next piece of work is tracker M16** — the Phase 4.6.6 coverage language.
It is self-contained, needs no new data, and finishes the 4.6 gate: the registry
already knows that Vail Unified has a governing board and that nothing has its
calendar, so the map can stop saying "0 meetings" and start saying something
true. The gate's screenshot of 85641 is the only outstanding deliverable.

**Two things need the author before they can be built**, and neither should be
started on assumption:

1. **The 4.6.3 reader prompt.** It adds a user data field, which `CLAUDE.md`
   requires asking about first. The exact question wording, what is stored, and
   whether it stays device-local all need confirming.
2. **D15**, closing the canonical identifier gaps. The convention is decided —
   internal key authoritative, canonical alongside with a confidence — but 348
   divisions still match nothing, concentrated in county subdivisions.

Do not start Phase 4.7 before reading it: it changes two decisions inside 4.6,
and it is the reason `cousub` was built now rather than later.
