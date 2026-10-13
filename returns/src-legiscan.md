# Returned: src-legiscan

lane: src-legiscan
owner: src-legiscan
writer: the src-legiscan lane
check: test
ready: no step ids d4ff52d959548426ddc551e51fe37fb722dbed1d
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T02:26:59Z
state: returned
fix_subject: fix:d4ffce73
fix: River · stream/src-legiscan — test failed for src-legiscan: tests/card-footer-ownership.test.ts (added by card-gaps-sources UI-01) fails when combined with src-legiscan READY d4ff52d95954: 'components/officials/legislator-bills.tsx: WorkingOnIt belongs only on the standalone Ask surfaces'. Remove Wo

## Failure

```
tests/card-footer-ownership.test.ts (added by card-gaps-sources UI-01) fails when combined with src-legiscan READY d4ff52d95954: 'components/officials/legislator-bills.tsx: WorkingOnIt belongs only on the standalone Ask surfaces'. Remove WorkingOnIt from legislator-bills.tsx (field components cannot use it) after merging river plus card-gaps-sources, then mark READY again.
```

## Repair

Fix on stream/src-legiscan and publish a new READY commit; River folds the new READY and clears this return when it integrates.
