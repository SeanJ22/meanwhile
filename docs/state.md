# Project state

Written for someone opening this repository with no prior context. It describes
what is real, what is scaffolding, why things are the way they are, and what is
still unresolved.

Last updated: 2026-08-14, second session of the day (the dating
convention changed this session — real wall-clock dates from here on;
see the §18 header note). This session: the reaction pipeline proved
itself end-to-end on the DEPLOYED site (one tap → one visible Neon row;
production's platform password found DOWN); honest reaction outcomes —
success earned by the 204, every failure rendering the saved-not-counted
line (P11); the FEC snapshot thin-guard for the unattended weekly
refresh (D44); the everyday-topics contact map — 30 of 36 topic×zip
cells carrying a government's-own-page contact, the pothole golden
answering Tucson 311 (A10); the refusal-log scrub before store (T09);
and the photo census — 16 of 747 rendered people have portraits (D45).
See §18. Before that, the 2026-08-19-labeled session (§17), and the
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
branch. It holds seven files, flat — six copied from the repo, one generated:

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

**Working on `claude/fec-cache-and-question-box-0819`** (2026-08-19),
branched from `main` at the PR #26 merge — the session §17 records: the
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

There is a hard date. The general election is **2026-11-03**, and the product
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
2026-11-03, curated from the county clerk's own filed-candidate PDFs into
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
(March town meeting). For state and federal offices, 2026-11-03 is one of
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
