# Returned: cal-01

lane: cal-01
owner: cal-01
writer: the cal-01 lane
check: fold-conflict
ready: CAL-01, DB-29, RH-01 ad877ee19578
river: 33139a56cb2a512d670634457da91e011f66d884
at: 2026-10-22T06:58:13Z
state: returned
fix_subject: fix:e4312e1c
fix: River · stream/cal-01 — fold-conflict failed for cal-01: CAL-01 READY ad877ee19 ships in release 79 without one piece: the dispatch-work.ts reactivation of item 7 and its first test in tests/dispatch-work.test.ts ("a paused place's stopped paid hunt comes back on when it is funded; an owner stop

## Failure

```
CAL-01 READY ad877ee19 ships in release 79 without one piece: the dispatch-work.ts reactivation of item 7 and its first test in tests/dispatch-work.test.ts ("a paused place's stopped paid hunt comes back on when it is funded; an owner stop given after the funding still holds"). Everything else in the READY ships: items 1 to 6, RH-01 (item 3), and item 7's pause fix (scripts/freshness-shadow.mts no longer calls deactivateUnfundedHunts while paused; scripts/routine-civic-data-runner.mts publishes Box findings before the pause return; its second test stays).

Why it is out: it contradicts PM-01's acceptance test in tests/assignment-identity.test.ts ("funding a place again turns its stopped hunt back on, and a stopped hunt with no new Send stays stopped", PM-01-7), and both cannot hold in one tree. Same scenario: a paid hunt stopped (PM-01's test stops it with deactivateUnfundedHunts; yours by hand), no owner stop order, the same funded Send applied again. PM-01: it stays stopped (the line `assert.equal(unchanged.marked?.length ?? 0, 0)` and active false). CAL-01 item 7: it turns back on ("stopped while paused (no owner stop): resuming turns it back on"). Only a new Send (a new assignment ref) turns it on under PM-01. With your plan code (a `reactivate` mark for every stopped hunt packet of the funded target) the PM-01 test fails at its first assertion (1 mark, expected 0).

To bring it back: the root cause you fixed (the pause no longer stops hunts) means a hunt stopped while paused only exists from before the fix. Either re-arm those once, by a one-time repair that does not touch the Send-versus-stop rule, or ask Sean which rule holds (a funded stopped hunt re-arms with the same Send, or only with a new one). Then add the reactivation back with both tests passing and send a new READY.

Also in release 79 (small, for your information): lib/facts/source-copy.ts keeps its original upsert (PM-01's `greatest(fetched_at)` bump on a repeat save is reverted, because your test "the same bytes read again keep their one saved copy and move the checked date" requires the copy's fetched date to stay).
```

## Repair

Fix on stream/cal-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
