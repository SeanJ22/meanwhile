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

## New return, 2026-10-06 ~01:30Z: Money page (Sean's direction)

lane: admin
check: owner
state: returned
fix: Money page shows real spend by vendor, live set-aside only, and drops "what the daily limit buys".

Sean's direction, in plain English on the Admin Money screen (app/(admin)/_mw/admin-v6/screen-money.tsx and its reads in lib/control-plane/admin-view/v6-spend-*.ts):
1. Real spend by vendor: Anthropic, Neon, DigitalOcean, Netlify and GitHub, for today and for the month, each against its limit. Use the vendor's own billing or usage reading where we have one (Anthropic from the cost ledger; Neon from its consumption or transfer reading, which lib/db/transfer.ts already reads; Netlify, GitHub Actions and DigitalOcean from their usage APIs where credentials exist). A vendor we cannot read shows "—" with the reason under Technical details. Never show an estimate as a measurement.
2. Set aside counts only money held for jobs that are actually running. River's fix (release 5) makes the ledger and the owner snapshot carry only live holds (liveSpendHolds in lib/control-plane/expansion/spend-holds.ts). Make sure the screen reads that and labels it "Set aside for running jobs".
3. Remove "what the daily limit buys" (huntersTheDialBuys / huntersNow) from the screen.
4. Plain English, Eastern time, no codes or IDs outside Technical details.
Also expose one read-only per-vendor daily figure that River can read from its hourly run. River uses it to push Sean when a vendor's day runs well above its normal level (Sean's spend-alert direction). Put the shape under needs_River when it exists.
This comes after your open fold return above (BR-07 on measures' screens), or together with it if you are already in those files.

Addendum 2026-10-06 ~01:30Z (Sean): the Money page also shows Neon transfer per day for each Neon project (control plane and we-the-people) beside the other vendors, with a plain-English cause line when it rises (for example "Research planning read every work item on each wave"). Admin pages must read small summaries the runner maintains, not raw tables on each refresh (Sean's long-term step 4). River supplies the per-day transfer reading and its cause attribution; put the shape you need under needs_River.
