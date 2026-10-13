# Returned: platform-legistar-members

lane: platform-legistar-members
owner: platform-legistar-members
writer: the platform-legistar-members lane
check: fold-conflict
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:18:22Z
state: returned
fix_subject: fix:9012de56
fix: River · stream/platform-legistar-members — fold-conflict failed for platform-legistar-members: platform-legistar-members READY 245acda948a7 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: tests/door-kinds-data-rows.test.ts   Merge river into stream/platform-legistar-members, resolve, and ma

## Failure

```
platform-legistar-members READY 245acda948a7 conflicts with river 691c01dd0ff4 (releases 25 to 29) when merged alone. Conflicting files: tests/door-kinds-data-rows.test.ts   Merge river into stream/platform-legistar-members, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-legistar-members and publish a new READY commit; River folds the new READY and clears this return when it integrates.
