# Returned: src-legiscan

## src-legiscan — cleanup list (River's review at fold; delete in stream/src-legiscan, then mark READY again)

Lane src-legiscan (SRC-LS), cut from river 6b207dedc, tip 5f7ec73a4. Added 660 lines, deleted 6 lines. Files: 14 added, 0 deleted, 13 modified. Code and tests alone: +640 / −6 (10 files added, 13 modified). Fixtures: +20 (4 files added).

Delete:
1. Remove the unused `export` (used only inside its own file): lib/ask/legiscan-bills.ts:7 (billEvidence); lib/sources/legiscan/bills.ts:12 (LEGISCAN_STATES), :18 (BillSponsor) and :78 (normalizeBill).

Checked and clean: no commented-out code; no comment over two lines or telling history; every new code file is imported; every new fixture is referenced.

The READY commit gives no line or file counts; it predates that requirement.


lane: src-legiscan
owner: src-legiscan
writer: the src-legiscan lane
check: cleanliness
ready: no step ids unknown
river: ac3ccf885d6de2934f43f931a3092f735f05f0e1
at: 2026-10-13T22:19:14Z
state: returned
fix_subject: fix:6502f3e6
fix: River · stream/src-legiscan — cleanliness failed for src-legiscan: ## src-legiscan — cleanup list (River's review at fold; delete in stream/src-legiscan, then mark READY again)

## Failure

```
## src-legiscan — cleanup list (River's review at fold; delete in stream/src-legiscan, then mark READY again)

Lane src-legiscan (SRC-LS), cut from river 6b207dedc, tip 5f7ec73a4. Added 660 lines, deleted 6 lines. Files: 14 added, 0 deleted, 13 modified. Code and tests alone: +640 / −6 (10 files added, 13 modified). Fixtures: +20 (4 files added).

Delete:
1. Remove the unused `export` (used only inside its own file): lib/ask/legiscan-bills.ts:7 (billEvidence); lib/sources/legiscan/bills.ts:12 (LEGISCAN_STATES), :18 (BillSponsor) and :78 (normalizeBill).

Checked and clean: no commented-out code; no comment over two lines or telling history; every new code file is imported; every new fixture is referenced.

The READY commit gives no line or file counts; it predates that requirement.
```

## Repair

Fix on stream/src-legiscan and publish a new READY commit; River folds the new READY and clears this return when it integrates.
