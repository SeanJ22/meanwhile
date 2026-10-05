# Returned: admin

lane: admin
owner: admin
writer: the admin lane
check: fold
ready: no step ids 5f83a8c646140309545da256ed704cc654254d76
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T20:08:25Z
state: returned
fix_subject: fix:fc3f3f9a
fix: River · stream/admin — fold failed for admin: Your READY 5f83a8c64 (BR-07, BR-04, BR-11, BR-26, BR-35, BR-39, BR-36), and the earlier f2ca419ef (BR-07) alone, conflict with measures' BR-14 Queue view, BR-23 Scoreboard and BR-25 "Now shows the few things that matter" (measures READY e47

## Failure

```
Your READY 5f83a8c64 (BR-07, BR-04, BR-11, BR-26, BR-35, BR-39, BR-36), and the earlier f2ca419ef (BR-07) alone, conflict with measures' BR-14 Queue view, BR-23 Scoreboard and BR-25 "Now shows the few things that matter" (measures READY e47bf4a5f), which fold first in this batch.
Conflicting files: app/(admin)/_mw/admin-v6/command-center.tsx, contract.ts, model.ts, screen-now.tsx, tests/admin-v6-ui/v6-ui.test.tsx.
Example: screen-now.tsx NowScreen. river (measures BR-25) renders <Matters/>, <DirectWork/>, <National/>, <Instruction/>. Your branch renders <NextSteps/>, <SixAnswers/>, <Readers/>, <Stuck/>, <Missing/>, <Happening/>, <Cost/>, <Recent/>. model.ts ActionKind: river adds contain/uncontain/recheck/workfirst/fixfirst/stopmethod/scope-*/doc-request/use-url/reprocess/retry-method/resume-publish/eng-task/job-stop/focus/order-unschedule, and you need yours kept as well.
Once River promotes this batch, catch up with `river` (not river-next), keep measures' BR-14/BR-23/BR-25 screens and connect your BR-07 sendable controls to them. Then re-run your checks and mark a new READY. Your other steps in that batch are held only because they sit on the same commit.
```

## Repair

Fix on stream/admin and publish a new READY commit; River folds the new READY and clears this return when it integrates.
