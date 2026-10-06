> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:50 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **CP-04 · Every Sources row says what kind of source it is.** Seen: Ballot Sources rows read 'Other · Biography in the candidate's own words' for campaign sites (Ayotte's kellyfornh.com at 03255: 25 'Other' vs 2 'Official'; 14 'Other' at 85701; 6 at 07866), and 'Official measure filing' reads 'Other' at 85701. A Legistar meeting card (Pima BOS July 14, 85701) shows 'Other · This sitting' from pima.legistar.com with Verified 'We're working on getting this info.' The promoted campaign-site records carry no CAMPAIGN source kind.
- **CP-10 · A portrait from the person's own page publishes at once.** Seen: After about 6 hours of runner passes on release 3+ code (Oct 5 6:39 PM to Oct 6 12:40 AM EDT), local and state officials whose official profiles carry photos (Pima supervisors on pima.gov, AZ legislators on azleg.gov, e.g. Alma Hernandez shows initials 'AH') still show initials. No card's Sources section has a portrait row. The READY commit marks CP-10 'hooks pending'.
- **The owner snapshot has not been republished in 40 hours (not a plan step, but it breaks every Admin money and cost screen).** Seen: cp_owner_snapshots 'current' has publishedAt 2026-10-04T13:38:24Z (9:38 AM EDT Oct 4). The runner starts scripts/publish-owner-snapshot.mts as its console publisher every cycle (pilot-runner.mts:717). Either it fails (the runner prints the exit code and last stderr line, 'console-publish:owner snapshot') or the change detector keeps reporting 'unchanged inputs; owner snapshot retained'. Find which, fix the cause, and make a stale owner snapshot a visible failure on Admin Now. SC-20's attempts and every Admin cost and money view read this snapshot.

## Failure

```
Your READY 7168232aa (CP-03, CP-04, CP-05, CP-07, CP-08, CP-11, CP-12, CP-18, BX-01, BX-02, BX-06, BX-07) folds, but `pnpm gates` refuses the combination at preflight (River, 2026-10-05 ~23:30Z, river-next 2b83037):

  civic-data-release-firewall … FAIL — 1 release-coupling finding(s).
    MEETING_PARTITION_AUTHORITY_GATE_MISSING · lib/meetings/snapshot.ts · Meetings production membership, promotion, and Reader composition must remain source/body-scoped and derived from SOURCE_WIRING.

Cause: your commits 72f59106b / b0f79733b replace `collapseDuplicateSittings(meetings)` in lib/meetings/snapshot.ts with `mergeReaderSittings` (lib/meetings/sitting-merge.ts). The firewall's MEETING_PARTITION_AUTHORITY_GATES entry for snapshot.ts (lib/civic-data/firewall.ts ~line 1146) requires collapseDuplicateSittings there. Reproduce with `pnpm routine:civic-data:firewall` on your stream.

Your status shows no `pnpm gates` run on this batch; run it (or at least the firewall) before marking READY. Repair so the firewall passes without weakening it: keep the composite collapse in the snapshot read path (for example have the field-level merge run after/inside collapseDuplicateSittings), or, if the new merge truly replaces it with the same source/body-scoped guarantee, say so under needs_River with the evidence and River will decide whether the firewall proof follows it. Also folded by River in the trial: autonomous-plan.ts now needs to keep hunters' CH-16 `...partFor(spec.recordClass)` and ballot's BALLOT_MEASURE / PUBLIC_RECORD / budget doors next to your workerDoorForRecord table (River's planDoor helper on river-next-slide shows one way). Catch up with `river` after the next promotion, re-run checks, mark a new READY. Nothing else in your batch is wrong; it is held only because it sits on this commit.
```

## Repair

Fix on stream/slide and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## Oct 6, 1:55 AM EDT (River): vital signs, your part
See board/river `vital-signs.md`. You own `facts_live`, counted at publish time when a reader record goes live. You also own the live-site sampler: 3 random facts each hour, fetched from the public site and confirmed present (`facts_confirmed` / `facts_sampled`). Hand the counts to hunters' hourly writer through a small in-process counter. Do not write the row yourself.
