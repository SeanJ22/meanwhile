# Returned: cal-01

lane: cal-01
owner: cal-01
writer: the cal-01 lane
check: runner-r86
ready: no step ids unknown
river: 2bd4e5e18eb86c078c76b43e412ce04ce481f19c
at: 2026-10-23T05:45:02Z
state: answered: stream/cal-01-fx READY 723ee4c4b (pass deadline for state-pointer retirement; publish-now scan in one-hour slices); folds next (Oct 23, 7:35 AM EDT)
fix_subject: fix:ffcc9097
fix: River · stream/cal-01 — runner-r86 failed for cal-01: Worked: the Box is building again. cp_box_findings built 6,217 (stalled since release 82) to 6,911, +287 since 05:13. No Netlify Blobs error (0 of 14 digests). The publish-now passes no longer exit 2 wholesale; each now ends with one failur

## Failure

```
CAL-01 CAL-02 (e41945169) is in release 86 (main 9f84aec, served from 04:50 UTC, runner on it from 05:13 UTC). Server checks at 05:50 UTC, one runner pass in:

Worked: the Box is building again. cp_box_findings built 6,217 (stalled since release 82) to 6,911, +287 since 05:13. No Netlify Blobs error (0 of 14 digests). The publish-now passes no longer exit 2 wholesale; each now ends with one failure.

Did not work, three things:
1. The first routine pass on 9f84aec (digest routine-civic-data-supervisor:meanwhile-runner:2026-10-23T05:13:37.256Z) ended ROUTINE CIVIC DATA OUTER SUPERVISOR FAILED, ROUTINE_CHILD_TIMED_OUT at 05:43:37, exactly 30 minutes after it started: "PASS_TIME_BUDGET: routine-civic-data reached its lane deadline; its unfinished work stays owed to the next pass", 4 GOOD and 6 HELD source summaries, 0 Reader references, 0 task receipts. This error code appeared on no earlier release (0 of 10, 18, 114, 111 and 26 digests on f8e4670, 094c487, be812ba, f44f9a1 and 107c99a); the passes before it ended in 25 minutes with 86 to 240 task failures. So CAL-02's pass does more and now runs out its time budget before the readback and the doors.
2. Calendar doors: no door has a new lastSuccessAt since 05:13 UTC in any state (AZ 0, NH 0, NJ 0, none elsewhere); NH and NJ had been recording reads on earlier releases. A planning round line: none yet (0). The point of CAL-02 was nationwide calendar reads.
3. publish-now (every ~4 minutes): each pass ends 'ROUTINE CIVIC DATA SUPERVISOR FAILED, 1 task failure': hunt-source-admission HUNT_SCOPE_UNREAD, NeonDbError, NEON_REQUEST_DEADLINE read=cp_work_items_history timer=standing-neon-request-deadline deadlineMs=30000 phase=headers elapsedMs=30000. A read of cp_work_items_history is taking the full 30 seconds, so hunt admission reads no scope and nothing is admitted.

To clear: (1) keep the routine pass inside its 30-minute budget, or finish the doors and readback first and let the long tails go; make sure the ones the pass owes for calendars are reached before the budget ends; (2) make the cp_work_items_history read in hunt-source-admission cheap (index or a narrower query) so it finishes well inside 30 seconds; (3) show on the next READY that doors outside NH and NJ record a new lastSuccessAt within one runner pass. Verify after the release: lastSuccessAt moves in AZ, NH, NJ and one other state; no ROUTINE_CHILD_TIMED_OUT; no NEON_REQUEST_DEADLINE; the meetings readback failure count (it was 195 of 211 failures on 107c99a) stays at or near 0.
```

## Repair

Fix on stream/cal-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
