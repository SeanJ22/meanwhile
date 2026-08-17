# We the People

A free, nonpartisan civic app. Enter a zip code and it tells you who governs
that place, what those people have actually done, when their next public
meeting is, what is on your ballot, and — for federal offices — who paid for
their campaigns.

Every claim on a reader-facing surface carries a source record pointing at a
specific statement, roll-call vote, filing or agenda. Where no source exists,
the surface says so in plain language rather than filling the gap. The product
never ranks candidates, never computes a match or fit score, and never tells
anyone how to vote.

**Consumers never pay.** State campaign finance is tracked in Phase B and has
not shipped.

## Getting started

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:3000. Every key lives in
[.env.example](./.env.example); most of the app runs without any of them,
because the registry, boundaries and meeting snapshots are committed files.

```bash
pnpm test
```

## Stack

Next.js (App Router) + TypeScript + React · Tailwind + shadcn/ui · Postgres on
Neon through Drizzle · deployed on Netlify with ingestion on a schedule ·
Auth.js email magic link only · MapLibre GL with a vector tile provider.
Mobile is responsive web first.

## Where things are

```
app/                  routes and pages
components/           UI, shadcn primitives in components/ui
lib/
  sources/<name>/     one ingestion adapter per external source
  db/                 drizzle schema, migrations, queries
  ocd/                OCD-ID parsing and district resolution
  signal/             reaction aggregation, snapshots, export
  evidence/           the research ledger and the required-field matrix
scripts/              backfills, audits and data exploration
docs/                 methodology, abuse policy, calibration log
tests/fixtures/       recorded API responses, no live calls in tests
```

## Pointers, not copies

This file used to describe the product, and it drifted badly enough to be
wrong about what the app was. It points now, so that it cannot.

| What you want | Where it lives |
|---|---|
| **The rules.** Non-negotiables, the transparency mandate, the retrieval ladder. Read this before changing anything. | [CLAUDE.md](./CLAUDE.md) |
| **Current state.** What has shipped, what is in flight, which phase everything sits in. | [docs/state.md](./docs/state.md) §7 |
| **Task status.** One row per ID, status and notes edited in the same commit as the work. | [docs/tracker.csv](./docs/tracker.csv) |
| **Sources and what each rung of a hunt returned.** | [docs/source-ladder.md](./docs/source-ladder.md) |
| **How to cover a new zip**, and the source ladder per jurisdiction type. Append-only. | [docs/zip-playbook.md](./docs/zip-playbook.md) |
| **Coverage against the official universe**, never against our own records. | [docs/coverage-audit-by-county.md](./docs/coverage-audit-by-county.md) |
| **Design system and tokens.** | [docs/DESIGN.md](./docs/DESIGN.md) |
| **Abuse and moderation policy.** | [docs/abuse-policy.md](./docs/abuse-policy.md) |
| **Kill switches and the procedure for pulling one.** | [docs/ripcords.md](./docs/ripcords.md) |
| **What to dump when you notice something wrong in production.** | [docs/defects.md](./docs/defects.md) |

## A few commands worth knowing

```bash
pnpm walk:all
```

The standing regression suite, run against production at the end of every
session. Each check carries the session that shipped the claim behind it, so a
failure reads as "the win that session shipped is undone" rather than as an
anonymous red line. New checks append; the suite only grows.

```bash
pnpm stamp
```

Today's date in `America/Phoenix`. Every date entering any document comes from
here — a plausible date is a fabricated one, and this repo treats that as the
same class of failure as a made-up quote.

```bash
pnpm zip:universe 03255
```

Enumerates what governs a zip and what meets near it, against the Census of
Governments rather than against our own registry.

Other commands are in [package.json](./package.json).
