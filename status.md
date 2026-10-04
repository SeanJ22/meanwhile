# River status

build_state: setup
worker: river
provider: Claude (this run: Opus 5.5, selected by Sean with /model at 06:00Z; this run began on Sonnet 5.5)
run_id: session_01M3CeUks1KpFZttTP6ZTEAq
lock: river-20261004T060134Z-23a399b0
heartbeat: 2026-10-04T09:36:09Z

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
- Browser: Chromium runs, at `/opt/pw-browsers/chromium` (Playwright's bundled headless shell 1234 is missing). **This environment's network policy blocks meanwhileusa.com, admin.meanwhileusa.com, api.netlify.com, console.neon.tech and tiles.meanwhilemaps.com**: CONNECT returns 403 at the egress proxy, and WebFetch reports EGRESS_BLOCKED. Only GitHub and package registries are reachable. Until Sean allows those hosts in this cloud environment's network settings, live checks run only through GitHub Actions (post-deploy-integrity reads the deployed site) and the Neon MCP connection (read-only). No rendered page, button or mobile layout can be checked from River. That is an open verification gap, not a pass. Admin also needs Sean's Google sign-in.

## Automatic continuation: verified

- Fresh scheduled cloud runs publish streams, mark READY and resume from saved status. Every Claude lane has done this across more than one hourly run since 06:10Z.
- Handoff verified: River handed bank (codex-bank stopped 07:34Z) to registry at 08:20Z. By 09:05Z a fresh scheduled registry run had claimed stream/bank under its own lock ("registry (continuing bank after recorded handoff 2026-10-04 08:20Z)"). The other three handoffs (admin→measures, slide→hunters, frontend→auditors) are waiting on those workers' next hourly runs.
- No verified Codex restart mechanism exists. The Claude fallback is the continuation path.

## Release work

- RL-01: built and integrated. CI's crosswalk floor was already on main. The local `feedback:sweep` check-debt fix is on river @ 8f6185c. `pnpm gates` passes in the cloud except one trace-sweep test that also fails on main (see Seen, not fixed). Still to do: the next full check on main passes after release 1.
- RL-02: done for all 33 PRs. 13 closed with a note. 19 are in river @ 8f6185c, each with its step named in a PR comment; they close as merged when release 1 lands. #599 is held for a live check. None is waiting on auto-merge.
- RL-03: integrated (river.mjs @ 8f6185c). Fold fix d45831c (status-file conflicts and the CI env for gates) is READY on stream/river for the next fold. Still to do: a release through `river.mjs release`.
- RL-04: on main via #706. Still to do: confirm the daily scheduled run (09:17Z) and full checks on release PRs.
- RL-05: `river.mjs observe` is integrated. It found and reused the success run for 0b31938 (dry run). Still to do: use it on release 1.
- RL-06: integrated behind the switch WTP_ADAPTER_PUBLICATION, default `pr`. Still to do: release, then set the repo variable to `river` first and the runner's env second, then watch for a real adapter repair arriving through the river.
- RL-07: integrated. A rulings.md-only diff now selects 56 test files instead of 482. Still to do: measure a docs-only PR on GitHub.

## Seen, not fixed

- `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" fails on main @ 0b31938 whenever a local `.next` exists. CI never runs it, because its test jobs have no build. Since ae476a5 (Sep 29) `isNonShippingPath` treats all of `data/` as non-shipping, yet the build traces 3,330 `data/` files (ballot cards, zip-divisions, candidates). A commit changing only those files would cancel its Netlify build and serve the old copy. Sean's own Sep 29 tests pin that data-only changes cancel (`tests/hosted-cost-invariant.test.ts`, `deploy-paths.test.ts:132-133`), while RULING 124's trace sweep says traced files must ship. **Owner question, not yet asked:** should a committed change to a traced `data/` file (ballot cards, zip-divisions, states) rebuild the site, or do those files reach readers only through the data plane? Until he answers, lanes test without `.next`, as CI does.

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

## needs_Sean (sent 09:45Z)

1. **Handoffs blocked by session permission checks.** Measures was denied pushing to stream/admin. admin, slide and frontend have been idle since 07:06Z, 07:39Z and 07:24Z. Either allow measures→stream/admin, hunters→stream/slide and auditors→stream/frontend, or restart those three Codex tasks.
2. Allow River's environment egress to meanwhileusa.com, admin.meanwhileusa.com, test.meanwhileusa.com and api.netlify.com, for live browser checks.
3. People CA-01: its session denied the verification commands.
4. Auditors FE-01: its session denied removing the RULING 125 non-local refusals in four harnesses.
5. Meetings DB-59: River ran the read-only production read instead (see returns/meetings.md). Nothing is needed unless meetings needs more.
