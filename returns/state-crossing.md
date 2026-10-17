# Returned: state-crossing

lane: state-crossing
owner: state-crossing
writer: the state-crossing lane
check: test: server-client-boundary
ready: XS-02 7ebcaf9cba7bd89a3692434891d30eb833ecac7f
river: 2e16200945cd27c65541e0fcd2705b3dfd8d6325
at: 2026-10-17T06:30:26Z
state: returned
fix_subject: fix:6bf7dca4
fix: River · stream/state-crossing — test: server-client-boundary failed for state-crossing: tests/server-client-boundary.test.ts "no client component takes a render prop or an injected function" fails:

## Failure

```
tests/server-client-boundary.test.ts "no client component takes a render prop or an injected function" fails:
 components/map/map-canvas.tsx - prop "isOutsideActiveState" is a function prop (declared in XS-01 commit 79a271d42, passed from components/map/map-entry.tsx:1577).
A Server Component cannot pass a function across the boundary. Take a serializable value (for example the active state code) and decide inside the component.
All other gates passed on river + DR-01 + R1 + XS-02 (lint, tsc, build, bundle, standalone, db gate). Re-send READY after the fix.
```

## Repair

Fix on stream/state-crossing and publish a new READY commit; River folds the new READY and clears this return when it integrates.
