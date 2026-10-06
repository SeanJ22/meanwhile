> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

# Returned: admin

lane: admin
owner: admin
writer: the admin lane
check: fold
ready: no step ids unknown
river: 005800718335f250a1e93bfc039482f0cd59e467
at: 2026-10-06T02:31:08Z
state: returned
fix_subject: fix:5abe56f2
fix: River · stream/admin — fold failed for admin: Your READY 3d99e4120 (BR-04, BR-07, BR-11, BR-12, BR-13, BR-16, BR-17, BR-18, BR-20, BR-26, BR-27, BR-28, BR-29, BR-35, BR-36, BR-39) was held out of River's 2026-10-06 lanes batch. It is current with river (ae07521) but conflicts in 13 pla

## Failure

```
Your READY 3d99e4120 (BR-04, BR-07, BR-11, BR-12, BR-13, BR-16, BR-17, BR-18, BR-20, BR-26, BR-27, BR-28, BR-29, BR-35, BR-36, BR-39) was held out of River's 2026-10-06 lanes batch. It is current with river (ae07521) but conflicts in 13 places with this batch's measures (BR-32) and auditors (DP-25/26/29/33/34) screens:
app/(admin)/_mw/admin-v6/actions.ts, context.tsx, model.ts (2), queue.ts (3), screen-now.tsx (4), tests/admin-v6-ui/v6-ui.test.tsx (2).

These conflicts are design decisions, not mechanics, so River did not pick a side:
- model.ts ActionKind: your side drops "contain" | "uncontain" | "recheck" | "workfirst" | "fixfirst" | "stopmethod" | "scope-stop" | "stoprepeats" | "fix-go" | "scope-first" | "scope-recheck" | "doc-request" | "use-url" | "reprocess" | "retry-method" | "resume-publish" | "eng-task" | "job-stop" | "focus" | "send-agents" | "cancel-send" | "order-unschedule" | "owed-add" | "owed-decline" | "owed-undo" | "target-set" | "target-clear" | "data-switch-on" | "data-switch-off" | "setting-set" | "setting-undo". River's side uses them on measures' and auditors' screens (Now, Queue, the fix detail, the owed list, targets, data switches, settings).
- actions.ts: your side removes the DEP-ACTION-PLANS, DEP-RESOURCE-EXECUTOR, DEP-ENGINEERING-TASKS, DEP-READER-CHECK and DEP-SAVED-COPY dependency entries, which river's screens reference.
- context.tsx: your side removes the "look" and "work" detail types (registry FE-20/21's look pass and measures' work rows). model.ts: river exports LookView/LookScreenView from lib/frontend/look-pass.ts.
- queue.ts and screen-now.tsx: measures' BR-32 Queue/Now (door numbers, owed list) against your Now and Queue changes.
If a removed kind has no executor, keep it on screen as "not available yet" with its dependency, as river does, rather than deleting it; anything you replace must keep every screen that uses it working. Catch up with `river` after this batch promotes (the trial fold with your conflicts is at stream/salvage-river-next-lanes; your branch merged on it shows each hunk). Keep measures', auditors' and registry's screens, connect your controls to them, re-run `pnpm gates` (it includes the admin UI tests), and mark a new READY.
```

## Repair

Fix on stream/admin and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## River note, 2026-10-06 ~03:50Z

Money page (Sean, 2026-10-06), in addition to the returns above: show (1) no-result spend by role (Sean's rule: no paid worker ends with nothing; River supplies the result-kind data) and (2) batch versus full-price model spend by role. Plain English.

Addendum 2026-10-06 ~04:00Z, no-result spend (Sean's rule): the Money page's Scout-results join (lib/control-plane/admin-view/v6-spend-read.ts:185-238, which prints "No result recorded") becomes "spend with no result, by role", read from CostEntry.endingKind (River is adding it). Until that lands, count a legacy row with no endingKind by its disposition or Scout result, not as nothing: about $25.87 of the 14-day $40.40 is pre-resultKind rows (2026-09-22) that did produce discoveries or ingests. The daily brief Sean approved (rulings §0) has no code yet. Put the same line in the owner digest (cp_log_owner_digests, log_key "owner-digest") as the brief's first home, and say under needs_River if you need River to build the brief itself.

## Priority order, River 2026-10-06 ~04:10Z (Sean: cost tracking ahead of other Admin work)
1. **Money page times in Eastern.** It shows MST; every Admin time is Eastern (EDT now), using lib/control-plane/eastern-time.ts.
2. **BR-31** (ready: BR-23 is integrated and BX-06 ships in release 7): the Scoreboard rows "Facts live per hour" (seven-day trend) and "Cost per fact" (settled spend over facts reaching a reader in the window), plus the Now cards (screen-now.tsx "Facts live per hour", "Cost per fact"), replacing "Counted in a later step".
3. **Cost per hunt** on the Hunts and Money views, from billing attribution's per-hunt spend.
4. **No-result spend by role** and **batch versus full-price spend by role** on the Money page (see the earlier addenda).
Then your fold return (BR-07 on measures' screens) and the rest of your batch.

## Correction, 2026-10-06 ~04:20Z (Sean): no "spend with no result" display
Drop the no-result spend line from the Money page and the digest (the earlier addenda's no-result items are withdrawn). Instead:
1. Money times in Eastern.
2. **BR-31: cost per fact and facts live per hour.** This is the proof of what each dollar bought.
3. Cost per hunt.
4. Batch versus full-price spend.
5. A fix-list hook (fix-list.ts is yours): when a paid ending bought nothing (CostEntry.endingKind NOTHING, from River and hunters), open a fix item at its cause, the way a broken door does.

Correction, Oct 6, 12:07 AM EDT (Sean): **cost per hunt goes in the Money page's existing Hunts table** (spent, set aside, limit per place). Fix that table so its figures are measured; do not build a second one. All Admin times are EDT: no Z, no UTC.

## RETURNED, Oct 6, 1:50 AM EDT (River): READY 734ee9633 overlaps measures' BR-31, now on river-next

River's release-9 fold folded measures' BR-31 (30922c2e1) first. That fold adds:
- the Scoreboard's flow week (`readFlowWeek`);
- Facts live per hour and Cost per fact rows (`flow-rows.ts`);
- operator chat **topic 8 "spendAndFacts"** (`read-models.ts`; `read-context.ts` reads `flow`).

Your READY, which also lists BR-31, adds `readSpendSummary`, a `config`/`spendSummary` context and its own chat topic in the same places. It conflicts in:
- `app/api/admin/v6/scoreboard/route.ts`
- `lib/control-plane/admin-view/scoreboard-read.ts`
- `lib/control-plane/operator-chat/read-context.ts`
- `lib/control-plane/operator-chat/read-models.ts`
- `tests/operator-chat.test.ts` (8 topics versus `CHAT_TOPICS.length`)

River's decision on the "how":
- measures' BR-31 is the one flow/cost record on the Scoreboard and in chat.
- Your spend summary (Set aside, settled spend, per-line money) stays as its own Admin read. Admin's cost tracking is still your first item.
- Build on BR-31's hourly record. Do not keep a second spend topic: extend `spendAndFacts`, or give yours a distinct question.
- The test counts `CHAT_TOPICS.length`.

To fix: merge current river (the release-9 river once promoted, or river-next's tip from board status), reconcile, rerun the affected tests and mark READY again.

**This is now the base for Sean's vital signs on Admin Now** (status.md handoff, "Order after release 8"). Admin Now will show the hourly vital-signs row: facts live, money, cost per fact, Neon bytes the runner read, rounds finished versus killed, and paid jobs ended with nothing. It reads that one row, never raw tables.
