# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: fold-conflict
ready: no step ids unknown
river: 593be2416b30508823ef245e2834b05eaa0a4b6b
at: 2026-10-13T03:38:20Z
state: returned
fix_subject: fix:aaa978ac
fix: River · stream/src-money — fold-conflict failed for src-money: src-money READY 74bcddd8cc0b conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/government-listings.tsx components/map/popup/district-popup.tsx components/map/popup/entity-modal.tsx lib/ask/s

## Failure

```
src-money READY 74bcddd8cc0b conflicts with river 3734a8f9bb3b (release 25) when merged alone. Conflicting files: components/map/government-listings.tsx components/map/popup/district-popup.tsx components/map/popup/entity-modal.tsx lib/ask/synthesize.ts   Merge river into stream/src-money, resolve, and mark READY again.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
