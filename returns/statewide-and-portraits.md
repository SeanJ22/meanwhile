# Returned: statewide-and-portraits

lane: statewide-and-portraits
owner: statewide-and-portraits
writer: the statewide-and-portraits lane
check: cleanliness
ready: no step ids unknown
river: edd7652c5bb585c8d6bdc5b01f31c77b556e6207
at: 2026-10-13T21:04:50Z
state: returned
fix_subject: fix:1425b068
fix: River · stream/statewide-and-portraits — cleanliness failed for statewide-and-portraits: ## statewide-and-portraits — cleanup list (River's review at fold; delete in stream/statewide-and-portraits, then mark READY again)

## Failure

```
## statewide-and-portraits — cleanup list (River's review at fold; delete in stream/statewide-and-portraits, then mark READY again)

Lane statewide-and-portraits (SL-03), cut from river 1e72570ac, tip 864a854bd. Added 20,491 lines, deleted 204 lines. Files: 60 added, 0 deleted, 37 modified. Code and tests alone: +6,390 / −204 (38 files added, 37 modified). Fixtures: +14,101 (22 files added). Its commits are also carried by stream/src-civic.

Delete:
1. Remove the unused `export` (used only inside its own file): lib/civic-data/people-source-publication.ts:21 (PublishPeopleSourceInput) and :35 (peopleSourceCandidate); lib/civic-data/people-source-runtime.ts:16 (PeopleSourceAcquired) and :25 (PEOPLE_SOURCE_FAILURE_ROUTES); lib/officials/people-coverage-report.ts:14 (personHasPublishedPhoto) and :20 (summarizePeopleRoster); lib/officials/types.ts:32 (OfficeSelectionMethod); lib/photos/portrait-work.ts:26 (PortraitPacingRuntime); lib/sources/statewide/acquisition.ts:19 (NationalStatewideLeads) and :25 (StatewidePeopleRelease).
2. Delete lib/sources/statewide/acquisition.ts:11, the line `export type { StatewideLead } from "./parse.ts";`. Nothing imports StatewideLead from there.
3. Cut these comments to two lines or less: lib/civic-data/people-source-read.ts lines 5–8; lib/photos/portrait-work.ts lines 23–25.

Checked and clean: no commented-out code; nothing replaced and left behind; every new code file is imported; every new fixture is referenced.

The READY commit gives no line or file counts; it predates that requirement.
```

## Repair

Fix on stream/statewide-and-portraits and publish a new READY commit; River folds the new READY and clears this return when it integrates.
