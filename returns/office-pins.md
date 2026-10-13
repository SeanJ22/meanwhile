# Returned: office-pins

## office-pins — cleanup list (River's review at fold; delete in stream/office-pins, then mark READY again)

Lane office-pins (DS-03), cut from river edd7652c5, tip 2dbd472fa. Added 2,244 lines, deleted 152 lines. Files: 19 added, 0 deleted, 16 modified. Code and tests alone: +2,100 / −152 (18 files added, 16 modified). Fixtures: +144 (1 file added).

Delete:
1. Remove the unused `export` (used only inside its own file): app/(admin)/_mw/admin-v6/doors-panel.tsx:10 (ShutDoorGroup); lib/control-plane/admin-view/v6-hunts-read.ts:108 (HuntPause); lib/control-plane/admin-view/v6-money-hunts-route.ts:28 (readOwnerPauses).
2. Cut these comments to two lines or less: app/(admin)/_mw/admin-v6/screen-workers.tsx lines 105–109 and 130–134; lib/control-plane/admin-view/v6-hunts-read.ts lines 95–98; scripts/admin-now-shots.mts lines 1–11 (a narrative file header with usage notes).

Checked and clean: no commented-out code; nothing replaced and left behind; every new code file is imported; the one new fixture (tests/fixtures/admin-now/fixture.ts) is imported by tests/admin-v6-ui/now-screen.test.tsx and v6-ui.test.tsx.

For Sean to rule, not ordered for deletion: scripts/admin-now-shots.mts is run by nothing. Only a comment in tests/fixtures/admin-now/fixture.ts:2 names it, and it writes screenshots under docs/design/admin-now/. Say whether to keep it.

The READY commit gives no line or file counts; it predates that requirement.


lane: office-pins
owner: office-pins
writer: the office-pins lane
check: cleanliness
ready: no step ids unknown
river: edd7652c5bb585c8d6bdc5b01f31c77b556e6207
at: 2026-10-13T21:04:13Z
state: returned
fix_subject: fix:bed922a4
fix: River · stream/office-pins — cleanliness failed for office-pins: ## office-pins — cleanup list (River's review at fold; delete in stream/office-pins, then mark READY again)

## Failure

```
## office-pins — cleanup list (River's review at fold; delete in stream/office-pins, then mark READY again)

Lane office-pins (DS-03), cut from river edd7652c5, tip 2dbd472fa. Added 2,244 lines, deleted 152 lines. Files: 19 added, 0 deleted, 16 modified. Code and tests alone: +2,100 / −152 (18 files added, 16 modified). Fixtures: +144 (1 file added).

Delete:
1. Remove the unused `export` (used only inside its own file): app/(admin)/_mw/admin-v6/doors-panel.tsx:10 (ShutDoorGroup); lib/control-plane/admin-view/v6-hunts-read.ts:108 (HuntPause); lib/control-plane/admin-view/v6-money-hunts-route.ts:28 (readOwnerPauses).
2. Cut these comments to two lines or less: app/(admin)/_mw/admin-v6/screen-workers.tsx lines 105–109 and 130–134; lib/control-plane/admin-view/v6-hunts-read.ts lines 95–98; scripts/admin-now-shots.mts lines 1–11 (a narrative file header with usage notes).

Checked and clean: no commented-out code; nothing replaced and left behind; every new code file is imported; the one new fixture (tests/fixtures/admin-now/fixture.ts) is imported by tests/admin-v6-ui/now-screen.test.tsx and v6-ui.test.tsx.

For Sean to rule, not ordered for deletion: scripts/admin-now-shots.mts is run by nothing. Only a comment in tests/fixtures/admin-now/fixture.ts:2 names it, and it writes screenshots under docs/design/admin-now/. Say whether to keep it.

The READY commit gives no line or file counts; it predates that requirement.
```

## Repair

Fix on stream/office-pins and publish a new READY commit; River folds the new READY and clears this return when it integrates.
