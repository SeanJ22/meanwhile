# River status

build_state: setup
worker: river
provider: Claude (this run: Opus 5.5, selected by Sean with /model at 06:00Z; this run began on Sonnet 5.5)
run_id: session_01M3CeUks1KpFZttTP6ZTEAq
lock: river-20261004T060134Z-23a399b0
heartbeat: 2026-10-04T06:05:59Z

## Launch

- Authorized: 2026-10-04T06:00Z by Sean. See `authorization.md`.
- Plan and briefs: `board/briefs` @ e076cd0.
- 36-hour clock: starts when the first authorized build worker starts, which is not yet recorded. River records the first worker heartbeat it sees as hour 0.
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

- RL-01: the Oct 3 scheduled failure ran on 022a183c. main @ 0b31938 already floors the crosswalk counts (#705/#706). tests/denominator-floor.test.ts passes 6/6 here. Full `pnpm gates` on 0b31938 is running in the cloud. The next scheduled run on main is 09:17 UTC.
- RL-02: auto-merge disabled on all 20 ready PRs at 06:05Z (#599, 677, 685-687, 689-696, 698-704); no PR can merge on its own. Per-PR keep/close triage in progress.
- RL-03: scripts/river.mjs in progress on stream/river.
- RL-04: #706 merged to main at 0b31938. Build check now runs on schedule once a day at 09:17 UTC. Still to confirm: one scheduled run a day on GitHub.
- RL-05: not started.
- RL-06: not started.
- RL-07: not started.

## Worker health

Updated each run from stream status files.

## Usage tally

Actions minutes, Netlify builds, runs: not yet measured.

## needs_Sean

none yet
