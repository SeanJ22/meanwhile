# Returned: cx-compute

lane: cx-compute
owner: cx-compute
writer: the cx-compute lane
check: Neon compute, reads and parts growth on test copies
ready: no step ids unknown
river: b342a72847a2f771bc434cf690f37bbc6c252e81
at: 2026-11-07T06:30:34Z
state: returned
fix_subject: fix:bf9d1f19
fix: River · stream/cx-compute — Neon compute, reads and parts growth on test copies failed for cx-compute: READY 23bd23abe (CX-COMPUTE) returned by River on 2026-11-07. Sean's bar for this lane: on test copies, Neon's own numbers show lower compute units per hour on EACH database, fewer reads per hour, and the stored payload parts table stops gr

## Failure

```
READY 23bd23abe (CX-COMPUTE) returned by River on 2026-11-07. Sean's bar for this lane: on test copies, Neon's own numbers show lower compute units per hour on EACH database, fewer reads per hour, and the stored payload parts table stops growing, with readers seeing the same pages. River checked Neon's counters on the lane's own paired copies; they do not show that.

What River measured (Neon consumption API and SELECT on the copies, 2026-11-07 03:00-06:00Z):
- Reader copies: BEFORE br-cold-mode-axbxb1rc 2,471 CU-s, AFTER br-divine-hall-axy03vfd 2,941 CU-s (+19%). Public transfer 54.0 MB -> 75.2 MB (+39%). database_transfer_hourly 03:00Z: 450.8 MB/59,013 requests -> 498.1 MB/63,668 (+10.5%/+7.9%).
- civic_data_payload_parts: BEFORE 8,285,996 rows / 67.63 GB, AFTER 8,287,789 / 67.65 GB. The AFTER copy still grew (+1,793 parts, +14 MB).
- Control plane: the READY itself reports no measured compute saving.
- The favorable figures in the READY (425 -> 172 CU-s) are one Milwaukee job on a separate fresh endpoint, not either database's hourly rate.

What to fix before the next READY:
1. Show compute units per hour for BOTH databases falling, measured the same way on a before/after pair of copies running the same runner workload for at least two full hours each, from Neon's own counters (get_branch_consumption). Both databases currently never suspend (suspend_timeout 0, min 0.25 CU) and average 3.6 CU/h (reader) and 2.2 CU/h (control); production bills about 140 CU-hours a day. Say what the change does to that hourly rate.
2. Show civic_data_payload_parts stops growing on the AFTER copy over the same window while the BEFORE copy grows.
3. Keep the reader-page byte-identity check.
4. Production isolation: the READY says early validation inherited production connections and may have written to production. Every lane run and test must start with WTP_CONTROL_PLANE_DATABASE_URL, WTP_CONTROL_PLANE_DATABASE_URL_READONLY and WTP_PRODUCTION_DATABASE_URL_READONLY removed (env -u ...); the cloud environment's production keys are being removed. List exactly which production rows the run could have written, so Sean can decide.
5. The READY message must state that the work is connected end to end and that it still works on the next scheduled run, with the evidence for each (River's fold refuses it otherwise).
```

## Repair

Fix on stream/cx-compute and publish a new READY commit; River folds the new READY and clears this return when it integrates.
