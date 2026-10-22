# Returned: cal-01

lane: cal-01
owner: cal-01
writer: the cal-01 lane
check: readback-r81
ready: no step ids unknown
river: cbe5ee1481879e9af0372bb611754e92c3c23a52
at: 2026-10-22T22:05:25Z
state: returned
fix_subject: fix:95a7ecab
fix: River · stream/cal-01 — readback-r81 failed for cal-01: CAL-01 owns the meetings readback now (Sean, 3:00 PM Phoenix). It was first returned to pm-01 (returns/pm-01.md, 18:58 UTC) and moves here: the one child reader-readback:meetings-aggregate (lib/civic-data/reader-repair-protocol.ts, ROUTINE_

## Failure

```
CAL-01 owns the meetings readback now (Sean, 3:00 PM Phoenix). It was first returned to pm-01 (returns/pm-01.md, 18:58 UTC) and moves here: the one child reader-readback:meetings-aggregate (lib/civic-data/reader-repair-protocol.ts, ROUTINE_READER_MEETING_TIMEOUT_MS = 5 minutes for every meeting contract) does not emit a result for most doors, and every missing result is a READER_READBACK_REPAIR_FAILED task failure ("The reader-readback:meetings-aggregate child did not emit one exact result for <contract>"). Release 81 (be812ba) is where it showed worst; release 82 (AG-01 only) does not touch it.

Runner evidence, routine supervisor passes (every ~26 minutes; digest routine-civic-data-supervisor:meanwhile-runner:<start>), task failures / of which READER_READBACK_REPAIR_FAILED / of which RECEIPT_COUNT_INVALID:
- 17:08 and 17:34 UTC, release 79 code (f8e4670): 115 / 59 / 53, then 135 / 59 / 73
- 17:59 UTC, release 80 (094c487): 86 / 59 / 24; 18:25: 122 / 92 / 27
- 18:51 UTC, release 81 (be812ba): 156 / 141 / 12; 19:17: 151 / 148 / 0; 19:43: 162 / 157 / 2
- 20:09 UTC: 10 / 0 / 9; 20:35: 2 / 0 / 1; 21:01: 20 / 0 / 19   (the only passes with no readback failures)
- 21:27 UTC: 195 / 159 / 33; 21:53: 171 / 161 / 7
So the child can finish: three passes in a row it emitted a result for every door, then it stopped again. The digest does not record why the child stopped (exit status, timeout, last error), which is the first thing to add. 100 digests since release 81 show no "Netlify Blobs" error; the meeting-partition child receipts (RCD_MEETING_PARTITION_RECEIPT) are mostly there now, but 1 to 33 per pass are still missing for iCal, Clerk boards and schedule-page doors.

Calendar doors with a new lastSuccessAt since release 81 deployed (18:10 UTC), at 22:03 UTC: NH 29 (19 failures), NJ 2 (4 failures), AZ 0, none anywhere else. Server-wide that is far short of "calendar doors in every state record reads". publish-now-supervisor still ends ROUTINE_CHILD_EXITED (exit 2): 88 times since release 81, "parent-observed durable source summaries=0 GOOD/0 HELD".

What to deliver, in order: (1) the aggregate child writes why it ended into the digest; (2) find what differs between the 20:09 to 21:01 passes (they ran clean) and the passes either side, and fix it; (3) split the meeting contracts across children, or scale the child's budget with the contract count, so a result exists for every door each pass; (4) publish-now reads and records the doors' own successes in AZ and the other states. Send a new READY. To verify after the release: READER_READBACK_REPAIR_FAILED stays at 0 for at least four passes in a row, doors outside NH and NJ get a new lastSuccessAt, and a meeting that changed at the source shows on the live page for the place (not only in cp_doors).

---
Earlier return still open (check fold-conflict, from release 79), kept here so it is not lost:
CAL-01 READY ad877ee19 ships in release 79 without one piece: the dispatch-work.ts reactivation of item 7 and its first test in tests/dispatch-work.test.ts ("a paused place's stopped paid hunt comes back on when it is funded; an owner stop given after the funding still holds"). Everything else in the READY ships: items 1 to 6, RH-01 (item 3), and item 7's pause fix (scripts/freshness-shadow.mts no longer calls deactivateUnfundedHunts while paused; scripts/routine-civic-data-runner.mts publishes Box findings before the pause return; its second test stays).

Why it is out: it contradicts PM-01's acceptance test in tests/assignment-identity.test.ts ("funding a place again turns its stopped hunt back on, and a stopped hunt with no new Send stays stopped", PM-01-7), and both cannot hold in one tree. Same scenario: a paid hunt stopped (PM-01's test stops it with deactivateUnfundedHunts; yours by hand), no owner stop order, the same funded Send applied again. PM-01: it stays stopped (the line `assert.equal(unchanged.marked?.length ?? 0, 0)` and active false). CAL-01 item 7: it turns back on ("stopped while paused (no owner stop): resuming turns it back on"). Only a new Send (a new assignment ref) turns it on under PM-01. With your plan code (a `reactivate` mark for every stopped hunt packet of the funded target) the PM-01 test fails at its first assertion (1 mark, expected 0).

To bring it back: the root cause you fixed (the pause no longer stops hunts) means a hunt stopped while paused only exists from before the fix. Either re-arm those once, by a one-time repair that does not touch the Send-versus-stop rule, or ask Sean which rule holds (a funded stopped hunt re-arms with the same Send, or only with a new one). Then add the reactivation back with both tests passing and send a new READY.

Also in release 79 (small, for your information): lib/facts/source-copy.ts keeps its original upsert (PM-01's `greatest(fetched_at)` bump on a repeat save is reverted, because your test "the same bytes read again keep their one saved copy and move the checked date" requires the copy's fetched date to stay).
```

## Repair

Fix on stream/cal-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
