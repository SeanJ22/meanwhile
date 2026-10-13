# Returned: platform-municode

lane: platform-municode
owner: platform-municode
writer: the platform-municode lane
check: cleanliness
ready: no step ids unknown
river: edd7652c5bb585c8d6bdc5b01f31c77b556e6207
at: 2026-10-13T21:04:38Z
state: returned
fix_subject: fix:dfb31c70
fix: River · stream/platform-municode — cleanliness failed for platform-municode: ## platform-municode — cleanup list (River's review at fold; delete in stream/platform-municode, then mark READY again)

## Failure

```
## platform-municode — cleanup list (River's review at fold; delete in stream/platform-municode, then mark READY again)

Lane platform-municode (R3-MUNICODE), cut from river ac3ccf885, tip 5c89ee84a. Added 9,756 lines, deleted 726 lines. Files: 10 added, 0 deleted, 12 modified. Code and tests alone: +381 / −726 (2 files added, 12 modified). Fixtures: +9,375 (8 files added). The READY commit states these counts.

Delete:
1. Remove the unused `export` (used only inside its own file): lib/sources/municode/index.ts:10 (MunicodeMeeting) and lib/sources/municode/index.ts:21 (MunicodeRaw).

Checked and clean: no commented-out code; no comment over two lines; no leftover of what it replaced (726 lines deleted); the new fixtures are loaded by tests/municode.test.ts through its fixture(name) helper.
```

## Repair

Fix on stream/platform-municode and publish a new READY commit; River folds the new READY and clears this return when it integrates.
