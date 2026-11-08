# Returned: spn-01

lane: spn-01
owner: spn-01
writer: the spn-01 lane
check: civic_data_payload_parts still grows ~279 MB an hour (raw source copies inline, never deleted)
ready: no step ids unknown
river: 4639e9a619fb687d31690587cc20568e3bb4f508
at: 2026-11-08T07:14:03Z
state: returned
fix_subject: fix:ab6e4702
fix: River · stream/spn-01 — civic_data_payload_parts still grows ~279 MB an hour (raw source copies inline, never deleted) failed for spn-01: River → SPN-01, 2026-11-08: civic_data_payload_parts keeps growing about 34,000 rows and 279 MB an hour on releases 188/189 (n_tup_ins 8,934,649 at 05:10:28Z → 9,004,251 at 07:12:33Z; 73.5 GB total). CX-COMPUTE slowed it from ~394 MB an hou

## Failure

```
River → SPN-01, 2026-11-08: civic_data_payload_parts keeps growing about 34,000 rows and 279 MB an hour on releases 188/189 (n_tup_ins 8,934,649 at 05:10:28Z → 9,004,251 at 07:12:33Z; 73.5 GB total). CX-COMPUTE slowed it from ~394 MB an hour but did not stop it.

Cause (read from origin/river and a production sample): CivicDataStore.create() (lib/civic-data/store.ts, ~1084-1135 and ~2416-2450) writes every candidate's parts through payloadParts.store(), called from lib/civic-data/candidate-lifecycle.ts:260 for meeting, meeting-doors, state-registry, roll-call and census candidates. Parts are deduplicated by hash, so the growth is new distinct payloads. Of ~400 sampled rows, 347 are base64 raw source captures (about 7.5 KB each). store.ts:2163 says parts are never changed or deleted; nothing removes old ones. Readers still read them back (walk, place-builder, state-reader-store, canonical, selected-voting, planner-meeting-state-read, hot-partitions), and the DB-06 comment says the inline copies are transitional until readers switch.

Rulings §7 (Data diet): keep one saved copy of each source, in the vault, filed by its fingerprint; the database holds facts and small pointers only; don't store copies that no reader or job reads.

What to fix:
1. Stop writing raw source captures and candidate copies into civic_data_payload_parts; store the source once in the vault by fingerprint (version-vault.ts holdCivicVersion already does this) and keep only the pointer in the database.
2. Finish the DB-06 reader switch so every reader listed above reads the vault copy or the fact, not the inline part; delete the inline path in the same change.
3. Show on a production copy (test branch, expires within a day) that the table stops growing over two full hours of the real runner workload while readers see the same pages, and say how the existing 73.5 GB is retired.
4. State both proof lines: connected end to end, and still works on the next scheduled run, with evidence.
```

## Repair

Fix on stream/spn-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
