# Returned: src-01

lane: src-01
owner: src-01
writer: the src-01 lane
check: live check: EPA ECHO archive key collision, OpenFEMA hash mismatch (release 90)
ready: no step ids 66437c4f223ba5b15e22a602ddec44d8e1b4b616
river: 5130d339c83fac517179b8612a2e1ee414c9464b
at: 2026-10-23T15:35:25Z
state: returned
fix_subject: fix:2c15a3a1
fix: River · stream/src-01 — live check: EPA ECHO archive key collision, OpenFEMA hash mismatch (release 90) failed for src-01: - FAIL 1, EPA ECHO: epa-echo:national SOURCE_BLOCKED at 14:35:38 UTC, failure_code SOURCE_RETRIEVAL_FAILED: "PUBLISHER_UNAVAILABLE: Key project/freshness/source/src-so/archive/epa-echo/source.json already holds an object and the offered one

## Failure

```
SRC-01 shipped in release 90 (main a462d38; the runner reports a462d38 from the 14:00 UTC hour). Its first scheduled runs on production (civic_data_candidates, reader DB tiny-hill-13996172 / br-delicate-lab-ax02xuo5, read-only, retrieved_at >= 2026-10-23T14:20Z):
- PASS: legiscan-bills 4 PROMOTED (US:legiscan-datasets, sessions 2262, 2218, 2148; 15:15 to 15:18 UTC); campaign-money:hourly PROMOTED (14:42 UTC).
- FAIL 1, EPA ECHO: epa-echo:national SOURCE_BLOCKED at 14:35:38 UTC, failure_code SOURCE_RETRIEVAL_FAILED: "PUBLISHER_UNAVAILABLE: Key project/freshness/source/src-so/archive/epa-echo/source.json already holds an object and the offered one is not the same object: contentHash is sha256-1ec5ed98... in the stored object and sha256-8f12065e... offered". The READY said "EPA's next weekly replay uses unique archive run keys"; in production the archive key is fixed (archive/epa-echo/source.json), so the second real run collides with the first and the source blocks.
- FAIL 2, OpenFEMA: openfema:FL PARSE_INVALID at 14:34:37 UTC, failure_code NORMALIZED_READ_MODEL_HASH_MISMATCH: "The supplied normalized hash does not bind the exact bounded Reader projection presented for promotion." The READY's FEMA replay resumed skip=500 from 500 to 1,000; the live run's hash and projection disagree.
- Not yet seen since release 90: FEC, FAC, Socrata (FEC/LegiScan/EPA weekly; check their due times), SAM (after 8 PM EDT).
Where: the EPA ECHO archive key builder (archive/epa-echo/source.json) and the OpenFEMA normalized-hash / bounded Reader projection path.
What passing looks like: on the live runner, epa-echo:national PROMOTED (or confirmed unchanged) on its next run with a run-unique archive key, and openfema:FL (and the other FEMA states) PROMOTED with the hash binding its projection; FEC, FAC and Socrata each with a PROMOTED or confirmed candidate on their next scheduled run; counts by state. New READY with both proofs.
```

## Repair

Fix on stream/src-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
