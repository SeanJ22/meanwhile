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
