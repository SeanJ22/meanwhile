# Meanwhile — start here

A free, nonpartisan civic app. Enter a zip code and it tells you who governs
that place, what those people have actually done, when their next public
meeting is, what is on your ballot, and — for federal offices — who paid for
their campaigns.

Every claim on a reader-facing surface carries a source record pointing at a
specific statement, roll-call vote, filing or agenda. Where no source exists,
the surface says so in plain language rather than filling the gap. The product
never ranks candidates, never computes a match or fit score, and never tells
anyone how to vote.

**Consumers never pay.** For live activity, open the
[admin console](https://admin.meanwhileusa.com/admin), using the owner's sign-in.
The Runner, State and Fleet views show progress. This README is a guide to the
project, not a second operational status report.

## Find the right folder

On Sean's Windows computer, the current locations are:

| Purpose | Location | What to do here |
| --- | --- | --- |
| Main project | `C:\Users\seanj\dev\we-the-people` | Start here for the repository and its instructions. |
| Automatic runner | `C:\Users\seanj\dev\wtp-production-runtime` | Leave this clean checkout to the scheduled runner. Do development elsewhere. |
| New temporary worktrees | `C:\Users\seanj\dev\meanwhile-worktrees` | Give each work session one named subfolder and branch. |
| Internal proof images | `C:\Users\seanj\dev\meanwhile-evidence\reader-last-mile` | Hash-bound historical screenshots; distinct from product portraits and assets. |
| Existing Claude worktrees | `we-the-people\.claude\worktrees` | Leave active or unconfirmed sessions in their assigned folders. |
| Scout verification and unfinished evidence | `C:\Users\seanj\wtp-scout-fieldmanual-verification` | Preserve the evidence and follow-up notes; these are not application code. |
| Private recovery and cleanup record | `D:\Meanwhile Recovery\2026-09-19` | Recovery only; the cleanup report is in `approved-local-cleanup`. |

The planned names `dev\meanwhile` and `dev\meanwhile-runner` are **not yet the
working locations**. Their move depends on session releases and verified path
updates. A folder's age, an idle session or a merged PR does not release it.

## Read the current instructions

Every Claude Code or Codex task uses one named temporary worktree and finishes
with [session workspace closeout](docs/session-closeout.md). That procedure
preserves useful deliverables, removes eligible temporary files and task branches,
and verifies the result. A release note alone is not completed cleanup.

Start with [CLAUDE.md](CLAUDE.md), the root constitution, and follow its policy
links. [AGENTS.md](AGENTS.md) gives Codex the generated mirror; it is not a
separate authority. The current authority order is in CLAUDE.md.

- [Ruling index](docs/rulings.md): check whether an old ruling is still current.
- [Current decisions](docs/governance/current-decisions.md): active author decisions.
- [Governance system](docs/governance/README.md): the ledger and generated views.
- [Agent session commands](docs/codex-resume.md): opening, resuming and handing off work.
- [CI verification and merge efficiency](docs/ci-efficiency.md): check selection, integrity retries, timings and merge windows.

Governing instructions and learned research have different homes. Source
playbooks, state notes and evidence stay in their linked locations below.
Workers inherit shared learned knowledge through the live `cp_field_manual`
store and its dispatch code. Importing a document there does not make the
original disposable. Claude/Codex memory and unfinished-work records also
remain separate from both stores.

## Data layout

State-scoped canonical data holdings live under `data/states/<st>/<domain>/`.
Genuinely multi-state or national files remain in their domain folders. New
state-scoped artifacts use the state directory when they are appropriate for Git;
raw vault and asset-store bytes remain in their external stores.

[`docs/states/<st>.md`](docs/states/az.md) is the generated answer to “what do we
hold for this state?” It derives from authoritative registries, acquisitions,
snapshots, obligations, and committed external readbacks. Run `pnpm state-manifest`
to regenerate; never hand-edit these manifests. Each manifest names observation
times so byte freshness cannot be mistaken for a fresh live observation.

See [the holdings architecture](docs/architecture/state-holdings.md) for the move
denominator, residual-path guard, reader mapping, and external readback contract.

## Getting started

Use your session's worktree. CI uses Node.js 24; the pnpm version is pinned in
[package.json](package.json). Install that version of pnpm, then run:

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm dev
```

Open http://localhost:3000. Stop your preview with Ctrl+C when finished.
[.env.example](.env.example) documents setting names; ask the project owner for
the development settings your task needs. Features that depend on services need
those services configured. Never print or commit credentials.

The runner currently reads `C:\Users\seanj\dev\we-the-people\.env.local`.
Leave that file and the scheduled task **WeThePeople Pilot Runner** alone during
ordinary development. Starting a local preview is not a reason to restart the
production runner or change its settings.

```bash
pnpm test
```

## Stack

Next.js (App Router) + TypeScript + React · Tailwind + shadcn/ui · Postgres on
Neon through Drizzle · deployed on Netlify · the standing runner schedules
routine civic-data work · Auth.js email sign-in and owner Google sign-in ·
MapLibre GL with a vector tile provider.
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

## Supporting documents

| What you want | Where it lives |
|---|---|
| **The rules.** Non-negotiables, the transparency mandate, the retrieval ladder. Read this before changing anything. | [CLAUDE.md](./CLAUDE.md) |
| **Capability evidence.** Generated claims and their proving checks; live activity is in the admin console above. | [docs/status-ledger.md](./docs/status-ledger.md) |
| **Session history.** The append-only session records. The old hand-written "current state" sections (§2, §3, §7) retired into the generated ledger on 2026-08-30. | [docs/state.md](./docs/state.md) |
| **Repo inventory.** The generated mechanical census — tree, routes, schema, gates, method store, scheduled jobs. Written by `pnpm repo-map`. | [docs/repo-inventory.md](./docs/repo-inventory.md) |
| **Work queue and completed work.** Follow the current tracker policy for its working and resolved stores. | [Tracker policy](docs/governance/policies/tracker-workflow.md) |
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

The standing regression suite, run against a LOCAL production build under the
[current shipping policy](docs/governance/policies/shipping-ci.md).
Each check carries the session that shipped the claim behind it,
so a failure reads as "the win that session shipped is undone" rather than as
an anonymous red line. New checks append; the suite only grows.

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

## Finish a session without leaving clutter

1. Record the worktree's owner, purpose and branch. Read current task instructions
   before working; use the [agent session guide](docs/codex-resume.md) to resume.
2. Preserve code, useful untracked or ignored evidence, settings and memory.
   Hand unfinished work off explicitly rather than mixing it into `main`.
3. Finish checks and stop your own previews and watchers. Explicitly release the
   folder, including any further round of work; merging alone is not release.
4. Before retirement, recheck processes, references and Git history. Refresh and
   verify the recovery copy of anything changed. An unresolved reference blocks
   moving a folder just as it blocks deletion.
5. Retire registered worktrees through `git worktree remove`, only after those
   checks pass. Keep needed branches and history. Do not use forced removal as a
   substitute for checking what would be lost.

Leave `.git`, private environment files, agent configuration/memory and runner
`.runtime` records alone. `node_modules` and `.next` are installed/generated
files; `.scratch` and other ignored folders can contain unique work. Generated
instructions and maps are updated through their generators. There is no
automatic deletion of active or unverified work.
