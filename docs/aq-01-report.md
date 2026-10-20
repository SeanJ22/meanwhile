# AQ-01 — release 60 return repaired

Ask keeps its short, answer-first responses and the verified finance and adopted-budget paths. River `5307d8b75678fc416f8e062cc9c65839d6d23da8` is merged, matching release-60 main `9a159f69f054c02b98933d836919ad8bc07a12c4`. The merge preserves SRC-MN's removal of campaign money without a verified person and seat binding. It supersedes returned READY `da719a61e195893b52f0542dfb31f12236ccd2d4`.

**Production browser check: 30/30 complete answers under three seconds.** The maximum, including the cold first Ask, was **2.861 s**. Ten ZIPs in nine states; 24 answers from held sources and six with a separately labeled AI answer. The nine focused files pass **78/78**, with zero failures or skips, using the CI loader, fixture-door preload and two-file concurrency. The original five returned test files are unchanged.

**Full `pnpm gates`: 8/8 green** on merged source commit `36aeadd14d`. The suite registered 8,679 tests across 1,158 files: **8,677 passed, zero failed, two skipped**. Bundle tests pass **16/16** without skips. Preflight, lint, TypeScript, browser assertions, database gate and both default/standalone builds pass. All five returned files also pass within the full run. READY differs from that tested source only in this report.

The two skipped checks are optional saved-capture replays in `tests/acquisition-repair-profile.test.ts` and `tests/acquisition-repair-roster.test.ts`; their captured source bytes are not supplied here. They are not counted as passes. The optional repository `.env.local` secret sweep is also unverified because that file is absent.

## What changed

The single release-60 conflict in `lib/ask/state-campaign.ts` is resolved around SRC-MN's new person-bound committee/cycle reader. Ask keeps its concise named-place questions and committee-list composer, but reads only eligible cycle summaries and filing links. The removed raw transactions, unbound committee facts, pre-2020 facts and unmatched legacy state-money records are not restored. SRC-MN's funding reader and publication changes remain intact.

The merged-reader regression now publishes a valid saved Washington filing matched to a published person and exact seat, plus unbound and historical negative cases. It also seeds an already-held invalid committee containing a $150 contributor fixture and requires its name and record to remain absent. State and exact-place reads return the same sourced cycle summary. No assertion in the five returned files was changed.

The default Ask writer now states §9's current rule: never name an individual donor who gave $200 or less in the cycle; name another individual donor only when the supplied filings establish a cycle total over $200; never show personal mailing addresses. The fixture manual matches the shipped seed. The existing shipped-default refresh recognizes AQ-01's prior writer hash, preserves custom Admin text, and uses the normal edit log and undo. The inherited SRC-MN description was corrected to the current threshold. Rulings itself is unchanged. Cycle summaries expose no individual transactions or donor addresses.

The earlier repairs remain: held government finance composers decline to other held paths before falling back to AI; the prompt and checker both enforce at most five sentences and 700 characters; generic vote answers say **“most recent recorded votes”**. A question about one exact bill intentionally receives the shorter position, such as “Mark Kelly voted NO on H.R. 1.” The named bill and Congress still have to match the held vote.

The full-run-only cost failure came from canceled-hedge accounting repeatedly awaiting the dynamic Next adapter import. Under load the winner could finish before the loser's cost row registered, racing the unchanged test's one-event-loop-turn assertion. The adapter is retained after loading, so subsequent accounting registers directly. The controlled delayed-import reproduction from the previous repair showed one row before and two after the change; the cost test remains unchanged.

RS-02's canonical reader path and RS-03's removed warm routes remain in place. Meeting-time questions settle independent holdings alongside the current canonical calendar, then read retained history only on a miss. Validation uses the same instant as selection. The sourced body name supplies the meeting-opening link. Spending limits, pauses, model choices and publishing settings were not changed. These changes move §0's correct, current and fast answers from the facts held for the reader's place.

## Production verification and read cost

Chromium pressed the real Ask button in the optimized build. A fresh native `grounded-ask` engine loaded on the first question. Each measurement runs from pointer-down through the complete answer and any AI section painting, after two animation frames. The native response identifies the first request as instance request 1. These are candidate-code browser/native-function checks against production data, not a deployed Netlify latency claim. Sean's live **6.1 s middle** and **9.3 s slow end** are shown beside each measurement; this is an operational comparison, not a controlled live A/B experiment.

The Anthropic key was present and never printed. The production credential is the existing `readonly` role, verified non-superuser with no table write grants. All database access uses the selected reader paths and read-only transactions/connections. Synthetic question headers, blocked other browser mutations and report-only accounting prevent production writes. A localhost GET/HEAD-only mirror of current public settings revision 663 applies the proposed unchanged-default playbook text; production settings and Admin model choices remain untouched.

The checks used exact ZIP/place/state/subject keys, paginated committee reads and scoped canonical payloads. No civic-table inventory, whole-table export or national campaign scan ran. The browser's normal ZIP background reads are included in the meter. **Total measured production response bytes: 92,894,361** — 3,669,833 bytes in 18 Neon HTTP responses and 89,224,528 bytes in PostgreSQL WebSocket messages. At $0.10 per decimal GB this is approximately **$0.00929**. This counts decoded HTTP response bodies and received PostgreSQL message payloads, including protocol overhead in those messages; it is not Neon's billing invoice or TLS framing. Two small role/grant permission queries ran before the new byte-meter instruction and were not instrumented; their bytes are excluded rather than invented. The full gate run added **zero production response bytes**. The change touches no schema contract paths, so the database gate checks migration immutability and needs no production query; no smoke read was forced.

The four matched legacy finance examples below still answer from verified filed summaries. Minnesota and Oakland now return **zero campaign committee records** through SRC-MN's reader: their old unbound records remain withdrawn. Ask shows the short gap and separate labeled AI explanation. The positive fixture proves eligible person-bound campaign summaries remain answerable rather than accepting every empty result. Pima has no held adopted-budget answer, ZIP 60601 has no held school-district answer, and Seattle's requested meeting week and governor holding are empty; their separate AI answers are explicit, including an unknown where appropriate. Adopted budgets are also checked against saved official bytes in the unchanged focused test.

The actual Ask result was inspected in the browser screenshots. The local check displayed a basemap-unavailable message; map tile delivery is outside this Ask change and is not claimed as verified. Local evidence is under ignored `.scratch/aq-01-release60/`: all 30 browser observations, native HTTP payloads, ten screenshots, byte-meter snapshots, focused logs and full gate logs. Earlier failed attempts remain there: the untouched old campaign fixture expected now-withdrawn records; the strengthened fixture first lacked its required source-copy reference; restricted execution and the default browser cache path also failed before the final 78/78 run. The first full gate attempt was stopped after the harness passed `WTP_VITAL_SIGNS_REPORT=1` into mock accounting tests, causing `tests/database-transfer.test.ts` to fail. The flag was removed from the gate environment; that unchanged file then passed 6/6, and the full gate set was restarted. No application or test assertion changed for this environment repair. No failed or interrupted run is substituted for a pass.

This branch is built and tested locally, not deployed. River owns folding the exact READY and shipping it. After pushing, AQ-01 checks `board/river:returns/aq-01.md` every 15 minutes, repairs returns without waiting, and stops only when River folds its READY.

## All 30 timings

| ZIP | Question | Complete answer | Reported live middle | Reported live slow end | Basis |
| --- | --- | --- | --- | --- | --- |
| 85701 | When was the last TUSD meeting? | 2.861 s | 6.1 s | 9.3 s | Held sources |
| 85701 | When is TUSD meeting next? | 0.711 s | 6.1 s | 9.3 s | Held sources |
| 85701 | What is Pima County's budget? | 1.579 s | 6.1 s | 9.3 s | Labeled AI |
| 85701 | How much campaign money has Mark Kelly raised? | 0.762 s | 6.1 s | 9.3 s | Held sources |
| 85701 | How did Mark Kelly vote on HR1? | 0.580 s | 6.1 s | 9.3 s | Held sources |
| 85701 | How much campaign money has Katie Hobbs raised? | 0.446 s | 6.1 s | 9.3 s | Held sources |
| 85701 | How much campaign money has Rodney Glassman raised? | 0.393 s | 6.1 s | 9.3 s | Held sources |
| 85701 | Which school district am I in? | 0.245 s | 6.1 s | 9.3 s | Held sources |
| 85701 | When's the school board getting together again? | 1.061 s | 6.1 s | 9.3 s | Held sources |
| 10001 | Who are my US senators? | 0.646 s | 6.1 s | 9.3 s | Held sources |
| 10001 | What's my congressional district? | 0.245 s | 6.1 s | 9.3 s | Held sources |
| 10001 | Who is running for governor? | 1.163 s | 6.1 s | 9.3 s | Held sources |
| 60601 | Who are my US senators? | 0.707 s | 6.1 s | 9.3 s | Held sources |
| 60601 | Which school district am I in? | 1.311 s | 6.1 s | 9.3 s | Labeled AI |
| 60601 | Who is running for governor? | 1.129 s | 6.1 s | 9.3 s | Held sources |
| 78701 | Who are my US senators? | 0.644 s | 6.1 s | 9.3 s | Held sources |
| 78701 | How did Ted Cruz vote on HR1? | 0.563 s | 6.1 s | 9.3 s | Held sources |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | 0.479 s | 6.1 s | 9.3 s | Held sources |
| 78701 | Who is running for governor? | 1.179 s | 6.1 s | 9.3 s | Held sources |
| 78701 | Which congressional district am I in? | 0.379 s | 6.1 s | 9.3 s | Held sources |
| 95814 | Who are my US senators? | 0.597 s | 6.1 s | 9.3 s | Held sources |
| 95814 | How did Alex Padilla vote on HR1? | 0.612 s | 6.1 s | 9.3 s | Held sources |
| 95814 | Which congressional district am I in? | 0.346 s | 6.1 s | 9.3 s | Held sources |
| 98101 | Who is my governor? | 0.945 s | 6.1 s | 9.3 s | Labeled AI |
| 98101 | Who's my US representative? | 0.562 s | 6.1 s | 9.3 s | Held sources |
| 98101 | Are there any meetings near me this week? | 1.246 s | 6.1 s | 9.3 s | Labeled AI |
| 55101 | What campaign finance records are held for Minnesota? | 2.268 s | 6.1 s | 9.3 s | Labeled AI |
| 94612 | What campaign finance records are held for Oakland? | 1.510 s | 6.1 s | 9.3 s | Labeled AI |
| 03301 | How much campaign money has Cinde Warmington raised? | 1.457 s | 6.1 s | 9.3 s | Held sources |
| 07960 | How much campaign money has Tayfun Selen raised? | 0.996 s | 6.1 s | 9.3 s | Held sources |

## Ten questions and answers

| ZIP | Question | Answer shown | Complete answer |
| --- | --- | --- | --- |
| 85701 | When was the last TUSD meeting? | The most recent TUSD meeting was the Alternative Education Advisory Committee on October 19 at 6:00 PM. | 2.861 s |
| 85701 | How did Mark Kelly vote on HR1? | Mark Kelly voted NO on H.R. 1. | 0.580 s |
| 78701 | How did Ted Cruz vote on HR1? | Ted Cruz voted YES on H.R. 1. | 0.563 s |
| 10001 | Who is running for governor? | Governor and Lt. Governor: Kathy C. Hochul and Adrienne E. Adams (Democratic / Working Families) and Bruce A. Blakeman and Todd Hood (Republican / Conservative / Vote Affordable). | 1.163 s |
| 85701 | How much campaign money has Katie Hobbs raised? | "Elect Katie Hobbs" raised $11,109,719.95 for January 1st, 2025 through December 31st, 2026. | 0.446 s |
| 85701 | How much campaign money has Rodney Glassman raised? | "Glassman for Attorney General" raised $3,775,589.91 for January 1st, 2025 through December 31st, 2026. | 0.393 s |
| 03301 | How much campaign money has Cinde Warmington raised? | "Friends of Cinde Warmington" raised $936,971.63 for the 2026 Election Cycle. | 1.457 s |
| 07960 | How much campaign money has Tayfun Selen raised? | "SELEN, TAYFUN" raised $225,025.50 in 14 reports filed through June 22nd, 2026; "SELEN, TAYFUN" raised $73,745.21 in 2 reports filed through October 6th, 2026. | 0.996 s |
| 55101 | What campaign finance records are held for Minnesota? | We don't have that answer yet. Separate labeled AI answer: Minnesota's Campaign Finance Board holds candidate, party, political committee, and lobbyist campaign finance disclosure records. | 2.268 s |
| 94612 | What campaign finance records are held for Oakland? | We don't have that answer yet. Separate labeled AI answer: Oakland campaign finance records include candidate and committee contribution and expenditure reports filed with the City of Oakland's Public Ethics Commission. | 1.510 s |
