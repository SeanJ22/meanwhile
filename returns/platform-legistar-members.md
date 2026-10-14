# Returned: platform-legistar-members

lane: platform-legistar-members
owner: platform-legistar-members
writer: the platform-legistar-members lane
check: fold-conflict
ready: no step ids unknown
river: 5bb464f06e345165d6302377d20418f29d392409
at: 2026-10-14T00:54:46Z
state: returned
fix_subject: fix:233dcad8
fix: River · stream/platform-legistar-members — fold-conflict failed for platform-legistar-members: platform-legistar-members READY 8f4ee1cbe conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-legistar-members, resolve, and mark READY again.

## Failure

```
platform-legistar-members READY 8f4ee1cbe conflicts with river 5bb464f06e34 by itself (acquisition-leftovers, census-lane and src-legiscan are now on river); merge river into stream/platform-legistar-members, resolve, and mark READY again.
```

## Repair

Fix on stream/platform-legistar-members and publish a new READY commit; River folds the new READY and clears this return when it integrates.
