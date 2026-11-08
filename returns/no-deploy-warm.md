# Returned: no-deploy-warm

lane: no-deploy-warm
owner: no-deploy-warm
writer: the no-deploy-warm lane
check: Sean: keep the post-deploy warm-up
ready: NB-02 102b8e16fbce27eabca483c804bc9c0451fa4ea6
river: 4639e9a619fb687d31690587cc20568e3bb4f508
at: 2026-11-08T05:07:43Z
state: returned
fix_subject: fix:f9e8021c
fix: River · stream/no-deploy-warm — Sean: keep the post-deploy warm-up failed for no-deploy-warm: READY 102b8e16f (NB-02) on stream/no-deploy-warm is not folded, by Sean's decision on 2026-11-08: keep the post-deploy warm-up, because removing it makes readers wait. The warm-up stays as it is on river. Nothing to fix on this lane; do not

## Failure

```
READY 102b8e16f (NB-02) on stream/no-deploy-warm is not folded, by Sean's decision on 2026-11-08: keep the post-deploy warm-up, because removing it makes readers wait. The warm-up stays as it is on river. Nothing to fix on this lane; do not post a new READY that removes the warm-up.
```

## Repair

Fix on stream/no-deploy-warm and publish a new READY commit; River folds the new READY and clears this return when it integrates.
