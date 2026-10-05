# River status

build_state: integrating
worker: river
provider: Claude (this run: Opus 5.5 per session; scheduled resume)
run_id: session_01NH24r1XGQSiiPDzK2fFJSp
lock: river-20261005T1857Z-01NH24
heartbeat: 2026-10-05T19:32:09Z

## Next River run

1. Recheck the runner. Is the next research cycle running on ecf4026, with lastCycleOk and testedSha updated?
2. Has Sean fixed the runner's reader-edge store? Check `/api/reader/manifest` sequence > 2979 and `/api/meetings` snapshot.generatedAt current.
3. Scan and fold new READY work. The Codex lanes are back with Codex; check whether they resumed, and hand a lane back to its paired Claude worker if it stops again.
4. Live-check release 2's runner-side steps after adoption.

## Current (2026-10-05 17:35Z, hour 35.4)

- **River was down for 26 hours.** The previous River session's last write was 2026-10-04 13:55Z, and its overflow workers stopped with it. This scheduled run claimed the lock at 15:57Z.
- **Integrated this run:** river ef13298 → 85a0ad6. That covers hunters CH-08, CH-09, CH-13, CH-29, CH-30; meetings BX-09, DB-30, DB-06 safety net; registry DB-10, DB-11, DB-23 (returned repairs); admin BR-01, 02, 03, 05, 06, 09, 10, 12, 15, 16, 24, 37, CH-12, CH-14 (overflow-1); slide CP-01, CP-19 (overflow-2). Evidence is in .scratch and #708. Gates: 10/12 on the full run. The 2 failures were live-check scratch files in the repo root, and both reran clean on the same SHA.
- **Release 2:** #708 merged at 18:07:38Z as ecf4026, before hour 36. CI run 37348532384 was all green. Deployed 18:09:53Z, before hour 36; post-deploy run 37353604926 succeeded; CP-01 checked live (releases/2-live.md); runner adopted ecf4026 after 18:31Z (next research cycle overdue at 18:48Z; recheck). Deadline status sent to Sean at 18:18Z.
- **Steps integrated:** about 147 of 314 build steps. Most of the rest are the five Codex lanes, all handed back to Codex by Sean at 16:50Z and 17:00Z.
- **Release 1 browser check (releases/1-live-browser.md):** 7 checked live, **4 failed live** (FE-39, CA-30, CA-51, DB-55), 15 proving over time, 59 not screen-checked (55 need Admin sign-in).
- **Reader harm (stale snapshot), cause corrected 2026-10-05 18:20Z:** reader pages have served the 2026-09-29T05:38Z snapshot (manifest seq 2979). The cause was `WTP_READER_EDGE_DIR=/var/lib/meanwhile/reader-edge` in /etc/meanwhile/runner.env. `resolveReaderArtifactWriteStore()` (lib/meetings/edge-store.ts) returns the local file store whenever that variable is set, before it looks at NETLIFY_SITE_ID or the token. So the runner wrote to a folder on the droplet and logged PUBLISHED at sequences 113 to 117 while production stayed at 2979. **The earlier staging-site theory was wrong:** NETLIFY_SITE_ID and WTP_BLOBS_SITE_ID were already the live site, and the token was set. **Sean fixed the runner at 11:08 AM MST (18:08Z)** by commenting out WTP_READER_EDGE_DIR. The needs_Sean item is cleared. Code fixes assigned (no owner input needed): hunters removes the WTP_READER_EDGE_DIR default from deploy/runner/setup.ps1; slide makes the runner log the store it published to and makes a local-folder publish on the production runner a visible failure in Admin (returns files, 18:20Z). **Checked live 18:50Z: fixed.** See "Stale snapshot live check" below. CA-30: Ask gives wrong Prop 425 NO figures.
- **Egress:** Sean opened meanwhileusa.com, admin, test, api.netlify.com and tiles at ~16:50Z. Browser checks work, with Chromium pinned to the agent proxy CA. api.maptiler.com is still blocked, so the basemap can't render here. Admin still needs Sean's Google sign-in.
- **Owner decision 16:50Z:** data never rebuilds the site (decisions.md).

## Stale snapshot live check

- 18:16Z: production manifest still seq 2979 (generatedAt 2026-09-29T05:38:58Z). The runner cycle had started at 18:10:25Z, after Sean's 18:08Z fix (runner on dcddcf5).
- **18:48:16Z: production `/api/reader/manifest` reads sequence 2980, generatedAt 2026-10-05T18:46:52.961Z, sourceThrough 2026-10-05T16:27:41Z.** The first cycle after the fix published to the live site.
- **18:50Z, reader pages in a browser** (Playwright, public, ZIPs 85701, 03255, 07866): each page shows "Checked 3 minutes ago" (it showed "Checked 6 days ago" at 17:30Z). The `/api/meetings` responses those pages load carry snapshot generatedAt 2026-10-05T18:46:52Z with today's meetings, e.g. 85701 "Tucson Transit Advisory Committee" 2026-10-05 2:30 PM MST; 03255 "Recreation Commission Meeting" 2026-10-05 5:30 PM EDT; 07866 shows meetings from Oct 6 on. 85701 renders 253 meetings, 65 bodies, 57 officials. The basemap is still unavailable in this environment, as before (api.maptiler.com blocked here).
- Status: **checked live, fixed.** The code guards (hunters setup.ps1, slide store logging and Admin failure) are still open in the returns files.

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

## Release verification routes (read-only)

- **Runner adoption:** Neon project `meanwhile-control-plane` (withered-sunset-39821877), `cp_runner_heartbeat` id `pilot-runner`. Its `value.testedSha` and `value.codeIdentity.effectiveExecutableSha` give the code the runner runs. At 10:03Z: 2aac424 (main's last shipping commit, CONSISTENT), beat 10:03:01Z, `lastCycleOk: false` with the cycle still in progress.
- **Data plane:** Neon project `we-the-people` (tiny-hill-13996172): civic_data_promotions and civic_data_reader_projections.
- **Deploy:** the post-deploy-integrity workflow on GitHub, reused per SHA (`river.mjs observe`). There is no direct Netlify API from River (egress blocked).

## Automatic continuation: verified

- Fresh scheduled cloud runs publish streams, mark READY and resume from saved status. Every Claude lane has done this across more than one hourly run since 06:10Z.
- Handoff verified: River handed bank (codex-bank stopped 07:34Z) to registry at 08:20Z. By 09:05Z a fresh scheduled registry run had claimed stream/bank under its own lock ("registry (continuing bank after recorded handoff 2026-10-04 08:20Z)"). The other three handoffs (admin→measures, slide→hunters, frontend→auditors) are waiting on those workers' next hourly runs.
- No verified Codex restart mechanism exists. The Claude fallback is the continuation path.

## Pace (10:35Z, hour 4.4)

- 76 of 314 build steps are integrated or in a gates run, about 17 an hour overall.
- On pace: measures, registry (plus bank), hunters, meetings, auditors, people, ballot. Measures' last heartbeat was 98 minutes ago; it is waiting on admin's BR-01.
- **At risk:** admin (29 steps), slide (28) and frontend (29) have made no progress since about 07:30Z. Their Claude continuation is blocked by session permission checks (needs_Sean 1). At the current pace the other lanes finish well before hour 36. These 86 steps decide the deadline: unblocked by about hour 8, they fit, and every hour of delay pushes the finish later.

## Release work

- RL-01: built and integrated. CI's crosswalk floor was already on main. The local `feedback:sweep` check-debt fix is on river @ 8f6185c. `pnpm gates` passes in the cloud except one trace-sweep test that also fails on main (see Seen, not fixed). Still to do: the next full check on main passes after release 1.
- RL-02: done for all 33 PRs. 13 closed with a note. 19 are in river @ 8f6185c, each with its step named in a PR comment; they close as merged when release 1 lands. #599 is held for a live check. None is waiting on auto-merge.
- RL-03: integrated (river.mjs @ 8f6185c). Fold fix d45831c (status-file conflicts and the CI env for gates) is READY on stream/river for the next fold. Still to do: a release through `river.mjs release`.
- RL-04: on main via #706. Still to do: confirm the daily scheduled run (09:17Z) and full checks on release PRs.
- RL-05: `river.mjs observe` is integrated. It found and reused the success run for 0b31938 (dry run). Still to do: use it on release 1.
- RL-06: integrated behind the switch WTP_ADAPTER_PUBLICATION, default `pr`. Still to do: release, then set the repo variable to `river` first and the runner's env second, then watch for a real adapter repair arriving through the river.
- RL-07: integrated. A rulings.md-only diff now selects 56 test files instead of 482. Still to do: measure a docs-only PR on GitHub.

## Seen, not fixed

- `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" fails on main @ 0b31938 whenever a local `.next` exists. CI never runs it, because its test jobs have no build. Since ae476a5 (Sep 29) `isNonShippingPath` treats all of `data/` as non-shipping, yet the build traces 3,330 `data/` files (ballot cards, zip-divisions, candidates). A commit changing only those files would cancel its Netlify build and serve the old copy. Sean's own Sep 29 tests pin that data-only changes cancel (`tests/hosted-cost-invariant.test.ts`, `deploy-paths.test.ts:132-133`), while RULING 124's trace sweep says traced files must ship. **Answered by Sean 2026-10-05 ~16:50Z (decisions.md): data never rebuilds the site; the sweep stays and the traced data/ reads are work.** Original question: should a committed change to a traced `data/` file (ballot cards, zip-divisions, states) rebuild the site, or do those files reach readers only through the data plane? Until he answers, lanes test without `.next`, as CI does.

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