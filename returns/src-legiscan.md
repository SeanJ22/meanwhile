# Returned: src-legiscan

lane: src-legiscan
owner: src-legiscan
writer: the src-legiscan lane
check: test
ready: no step ids d4ff52d959548426ddc551e51fe37fb722dbed1d
river: 3734a8f9bb3bb234dfe9ca3b241e6d83b339ce97
at: 2026-10-13T04:08:49Z
state: returned
fix_subject: fix:0a5b9c47
fix: River · stream/src-legiscan — test failed for src-legiscan: tests/card-footer-ownership.test.ts (in river since release 25 via card-gaps-sources UI-01) fails with src-legiscan READY d4ff52d95954 folded alone on river 3734a8f9bb3b: 'components/officials/legislator-bills.tsx: WorkingOnIt belongs only

## Failure

```
tests/card-footer-ownership.test.ts (in river since release 25 via card-gaps-sources UI-01) fails with src-legiscan READY d4ff52d95954 folded alone on river 3734a8f9bb3b: 'components/officials/legislator-bills.tsx: WorkingOnIt belongs only on the standalone Ask surfaces'. Remove WorkingOnIt from legislator-bills.tsx (field components cannot use it), merge river, and mark READY again.
```

## Repair

Fix on stream/src-legiscan and publish a new READY commit; River folds the new READY and clears this return when it integrates.
