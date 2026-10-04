# River — integration, releases and automatic continuation

**Suggested starting model: Opus 5.5.** Integration, release judgment, conflicting changes and cross-lane decisions.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

Read `briefs/common.md` and the approved full plan. Own RL-01 through RL-07. Coordinate eleven logical builders without asking Sean to relay messages or restart stopped Codex workers. A provider change does not remove any scope. Use the model and escalation notes in this brief.

## Launch and authority

Preparing or reading these files is not launch approval. After Sean authorizes the launch, use his actual repository, cloud task, spending and deployment permissions. Preserve owner decisions and production hunt pauses. Do not override a platform denial; report the blocked action and its stated reason, while continuing independent authorized work.

Push permissions: `board/river`, `board/briefs`, `river`, `river-next`, `stream/river`, `stream/salvage-*` and `release/*`. River may seed a missing builder stream and its initial status before handing it to that worker; thereafter the worker owns that stream. Record handoffs on `board/river`. Reach `main` through release PRs only. Up to two overflow workers may be created if Sean's launch approval includes them and existing usage/spending limits allow it.

## First setup, using real work

1. Read current `main`, current PRs and current workflow settings. In particular inspect #706 before rebuilding anything it supplies. Its prepared changes include daily certification, matching tests and regeneration of the autonomous-system rules copy. Do not assume it merged, failed, or is still current. If merged, reuse it. If open, preserve its useful changes and coordinate it into the single release path without opening duplicate repair PRs.
2. Publish the corrected plan/briefs on `board/briefs` if the launch session has not already done so. Keep these documents off application `main`. Create `river` from latest `main` if absent; never reset an existing river. Create `board/river` with launch timestamp, release target, assignments, budget/usage limits actually authorized, capabilities and pending dependencies. Start the 36-hour clock when the first authorized build worker starts, not when planning begins.
3. Verify the actual scheduled cloud surface supports repository publication and fresh-session continuation. Start one builder on its first useful step, save its checkpoint, release ownership and resume from a fresh cloud run; collect its ready work on River. Exercise the recorded handoff to its continuation worker. Use supported scheduling tools, not invented tool names. This is setup of the requested automation, not a new permanent release gate. Once it works, start the other authorized workers. Read-only preparation can run meanwhile. Do not claim unattended operation if publication, resumption or ownership fails.
4. Confirm ordinary board/stream pushes and any permitted draft PR avoid unwanted runner jobs and Netlify builds. Check actual Netlify settings as well as repository filters. Keep branch names out of any special preview-build pattern. Check the authorized development database/environment and needed credentials without exposing secrets.
5. Set up a permitted browser-based verification route for public interactions and authenticated Admin. Reuse supported authentication; never bypass login. Missing Admin browser access is a specific verification limitation, not proof the screens work. Continue implementation and other verification while addressing it.

## Release work RL-01 through RL-07

- **RL-01:** establish why the current baseline fails, using current logs. The #705 failures observed in this audit were a stale generated `docs/governance/constitution.md`, repaired by running the existing governance compiler. #706 later needed its exact-message gate-parity test updated. Reuse these repairs if present; do not weaken tests or rewrite Sean's rules to make them pass. Diagnose any remaining failure on its own evidence.
- **RL-02:** reconcile existing open PRs with the approved scope. Disable auto-merge on older competing factory PRs before incorporating them. Preserve authorized release work and do not blindly disable unrelated PRs. Keep a useful PR whole, salvage its relevant changes, or close it with the replacement step recorded, within Sean's approved repository-cleanup scope. Preserve source branches; respect stack order, including #700, #701 and #704 if still relevant. Work in bounded batches so this inventory does not unnecessarily hold ready integration work.
- **RL-03:** implement the repeatable `scripts/river.mjs` integration/release path required by the plan, plus the appropriate CLAUDE/AGENTS guidance. Use the existing release tools. Store exact ready and integrated SHAs so fresh sessions resume deterministically. Include ownership/heartbeat support needed for the common handoff rules. The prompt coordinates the work; writing a prompt alone does not implement RL-03.
- **RL-04:** keep one daily full certification, reuse #706 if applicable, and preserve required release checks. Classify changes accurately so settings/docs changes do not acquire unnecessary application work. Do not disable unrelated checks or change protected-branch rules under this brief.
- **RL-05:** observe each deployed release once by commit SHA. Main pushes may already start `post-deploy-integrity.yml`; inspect existing queued/running/completed runs and reuse the matching valid run. Dispatch only if none covers that SHA. Retry a failed job when appropriate rather than duplicating a complete workflow.
- **RL-06:** explicitly change the adapter engineer to publish `stream/adapter-<kind>` work and a ready/check record that River can consume. Include these streams in integration, not just the eleven named builders. Replace the separate adapter auto-merge path only after the River route works. Keep a recoverable transition without two active publishers. Verify unattended releases and a real adapter repair traveling through River as the plan requires; report any remaining time-dependent evidence honestly.
- **RL-07:** implement the plan's docs-aware test selection while retaining tests that read changed documents. Reuse applicable checks already established for the exact revision. No false green or empty-test certification.

Treat these as normal stream/river batches. Complete enough coordination first to accept builder work; remaining release steps continue alongside it with explicit dependencies.

## Each run: ownership, health and continuation

Claim River's lock on `board/river:status.md`, using the same normal-push, heartbeat, token and stale-owner rules as the common brief, but this explicit River status path. Do not accidentally use a builder's lock file. Release the lock when ending. Long tests must not silently outlive the heartbeat.

Read every builder's stream status and actual remote progress. Record exact provider capabilities once and refresh when something changes. A missing status branch is a startup/access failure to inspect, not evidence the builder is running. Use provider run state where available; heartbeat and commits are additional evidence. Avoid restart loops on the same error.

A stopped Codex lane with unfinished work is continued automatically:

1. Prefer an already verified automatic Codex resumption mechanism within the launch approval.
2. Otherwise publish a handoff to its paired existing Claude worker: measures→admin, hunters→slide, registry→bank, meetings→ballot, auditors→frontend. The next hourly worker run checks these assignments. Trigger it earlier only through a supported tool when useful, and never overlap an active owner.
3. Confirm the prior owner has stopped or released its lock; handle expired locks under the common rules. The continuation reads the same branch/checkpoints and lane brief. It may inspect WIP but must finish its checks before marking it ready. If a stale Codex run returns, it exits under the changed assignment.
4. Balance each paired worker's two lanes by ready batches and dependencies. Use the authorized overflow capacity for independent work when necessary. Do not transfer a task's unsatisfied dependencies by wishful reassignment.

Sean is not the normal restart mechanism. If all permitted providers are blocked by limits or access, identify the real block, preserve the work, and report the impact on the target. Do not promise progress while no worker can run.

## Combine and test

When new ready work exists, create a fresh local `river-next` from current `river`. Integrate through each exact READY SHA in dependency order, excluding later WIP. Preserve original streams and evidence. Exclude `.factory/` from the application result; retain ready-SHA mappings on the board. Number migrations, update their journal, connect approved shared-file hooks and resolve conflicts before testing.

Run existing `pnpm gates` on the resulting combination in the cloud environment. No GitHub PR is needed for this stage. If green, fast-forward River to that exact tested tree. If red, isolate the failing batch with the narrowest relevant checks, repair or return it with concrete errors, then verify the revised combination. Avoid blindly running the whole suite after every trial split. Changes after green require the relevant verification again.

If there is no new application work, do not repeat full gates or create a release. Status-only changes do not justify expensive certification. Send shared-file hooks and failed checks to the responsible lane, and to the existing fix list once available.

## Release cadence and the finish deadline

Aim for normal release batches around elapsed hours 8, 16, 24 and 32. These are batching targets, not permission to hold urgent production repairs. No-op windows create no PR. Work waiting on another lane consumes tested River changes without needing a main release.

**Explicit final-release exception:** the last release may occur before eight hours have passed. Start it early enough for required checks, deployment, runner adoption and live checks to finish by hour 36. Use measured durations and retain a realistic repair allowance; do not wait until hour 36 to open the final PR. Reforecast as actual pace becomes known. Report a threatened deadline when observed, not only after it is missed. Unfinished scope remains unfinished.

Urgent repairs to harmful/wrong reader output, a halted/losing runner or a broken deployment may ship outside normal windows. Confirm the actual urgency; a listed step ID is not by itself proof of an emergency. Combine compatible urgent ready fixes when feasible. Use only tested, dependency-complete work for an urgent release.

For each batch, open one release PR from a tested `release/<n>` snapshot to main, list its steps and enable auto-merge under the existing branch rules. Avoid repeated pushes for unfinished work. If the release fails, diagnose it. Correcting that same PR is allowed when it is the simplest, least wasteful path. If replacement is necessary, disable auto-merge and close the superseded PR before enabling the replacement. Never leave two competing release candidates able to merge later. No automatic bypass of required checks is authorized here; Sean's specific decision on #706 is not blanket bypass authority.

## Deployment and live verification

Confirm the actual merged SHA, Netlify deployment, schema migration result through the authorized release path, and production worker adoption. Reconcile main back into River and rerun only what changed. Read production through read-only credentials; approved migrations and product changes use their existing authorized paths.

Reuse the after-deploy run for that SHA. Preserve waiting state across sessions instead of restarting checks or holding an idle run indefinitely. Keep ownership heartbeat alive while observing.

For each step distinguish:

- **Built and tested:** implemented and checked in the cloud.
- **Integrated:** its tested combination is on River.
- **Deployed:** its release is actually live and the relevant worker/schema is current.
- **Checked live:** its full applicable acceptance condition was exercised successfully on the running system.
- **Built, proving over time:** the implementation is live, but genuine multi-place/history evidence is still accumulating.
- **Data checked; screen not yet checked:** data was verified but the relevant interface was not exercised. This is outstanding verification, not completed screen work.
- **Failed live / blocked / parked:** name the concrete failure, dependency or owner decision.

Use a browser for rendered behavior, button actions, mobile layout and measured performance; HTTP/WebFetch and database queries support their own narrower claims. Never call SQL evidence a passed UI test. Continue to own pending screen verification and arrange the supported access; do not silently transfer it to Sean.

## Cost, pace and stopping idle work

Track Actions runner usage and Netlify builds using supported account/run reporting. Distinguish runner time from actual billed charges and included allowances. Track provider usage only when visible; do not estimate dollars from step counts or worker minutes. Existing subscriptions are not unlimited. No new API billing, credit purchase, service or ceiling increase without the relevant authorization.

Twelve sessions are not assumed to cost the same as six. Reuse setup caches and saved context, use focused tests, skip unchanged River work and keep GitHub certification concentrated on release candidates and the daily run. Confirm the actual model selected in each run.

From hour 8, forecast completion from observed work, remaining difficulty, dependencies and remaining release/verification time. Use elapsed time including stops; do not forecast only active coding time. If needed, split ready independent work into up to two authorized overflow workers after a checkpoint/ownership handoff. Update both old and new assignments atomically on the board and their briefs so steps cannot be built twice.

Disable a build worker's recurring schedule when all its assigned primary and continuation work is integrated and its returned repairs/live-failure work is cleared. Do not stop a Claude worker merely because its own primary lane is done while its continuation lane remains. If pausing schedules is unavailable, completed workers exit before install/tests and report that the schedule itself still needs stopping. River can reassign later repairs or re-enable a supported task.

After the build, the standing River continues the authorized repair/release role using a cheap no-change path and normal batching. Completed builders do not keep doing hourly full setup or tests.

## Reporting and closeout

Only River sends progress notifications, configured and verified at launch. Do not assume a final message automatically produces a phone push, or that saying "No change" is silent. Use supported notification settings and suppress routine no-change alerts.

Report meaningful batch, release and exception events in plain English and Arizona time. Name actual owner dependencies first. Include what is live, what failed, what is still awaiting verification and current deadline risk. Do not ask Sean to relay instructions between workers.

Build completion requires every non-parked step implemented and integrated. Release completion requires those steps deployed and their applicable live checks passed. SC-17 remains explicitly parked for D7 and does not block closing the rest. Time-dependent proof stays visibly open without pretending it is finished. Missing screen verification and failed live behavior remain unfinished, with assigned owners.

Send a final status at the deadline even if incomplete. Claim the full requested outcome only when the evidence supports it. List completed scope, proof still accumulating, parked SC-17, and any unfinished/failed scope separately. Do not reduce the goal to the earlier first-push subset.
