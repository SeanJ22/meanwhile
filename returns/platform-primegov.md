# Returned: platform-primegov

lane: platform-primegov
owner: platform-primegov
writer: the platform-primegov lane
check: fold-conflict
ready: no step ids unknown
river: dc5cddd3834ac04588782f84b6becc81fe6a5e25
at: 2026-10-14T17:07:53Z
state: returned
fix_subject: fix:ff818811
fix: River · stream/platform-primegov — fold-conflict failed for platform-primegov: platform-primegov READY 954f2c405 conflicts with river dc5cddd3834a (checked 2026-10-14 Eastern) in 13 files. Eleven are additive registry lists or branches (PRIMEGOV beside NOVUSAGENDA/ESCRIBE: derived-door-kinds.ts, meeting-body-crosswalk

## Failure

```
platform-primegov READY 954f2c405 conflicts with river dc5cddd3834a (checked 2026-10-14 Eastern) in 13 files. Eleven are additive registry lists or branches (PRIMEGOV beside NOVUSAGENDA/ESCRIBE: derived-door-kinds.ts, meeting-body-crosswalk.ts, meeting-partitions.ts, derived-wiring.ts, derived-wiring-reading.ts, meetings-discovery-executor.ts imports, meetings-recipes.ts, meetings-site-discovery.ts, registry/source-wiring.ts, registry/types.ts, sources/composite/wiring.ts) and River will resolve those on the next fold. Two are real logic conflicts, named here: (1) lib/control-plane/discovery/auto-crosswalk.ts, the governing-body proposal near 'const listed = [...named.get(governing[0]!)!.spellings][0]': river proposes spellings: [listed], this lane's own commit proposes the deduplicated observedSpellings list; pick one rule and delete the other. (2) lib/sources/known-release.ts, the DurableEvidenceStore vault path: river joins the segments 'data', 'control-plane', 'vault'; this lane writes the literal 'data/control-plane/vault'; keep one and delete the other comment. Merge river into stream/platform-primegov, resolve those two, and mark READY again.
```

## Repair

Fix on stream/platform-primegov and publish a new READY commit; River folds the new READY and clears this return when it integrates.
