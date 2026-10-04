# Lane assignments

The authoritative assignment table. River writes it. Workers read it every run.

| Lane | Assigned worker | Provider | Released to build | Continuation owner |
|---|---|---|---|---|
| measures | measures | Claude | yes | — |
| hunters | hunters | Claude | yes | — |
| registry | registry | Claude | yes | — |
| meetings | meetings | Claude | yes | — |
| auditors | auditors | Claude | yes | — |
| people | people | Claude | yes | — |
| admin | **overflow-1** (River-run worker, 13:45Z; measures' handoff blocked) | Claude | yes | measures (only after a recorded handoff below) |
| slide | **overflow-2** (River-run worker, 13:45Z; hunters never claimed it) | Claude | yes | hunters (only after a recorded handoff below) |
| ballot | **meetings** (handed off 11:05Z) | Claude | yes | meetings (only after a recorded handoff below) |
| bank | **registry** (handed off 08:20Z) | Claude | yes | registry (only after a recorded handoff below) |
| frontend | **auditors** (handed off 08:20Z) | Claude | yes | auditors (only after a recorded handoff below) |

## Handoffs

| Time | Lane | From | To | Reason | Stream tip at handoff |
|---|---|---|---|---|---|
| 2026-10-04 08:20Z | admin | codex-admin | measures | Codex task released its lock at 07:06Z and stopped; no verified Codex restart mechanism exists | stream/admin as of 08:20Z |
| 2026-10-04 08:20Z | slide | codex-slide | hunters | released at 07:39Z and stopped | stream/slide as of 08:20Z |
| 2026-10-04 08:20Z | bank | codex-bank | registry | released at 07:34Z and stopped | stream/bank as of 08:20Z |
| 2026-10-04 08:20Z | frontend | codex-frontend | auditors | released at 07:24Z and stopped | stream/frontend as of 08:20Z |
| 2026-10-04 11:05Z | ballot | codex-ballot | meetings | released its lock at 09:23Z "for recorded continuation" and stopped | stream/ballot @ d63bbe831 |

The continuation worker reads the lane's brief and its saved continuation file, claims `.factory/<lane>.md` with its own token (the previous lock is `none`), and alternates ready batches with its primary lane. Do returned failures and unblocking work first, and never starve either lane. If a Codex run comes back, it sees this table and exits without writing. Ballot was handed to meetings at 11:05Z.

Previously: None yet. When River hands a Codex lane to its paired Claude worker, it records a line here with a UTC time, the reason, the last Codex heartbeat it saw, and the stream tip at handoff. A Claude worker takes a Codex lane only when this section names it.

## Priorities

1. Returned failures in `returns/<lane>.md` come first.
2. Then take your lane's steps in the order your brief lists them, longest chains first. Registry starts DB-09 → DB-10 → DB-12 → DB-13 → DB-14 → DB-15 → DB-20.
3. Shared-file hooks go through River: put them under `needs_hook` in your status.

## Streams

Each lane works on `stream/<lane>`, which River seeds from `river` with an unlocked `.factory/<lane>.md`. An existing stream is resumed, never overwritten. Ready work is integrated through its exact `READY` commit only.

## Overflow

Sean's launch authorization allows up to two overflow workers when a lane falls behind.

| Time | Worker | Lane | Why |
|---|---|---|---|
| 2026-10-04 13:45Z | overflow-1 | admin | No progress since 07:06Z. measures' session permission check denied claiming stream/admin twice. About 20 measures steps and several auditors steps wait on BR-01, BR-03, BR-05, BR-12 and BR-24. |
| 2026-10-04 13:45Z | overflow-2 | slide | No progress since 07:39Z, and hunters never claimed it. Slide carries the reader-harm fixes CP-01 (privacy) and CP-19 (wrong person's facts). |

Both run as background workers inside River's cloud session (session_01M3CeUks1KpFZttTP6ZTEAq), under the common lock and READY rules, on their lane's stream. **measures and hunters: do not claim admin or slide while this row stands.** Frontend stays with auditors, unless Sean restarts its Codex task.

## Environment notes for every worker (River, 2026-10-04 06:40Z)

- **Run tests the way CI does.** These cloud sessions set `DATABASE_URL` and `WTP_ASSET_STORE`, and CI doesn't. With them set, store-reading tests (registry, Ask, officials, meetings routes) fail with `STORE_UNREACHABLE` / 503, which looks like a code failure. Run checks as `env -u DATABASE_URL -u WTP_ASSET_STORE <command>`, e.g. `env -u DATABASE_URL -u WTP_ASSET_STORE CI_TEST_FILES="$FILES" corepack pnpm test`. Never point tests at a real database.
- **Fetch full history before running tests.** A shallow clone fails the frozen-base tests that `git show` old commits (`fatal: path ... does not exist in <sha>`). Run `git fetch --unshallow origin` once per environment.
- `route-refusals` "/api/meetings still answers a well-formed request" fails with 503 for the same `DATABASE_URL` reason. It isn't your change.
- A READY commit's subject starts with `READY: <step ids>`, and its SHA goes in `ready:`. River folds exactly that SHA.

## Fold notes (River, 2026-10-04 07:55Z)

- **`OFFICIAL_PAGE_EVENTS_VERSION`** (`lib/hunt/meetings-site-discovery.ts`) is a hash of the official-page parser's code closure. Any change inside that closure re-keys it, so streams collide on that one line. At each fold, River sets it to the value `tests/meetings-official-page.test.ts` computes on the combined tree. When you catch up with `river`, take river's value and re-run that test.
- **Checklist census removal (people SC-15) and the measures SC-03 group-names move** met in `v6-checklist-section.ts`, `owner-surface.ts` and `publish-owner-snapshot.mts`. River kept both intents: the census, index publisher and section functions are gone, and `lib/coverage/group-names.ts` and the per-place history stay. Measures and people: catch up before your next edit there.
- Delete a stale `.next` before running `tsc`. Its generated types still name routes that SC-15 removed.

## Checks guidance for FULL batches (River, 08:20Z)

Several lanes held work back as WIP because their FULL run failed for reasons that aren't theirs. In order:
1. Run as CI does: `env -u DATABASE_URL -u WTP_ASSET_STORE`, full history, the place-reference projection rebuilt (`node --experimental-strip-types scripts/project-place-references.mts`), and **no `.next` present** when the test leg runs. CI's test jobs never have a build. With a `.next` present, `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" fails on plain river and main as well: 3,330 traced `data/` files against the owner's Sep 29 data-is-non-shipping rule. That is an open owner question River holds. It isn't your failure.
2. If a FULL test still fails, run the same test file on plain `origin/river`. A failure identical there isn't yours: write it under `checks:` as "baseline on river <sha>: <test>" and mark READY. Failures that appear only with your change are yours to fix.
3. Browser tests: Chromium is at `/opt/pw-browsers/chromium`. If Playwright's pinned headless shell is missing in your environment, record which browser tests could not run as such. River's own `pnpm gates` on the combination is the release check, and it passed 9,088 of 9,088 on c7914e8.
4. Live and browser checks of deployed pages are River's, after release. Don't hold a step as WIP waiting for them.
