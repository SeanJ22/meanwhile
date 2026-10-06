# Owner decisions recorded by River

## 2026-10-05 ~16:50Z: data never rebuilds the site

Sean, in the River session (session_012Ufwyxx6iej1CSEX6khMyg), word for word:

> Owner decision: new or changed data must never rebuild the site. Data reaches readers only through the data system. Record this decision on board/river and resolve the deploy-paths trace-sweep exception to match it.

What it settles: the open question in status.md ("should a committed change to a traced `data/` file rebuild the site?"). **No.** All of `data/` stays non-shipping for Netlify, as `lib/ops/deploy-paths.ts` and `tests/hosted-cost-invariant.test.ts` already say. Readers get data only from the data system (the data plane and its reader projections), never from a copy bundled at build time.

How the trace-sweep exception is resolved:
- `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" is **correct as written**, and it now enforces this decision. It is not weakened, and `data/` is not made shipping.
- The 3,330 traced `data/` files are the defect. They are a stale copy that a data-only commit can never refresh. The baseline exception in integration.md (07:34Z, Oct 4) is withdrawn as an exception and reopened as work: about 81 app/lib modules read `data/` at runtime (for example `lib/registry/server.ts`, `lib/geo/zip-division-index.ts`, `lib/coverage/photo-slots.ts`, `lib/meetings/snapshot.ts`, and the JSON imports in `lib/registry/body-membership.ts`, `lib/ballot/measure-records.ts` and `lib/meetings/notice-summary.ts`). Each moves to a data-system read with no traced file, lane by lane, owner recorded in hooks.md. The sweep goes green when the last one moves.
- Until then CI keeps running without `.next`, as it does now, so this test skips with its named reason in CI and fails locally after a build. River reports it as open, never as passing.
- This is the owner's own rule. It does not change docs/rulings.md on main; adding it there is Sean's call.

## 2026-10-05 ~17:40Z: builders bring questions to River, not Sean

Sean, in a River session (session_01KbZarGhrBfffhSMzZ3Si4t), word for word:

> Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file.

Scope: every builder lane, every provider. River answers every "how" choice itself. Only credentials, new paid services, spending beyond the budget and D7 go to Sean. Every `returns/<lane>.md` now says this. Workers put questions under `needs_River:`.

## 2026-10-05 ~17:40Z: CH-24 and CH-26 go ahead

Sean, same session, word for word:

> Answer hunters: CH-24, go ahead. Extract the shared spending-guard module behind a runner switch, keep the old path as the default until it's checked live, and prove in tests that the guards behave identically. Check it live after the next release. CH-26, go ahead with the lineage-keyed index. You number the migration.

River's engineering choice (not Sean's decision): CH-26 takes control-plane schema version 20. Details are in returns/hunters.md.

## 2026-10-05 ~21:00Z — Sean: River's notifications (in the River session)

Sean's words: "Each time river moves forward to a new tested batch, send me one push notification. Say in one line which Codex lanes (admin, slide, ballot, bank, frontend) now have ready work or a new return, so I can send those Codex tasks "Continue." Send nothing else to me unless it is a release or a real decision I have to make."

How River applies it, every run:
- After each `river promote` (river fast-forwards to a tested batch), send exactly one push notification. Its one line names the Codex lanes that now have something to do: a new or open return in `returns/<lane>.md` addressed since the last notification, or a newly integrated batch to catch up on and continue from. Example: "River moved to <sha>: Codex Continue → admin (return), slide (return), ballot, bank, frontend." If none, say "no Codex lane needs Continue."
- The only other notifications are a release (PR opened, merged or failed live) and a real owner decision. No status, no-change or progress pushes.
- This replaces the per-event reporting in the river brief for Sean's phone. Board status files still record everything.

## 2026-10-06 ~01:20Z: Sean, spend holds, Neon transfer, research and spend alerts (River session)

Sean's directions, in his message to River:
- **Leaked spend holds:** build and ship the fix (release 5, or in the urgent release if that would not hold it back). Sean approved a one-time cleanup of unsettled holds older than 2 hours. **Done 2026-10-06 ~00:42Z:** snapshot branch `snapshot-before-spendhold-cleanup-20261006` (br-still-dew-aeeyy53o, parent LSN D/609B33F8) on meanwhile-control-plane. Before: 19,749 holds, 16,901 unsettled, 16,463 of them older than 2 h ($683.49), row 38.4 MB as text, revision 29995. After: 3,288 holds, 440 unsettled (all under 2 h), row 7.8 MB, revision 29998. One atomic UPDATE bumped the revision, so the runner's compare-and-set retried on top of it.
- **Neon transfer:** keep the ledger row small; scope the heavy reads of cp_attempts, cp_work_items and cp_log_artifacts.
- **Research crash:** ship the stall probe and memory-wait fix in release 4; hunters bounds the side lanes and campaign-publication-cycle.ts:56.
- **CH-24 part 2:** research runs continuously, without timed rounds. River chose Proposal A (returns/hunters.md).
- **Money page:** returned to admin (returns/admin.md).
- **Spend alerts:** Sean should not have to find spikes. Push him when any vendor's daily spend runs well above its normal level, naming the vendor and the likely cause. How River applies it: no product channel can reach Sean's phone, so River checks on every hourly run and uses its own push. It compares Anthropic (cp_log_costs) and Neon transfer (the project's data-transfer reading) per day against the median of the previous 7 days. It pushes once per vendor per day when today's pace is at least 2x that median and at least $5 or 50 GB above it. Other vendors are added when admin's per-vendor read exists. These alerts are added to the notification rule above.
- **Verify live:** Money "Left today" above $0, Anthropic spend resumes, a research cycle completes, and Neon transfer per hour drops sharply.

## 2026-10-06 ~01:15Z: Sean stopped the runner; restart only on a release with both fixes

Sean stopped the production runner at 00:51Z (systemctl stop) because Neon transfer cost about $2.50 an hour. With it stopped the control plane shows no traffic, so the runner is the whole Neon bill. He also cleaned the ledger at 00:50Z in the Neon SQL editor: 19,747 holds became 3,727, the row went from 38 MB to 8.5 MB, and unsettled holds are now $36. His snapshot branch is before-hold-cleanup-2026-10-06T0041Z. River's own cleanup at ~00:42Z (snapshot snapshot-before-spendhold-cleanup-20261006) ran first; the two do not conflict.
- The runner stays off until a release carries (1) the hold-leak fix and (2) scoped reads on the hot paths: CH-26's scoped task reads on, plus worker-completion.ts:95 and the other full-table list() calls on per-job paths. That is release 5.
- When it is deployed, River gives Sean the exact restart command and any env lines. After the restart, River measures Neon transfer for one hour. Target: under 0.7 GB an hour. If it is above that, River says what is still reading and asks Sean to stop the runner again.

## 2026-10-06 ~01:30Z: Sean's long-term database direction

Sean, word for word in substance: the runner's database traffic must fit easily inside Neon's included 500 GB a month per project, with a target under 1 GB a day. His Neon budget is compute only, about $40-60 a month. Build in this order after the urgent hold-leak and scoped-read release:
1. Scoped reads on every hot path: no full-table list() on any per-job, per-cycle or Admin-refresh path. The database filters; the runner never downloads a table to find a few rows.
2. Split the giant single-row records into real tables, one row per item: the spend ledger (holds), the research state, the prepared meeting snapshot and owner snapshots. Settled holds are cleared or moved out, never accumulated.
3. Runner-side cache with incremental reads: working tables held in memory, fetching only rows changed since the last read (updated_at or revision greater than the last seen).
4. Admin reads small precomputed summaries the runner maintains, not raw tables on each refresh.
5. The same audit on the we-the-people data project (119 GB this month so far, on pace to exceed its 500 GB).
Report Neon transfer per day on Admin's Money page beside the other vendors, with plain-English cause lines when it rises.

How River carries it (engineering choices): River owns the repository layer and schema (shared-file table), so River builds 1 (repository-level scoped reads and the per-call-site moves), 2 (new tables with step-named migrations) and 3, and runs 5. Admin builds 4's screens and the Money page's Neon-per-day line (added to returns/admin.md). Known remaining hot reads after release 5:
- The research planner's selection (lib/control-plane/workers/coordinator.ts ~491-518) lists work items, Attempts, route tasks, Scout and worker results, occurrences and every artifact on each worker wave.
- The unscoped runtime in standing-runtime.ts 75-130.
- admin-data.ts:299 readFleetInputs on each Admin live refresh.
- publish-owner-snapshot.mts (costs.readAll, attempts listNarrowed).
- routine-civic-data-runner.mts:411.
- readPlaceWorkItems and readPlaceArtifacts miss their indexes.
- cp_attempts has no routeTaskId index, so coordinator.ts:448 and model-batch.ts:191/197 do full scans.

## 2026-10-06 ~03:35Z: Sean, no paid worker ends with nothing

Sean's rule, in substance: no worker (Scout, Detective, any paid role) spends money and ends with nothing. Every paid job ends with a result: a finding, an ingest, a source shown blocked or unpublished with what was tried, or a lesson saved for the next worker.

His evidence: over the last 14 days, $40.40 of $85.35 recorded worker spend ended with nothing.
- 94 Scout jobs had no result recorded at all ($35.09), and 31 of them had zero output tokens.
- The rest ended with no disposition, refused, or needs-adapter.
- One zero-output Scout ran on release 6 at 11:22 PM EDT (2026-10-06 03:22Z).
- Spend from killed research rounds never reached cp_log_costs at all.

Direction: fix the causes, not a cap.
- Find why Scouts end with no result, and why some return zero output after paying for input, and fix it at the source.
- Give every paid ending a result kind, and save what was learned.
- Show no-result spend by role on Admin's Money page and in the daily brief, so it cannot hide.

How River carries it: River investigates the causes from production records (read-only) and routes each fix to its owning lane; River builds the shared parts. Recorded in returns as the work lands.

## 2026-10-06 ~03:50Z: Sean, unattended paid work goes through the Batch API

Sean's direction: in the last 30 days, Scout and Detective spend was $209, all at full price, with zero batch requests. Batches are half price, stack with caching, and usually finish within an hour. Route every paid job where nobody is waiting through batches: hunting, plain-English summaries, audits. Keep Ask and Sean's direct orders on the normal path.

River's findings (code, 2026-10-06):
- model-batch.ts registers only two lanes, background-worker-parse and background-worker-audit (lease-worker PARSER and ADVERSARIAL_AUDITOR, on by default). Those workers have done almost nothing: 83 results ever, the last on Oct 4.
- Scout, Detective, translation and live-audit transports never call model-batch.ts.
- Every Scout and Detective tool runs on our side: read_permission, fetch_public, browse (Playwright), search (our Brave/Exa), read_held, read_inherited, find_manual, read_manual. No Anthropic server-side tools are used. A 17-step job is 17 dependent requests, not one batch request.
- Anthropic's server-side web_fetch/web_search would bypass our robots and permission checks, exact-bytes evidence vaulting (§3), Playwright and held evidence, so it is not used for acquisition.

Design (engineering choice): batch per step.
- A shared step batcher (River, model-batch.ts) collects pending steps from all unattended jobs, submits a batch on a timer, routes results back by custom_id, records the attempt's provider batch, and keeps the request journal so a restart resumes.
- Jobs pause between steps; a paused job's conversation is saved.
- Owners:
  - Scout through the batcher in the CH-24 Proposal A standing lane: hunters.
  - Detective and the live-audit sampler: auditors.
  - Plain-English summaries: ballot.
  - Money page batch versus full-price spend by role: admin.
- Kept on Messages: Ask (lib/ask, app/api/ask) and anything a person waits on, including Sean's direct Admin orders.

## 2026-10-06 ~04:10Z: Sean amends the batch plan; cost metrics first; Admin in Eastern time

- **Batch now, single-request work only:** plain-English summaries (ballot, CA-25) and audit and re-verification samples (auditors' live-audit sampler and model audit samples; BX-13's audit-sample route). **Hold per-step batching of Scouts and Detectives.** It turns a minutes-long hunt into hours, and Sean wants hunts fast, as long as they are promoted rapidly and readers see them. Before building it, River shows the per-step speed versus cost trade, from measured batch turnaround (the single-request batches give real latency) and recorded Scout and Detective step counts, durations and prices.
- **Cost tracking ahead of other Admin work.** These must be measured, not "—":
  - cost per hunt;
  - cost per fact reaching a reader;
  - facts live per hour;
  - no-result spend by role;
  - batch versus full-price spend.
  
  Owners:
  - Facts live per hour and cost per fact: **BR-31 (admin)**, on BX-06's flow counts (slide, in release 7) and BR-23 (integrated). Its dependencies are met, so it is ready now.
  - Cost per hunt: **admin**, as part of BR-31. Billing attribution already carries per-hunt Anthropic and other spend; show it per hunt.
  - No-result spend by role: **admin** on the Money page, from CostEntry.endingKind (**River** adds the field; **hunters** sets it at dispatch).
  - Batch versus full-price: **admin** on the Money page, from each cost row's batch flag; BX-13's done-when.
- **Admin in Eastern time:** the Money page shows MST. Every Admin time is Eastern (EDT now). Admin fixes it first.

## 2026-10-06 ~04:20Z: Sean, paid work is designed so it cannot end with nothing (REPLACES the no-result tracking lines above)

Sean, in substance: no "spend with no result" tracking on the Money page or in the digest. He doesn't want to watch waste; he wants it designed out. Build it so a paid job cannot end with nothing:
1. **Before any paid job dispatches**, skip anything already held, anything already being worked, a known dead end whose unlock hasn't changed, and a failed route being repeated with nothing new.
2. **Every route candidate a Scout produces goes straight to a builder** and ends as a working door or a recorded dead end. A lead that sits unfollowed is a defect.
3. **Every paid ending writes what it tried and learned into the field manual**, so the next worker starts ahead. A "no progress" ending is a bug: find the stall and fix the cause.
4. **A killed round saves whatever its jobs found before the kill.**
The proof is **cost per fact** in Admin: what each dollar bought. Any dollar that bought nothing is raised and fixed at its cause, like a broken door.

This replaces:
- the 03:35Z rule's "show no-result spend by role on Admin's Money page and in the daily brief";
- the 04:10Z "no-result spend by role" Money item.

The rest of 03:35Z (every paid ending has a result; fix causes, not a cap) stands, and is now enforced by design. How River carries it (engineering choices):
- CostEntry.endingKind stays, as the internal signal, not a display. An ending that bought nothing opens a fix item at its cause (the existing fix list), the way a broken door does.
- Owners: 1, 2 and 4 hunters (dispatch admission, route-candidate to builder, saving found work before a kill); 3 hunters with bank (field-manual lessons); the fix-item hook admin (fix-list.ts owner); the cost-on-throw, lease-expiry and kill repository side River.
- Cost per fact (BR-31, admin) stays first in Admin's order.

## Oct 6, 12:07 AM EDT: Sean, all times in EDT

Every time given to Sean, written on the board, or shown in Admin is in Eastern time (EDT now), with no Z and no UTC. This applies to status.md, returns, decisions, release notes, notifications and every Admin screen. Machine fields (JSON records, commit metadata) keep their ISO timestamps; what a person reads is Eastern.

## Oct 6, 12:07 AM EDT: Sean, the stall probe confirms the research crash's second cause

Release 6's first research cycle was killed at 12:01 AM EDT after 43 minutes. The stall probe reported "pending: campaign-sites; last phase: occurrence-and-debt-commit". Every killed round also kills its running Scouts (two tonight, mid-work), so this is money spent for nothing until it is fixed. It is now hunters' top item (returns/hunters.md). Cost per hunt: fix the Money page's existing Hunts table (spent, set aside, limit per place); do not build a second one.

## Oct 6, 12:14 AM EDT: Sean, one lane must never crash another

Tonight the campaign-sites lane stalled and the watchdog killed the whole research round, including two healthy Scouts mid-work. That is the design, not a bug: every lane shares one process, one heartbeat and one kill. Sean's direction:
- Each job and lane runs and saves independently.
- A stuck one is ended alone, with its state recorded for hunters.
- Nothing waits on the slowest lane to finish.
- Put CH-24 Proposal A (continuous research, no timed rounds) on that basis, and move it ahead of the other hunters work, right after bounding campaign-sites.

Constraints:
- Build within the droplet's current memory at the 0.75 GiB margin (WORKER_MEMORY_HEADROOM_MIB = 768, lib/control-plane/workers/worker-slots.ts).
- Keep one long-lived parent holding release 6's shared incremental read cache, so jobs never re-read tables on their own.
- Isolate jobs inside it with their own deadlines and progress. Use a separate process only where a job can freeze the whole program (synchronous or CPU-bound work, Playwright).
- Report how many jobs fit at the margin, and what more memory would buy.
- Measure Neon transfer before and after.

Owner: hunters. Order:
1. Bound campaign-sites (top item).
2. Lane and job isolation in one long-lived parent, as the basis for CH-24 Proposal A.
3. The rest.

River measures Neon transfer before and after, and computes the fit at the margin from the host memory hunters records (the heartbeat does not carry it today) and the measured peaks in worker-slots.ts (research parent 2,928 MiB, Scout 248, lease worker 342, route 285, national 1,258).

## Oct 6, about 1:20 AM EDT: Sean's mission, release 8, the permanent fix and the new release gate

Sean, live in River session session_01GomLhSQqS2qk8vHjjkBzbT (a scheduled River run; the board lock was then held by session_01VxkjQwRW6tEj8XDPVSGkKU), word for word:

> THE MISSION. Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Work forward from today at the same time and meet in the middle. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass. Targets: control-plane Neon under 0.7 GB an hour, no paid job ending with nothing, cost per fact measured and falling.
>
> FIRST, BEFORE ANYTHING ELSE. Your session is near the end of its context. Record this whole message in decisions.md, then write a complete handoff in status.md so the next scheduled River run can carry on without this conversation: release 8's state, what's folded, what's pending, every open return, and this plan.
>
> WHAT HAPPENED. Seven releases each passed about 9,500 tests while the running system failed: research rounds have died since Oct 3, Neon reached $150 this month, paid Scouts were killed mid-work. Release 6's first hour (11:23 PM to 12:29 AM EDT) moved 7.8 GB, ten times target, about 5.5 GB of it ledger reads. The runner is now stopped. Keep it stopped until release 8 is live; its one-time ledger move needs it off.
>
> RELEASE 8. Ship it when gates pass. Then send me the restart steps. Its first hour is measured by hand (Neon project totals and the holds table) until the vital signs exist.
> Campaign-sites: a time limit with a named deferral is a stop line, not a fix. Tell me whether the cause, the unbounded read at campaign-publication-cycle.ts:56 and the missing deadline inside the lane, is fixed. If not, hunters fixes the cause next, so campaign-sites work actually finishes instead of being deferred every round.
>
> THE PERMANENT FIX.
> 1. Vital signs every hour. The runner writes one small row per hour: facts that reached readers (counted when published, with a random few confirmed on the live site), money spent, cost per fact, Neon bytes the runner itself read (counted per query and tagged with the calling code), rounds finished versus killed, and paid jobs that ended without a result (must be zero). Neon's project total is the cross-check against my bill. Admin's Now screen and the daily brief show this row, built without reading raw tables.
> 2. New gate, approved by me. A release is done only after an hour on the droplet with vital signs at or better than before and inside my targets. Clearly worse means it rolls back (DB-47) and returns to its lane with the numbers. Before anything rolls back, show me how "clearly worse" is decided, using real hours.
> 3. Every change that adds database reads states its estimated Neon cost before it ships. The measured hour checks it.
> 4. Name one owner for the running system, measured on facts delivered per dollar, separate from merging code.
> 5. The runtime core is one rebuild, finished when an hour on the droplet shows hunts completing and transfer under 0.7 GB: the ledger split (release 8); the research-state split; the Bank split (cp_field_manual is one 6.6 MB record rewritten on every write; DB-39 splits now, no "only if writes fail" trigger); one lane never killing another (CH-24 Proposal A on the isolation basis already recorded); and scoped reads everywhere.
> Order after release 8: the campaign-sites cause, then the vital signs, then the rest of the core.
>
> EVERY LANE. Put the mission block at the top of every returns file, so every Claude and Codex worker reads it first and works backward from the finish line for its own part.
>
> OVERNIGHT. Keep working without me. If a Codex lane stops with unfinished work, hand it to its paired Claude worker per assignments.md and back to Codex when I'm up. Only credentials, new spending or D7 wait for me. Push me releases and promotions with the Codex Continue line, and record each push in status.md. All times in EDT. Morning summary: what's built, what's live, what's blocked, and release 8's first measured hour if it's run.

What it settles (River's reading, not new policy):
- **Mission and targets:** control-plane Neon under 0.7 GB an hour; no paid job ends with nothing; cost per fact measured and falling. Work is done when the live vital signs show it, not when tests pass.
- **New release gate (Sean approved it himself, so §0's no-new-gates rule is satisfied):** a release is done only after one hour on the droplet with vital signs at or better than the previous hour and inside the targets. Clearly worse means rollback through DB-47 and a return to the lane with the numbers. **No rollback happens until Sean has seen how "clearly worse" is decided, shown on real hours.**
- **Read-cost statement:** every change that adds database reads states its estimated Neon cost before it ships (in its READY status and the release PR). The measured hour checks it.
- **Runtime owner:** one named owner for the running system, judged on facts delivered per dollar, separate from merging code. River's proposal is in status.md. The owner is not settled until it is named there.
- **Runner:** stays stopped until release 8 is live. The one-time ledger move needs it off.
- **Order after release 8:** (1) the campaign-sites cause; (2) hourly vital signs; (3) the rest of the runtime core: research-state split, Bank split (DB-39 now, unconditionally), CH-24 Proposal A on the isolation basis, scoped reads everywhere.
- **Overnight:** a stopped Codex lane goes to its paired Claude worker (assignments.md) and back to Codex when Sean is up. Every push to Sean is recorded in status.md. All times are EDT.

## Oct 6, about 1:45 AM EDT: overnight plan, the runner restart, and the live ledger

Sean, live in River session session_01GomLhSQqS2qk8vHjjkBzbT, word for word:

> Overnight plan. My oversight session will start the runner once release 8 is merged and its after-deploy check passes. It checks the runner's settings file first, then measures each hour. It stops the runner if control-plane transfer is above 1.5 GB in a full hour or climbing hour over hour, or if AI money is being spent and nothing reaches the site for a full hour. AI spend has no cap while facts are being found and published. You don't need to wait for me to restart it. Measure the hour yourself too, so the two readings cross-check.
>
> Then check every integrated step live, releases 1 through 8 (about 260 steps), against its "Done when" line in the plan. Integrated is not done. A step is done only when it's working live.
> 1. Give every step one verdict: Working live; Failed live (what you saw); Needs time (what will show it and when, in EDT); or Can't check (exactly what's needed). Keep them in one table on the board, releases/live-ledger.md, and update it as verdicts change.
> 2. Order: what readers see first (reader pages, Ask, maps, cards), then the factory pieces behind the vital signs (hunts finishing, publishing, cost per fact), then Admin.
> 3. Every Failed live step goes back to its lane as that lane's top item, with what you saw.
> 4. Every Admin check that needs my sign-in goes in releases/admin-checks.md: the screen, what to look for, and the step it proves. My oversight session works through them in my Chrome overnight and gives me the verdicts in the morning.
> 5. From now on, every release's steps are checked live during its measured hour, and the release isn't done until they are.
>
> Record this in decisions.md and in the "Next River run" list in status.md, so every River run carries it. Morning summary in EDT: release 8's first measured hour, how many steps are Working live, and what failed.

What it settles:
- **Runner:** Sean's oversight session starts and stops it. Its stop lines are: over 1.5 GB of control-plane transfer in a full hour; transfer climbing hour over hour; or AI money spent with nothing reaching the site for a full hour. River does not wait for Sean. River measures each hour independently, as a cross-check, in releases/<n>-live.md.
- **AI spend:** no cap while facts are being found and published.
- **Done means working live.** Integrated is not done. Every integrated step, releases 1 to 8, gets exactly one verdict in releases/live-ledger.md: Working live; Failed live (what was seen); Needs time (what will show it and when, in EDT); or Can't check (exactly what is needed). Order: reader-facing first, then the factory behind the vital signs, then Admin.
- **Failed live** goes back to its lane as that lane's top item, with what was seen.
- **Admin checks that need Sean's sign-in** go in releases/admin-checks.md (the screen, what to look for, the step). Sean's oversight session runs them in his Chrome.
- **Standing rule from release 9 on:** a release's steps are checked live during its measured hour, and the release is not done until they are.
