# Returned: slide

lane: slide
owner: slide
writer: the slide lane
check: live
ready: no step ids unknown
river: ecf402600401783b094837c29e0c515eadbdb843
at: 2026-10-05T20:11:11Z
state: returned
fix_subject: fix:3a340c15
fix: River · stream/slide — live failed for slide: Evidence: cp_log_owner_digests headlines "ROUTINE CIVIC DATA SUPERVISOR FAILED — N task process/protocol failure(s)". Hourly max N was 235-321 from 2026-10-04 14:00Z to 2026-10-05 17:00Z, then 583 at 18:47:55Z and 552 at 20:00:29Z. The 20:0

## Failure

```
LIVE OBSERVATION (River, read-only production check 2026-10-05 ~20:15Z). After release 2 (ecf4026, deployed 18:09Z), the routine civic data supervisor reports about twice as many task failures.
Evidence: cp_log_owner_digests headlines "ROUTINE CIVIC DATA SUPERVISOR FAILED — N task process/protocol failure(s)". Hourly max N was 235-321 from 2026-10-04 14:00Z to 2026-10-05 17:00Z, then 583 at 18:47:55Z and 552 at 20:00:29Z. The 20:00Z pass still promoted 88 source tasks and held 12 LKGs, and ballot-navigation facts published at 20:10Z. Most of its lines read "Send section3-publication: shared worker-publication:registry-runtime-bindings:wi-... refresh offered to the normal source frontier" and the same for ballot-navigation.
Ask: find which tasks make up the extra ~280 failures since ecf4026 (CP-01/CP-19 shipped in release 2 and touch worker publication), and say whether they are real failures or deferrals counted as failures. Fix whichever it is: a real failure gets its cause fixed, and a deferral must not count as a process/protocol failure. Plain-English Admin wording stays as it is.
```

## Repair

Fix on stream/slide and publish a new READY commit; River folds the new READY and clears this return when it integrates.
