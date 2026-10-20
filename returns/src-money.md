# Returned: src-money

lane: src-money
owner: src-money
writer: the src-money lane
check: fold-conflict
ready: no step ids unknown
river: d9cb87e0f6869334be584fc7f842fc41daea78e9
at: 2026-10-20T22:49:58Z
state: returned
fix_subject: fix:68bd221c
fix: River · stream/src-money — fold-conflict failed for src-money: SRC-MN READY 6dc11bf851b6 does not fold cleanly with AQ-03 b0bffe3c50 and UI-03 51f73f7104 in the release being built (River 7dbad3bb5 + main ed0ac299c + MP-01 b986167e6f + AQ-03 + UI-03). Sean asked for both lanes' behavior to be kept, and

## Failure

```
SRC-MN READY 6dc11bf851b6 does not fold cleanly with AQ-03 b0bffe3c50 and UI-03 51f73f7104 in the release being built (River 7dbad3bb5 + main ed0ac299c + MP-01 b986167e6f + AQ-03 + UI-03). Sean asked for both lanes' behavior to be kept, and said to return SRC-MN if that cannot be resolved cleanly. Three hunks conflict:

1. app/ballot/page.tsx, 1 hunk (vs UI-03). UI-03 deleted the constants AUXILIARY_READER_LABEL and EXTENDED_MECHANICS_CHARS (about 400 lines of ballot page); SRC-MN still carries them. Keep UI-03's deletion unless SRC-MN's own change needs them: check that nothing in the merged page references either constant. The other overlap Sean named, tests/ballot-source-isolation.test.ts, did not conflict textually; confirm it still passes on the merged tree.

2. app/api/ask/grounded/route.ts, hunk A (vs AQ-03). The state-money filer lookup differs. AQ-03 settles a preload and skips it for federal offices:
     if (!namedFederalOfficeholder(question) && !relativeMoney?.office.keys.every(key => key === "us_representative" || key === "us_senator")) { await settleGroundedSourcePreloads([stateMoneyPreload]); stateMoneyFilers = requestedStateMoneySubjects(question, moneyStates); }
   SRC-MN awaits a state-filtered lookup:
     if (!namedFederalOfficeholder(question)) await settleGroundedSourcePreloads([timed("campaignFinance", async () => { stateMoneyFilers = await requestedStateMoneySubjects(question, statesOf(ocdIds)); })]);
   They differ in the function's signature (sync with moneyStates vs awaited with statesOf(ocdIds)) and in the federal-office skip. Decide which signature requestedStateMoneySubjects has after both lanes, keep AQ-03's relative-money federal skip, and keep SRC-MN's retirement of the state-native campaign load.

3. app/api/ask/grounded/route.ts, hunk B (vs AQ-03). deferrablePreloads composition: AQ-03 adds campaignFinancePreload, hasOneReferencedContest and the ballotReference branch; SRC-MN's version is the older shape (stateMoneyFilers.length ? [] : ...). Keep AQ-03's ballotReference and campaignFinancePreload branches; keep SRC-MN's rule that a state-money filer question reads nothing from the retired native load.

River will not hand-merge the Ask route: a wrong guess changes what readers are answered, and the owners have the tests. Merge current River once the release (MP-01, AQ-03, UI-03, OT-01) is in main, resolve these three hunks, run the Ask money and ballot tests with the CI flags (tests/ask-*, tests/campaign-money-*, tests/ballot-*), preflight, db:gate, pnpm build (the /api/voting-sites trace must stay at or under 430) and the full pnpm gates, and send a new READY.
```

## Repair

Fix on stream/src-money and publish a new READY commit; River folds the new READY and clears this return when it integrates.
