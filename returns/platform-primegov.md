# Returned: platform-primegov

lane: platform-primegov
owner: platform-primegov
writer: the platform-primegov lane
check: cleanliness
ready: R3-PRIMEGOV 7ed33b50d2530350bbf8dabb7330160f68e80bb4
river: be06573dcbd3a61b776ddab90e6f20519d3eefbf
at: 2026-10-15T14:32:19Z
state: returned
fix_subject: fix:2bf3634e
fix: River · stream/platform-primegov — cleanliness failed for platform-primegov: Cleanliness findings on R3-PRIMEGOV (7ed33b50d, folded as 95c230727). Fix in your next READY:

## Failure

```
Cleanliness findings on R3-PRIMEGOV (7ed33b50d, folded as 95c230727). Fix in your next READY:
Exports nothing outside their own file imports (unexport; tests count only for the last):
   lib/sources/primegov/index.ts:15 PrimeGovDocument
   lib/sources/primegov/index.ts:31 PrimeGovMeeting
   lib/sources/primegov/index.ts:45 PrimeGovRaw
   lib/sources/primegov/index.ts:90 primeGovDocumentUrl
```

## Repair

Fix on stream/platform-primegov and publish a new READY commit; River folds the new READY and clears this return when it integrates.
