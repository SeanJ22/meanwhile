# Lane: hunters (Runner, workers and hunters)

**Starts in Claude** (suggested model Opus 5.5) as an hourly cloud task. Status file: `.factory/hunters.md` on `stream/hunters`. You also continue the `slide` lane when River hands it to you (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = hunters` (87 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** The always-on runner and how new releases install on it; the worker pool and memory slots; the scheduler and dispatch; scouts and their tools; discovery walks; Sends and work creation; request pacing; and the spending guards on paid work.

**Shared files you own:** `scripts/freshness-shadow.mts`, `scripts/pilot-runner.mts`, `lib/ops/runtime-release-*`.

## 1. What stops free acquisition (rulings §2)

Start with `deploy/runner/*`: a runner that does not start and stay up runs nothing.

| Path | Action |
|---|---|
| `deploy/runner/install.sh` | Needed to rebuild the server, but it disables and leaves the runner off. End with 'systemctl enable --now' so the runner starts and survives reboots. |
| `deploy/runner/setup.ps1` | Hard-codes staging settings (mode staging, local database role, Sean's .env.staging path), so a rebuilt server comes up as staging and needs hand edits. Install production settings. |
| `lib/control-plane/discovery/meetings-discovery-executor.ts` | Records an HTTP 429 as a permanent wall like a login. Rules say back off and retry on 429. |
| `lib/control-plane/expansion/dispatch-work.ts` | Run it on a rolling clock for every place; Sends only reorder and fund paid work. Drop owner-only gap rows. |
| `lib/control-plane/fleet-safety.ts` | Remove leftovers: a 24 MiB per-download cap Sean never set (drops big agenda and budget PDFs), dead night/blackout shims and unused stop codes. |
| `lib/control-plane/scheduler/provider-inputs.ts` | Tracked states come only from promoted reviewed registries plus states a Send reached; they should be every state and territory from the national registration. |
| `lib/control-plane/scheduler/robots.ts` | Behavior matches the rule; delete the restated owner quote and ruling citation, and stop honoring Crawl-delay as spacing on large sites that should be read at full speed. |
| `lib/control-plane/scheduler/scout-api.ts` | Agents must be able to call these, so keep; but the data_gov_api tool points at College Scorecard instead of govinfo's Congressional Directory. |
| `lib/extract/embedded-payload.ts` | A useful general reader, but only a hand-run CLI uses it. Expose it to scouts and the roster door as a tool so it actually runs. |
| `lib/hunt/discovery-search.ts` | Used by the discovery executor, but drops any result not on an official government site. |
| `lib/hunt/meetings-discovery.ts` | Used by the discovery walk; the code is general, but it cites a numbered ruling and reads the three-state registry files. Strip the citation; read from the national registration. |
| `lib/hunt/meetings-recipes.ts` | A failed method waits up to 30 days before retrying a place. The rules cap dead-end waits at 5 days while coverage expands. Strip the attribution and ruling. |
| `lib/hunt/meetings-site-discovery.ts` | Bodies in 13 states that span time zones (TX, FL, MI...) can never be confirmed, and any code edit re-keys verified calendars. Take each body's time zone from place data; drop the version-hash re-keying. |
| `lib/hunt/mission-meetings-discovery.ts` | Free discovery should walk every registered government on a standing clock, with mission places first. |
| `lib/hunt/place-source-admission.ts` | Run it for every ZIP on a rolling clock, reader-demand first; sends only steer paid work. |
| `lib/hunt/recorded-walls.ts` | It permanently skips go.boarddocs.com, a big school-board platform, with no retry. Make the list data that gets re-checked, and drop the history note. |
| `lib/hunt/robots-first-fetch.ts` | Used by campaign-site checks and corrections. It still slows to robots.txt crawl-delay on any site, and keeps an empty 'waits on owner decision' host list. Remove both. |
| `scripts/freshness-shadow.mts` | Findings stage but never publish (:35-37, :3801); a built-in daily spend cap applies when Admin sets none (:1633-1648); pilot ZIP ordering (:315, :1461); hunter and meeting-discovery off switches (:1704, :3342). |
| `scripts/pilot-runner.mts` | Research stays shadow and never publishes (:13-18); paid hunters sit behind an off switch (:1340); it launches the shadow nightly window (:2019); delete the drain-first switch (:1104) and Sean's-PC Drive digest (:300). |
| `tests/dispatch-work.test.ts` | Change the test that says an untracked state gets no standing clock; every state runs free work on a schedule. |
| `tests/free-walks.test.ts` | Free-first is right, but it pins the free walk to dispatched places and only while the paid lane is open. Free discovery must run everywhere, paid switch or not. |
| `tests/meetings-discovery-executor.test.ts` | Delete the WTP_DISCOVERY_SERIAL old one-at-a-time path check, and the hints test that reads committed per-state jurisdiction files. |
| `tests/paid-work-fails-closed.test.ts` | Delete assertions pinning a built-in fallback ceiling Sean never set, and the WTP_MEETINGS_DISCOVERY off switch for free discovery. |
| `tests/robots-first-fetch.test.ts` | Robots-recorded behavior matches the rules; remove the fixed two-second spacing for every host (only small governments get a cap) and the owner-decision label. |

## 2. Groups

_None._

## 3. The rest

| Path | Action |
|---|---|
| `deploy/runner/README.md` | Mostly a finished one-time resume and transfer checklist: staging canary on an Arizona source, 'keep originals until Sean approves', 'remains off until Sean resumes'. Cut to install, restart and logs. |
| `lib/control-plane/cache-defects.ts` | Useful cost check. Remove the numbered ruling cited in a comment and in the message it prints. |
| `lib/control-plane/expansion/spend-holds.ts` | Delete the old ledger-row path behind the WTP_SPEND_HOLDS_TABLE=0 switch and the "Sean, date" quotes in comments. |
| `lib/control-plane/route-task.ts` | Core scheduler type used everywhere; only its comments cite rulings as authority and should be stripped. |
| `lib/control-plane/scheduler/dispatch.ts` | Core scheduler; behavior is fine, but comments cite rulings as authority and should be stripped. |
| `lib/control-plane/scheduler/host-supervision.ts` | The small-government request cap is right; remove the "Sean, October 1" attribution and the Windows pilot-task relaunch proof tied to Sean's PC. |
| `lib/control-plane/scheduler/model-lane.ts` | Sean's pause and spending controls are right; delete the "no delivery path" closure that shuts paid work while the publishing allowlist is closed, and the continuous-hunters switch branch. |
| `lib/control-plane/scheduler/model-routing.ts` | Cheapest-model-first routing is useful; strip ruling citations, and the hard-coded "Opus is the ceiling" owner rule should become an Admin spending setting since only Admin sets limits. |
| `lib/control-plane/scheduler/same-round-work.ts` | Behavior is good; delete the switch that keeps the old next-round path "until checked live". |
| `lib/control-plane/scheduler/scout-contract.ts` | Scouts need it and it already lists every keyed API as a tool; strip the RULING 243/244 citations. |
| `lib/control-plane/scheduler/scout-search.ts` | Search under Sean's Admin budget is right; its header says excerpts stay leads until verified "against the official source", which contradicts any checkable source counting. |
| `lib/control-plane/scheduler/scout-tools.ts` | Core agent toolkit with the correct small-government cap; strip RULING 243 citations and "official source" wording in tool instructions. |
| `lib/control-plane/scheduler/shadow-loop.ts` | The runner needs it; delete its stated doctrine that the loop may never promote anything until independently reproduced, and the RULING 146/212/216/217/218 citations. |
| `lib/control-plane/workers/hunter-lane.ts` | This is the continuous-hunting path that should simply run; delete its dependence on the WTP_CONTINUOUS_HUNTERS switch and the "Sean, Oct 6" attributions. |
| `lib/control-plane/workers/lease-worker.ts` | Needed by the worker pool; delete the two "way back" switches that keep old whole-table and per-task paths alive until checked live. |
| `lib/control-plane/workers/process-pool.ts` | Core worker pool; remove the "(Sean, Oct 6)" attributions from comments. |
| `lib/control-plane/workers/research-runtime.ts` | Keep the acquirer path; delete the engineering branch that only serves the dead review-only engineering worker. |
| `lib/control-plane/workers/scoped-history.ts` | This is the database-cost fix; delete the old whole-table path kept behind a switch "until checked live". |
| `lib/control-plane/workers/types.ts` | Core types; drop the ENGINEERING role once the dead review-only engineering worker is deleted. |
| `lib/control-plane/workers/worker-slots.ts` | Required by the memory-margin rule; remove the "(Sean, Oct 6)" attribution. |
| `lib/hunt/access-control.ts` | Matches the rule against bypassing access controls, but the header credits a dated Sean decision and tells a Sierra Vista story. Strip the attribution and anecdote; keep the code. |
| `lib/hunt/egress.ts` | Delete the retired readViaEgress tombstone, its long history header and the three old scripts that call it. |
| `lib/models.ts` | Used by Ask and scouts. Remove the "(Sean, 2026-09-25)" attributions in comments and strings; keeping a retired-model list is fine as an engineering fact. |
| `lib/ops/runtime-release-stage.ts` | Delete the WTP_RELEASE_DRAIN_FIRST switch and the old drain-first path it keeps 'until verified live'. |
| `lib/ops/runtime-release-switch.ts` | The fast switch hides behind WTP_RELEASE_QUICK_SWITCH, off by default 'until checked live'. Delete the switch so it always runs, and drop the drain-everything path. |
| `scripts/hunter-lane.mts` | Delete that switch (pilot-runner.mts:1340) so it always runs, and the switch wording in its header (:3). |
| `scripts/pilot-runtime-config.mjs` | Delete the default that points the digest at Sean's PC Google Drive folder (:43). |
| `tests/control-plane-evidence.test.ts` | Real evidence and credential-safety checks. Remove the ruling citation in an assert message. |
| `tests/expansion-any-state-surfaces.test.ts` | Drop the assertion on the "reviewed AZ registry" sentence; seed-state lists are being replaced by national registration. |
| `tests/fleet-recovery-journey.test.ts` | Real worker-pipeline behavior that matches the robots rule, but it cites an owner decision by date. |
| `tests/fleet-safety.test.ts` | Mostly real safety code, but it pins a built-in $100 daily AI ceiling as fallback. Only Sean's Admin setting may set a cap. |
| `tests/http-retrieval.test.ts` | Real retrieval behavior that honors Retry-After, with a numbered-ruling comment to remove. |
| `tests/hunter-lane.test.ts` | Lane behavior is fine, but it pins the lane behind the WTP_CONTINUOUS_HUNTERS switch, one of the ten default-off switches to delete. |
| `tests/identified-ua-wall.test.ts` | Real access behavior, but cites an owner decision by date. |
| `tests/lease-runtime-once.test.ts` | Real worker behavior, but it pins an old per-task path kept behind a switch. |
| `tests/meetings-discovery-search.test.ts` | Search use is real, but it pins a code-set daily and per-cycle request cap (200/day default). Caps must come only from Sean's Admin spend settings. |
| `tests/mission-meetings-discovery.test.ts` | Real behavior. Delete the tombstone check that asserts the retired gap-ledger files stay gone. |
| `tests/mission-parts.test.ts` | Real behavior. One test reads the committed Arizona jurisdiction file; use a fixture so it survives that data moving to the database. |
| `tests/model-batch.test.ts` | Remove the RULING 277 citation and the comparison-seam test for lib/ask/model-comparison.ts, a one-off measurement nothing runs. |
| `tests/model-ceiling.test.ts` | A model limit set in code, not by Sean in Admin. Move the allowed-model ceiling to an Admin setting and test that instead. |
| `tests/model-lane.test.ts` | Drop the tests tying paid work to the open-record-class allowlist, which the plan deletes. |
| `tests/obligation-registry.test.ts` | Remove RULING 282/283/207/224/228 citations and use a fixture instead of the committed AZ/NH/NJ jurisdiction files. |
| `tests/robots-recorded-not-blocking.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. |
| `tests/same-round-work.test.ts` | Keep same-round work; delete the WTP_FIRST_HUNT_NEXT_ROUND switch test and the old one-round-lag path it guards. |
| `tests/scheduler-freshness.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. Also rename the 'PILOT HEALTH' digest heading. |
| `tests/scoped-task-reads.test.ts` | Keep scoped reads; delete the 'switch off, old whole-table reads still run' test and the WTP_SCOPED_TASK_READS switch. |
| `tests/scout-lane.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. |
| `tests/send-budget-hard-cap.test.ts` | Sean-set budgets are allowed; strip the quoted "Sean, 10:00 PM MST" instruction from the header. |
| `tests/spend-holds-table.test.ts` | Keep the table tests; delete the WTP_SPEND_HOLDS_TABLE=0 switch tests and old ledger-row path, and the quoted 'Sean:' line. |
| `tests/wikipedia-permission.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. Remove the docs/sources.md Tier A note. |

**Check and close (11 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/control-plane/discovery/free-walks.ts`, `lib/control-plane/workers/hunter-lane-arming.ts`, `scripts/pilot-runtime-child.mts`, `tests/control-plane-pima-shadow.test.ts`, `tests/expansion-any-state.test.ts`, `tests/model-cost-metered.test.ts`, `tests/read-only-vault.test.ts`, `tests/settled-occurrence-recovery.test.ts`, `tests/window-exited-holder.test.ts`, `tests/worker-fleet-standing-generalized.test.ts`, `tests/worker-fleet-standing.test.ts`.

## Notes

- Report the worker count at the memory margin with any fleet change (rulings §5).
- Never restart the production runner by hand; changes reach it through River.
- Request pacing and robots.txt: rulings §2. Spending limits: rulings §8.
