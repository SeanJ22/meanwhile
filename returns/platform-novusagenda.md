# Returned: platform-novusagenda

lane: platform-novusagenda
owner: platform-novusagenda
writer: the platform-novusagenda lane
check: cleanliness
ready: R3-NOVUS 6d8ba4a1a5824a9b37dba97bd590c2e297abafc6
river: e06723d0f904ae6123d9c3d8f63b124c67b27ba2
at: 2026-10-14T15:56:21Z
state: returned
fix_subject: fix:a9b7ebb2
fix: River · stream/platform-novusagenda — cleanliness failed for platform-novusagenda: ## platform-novusagenda — cleanup list (River's review at fold; delete in stream/platform-novusagenda, then mark READY again)

## Failure

```
## platform-novusagenda — cleanup list (River's review at fold; delete in stream/platform-novusagenda, then mark READY again)

Lane platform-novusagenda (R3-NOVUS), READY 6d8ba4a1a, folded into river-next. Measured effect against river e06723d0f904: +5,697 / −23 lines across 26 files (9 added, 0 deleted, 17 modified); code and tests +484 / −23 in 19 files. The READY commit gives no line or file counts; state them when marking READY again.

Delete:
1. Remove the unused `export` keyword (nothing outside the file imports them, tests included): lib/sources/novusagenda/index.ts:11 (NovusMeeting), :20 (NovusRaw) and :78 (novusForm). If a symbol is also unused inside its file, delete it.

Test-only export left alone: lib/sources/novusagenda/index.ts:92 (nextNovusPage).

Checked and clean otherwise: no commented-out code; every new code file and fixture is referenced.
```

## Repair

Fix on stream/platform-novusagenda and publish a new READY commit; River folds the new READY and clears this return when it integrates.
