# Returned: acquisition-leftovers

## acquisition-leftovers — cleanup list (River's review at fold; delete in stream/acquisition-leftovers, then mark READY again)

Lane acquisition-leftovers (R2B), READY 37080911d, folded into river-next 5bb464f06e34. Measured effect against river 25ef70542f9b: +763 / −747 lines across 40 files (A12 / M28): code and tests +646 / −678 (2 added, 26 modified), fixtures +117 / −69 (10 added, 2 modified). The READY counts match.

Delete:
1. tests/fixtures/prl/profiles-national-source.json (7 lines). No test, script or code reads it; the test loads only tests/fixtures/prl/profiles-national.csv.

Checked and clean otherwise: the census-address-* fixtures are loaded by name template in tests/acquisition-leftovers.test.ts:120 and :142; census-geocoder-vintages.json and fec-national/second-hop.json are read there too; no commented-out code, no unused export, no second path beside a replaced one.


lane: acquisition-leftovers
owner: acquisition-leftovers
writer: the acquisition-leftovers lane
check: cleanliness
ready: no step ids 37080911ddf367885daf9b5e9bdb372383f10bda
river: 25ef70542f9bf5cffd93368ce29dcb11576e46cf
at: 2026-10-14T00:25:18Z
state: returned
fix_subject: fix:4e7b65c0
fix: River · stream/acquisition-leftovers — cleanliness failed for acquisition-leftovers: ## acquisition-leftovers — cleanup list (River's review at fold; delete in stream/acquisition-leftovers, then mark READY again)

## Failure

```
## acquisition-leftovers — cleanup list (River's review at fold; delete in stream/acquisition-leftovers, then mark READY again)

Lane acquisition-leftovers (R2B), READY 37080911d, folded into river-next 5bb464f06e34. Measured effect against river 25ef70542f9b: +763 / −747 lines across 40 files (A12 / M28): code and tests +646 / −678 (2 added, 26 modified), fixtures +117 / −69 (10 added, 2 modified). The READY counts match.

Delete:
1. tests/fixtures/prl/profiles-national-source.json (7 lines). No test, script or code reads it; the test loads only tests/fixtures/prl/profiles-national.csv.

Checked and clean otherwise: the census-address-* fixtures are loaded by name template in tests/acquisition-leftovers.test.ts:120 and :142; census-geocoder-vintages.json and fec-national/second-hop.json are read there too; no commented-out code, no unused export, no second path beside a replaced one.
```

## Repair

Fix on stream/acquisition-leftovers and publish a new READY commit; River folds the new READY and clears this return when it integrates.
