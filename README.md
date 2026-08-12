# We the People

A civic app. This repository currently contains one screen: the map you land on.

Enter a zip code, the map flies to it, and upcoming local government meetings
render as pins. Click a pin to see who is meeting, when, where, and what's on
the agenda.

Read [CLAUDE.md](./CLAUDE.md) before changing anything — it holds the
constraints this product is built around, several of which are not negotiable.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # optional in development, see below
pnpm dev
```

Open http://localhost:3000.

### Environment

Every key lives in [.env.example](./.env.example). None are required to run the
entry screen:

| Variable | Needed for | Without it |
|---|---|---|
| `NEXT_PUBLIC_MAPTILER_KEY` | MapTiler vector tiles | Falls back to OpenFreeMap, which needs no account |
| `NEXT_PUBLIC_MAPTILER_STYLE` | Choosing a MapTiler style | Defaults to `dataviz-dark` |
| `DATABASE_URL` | Neon Postgres | Nothing on this screen reads the database yet |

Set `NEXT_PUBLIC_MAPTILER_KEY` before deploying. OpenFreeMap is free and
unmetered but community-run, with no SLA behind it.

## What's here

```
app/
  page.tsx                    the map entry screen
  api/meetings/route.ts       the map's only data dependency
components/map/               map, entry notice, pins, detail panel
lib/
  sources/types.ts            the Meeting interface every adapter normalizes to
  sources/mock/               fixture adapter standing in for Legistar
  meetings/query.ts           the empty-state cascade
  meetings/registry.ts        the one place that knows which adapter is live
  geo/                        zip resolution and ZCTA centroids
  map/                        tile provider, formatting
  db/                         Drizzle schema (empty) and a lazy Neon client
scripts/fetch-zcta-centroids.ts
tests/
```

## Notes on the pieces

**Meetings are mocked, but the interface isn't.** `lib/sources/types.ts` defines
the real contract: `fetch()`, `normalize()`, `upsert()`, and a `Meeting` record
carrying an OCD-ID and full provenance. The mock emits Legistar-shaped rows and
transforms them exactly as a real adapter will. Nothing above
`lib/meetings/registry.ts` can tell the difference — swapping in a live source
is one line there plus a new directory under `lib/sources/`.

There are 17 meetings around Tucson, 11 around Philadelphia, and 3 recently
concluded in Cochise County. Their dates are day offsets from today, so the
calendar never goes stale.

**Zip codes are orientation, not identity.** A ZCTA is built from mail delivery
routes and runs straight through cities, counties, and school districts. It
tells the map where to look and nothing else. The entry screen says so, and
anything that needs real districts will ask for a street address and explain
why at that point.

**ZCTA centroids ship as a stub.** `lib/geo/zcta-centroids.json` currently holds
approximate coordinates for the metros the mock data covers, and its `complete`
flag is `false` — which is what lets the UI say "we don't have that zip yet"
rather than falsely claiming it doesn't exist. Run:

```bash
pnpm zcta:fetch
```

to replace it with all ~33,000 authoritative internal points from the Census
2020 ZCTA Gazetteer. The flag flips to `true` and unknown zips start reading as
invalid.

**The map never renders empty.** `lib/meetings/query.ts` walks a radius ladder —
25km, 60km, 150km — looking for upcoming meetings, then falls back to anything
concluded in the last 30 days, then to a plain message. Whichever rung it lands
on is reported to the client and shown on screen: a search that quietly widened
its radius is indistinguishable from one that found what you asked for, which
makes it a wrong answer.

CLAUDE.md calls for one more rung after that — district boundaries with
officeholders — which needs TIGER/Line geometry and an officeholder source.
Not built.

## Commands

```bash
pnpm dev              # development server
pnpm build            # production build
pnpm test             # node --test over tests/
pnpm lint
pnpm ingest mock      # run one source adapter
pnpm zcta:fetch       # rebuild ZCTA centroids from Census
pnpm db:generate      # drizzle migration from schema changes
pnpm db:migrate
```
