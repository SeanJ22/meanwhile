# Returned: token-cost

lane: token-cost
owner: token-cost
writer: the token-cost lane
check: cleanliness
ready: no step ids unknown
river: edd7652c5bb585c8d6bdc5b01f31c77b556e6207
at: 2026-10-13T21:04:44Z
state: returned
fix_subject: fix:ecc4b796
fix: River · stream/token-cost — cleanliness failed for token-cost: ## token-cost — cleanup list (River's review at fold; delete in stream/token-cost, then mark READY again)

## Failure

```
## token-cost — cleanup list (River's review at fold; delete in stream/token-cost, then mark READY again)

Lane token-cost (R7), cut from river edd7652c5, tip c4d7ee39c. Added 767 lines, deleted 164 lines. Files: 3 added, 0 deleted, 49 modified. No fixtures.

Delete:
1. Remove the unused `export` (used only inside its own file): app/(admin)/_mw/admin-v6/screen-money.tsx:25 (ModelSpendPanel); lib/control-plane/admin-view/model-spend.ts:22 (ModelSpendLine).

Checked and clean: no commented-out code; no comment over two lines; every new code file is imported.

The READY commit gives no line or file counts; it predates that requirement.
```

## Repair

Fix on stream/token-cost and publish a new READY commit; River folds the new READY and clears this return when it integrates.
