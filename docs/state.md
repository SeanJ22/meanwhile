# Project state

Written for someone opening this repository with no prior context. It describes
what is real, what is scaffolding, why things are the way they are, and what is
still unresolved.

Last updated: 2026-08-12, after the Legistar adapter and the vendor review
(tracker D12, D14). See §4.7 and §7.

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
| `corepack pnpm session:start` | Start-of-session sweep, then the dev server — see §8. `--check` starts nothing |
| `corepack pnpm dev` | Development server. Refuses if 3000 is taken; records its pid in `.dev-server.pid` |
| `corepack pnpm build` | Production build |
| `corepack pnpm test` | `node --test` over `tests/` — 162 tests |
| `corepack pnpm lint` | ESLint |
| `corepack pnpm ingest mock` | Run one source adapter end to end |
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
  **132 total.**

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
branch. It holds seven files, flat — six copied from the repo, one generated:

| Mirror | Repo |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` |
| `abuse-policy.md` | `docs/abuse-policy.md` |
| `vendor-review.md` | `docs/vendor-review.md` |
| `state.md` | `docs/state.md` |
| `tracker.csv` | `docs/tracker.csv` |
| `types.ts` | `lib/sources/types.ts` |
| `git-state.txt` | *generated — no repo counterpart* |

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

1. ~~**Which real meeting source lands first?**~~ **Answered 2026-08-12:
   Legistar.** The adapter is built, tested and verified against the live `pima`
   client — §4.7. What is *not* answered is when it becomes the app's source:
   `active` is still the mock, because Pima's Legistar carries one county board
   and switching would empty three of the four target zips. The open question is
   now narrower — composite source, or hold the mock until more clients are
   wired?
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

**Map-layer test coverage is still thin.** 162 tests now cover the cascade, time
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

**Working on `claude/link-ladder-and-coverage-audit`**, branched from `main` at
`c94aa9c` (the PR #17 merge). Four commits.

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
nothing. **It has now happened four times in this project**, in four different
disguises:

| Instance | Presented as | Actually |
|---|---|---|
| The raster basemap fallback | a styled dark map | the vector style never loaded — §5.1 |
| Zero-match identifier joins | a clean build | `cd:0` and NH `sldl:` matching nothing — §4.8, §4.9 |
| The dev server on another port | a working page | last session's build on 3001 — the `predev` guard |
| PR #14's documentation gap | a green ship | a `String.replace` that matched nothing |

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

### Starting a session: `pnpm session:start`

```
pnpm session:start            check, then start the dev server
pnpm session:start --check    report only, start nothing
```

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
- **162 tests, lint, tsc and build all pass.** M16, M17, M21, R07, R09, R10,
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

**The next piece of work, in the order it should be taken:**

1. **Decide the active meeting source.** `registry.ts` still resolves to the
   mock. Pima's Legistar carries one county board, so switching outright empties
   three of the four target zips — the open question is composite versus holding
   the mock until more clients are wired (§5.2 item 1). **Wiring more clients is
   the cheap half**: `phoenix`, `mesa`, `maricopa`, `seattle`, `oakland`,
   `alexandria` and `alameda` all answered 200 in one sweep, and adding one is
   an entry in `clients.ts` plus a curated venue table.
2. **D13 Diligent *and* D22 NovusAgenda together**, for the school-board tier —
   trying each district's own site *before* the portal, per D14. **Diligent
   alone no longer reaches both target districts**: 4.6.10 measured Vail and it
   runs NovusAgenda, not BoardDocs (§4.11). The author chose to build both in
   one change on 2026-08-12, since `agendaSourceType` routing is the point of
   4.6.4 anyway.

   **D21 CivicPlus may be the better first adapter of the three** and was not on
   this list before: Rockaway Township publishes populated RSS *and* iCal agenda
   feeds through its own website, so there is no vendor portal and no B09 tenant
   question, and both URL patterns are CivicPlus-wide. It still needs a D14
   finding written before anything ships.
3. **Phase 7**, whose slots the Phase 6 modal already renders as empty states:
   Notes and Activity tabs exist and say what is coming.
4. **Tier 3 officeholders**, the curated local seed. It is the only half of
   Phase 5 that needs hand work, and it is what would let the *meeting* popup's
   Representation section stop being empty (§4.10).

**Two things still need the author**, and neither should be started on
assumption:

1. **The 4.6.3 reader prompt — approved, and still blocked on one thing.** The
   author approved it on 2026-08-12 and settled the storage question: **device-
   local only**, with a tracker row to revisit sync when accounts exist. What is
   still missing is **the wording itself**, which the author says is verbatim and
   deliberately chosen and must not be paraphrased. It is not in this repo and
   was not supplied, so 4.6.3, 4.6.3c and the 4.6.3a "want us to prioritize it"
   control all wait on that text arriving. Do not draft a stand-in — a
   paraphrase of copy that was chosen word by word is worse than a blank,
   because it looks finished.
2. **D15**, closing the canonical identifier gaps. The convention is decided —
   internal key authoritative, canonical alongside with a confidence — but 348
   divisions still match nothing, concentrated in county subdivisions. **M18**
   (consolidated `FUNCSTAT=C` governments) asks the same which-identifier-wins
   question and should probably be answered with it.

Do not start Phase 4.7 before reading it: it changes two decisions inside 4.6,
and it is the reason `cousub` was built now rather than later.
