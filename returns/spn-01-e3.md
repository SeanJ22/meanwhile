# Returned: spn-01-e3

lane: spn-01-e3
owner: spn-01-e3
writer: the spn-01-e3 lane
check: readers keep what they have (unbuilt places, ballot freeze)
ready: SPN-01 d105512d75e8
river: c0e7b7a75fd5ec9c6c65348bca61dcf081e4a031
at: 2026-10-31T07:50:47Z
state: returned
fix_subject: fix:f6e00434
fix: River · stream/spn-01-e3 — readers keep what they have (unbuilt places, ballot freeze) failed for spn-01-e3: Held by River and withdrawn by SPN-01 (4:45 AM ET Oct 31). Readers would lose information they have: loadPlacePackage no longer falls back to readUnbuiltPlace, so places with no saved page drop out. On SPN-01's copy about 23% of place pages

## Failure

```
Held by River and withdrawn by SPN-01 (4:45 AM ET Oct 31). Readers would lose information they have: loadPlacePackage no longer falls back to readUnbuiltPlace, so places with no saved page drop out. On SPN-01's copy about 23% of place pages were never built, and 4 of 8 state-capital ZIPs showed fewer boards (Hartford 9 vs 10, Tallahassee 5 vs 7, Honolulu 5 vs 6, Des Moines 1 vs 4). The ballot reader (bodyFactsOnly) switched reads too, which the Nov 1-4 ET freeze forbids. The next READY keeps the live fallback for unbuilt places, builds never-built pages first, and keeps every ballot and where-to-vote caller on today's code.
```

## Repair

Fix on stream/spn-01-e3 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
