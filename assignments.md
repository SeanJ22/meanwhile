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
| admin | **measures** (continuing admin, River handoff Oct 6, 2:40 AM EDT; back to codex-admin when Sean is up) | Claude | yes | measures |
| slide | **hunters** (continuing slide, River handoff Oct 6, 2:40 AM EDT; back to codex-slide when Sean is up) | Claude | yes | hunters |
| ballot | **meetings** (continuing ballot, River handoff Oct 6, 2:40 AM EDT; back to codex-ballot when Sean is up) | Claude | yes | meetings |
| bank | **registry** (continuing bank, River handoff Oct 6, 2:40 AM EDT; back to codex-bank when Sean is up) | Claude | yes | registry |
| frontend | **auditors** (continuing frontend, River handoff Oct 6, 2:40 AM EDT; back to codex-frontend when Sean is up) | Claude | yes | auditors |

## Handback to Codex (2026-10-05 16:50Z, Sean's instruction)

- **meetings: release stream/ballot and stop claiming it.** **auditors: release stream/frontend and stop claiming it.** If you hold either lock, push your checkpoint with `lock: none` and leave the lane. A READY commit you already pushed stays foldable.
- codex-ballot and codex-frontend own those lanes from now. Each claims `.factory/<lane>.md` under the common lock rules once the Claude lock is `none` or stale.
- If either Codex task stops again with unfinished work, River hands the lane back to its paired Claude worker (meetings, auditors) the same way as before, with a new line in the table below.
- **Update 2026-10-05 17:00Z (Sean):** admin, slide and bank go back to Codex too. **All five Codex lanes (admin, slide, ballot, bank, frontend) are Codex.** overflow-1 and overflow-2 are stopped; their last runs ended at 16:48Z with `lock: none`. **registry: release stream/bank and stop claiming it.** measures and hunters never claim admin or slide.
- If any of the five Codex tasks stops again with unfinished work, River hands it back to its paired Claude worker (admin to measures, slide to hunters, bank to registry, ballot to meetings, frontend to auditors) with a new line below.

## Overnight handoff, Oct 6, 2:40 AM EDT (Sean's overnight plan)

All five Codex lanes stopped with unfinished work, so each goes to its paired Claude worker: admin to measures, slide to hunters, ballot to meetings, bank to registry, frontend to auditors.
- Each Claude worker alternates ready batches between its own lane and the continued lane. Returned Failed live items come first.
- **hunters:** your own top item stays first: the campaign-sites cause, then the vital-signs writer. Take slide's returns after those.
- When Sean is up he hands the five lanes back to Codex. A returning Codex run reads this table and exits until River records the handback.

## Handoffs

| Time | Lane | From | To | Reason | Stream tip at handoff |
|---|---|---|---|---|---|
| 2026-10-04 08:20Z | admin | codex-admin | measures | Codex task released its lock at 07:06Z and stopped; no verified Codex restart mechanism exists | stream/admin as of 08:20Z |
| 2026-10-04 08:20Z | slide | codex-slide | hunters | released at 07:39Z and stopped | stream/slide as of 08:20Z |
| 2026-10-04 08:20Z | bank | codex-bank | registry | released at 07:34Z and stopped | stream/bank as of 08:20Z |
| 2026-10-04 08:20Z | frontend | codex-frontend | auditors | released at 07:24Z and stopped | stream/frontend as of 08:20Z |
| 2026-10-04 11:05Z | ballot | codex-ballot | meetings | released its lock at 09:23Z "for recorded continuation" and stopped | stream/ballot @ d63bbe831 |
| 2026-10-05 16:50Z | ballot | meetings | codex-ballot | Sean's instruction in the River session, 2026-10-05 ~16:50Z: "Hand ballot and frontend back to Codex now." | stream/ballot @ d63bbe831 |
| 2026-10-05 16:50Z | frontend | auditors | codex-frontend | Same instruction from Sean, 2026-10-05 ~16:50Z | stream/frontend @ bb0cfe7c |
| 2026-10-05 17:00Z | admin | overflow-1 | codex-admin | Sean, River session, 2026-10-05 ~17:00Z: "hand admin, slide and bank back to Codex as well, the same way. Stop overflow-1 and overflow-2, and tell registry to release bank." | stream/admin @ 2bfbea34c |
| 2026-10-05 17:00Z | slide | overflow-2 | codex-slide | Same instruction from Sean, ~17:00Z | stream/slide @ db17dc16e |
| 2026-10-05 17:00Z | bank | registry | codex-bank | Same instruction from Sean, ~17:00Z | stream/bank @ cdeb09cd9 |
| 2026-10-06 06:40Z (2:40 AM EDT) | admin | codex-admin | measures | Sean, Oct 6 ~1:45 AM EDT: "If a Codex lane stops with unfinished work, hand it to its paired Claude worker per assignments.md and back to Codex when I'm up." codex-admin released its lock (last heartbeat 6:22:00 UTC) with build_state waiting, and its returns now carry Failed live items from the live ledger | stream/admin @ 1ca087938 |
| 2026-10-06 06:40Z (2:40 AM EDT) | slide | codex-slide | hunters | Sean, Oct 6 ~1:45 AM EDT: "If a Codex lane stops with unfinished work, hand it to its paired Claude worker per assignments.md and back to Codex when I'm up." codex-slide released its lock (last heartbeat 6:20:00 UTC) with build_state waiting, and its returns now carry Failed live items from the live ledger | stream/slide @ 3e43de4be |
| 2026-10-06 06:40Z (2:40 AM EDT) | ballot | codex-ballot | meetings | Sean, Oct 6 ~1:45 AM EDT: "If a Codex lane stops with unfinished work, hand it to its paired Claude worker per assignments.md and back to Codex when I'm up." codex-ballot released its lock (last heartbeat 6:13:00 UTC) with build_state waiting, and its returns now carry Failed live items from the live ledger | stream/ballot @ 11873169d |
| 2026-10-06 06:40Z (2:40 AM EDT) | bank | codex-bank | registry | Sean, Oct 6 ~1:45 AM EDT: "If a Codex lane stops with unfinished work, hand it to its paired Claude worker per assignments.md and back to Codex when I'm up." codex-bank released its lock (last heartbeat 6:33:00 UTC) with build_state waiting, and its returns now carry Failed live items from the live ledger | stream/bank @ 7fbf57e9e |
| 2026-10-06 06:40Z (2:40 AM EDT) | frontend | codex-frontend | auditors | Sean, Oct 6 ~1:45 AM EDT: "If a Codex lane stops with unfinished work, hand it to its paired Claude worker per assignments.md and back to Codex when I'm up." codex-frontend released its lock (last heartbeat 5:32:00 UTC) with build_state waiting, and its returns now carry Failed live items from the live ledger | stream/frontend @ ab109934d |

The continuation worker reads the lane's brief and its saved continuation file, claims `.factory/<lane>.md` with its own token (the previous lock is `none`), and alternates ready batches with its primary lane. Do returned failures and unblocking work first, and never starve either lane. If a Codex run comes back, it sees this table and exits without writing. Ballot was handed to meetings at 11:05Z.

Previously: None yet. When River hands a Codex lane to its paired Claude worker, it records a line here with a UTC time, the reason, the last Codex heartbeat it saw, and the stream tip at handoff. A Claude worker takes a Codex lane only when this section names it.

## Priorities

1. Returned failures in `returns/<lane>.md` come first.
2. Then take your lane's steps in the order your brief lists them, longest chains first. Registry starts DB-09 → DB-10 → DB-12 → DB-13 → DB-14 → DB-15 → DB-20.
3. Shared-file hooks go through River: put them under `needs_hook` in your status.

## Streams

Each lane works on `stream/<lane>`, which River seeds from `river` with an unlocked `.factory/<lane>.md`. An existing stream is resumed, never overwritten. Ready work is integrated through its exact `READY` commit only.

## Overflow

**Stopped 2026-10-05 17:00Z by Sean.** overflow-1 (admin) and overflow-2 (slide) have ended. No overflow worker is active. The rows below are history.

Sean's launch authorization allows up to two overflow workers when a lane falls behind.

| Time | Worker | Lane | Why |
|---|---|---|---|
| 2026-10-04 13:30Z | overflow-1 | admin | No progress since 07:06Z. measures' session permission check denied claiming stream/admin twice. About 20 measures steps and several auditors steps wait on BR-01, BR-03, BR-05, BR-12 and BR-24. |
| 2026-10-04 13:30Z | overflow-2 | slide | No progress since 07:39Z, and hunters never claimed it. Slide carries the reader-harm fixes CP-01 (privacy) and CP-19 (wrong person's facts). |

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

## READY means connected (River, 14:00Z, after release 1)

Release 1's live check found 28 READY steps that are libraries with tests and no runtime caller ("the runner call is a hook"). A step's "Done when" describes the running system, so:
- Mark a step READY only when its code is **connected** to the path the "Done when" names (runner pass, route, Admin read, Ask). Alternatively, when the only missing piece is a call in another lane's file, mark it `READY (hook pending: <file>, <owner>)` and put the exact request under `needs_hook`. River then routes it and reports the step as "built, not connected" until the hook lands.
- Owners of shared files: treat hook requests in `returns/<lane>.md` as your top priority. They block live acceptance across lanes.
- Schema: a new table needs a migration that River numbers. A `CREATE` statement held in a TS constant that nothing applies does not create the table.
- Production data seeding (such as the door registry) needs an authorized write path. Propose one; no lane or River writes production by hand.
