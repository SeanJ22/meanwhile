# River status

build_state: setup
worker: river
provider: Claude (this run: Opus 5.5, selected by Sean with /model at 06:00Z; this run began on Sonnet 5.5)
run_id: session_01M3CeUks1KpFZttTP6ZTEAq
lock: river-20261004T060134Z-23a399b0
heartbeat: 2026-10-04T07:35:15Z

## Launch

- Authorized: 2026-10-04T06:00Z by Sean. See `authorization.md`.
- Plan and briefs: `board/briefs` @ e076cd0.
- 36-hour clock: **hour 0 = 2026-10-04T06:10Z**, the meetings worker's first lock (Oct 3, 11:10 PM MST). **Hour 36 = 2026-10-05T18:10Z** (Oct 5, 11:10 AM MST).
- Release windows: h8 14:10Z (7:10 AM MST Oct 4), h16 22:10Z (3:10 PM MST), h24 06:10Z Oct 5 (11:10 PM MST Oct 4), h32 14:10Z Oct 5 (7:10 AM MST). The final release must open early enough to be deployed and checked live by 18:10Z Oct 5.
- Release targets: normal batches around hours 8, 16, 24 and 32. The final release starts early enough to deploy and pass live checks by hour 36.
- Budgets: unchanged. No budget increases, no new paid services, no hunts. Admin spending settings stay as they are. Production database is read-only.

## Branches

- river: created from main @ 0b31938 (which carries #706) at 2026-10-04T06:01Z.
- board/river: this branch.
- river-next / release/*: none yet.
- stream/<lane>: River seeded all eleven builder streams from river @ 0b31938 at 06:03Z. Each has an unlocked `.factory/<lane>.md`. Seeding them started no Actions runs; the only runs since are on main. Netlify cancels branch deploys except `test`, and the stream names don't contain "preview".

## Capabilities (this River cloud session, observed 2026-10-04)

- git push over HTTPS to SeanJ22/meanwhile: works (created river).
- GitHub MCP tools: read PRs and Actions, disable auto-merge, update/close PRs, comment, dispatch and re-run workflows, create PRs.
- No tool in this session can create, list or fire cloud scheduled tasks/routines. River cannot start, restart or pause another worker's schedule. Pausing finished workers means asking Sean, or the worker exits early on its own.
- No Codex control surface. River cannot see Codex run state, only its stream commits and heartbeat.
- Notifications: PushNotification is available to River.
- Neon MCP is connected with write tools exposed. River uses only read-only queries, as authorized.
- Netlify MCP: coding-context tool only. No deploy/site-settings reads seen yet.
- Browser: Chromium and Playwright installed. Public pages can be checked. Admin needs Sean's Google sign-in, so Admin screens are a known verification limitation.

## Release work

- RL-01: built and integrated. CI's crosswalk floor was already on main. The local `feedback:sweep` check-debt fix is on river @ 8f6185c. `pnpm gates` passes in the cloud except one trace-sweep test that also fails on main (see Seen, not fixed). Still to do: the next full check on main passes after release 1.
- RL-02: done for all 33 PRs. 13 closed with a note. 19 are in river @ 8f6185c, each with its step named in a PR comment; they close as merged when release 1 lands. #599 is held for a live check. None is waiting on auto-merge.
- RL-03: integrated (river.mjs @ 8f6185c). Fold fix d45831c (status-file conflicts and the CI env for gates) is READY on stream/river for the next fold. Still to do: a release through `river.mjs release`.
- RL-04: on main via #706. Still to do: confirm the daily scheduled run (09:17Z) and full checks on release PRs.
- RL-05: `river.mjs observe` is integrated. It found and reused the success run for 0b31938 (dry run). Still to do: use it on release 1.
- RL-06: integrated behind the switch WTP_ADAPTER_PUBLICATION, default `pr`. Still to do: release, then set the repo variable to `river` first and the runner's env second, then watch for a real adapter repair arriving through the river.
- RL-07: integrated. A rulings.md-only diff now selects 56 test files instead of 482. Still to do: measure a docs-only PR on GitHub.

## Seen, not fixed

- `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" fails on main @ 0b31938 whenever a local `.next` exists. CI never runs it, because its test jobs have no build. Since ae476a5 (Sep 29) `isNonShippingPath` treats all of `data/` as non-shipping, yet the build traces 3,330 `data/` files (ballot cards, zip-divisions, candidates). A commit changing only those files would cancel its Netlify build and serve the old copy. River owns this deploy-classification question; it is not yet fixed.

## Worker health (06:31Z)

| Lane | Provider | State | Ready |
|---|---|---|---|
| measures | Claude | active, heartbeat 06:25Z | SC-01 @ 7d3c085 |
| hunters | Claude | active, heartbeat 06:25Z | none (CH-02 testing) |
| registry | Claude | active, heartbeat 06:25Z | DB-09..DB-11 @ 165e953 |
| meetings | Claude | active, lock 06:10Z | none (DB-01) |
| auditors | Claude | lock released at checkpoint 06:27Z | DP-01 @ ec1157a |
| people | Claude | active, heartbeat 06:23Z | CA-09, CA-12 @ cf622f3 |
| admin | Codex | active, lock 06:27Z | none (BR-05) |
| slide | Codex | active, lock 06:29Z | none (CP-01) |
| ballot | Codex | active, lock 06:29Z | none (CA-24) |
| bank | Codex | active since 06:31Z | none yet |
| frontend | Codex | active since 06:31Z | none yet |

All eleven lanes are running (bank and frontend locked at 06:31Z).

## Integration in progress

river-next @ 8f6185c (full `pnpm gates` running, 07:10Z). It contains:
- 19 kept PRs (RL-02) plus the #692 re-key
- RL-01 feedback check-debt; RL-03 river.mjs; RL-07 docs-only selection; RL-06 adapter streams (switch default `pr`)
- measures SC-01, 02, 03, 05, 08, 12, 20 @ cc8c0cf; registry DB-09..11 @ 165e953; auditors DP-01 @ ec1157a; people CA-06, 09, 12 @ 4b5bbc1; hunters CH-02 @ 9ae2d28
- River fold repairs: the door-import floor, and the #701 history-read spy

First gates run on river-next (4f3bd5d): 23 failures before the repairs. 21 were environmental: `DATABASE_URL` set in the cloud, and a git-ignored place-reference projection missing in worktrees. 2 were real and are repaired above. The build failed only because of a symlinked node_modules. With a clean env, plain main has no failures in those files.

## Usage tally

Actions minutes, Netlify builds, runs: not yet measured.

## needs_Sean

none yet
