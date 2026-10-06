> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:50 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **DP-13 · Auditors re-read live facts after they publish.** Seen: cp_log_live_audits holds 0 rows ever. It stores audit RESULT, SPEED, TASKS, LOOK and CLAIMS passes. At a5fd753 nothing calls scripts/live-audit-pass.mts, resident-tasks.mts or look-pass.mts: they are not in the runner's child list (scripts/pilot-runner.mts), deploy/runner or .github. So Admin has no audited facts to show ('No published fact has been audited this week').
- **DP-16 · Auditors look harder where it matters.** Seen: cp_log_live_audits holds 0 rows ever. It stores audit RESULT, SPEED, TASKS, LOOK and CLAIMS passes. At a5fd753 nothing calls scripts/live-audit-pass.mts, resident-tasks.mts or look-pass.mts: they are not in the runner's child list (scripts/pilot-runner.mts), deploy/runner or .github. With no sample, the audit card has nothing to split by reason.
- **DP-17 · The audit policy is a setting.** Seen: cp_log_live_audits holds 0 rows ever. It stores audit RESULT, SPEED, TASKS, LOOK and CLAIMS passes. At a5fd753 nothing calls scripts/live-audit-pass.mts, resident-tasks.mts or look-pass.mts: they are not in the runner's child list (scripts/pilot-runner.mts), deploy/runner or .github. No audit pass runs, so a ratio change ('How the live audit samples published facts') cannot change a next pass's sample size.
- **FE-18 · Resident tasks run on the live site.** Seen: cp_log_live_audits holds 0 rows ever. It stores audit RESULT, SPEED, TASKS, LOOK and CLAIMS passes. At a5fd753 nothing calls scripts/live-audit-pass.mts, resident-tasks.mts or look-pass.mts: they are not in the runner's child list (scripts/pilot-runner.mts), deploy/runner or .github. No resident-task pass (TASKS rows) has ever been recorded, so Admin has no screenshot strip or per-task pass or fail at any ZIP.
- **DP-18 · Audit accuracy on the Scoreboard.** Seen: cp_log_live_audits has 0 rows ever, so the Audit accuracy row can only show "—". The audit pass (scripts/live-audit-pass.mts) says the runner starts it every cycle, but scripts/pilot-runner.mts at a5fd753 never starts it; its only console publisher is the owner snapshot. Not seen on screen: Admin needs sign-in.
- **DP-33 · Auditors check the team's own claims.** Seen: No claim-audit pass has ever been recorded: cp_log_live_audits has 0 rows. scripts/claim-audit-pass.mts is not started by the pilot runner or any workflow at a5fd753, so the Report accuracy row can only say "No weekly check of the team's claimed wins in the last two weeks." The controlled false-claim test has not been run.
- **DP-14 · Red flags are fixed or pulled at once, and the lesson is kept.** Seen: The live auditor has never recorded a result: the control-plane table cp_log_live_audits has 0 rows. scripts/live-audit-pass.mts says "the runner starts it as a child each cycle", but nothing in a5fd753 starts it. pilot-runner.mts's CONSOLE_PUBLISHERS lists only the owner snapshot, and no other script refers to it. So no red flag can be found, fixed or pulled, and the Bank cannot show a lesson from one.
- **DP-15 · A pulled fact really leaves the published version.** Seen: No audit pull has ever been recorded (cp_log_live_audits has 0 rows, including no PULL rows), because the live-audit pass is never started (see DP-14). Pulls are also off by default: WTP_LIVE_AUDIT_PULLS is unset, so a red flag goes to the fix list without being pulled. A pulled fact cannot leave the reader page.
- **FE-02 · Worst-case speed is measured on production, phone and desktop.** Seen: Admin's speed row has no data to show: cp_log_live_audits has 0 rows, so no SPEED pass has ever been recorded. scripts/worst-case-speed-pass.mts is not started by the runner or by anything else in a5fd753. My own first loads were usable: ballot pages loaded in about 3 s and the Ask answer at 85701 took 3.4 s on the server (totalMs 3364), but that is not the Admin row the Done-when line names.
- **FE-17 · Resident tasks written as data.** Seen: The file data/health/resident-tasks.json exists at a5fd753, but FE-18 has never run it on the live site: there are 0 TASKS rows in cp_log_live_audits. scripts/resident-tasks.mts is not started by the runner or by anything else in a5fd753.

## Failure

```
Update (River, after 20:00Z): your newer READY e1e995fd6 merged river-next 92fda9c, which was an untested combination and not river. It carries people's CA-01 (71a308afe), which River held out after gates failed (see returns/people.md). So e1e995fd6 cannot fold until CA-01 is repaired and integrated. Catch up only from `river`. The pg-schema v21 and freshness-shadow shut-threshold notes in the entry above still apply. Hold your batch until River's next promotion, then catch up with river and mark a new READY on top of it.
```

## Repair

Fix on stream/auditors and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## River note, 2026-10-06 ~03:50Z

Batch API (Sean, 2026-10-06): the Detective and the live-audit model sampler send their steps through River's shared step batcher (model-batch.ts, coming from River) when no person is waiting. Ask and Sean's direct orders stay on Messages.

Update 2026-10-06 ~04:10Z (Sean): batch the single-request work now: the live-audit and re-verification samples (model audit samples). **Hold the Detective's per-step batching.**
