# Returned: road

lane: road
owner: road
writer: the road lane
check: conflict
ready: no step ids unknown
river: 8b6a9150ed7b0fb2cfd5b6eb83e70a322831ab4e
at: 2026-10-16T20:10:47Z
state: returned
fix_subject: fix:23d4b134
fix: River · stream/road — conflict failed for road: Not folded: R0 caffa8305 conflicts with SB-01A (now in main b23c819 and river 05b72687f). The conflict changes what your code does, so this is yours to settle. Memory-fix READY stays wanted; it is the next thing River folds after SB-01B.

## Failure

```
Not folded: R0 caffa8305 conflicts with SB-01A (now in main b23c819 and river 05b72687f). The conflict changes what your code does, so this is yours to settle. Memory-fix READY stays wanted; it is the next thing River folds after SB-01B.

Fix, in your lane (stream/road). Merge origin/river (05b72687f or newer), then settle these five files:

1. lib/civic-data/payload-parts.ts. Take river's side whole. SB-01A moved partitionCivicPayload and its helpers (bytes, digest, territory, stringBytes, encode) into lib/civic-data/payload-codec.ts:137 and added a third parameter, referencedFields. Re-apply your single-pass encode (sizes summed from children, JSON-form values kept, not copied) inside payload-codec.ts partitionCivicPayload(input, inlineFields, referencedFields), keeping referencedFields behavior and the stored hashes identical to river's.

2. lib/civic-data/promotion.ts. Keep both imports: { immutableStateCandidate, statePublicationScope, withStatePublicationRead } from ./state-publication.ts, and { freezeDurableJson } from ./durable-json.ts. In durableCandidate (line ~49) the body becomes: if (statePublicationScope(candidate.scope)) return withStateRecordHashes(immutableStateCandidate(candidate)); return freezeDurableJson(candidate). State candidates stay on SB-01A's path; everything else uses your freeze.

3. lib/civic-data/validate.ts (6 hunks). Keep river's `scoped` parameter and durableStateHash for state-scoped candidates. For non-state candidates use your durableJsonIssue and durableCanonicalHash with no stringify round trip. So durableCanonicalJson(value, scoped) and canonicalMembers(value, scoped = false) branch: scoped keeps river's code, unscoped uses yours. Keep river's imports (statePublicationPriorOf, durableStateHash, statePublicationScope), keep your durable-json import, drop any import left unused. In the candidate check keep river's `scoped`, `digest` and `readModel` lines.

4. tests/civic-payload-parts.test.ts. Additive: keep river's owned-hydration tests and your additions, both.

5. tests/assemble-ballot-package.test.ts. Keep river's assertions (unreceipted.example.gov and analysis.example.gov violations) but do not mutate `input` after publish() freezes it: build each mutated package from a structuredClone made before the publish, as your version does.

Then rerun focused tests for those five files, full pnpm gates on the merged head, and re-measure the Illinois roll-call publish on the merged tree. Re-READY with the new numbers. State-scoped candidates no longer pass through freezeDurableJson, so say in the READY which jobs your saving still covers.
```

## Repair

Fix on stream/road and publish a new READY commit; River folds the new READY and clears this return when it integrates.
