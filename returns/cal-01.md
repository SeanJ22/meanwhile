# Returned: cal-01

lane: cal-01
owner: cal-01
writer: the cal-01 lane
check: live check: calendar doors deferred by the provider frontier (release 90)
ready: no step ids 723ee4c4bedf11ed051578e5d8b7cadc35719013
river: 171c09b52f070bb95b87297aa621cb6da6029757
at: 2026-10-23T16:21:16Z
state: returned
fix_subject: fix:72c7ddee
fix: River · stream/cal-01 — live check: calendar doors deferred by the provider frontier (release 90) failed for cal-01: FAIL: (3) "doors and readbacks finish inside it ... River's post-release check should see them move (AZ, NH, NJ)". cp_doors (control plane withered-sunset-39821877 / br-tiny-frog-aeufpjeq, read-only, 16:20 UTC): lastSuccessAt since 14:20 UT

## Failure

```
CAL-01-FX shipped in release 90 (main a462d38; runner on a462d38 from the 14:00 UTC hour). Two of its three goals hold on the live runner; calendar doors do not move.

PASS: (1) the routine pass finishes inside its budget (15:00 UTC pass finished 15:28; no ROUTINE CIVIC DATA OUTER SUPERVISOR timeout since); (2) the publish-now cursor moved from 2026-10-13T22:24:35Z to 2026-10-23T16:18:52Z (about two minutes behind live at 16:20 UTC), and publish-now has not timed out since 15:32 UTC.
FAIL: (3) "doors and readbacks finish inside it ... River's post-release check should see them move (AZ, NH, NJ)". cp_doors (control plane withered-sunset-39821877 / br-tiny-frog-aeufpjeq, read-only, 16:20 UTC): lastSuccessAt since 14:20 UTC on 35 of about 5,800 doors: KY 10 of 47, CT 8 of 215, ID 3 of 90, HI 2 of 62, SC 2 of 24, WA 1 of 195, unscoped 9 of 2,720; 0 in CA (1,716), FL (722), TX (704), WI (470), MO (237), CO (228), AZ (224), IL (223), DE (189), MA (188), VA (175), MI (147), NH (145). Latest success: AZ 2026-10-22T17:52:37Z (0 today), NH 2026-10-23T03:47Z, NJ 2026-10-23T02:54Z, FL 2026-10-22T01:36Z, CA and TX none recorded at all; lastAttemptAt is null on every one of these doors.
What the runner says (cp_log_owner_digests, owner-digest): every pass lists "Owner due request door-read-now:meetings:<platform>:... was due but deferred by the provider frontier; the next pass offers it again" (15:41 UTC: WI legistar-insite cog:177216 bodies; 15:57: FL granicus cog:102082; 16:10: CA legistar cog:205980). Due door reads are deferred pass after pass, so meetings in the seven-day window are not checked hourly (rulings §4).
Where: the provider frontier that admits door-read-now work in the routine pass (scripts/routine-civic-data-runner.mts and its door admission), and whatever records lastAttemptAt on cp_doors (null everywhere above).
What passing looks like: on the live runner, doors in the seven-day window read hourly and record lastAttemptAt/lastSuccessAt; within two passes of the fix, AZ, NH, NJ, CA, TX, FL and 10+ other states each show new lastSuccessAt, counts by state; "deferred by the provider frontier" lines fall pass over pass. New READY with both proofs.
```

## Repair

Fix on stream/cal-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
