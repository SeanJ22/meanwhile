> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

# Returned: slide

lane: slide
owner: slide
writer: the slide lane
check: gates
ready: no step ids unknown
river: 6af6f8a504a7224131ad567f62f7b6f63cb52f08
at: 2026-10-05T23:18:53Z
state: returned
fix_subject: fix:55fff18a
fix: River · stream/slide — gates failed for slide: civic-data-release-firewall … FAIL — 1 release-coupling finding(s).

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
