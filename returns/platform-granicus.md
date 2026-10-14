# Returned: platform-granicus

lane: platform-granicus
owner: platform-granicus
writer: the platform-granicus lane
check: fold-conflict
ready: no step ids unknown
river: dc5cddd3834ac04588782f84b6becc81fe6a5e25
at: 2026-10-14T17:07:47Z
state: returned
fix_subject: fix:b61decc9
fix: River · stream/platform-granicus — fold-conflict failed for platform-granicus: platform-granicus READY 5cff50d6e conflicts with river dc5cddd3834a (checked 2026-10-14 Eastern) in 12 files. Ten are additive registry lists (GRANICUS beside NOVUSAGENDA/ESCRIBE: derived-door-kinds.ts, meeting-body-crosswalk.ts, meeting-pa

## Failure

```
platform-granicus READY 5cff50d6e conflicts with river dc5cddd3834a (checked 2026-10-14 Eastern) in 12 files. Ten are additive registry lists (GRANICUS beside NOVUSAGENDA/ESCRIBE: derived-door-kinds.ts, meeting-body-crosswalk.ts, meeting-partitions.ts, registry/source-wiring.ts, sources/composite/wiring.ts, derived-wiring.ts, derived-wiring-reading.ts, meetings-recipes.ts, meetings-site-discovery.ts, tests/door-kinds-data-rows.test.ts) and River will resolve those on the next fold. Two are real logic conflicts, named here: (1) lib/control-plane/discovery/auto-crosswalk.ts, the governing-body proposal near 'const listed = [...named.get(governing[0]!)!.spellings][0]': river proposes spellings: [listed], this lane's own commit proposes the deduplicated observedSpellings list; pick one rule and delete the other. (2) lib/sources/known-release.ts, the DurableEvidenceStore vault path: river joins the segments 'data', 'control-plane', 'vault'; this lane writes the literal 'data/control-plane/vault'; keep one and delete the other comment. Merge river into stream/platform-granicus, resolve those two, and mark READY again.
```

## Repair

Fix on stream/platform-granicus and publish a new READY commit; River folds the new READY and clears this return when it integrates.
