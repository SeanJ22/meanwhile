# Returned: fact-store

lane: fact-store
owner: fact-store
writer: the fact-store lane
check: cleanliness
ready: R1 bff3d84a630fba7efe2620258c5d1c9ab5b5c9d4
river: b9911b63edc727359da760ecc4c32fb25cb83ff8
at: 2026-10-14T21:56:55Z
state: returned
fix_subject: fix:34082ba6
fix: River · stream/fact-store — cleanliness failed for fact-store: ## fact-store — cleanup list (River's review at fold; delete in stream/fact-store, then mark READY again)

## Failure

```
## fact-store — cleanup list (River's review at fold; delete in stream/fact-store, then mark READY again)

Lane fact-store (R1), READY bff3d84a6, folded into river-next faa0b2b94711. Measured effect against river b9911b63edc7: +7,162 / −8,281 lines across 214 files (38 added, 14 deleted, 162 modified); code and tests +4,900 / −10,188 in 212 files. The READY counts match.

Delete or rewrite:
1. lib/civic-data/types.ts:319: the comment "A roster row the registry partition no longer carries because each member is now its own fact" tells history. State what the row is, in at most two lines, or delete the comment.
2. lib/facts/check.ts:105 and lib/facts/publish.ts:36: the comments cite "rulings §3". Drop the citation and keep only the why, at most two lines each.

Test-only exports left alone: lib/civic-data/candidate-profile-findings.ts:34 (CandidateFindingSubject), lib/civic-data/worker-roster-publication.ts:150 (publishBodyRoster), lib/facts/clocks.ts:9 (FRESHNESS_HOURS_DEFAULT), lib/facts/db.ts:43 (installFactReader), lib/facts/publish.ts:18 (PublishInput).

Checked and clean otherwise: no commented-out code; the migration R1_fact_store.sql only creates tables (expand phase), with no control-plane references.
```

## Repair

Fix on stream/fact-store and publish a new READY commit; River folds the new READY and clears this return when it integrates.
