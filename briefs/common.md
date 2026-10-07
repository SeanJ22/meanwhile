# Common instructions

Read this file and your lane brief from `board/briefs` at the start of every run.

## What to read

- **`docs/rulings.md` on `main`.** Sean's rulebook. It wins over everything here. Read §0 every run, plus the sections your rows touch. Briefs cite it by section and never copy it. Never edit it, and never copy it into a branch, a brief or a commit.
- **The inventory:** `inventory/meanwhile-repo-inventory-2026-10-06.csv` on `board/briefs`. Each row gives a file's verdict, fix type, group ("moves to / replaced by"), the reason, the evidence and what uses it.
- **`briefs/ownership.csv`:** every inventory row that still has work, with its one owning lane, order bucket (1, 2 or 3) and group (A–N or blank).

## Your work

Your lane's work is its rows in `ownership.csv`. That means every FIX row (behavior change, built but not connected, move to wtp-assets, move out of this repo) and every DELETE row timed "with its replacement". The cleanup release already shipped the "cleanup release" deletions and the "comment cleanup only" rows.

Take rows in bucket order:

1. Rows that stop free acquisition (rulings §2).
2. The groups A–N your lane owns.
3. The rest.

Within a bucket, take the first ready row, and prefer rows that unblock another lane.

To work a row:

1. Read its whole inventory row and the current code. Do the action the inventory gives; don't re-decide it. If the code already does it or the file is gone, record that in status and close the row.
2. If the change needs a file another lane owns, ask for the hook through River (see "Shared files and hooks").
3. A row is done when its change is on `main`, deployed, and checked where a reader or Sean would see it (rulings §6). River records rows as done.

If you find needed work that no row covers (rulings §0), or a row that looks wrong, add one line under `seen_not_fixed` in your status. River assigns it.

## Every move ships in one release

A move is four steps in **one** release: copy the content to its new home, switch every reader and job to the new home, prove it works live, delete the old file. No release leaves two live copies or a path pointing at a file that is gone. A DELETE row "with its replacement" ships in the release that proves its replacement live.

- **Portraits (group M) and large reference files (group N: the ZIP index and boundary files)** go to the `SeanJ22/wtp-assets` repository and are read through the jsDelivr CDN in front of it. They never go to Neon. The runner commits new portraits straight to wtp-assets.
- **Facts that leave code** (rosters, bodies, help text, measure records, tiers and the like) go into the database through the normal data path, never through a release (rulings §9). Where the inventory says so, they are also published per state to wtp-assets for readers.

## Work the rulings name that no inventory row covers

| Work | Lane | Why that lane |
|---|---|---|
| The line keeper (rulings §2, "Nothing fails silently") | auditors | It judges whether the line works and whether repairs held, which auditors already do for published facts. |
| Per-state and national queues (rulings §0 item 4; group C) | measures | Queues are counted per place from the owed and held measures this lane already owns; admin wires the buttons. |
| Auditor flags with Sean's four choices (rulings §2 step 6) | auditors | Flags come from the live audit pass; admin's gateway carries the buttons and slide's path publishes a typed value. |
| State profiles (rulings §2 step 7; groups A and B) | bank | A profile is a state's wins, losses and methods, kept in the bank's own store. |
| "List on search engines" switch (group L; noindex in `netlify.toml`, `next.config.ts`, `middleware.ts`) | admin | It is an Admin setting, and admin owns settings and middleware. |

## Workers and paired continuation

| Lane | Starts in | Suggested model | Continued by, if its Codex run stops |
|---|---|---|---|
| measures | Claude | Sonnet 5.5 | — |
| hunters | Claude | Opus 5.5 | — |
| registry | Claude | Sonnet 5.5 | — |
| meetings | Claude | Sonnet 5.5 | — |
| auditors | Claude | Opus 5.5 | — |
| people | Claude | Sonnet 5.5 | — |
| admin | Codex | GPT Sol 6.1 | measures |
| slide | Codex | GPT Astra 6 | hunters |
| ballot | Codex | GPT Sol 6.1 | meetings |
| bank | Codex | GPT Sol 6.1 | registry |
| frontend | Codex | GPT Sol 6.1 | auditors |

The model is chosen in the task settings; writing it here does not switch it. Move to the stronger model only for a specific hard problem, then move back.

**Paired continuation.** A lane is a body of work, not a session. When a Codex run stops with work left, River records a handoff on `board/river` to the paired Claude worker. That worker keeps the same branch, status file and rows, and alternates ready batches between its two lanes without starving either. A Codex run that comes back reads the assignment and exits without writing. Each lane has one active owner at a time. Sean is not the restart mechanism.

## Branches and permissions

- `board/briefs`: briefs, ownership list and inventory. Builders read it; River may update it.
- `board/river`: River's status, assignments, returns and release records. Only River writes it.
- `river`: combined, tested work. Only River updates it.
- `stream/<lane>`: the lane's work and `.factory/<lane>.md`, cut from `river`. Only the worker holding the lane's lock writes it.
- Builders open no pull requests and never push to `main` or `river`. The one exception: a Codex lane that needs a PR to publish keeps one **draft** PR from its stream into `river`. It stays a draft, with no reviews and no auto-merge; River closes it once the work is folded.

## Each run

1. Fetch `main` and `board/briefs` into explicit refs, then read your briefs from them:
   ```sh
   git fetch origin refs/heads/main:refs/remotes/origin/main refs/heads/board/briefs:refs/remotes/origin/board/briefs
   git show origin/board/briefs:briefs/common.md
   ```
   Check whether `river`, `board/river` and your stream exist before fetching them. A missing optional branch on a first run is normal.
2. Read your assignment and returns on `board/river`. If you have no assignment, do read-only preparation and stop.
3. Take the lock (below). Create your stream from `river` on first use; resume an existing stream, never overwrite it.
4. Catch up with `river`. Keep your own `.factory` file; never bring back another lane's. Fix returned failures first.
5. Take the next ready row. Save unfinished work as `WIP` commits.
6. Run focused checks: lint, types and the affected-test selector against your merge base with `river`. Put the selector's actual test paths in `CI_TEST_FILES`. If it selects none, say so; an empty run is not a pass.
7. Mark checked work with a `READY` commit (below) and push it.
8. Release the lock at a safe point when you stop or switch lanes.

## Lock and heartbeat

`.factory/<lane>.md` records `worker`, `provider`, `run_id`, `lock` (a unique token) and `heartbeat`. Take the lock with a normal fast-forward commit and push. A rejected push means refetch and look again; never force-push. Refresh the heartbeat at least every 15 minutes, during long commands too. A heartbeat under 45 minutes old means someone else owns the lane; leave it. Before every push, check that you still own the lane. If you don't, keep your local work for recovery and exit without pushing.

## READY commits and River

- After a batch's checks pass, commit `READY: <inventory paths>` and record that exact SHA and the check results in status.
- River folds each lane's exact READY commit, never later WIP. It drops `.factory/`, numbers migrations, runs `pnpm gates` once on the combination, and fast-forwards `river` to the tested commit. A couple of times a day it ships `river` to `main` in one `release/<n>` pull request.
- Name new migrations by the inventory path they serve. River assigns numbers and updates the journal.
- Data never rides the river. Facts, doors, settings and playbooks go live as data (rulings §9).

## Status file

Keep `.factory/<lane>.md` short:

```text
build_state: active | waiting | lane done
worker / provider / run_id / lock / heartbeat
on_river: <inventory paths and integration SHA>
ready: <inventory paths and exact READY SHA>
checks: <commands, result, tested SHA; skipped means skipped>
working_on: <inventory path and checkpoint>
closed_no_change: <paths already done or gone, with one-line evidence>
waiting_on: <specific dependency and owner>
returned: <failure and repair status>
needs_hook: <shared file, function and connection wanted>
needs_Sean: <only a real owner decision or credential>
seen_not_fixed: <one line each>
```

## Shared files and hooks

If another lane owns a file you need to change, ask for the change through River (`needs_hook`) instead of editing it yourself. Ownership stays with the lane even when its provider changes.

| Shared file or function | Owner lane |
|---|---|
| `scripts/freshness-shadow.mts`, `scripts/pilot-runner.mts`, `lib/ops/runtime-release-*` | hunters |
| `lib/doors/registry.ts` | registry |
| `scripts/ingest.ts`, `lib/civic-data/runner.ts` | meetings |
| `lib/control-plane/gateway/registry.ts`, `lib/control-plane/settings.ts`, `lib/control-plane/fix-list.ts` | admin |
| `lib/control-plane/promotion/section3.ts`, `lib/civic-data/worker-publication-evidence.ts`, `lib/control-plane/workers/standing-runtime.ts`, `lib/civic-data/worker-publication-tasks.ts` | slide |
| `lib/coverage/place-owed.ts`, `lib/civic-data/held-place-capture.ts`, the queue tables and their add-item function | measures |
| `lib/control-plane/workers/detective.ts` | auditors |
| `lib/control-plane/field-manual.ts`, `docs/how-meanwhile-works.md` | bank |
| The wtp-assets writer and reader (`lib/ops/asset-remote.ts`) | people |
| The shared reader Card and design tokens | frontend |
| `lib/ask/`, `app/api/ask/` | ballot |
| Database schema and migration numbers, `.github/workflows/`, `scripts/ci-*`, `scripts/river.mjs`, `package.json` | river |

## Standing rules

- **Nothing built for one place.** Never target, name or prepare a particular ZIP, county, city or state (rulings §1).
- **No new gates.** No new gate, proof step, certification, ledger or scoring system (rulings §0).
- **Plain English in Admin** (rulings §10).
- Spending limits, the paid-research switch and pauses stay as Sean sets them in Admin (rulings §8, §9).
