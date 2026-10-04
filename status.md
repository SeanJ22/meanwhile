# River status

build_state: setup
worker: river
provider: Claude (this run: Opus 5.5, selected by Sean with /model at 06:00Z; this run began on Sonnet 5.5)
run_id: session_01M3CeUks1KpFZttTP6ZTEAq
lock: river-20261004T060134Z-23a399b0
heartbeat: 2026-10-04T06:35:36Z

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

- RL-01: CI's scheduled failure (crosswalk floor) is already fixed on main @ 0b31938. Local `pnpm gates` also failed `feedback:sweep` on main: six Admin feedback rows cited tests retired with the old Admin pages on Oct 1. Fixed on `rl01-feedback-debt` @ 26753d4: those rows moved to checkDebt with the reason, and the rule is unchanged. That fix is folded into river-next. The full `pnpm gates` run on 0b31938 is still in its test leg.
- RL-02: Sorted all 33 open pull requests, 06:40Z.
  - **Closed with a note, 13** (no branch deleted): #687, 644, 640, 633, 620, 615, 607, 603, 575, 572, 569, 471, 458. The useful parts are kept on `stream/salvage-*`: fe30-ballot-copy (#644 → frontend FE-30), fe04-cold-reader-shell (#640 → FE-04), ca21-filing-regimes (#633 → ballot CA-21/CA-34), ca21-money-registrations (#603 → CA-21), refusal-counter (#607), tester-retention (#569/#572), organic-only (#620).
  - **Kept, 19**: folded into river-next in this order: 695, 698, 703, 700→701→704, 702, 696, 692, 693, 691, 689, 690, 686, 685, 677, 699, 694, 642. Two small conflicts resolved: #686 after #690 (tests file), and #692 needs OFFICIAL_PAGE_EVENTS_VERSION re-keyed, which is done. Each PR closes once its fold reaches river with steps named.
  - **Held, 1**: #599. It converts the production registry on its first runtime start, and its own staging pass ended FAILED. It rides a later river only after a live check. Auto-merge is off.
- RL-03: scripts/river.mjs (scan, fold, migrations, test, promote, release, lock, observe), 10/10 tests, plus CLAUDE/AGENTS guidance. On stream/river @ fcf9492, folded into river-next. Awaiting the full gates on the combination.
- RL-04: #706 merged to main at 0b31938. Build check now runs on schedule once a day at 09:17 UTC. Still to confirm: one scheduled run a day on GitHub.
- RL-05: not started.
- RL-06: not started.
- RL-07: docs-only selection. A rulings.md-only diff selects 56 test files instead of 482, and the doc's readers and compiled-copy freshness test still run. Code selection is unchanged. READY @ 818c6ef, folded into river-next.

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
| bank | Codex | **not started**, no lock or heartbeat | — |
| frontend | Codex | **not started**, no lock or heartbeat | — |

Bank and frontend are Codex environment 2 tasks, which Sean starts by hand. They show no run yet.

## Usage tally

Actions minutes, Netlify builds, runs: not yet measured.

## needs_Sean

none yet
