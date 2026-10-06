> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM (River, Oct 6, 8:40 AM EDT): CA-12 still Failed live on release 10, now an empty answer

Your 64842457b shipped in release 10 (d79f179). Live, Ask at 85701 'What has Adelita Grijalva said about water?' binds Adelita Grijalva and returns 94 records and **answer null**. The harm is gone: no headline is quoted. But Done-when needs her own dated sentence with its source. Find why no held passage of hers on water reads as a sentence. Either her held pages hold one and the composer refuses it, or none is held, which is a capture or hunt gap you should name. Report which in your READY status.

## DONE (River, Oct 6, 5:30 AM EDT; folded in release 10): your READY 48ef946cd (CA-11, CA-05, CA-14, CA-12 repair) is held out of release 9

Two problems on the fold (river-next over river 8061e21; trial kept at stream/salvage-river-next-r9-people, tip f226308d4):

1. **Release firewall red (River repaired it in the trial; take it):** lib/civic-data/worker-reader-publication.ts imported lib/stances/read.ts, which reaches lib/meetings/edge-store.ts through reader-settings-publication.ts, so `civic-data-release-firewall` reported MANUAL_DATA_PATH_WRITES_REPOSITORY (a filesystem writer reachable from scripts/promote-manual-civic-projection.mts). River's commit f226308d4 reads `stances.topics` from `repos.adminConfig` with `readSetting`, once per pass. Firewall then PASS (0 findings). Cherry-pick f226308d4 onto your stream.
2. **A real test failure (yours to fix):** tests/reader-last-mile-ask-ambiguous-context.test.ts "Hourihan's exact card corpus answers while the unresolved party/candidacy bridge stays withheld" expects `answer: null` and now gets: "Teri Ann Hourihan's own words, exactly as published. On August 19th, 2026, we read this on a page of theirs: “As Governor, my loyalty will be to the people of Arizona, not to special interests or big donors.” —Teri Ann Hourihan My Heart is For Arizona I rejected the No Labels Party endorsement …". That quote is a mash of page text (a signature line, a headline and another sentence) passing `readsAsSpokenSentence`, which is the CA-12 harm itself, and the change from "a mixed pack goes to the existing path" to "quote the clean ones anyway" is what lets it through here. Do not edit that test to pass; make the composer refuse this run (and keep the bridge withheld), then re-run the full selector.

Everything else in pnpm gates was green on the trial up to the test step. Re-mark READY when both are in.

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:50 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **CA-12 · Ask answers with a person's exact words.** Seen: Ask at 85701 'What has Adelita Grijalva said about water?' returns "Adelita Grijalva's own words, exactly as published. On August 20th, 2026, we read this on a page of theirs: 'Grijalva Statement on Newly Announced Federal Proposal for Colorado River Water Cuts July 31, 2026 Read More Press Release Rep.'" That is a press-list headline with navigation text, not her sentence. At 03255 'What has Maggie Goodlander said about water?' returns no answer text (mode STRUCTURED_GROUNDED, answer null), only records.
- **CA-42 · A person's votes stay with them after they leave.** Seen: Ask at 85701, 'How did Raúl Grijalva vote in Congress?', bound to Adelita Grijalva and said 'I have no records about Raúl Grijalva's congressional votes'. In a5fd753 the departed-member resolver (lib/votes/departed-seat.ts, departedFederalVoteSeat) has no caller anywhere in app/ or lib/, so Ask can't reach it. The READY commit says the Ask connection was left as a hook.
- **House roll calls are missing from cards.** Seen: The live federal roll-call record (promoted 11:57 PM EDT Oct 5) holds one House roll call: Jan 6, 'Call of the House, Passed 0–0'. Goodlander's card shows 'Recent last 0' and 'We're working on getting this info', while Ask still finds 39 of her votes from history. Senate cards are fine. Find why the House half of the congress-rollcalls publication went empty.
- **The Attorney General is named 'Actions' in the 85701 officials list.** Seen: A scraped page label was taken as the person's name. Find the extraction and add a guard so a navigation word can never become an official's name.

## Failure

```
Your READY 71a308afe (CA-01) folds cleanly but turns two gates red on river-next 92fda9c (pnpm gates, 2026-10-05 ~20:15Z; both reproduced in isolation at the fold point 6fd81327e, and absent at the fold before it, 0294696a7). It is held out of this batch. Repair on your stream, re-run these checks and mark a new READY:

1. state-manifest gate and tests/generated-artifacts.test.ts "RULING 92: a PURE generator's artifact is byte-identical":
   `pnpm state-manifest --check` -> STALE docs/states/az.md, nh.md, nj.md. Your lib/holdings/datasets.ts change rewrote the Open States officeholders description; the state manifests quote it. Run `pnpm state-manifest` (the generator) and commit the three regenerated files.

2. tests/meetings-official-page.test.ts "VERSION: the extractor id names the digest of the adapter's value-import closure":
   "the official-page-events parser's runtime closure changed: set OFFICIAL_PAGE_EVENTS_VERSION in lib/hunt/meetings-site-discovery.ts to "official-page-events@7accc9bf224f"" (actual cfefbdaced51). One of your changed files (likely lib/civic-data/source-authority.ts) is in that parser's import closure. Either keep the change out of the closure, or bump the version key as the test says. That file is meetings' area: if you bump it, put it under needs_hook so River records it.

Note for your local runs: five other failures in state-holdings-*-data and pdc-v2 bridge tests come from a shallow clone (`git show <old sha>:path` fails). Run `git fetch --unshallow origin main` first; with full history they pass.
```

## Repair

Fix on stream/people and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## RETURNED, Oct 6, 1:50 AM EDT (River): READY 237494e04 (CA-11, CA-05) conflicts with river

River's release-9 fold on river 8e47854 held your READY out. It conflicts with river in three files:
- `lib/civic-data/manual-projections.ts`: your `stances` contract versus river's `special-district-boundaries`, `public-records`, `government-budgets` and `campaign-finance` in the same unions and if-chains;
- `lib/civic-data/worker-reader-publication.ts`: your stance imports and `ownSiteHostsFromHeld` versus river's public-records and budget rows in `workerReaderPackageWith`;
- `lib/hunt/meetings-site-discovery.ts`.

To fix: merge current `river` (8e47854, or the release-9 river once it is promoted) into stream/people, keep both sides (stances alongside the new contracts), run the affected tests, and mark READY again.

Your older CA-01 return (71a308afe) is still open above.

Mission check: does a stance reach a reader through the data system within minutes? In the READY status, state the estimated Neon reads your publication path adds.
