# AQ-01 — River return repaired

The merged Ask keeps held finance and adopted-budget answers, concise answer-first copy, and SRC-MN's state/place campaign money. The requested River `011443fad6cfca5bb943f5c307925808fc8974c4` is merged (same tree as release-58 main `9ab71524b692cfe8f0f47dc8a2dcddb2ab480e4d`), followed by River `93ff0f4b64fcbab3e02972a5952b76c313d878b8`, including SH-01 and RS-03. This supersedes returned READY `6e24f7c44`.

**Production read-only browser check: 30/30 complete answers under three seconds.** Maximum and cold first Ask: **2.761 s**. Ten ZIPs in nine states; 26 answers from held sources and 4 separately labeled AI answers. The five returned test files pass **39/39**; together with the overlapping reader and owner checks, **66/66** pass, with no failures or skips.

**Full `pnpm gates`: 8/8 green.** The full unit suite registered 8,682 tests: **8,680 passed, 0 failed, 2 skipped**. Bundle tests pass **16/16** without skips. Preflight, lint, TypeScript, browser assertions, read-only schema check and both production/standalone builds pass. The final READY differs from that checked tree only in this result report.

The two optional source-fixture replays were skipped because their saved capture bytes are not supplied in this workspace: the held official-profile replay and Sierra Vista roster replay. They are not counted as passes. The secret-redaction test also reports its optional repository `.env.local` sweep did not run because that file is absent; that sweep is not claimed as verified.

## Repairs

- The government-finance composer declines with `null` when it has no matching holding, allowing other held-data composers to answer. Only after those composers decline and no finance facts are held does the route produce a short gap and ask the separate AI. A new regression requires exactly that one AI call; adopted-budget and audit tests retain their original assertions.
- The writer's shipped default instructions contain the exact rule from the length contract: at most **5 sentences and 700 characters**. Simple questions still ask for one sentence, answer first. Unchanged shipped defaults update through the existing edit log and undo; custom Admin text and model settings remain protected.
- Generic vote answers again say **“most recent recorded votes”**. Local filtered-vote wording and the retained-record count are restored. Exact-bill answers intentionally retain “Mark Kelly voted NO on H.R. 1.” because the reader requested that one vote; source positions, bill/Congress matching and retained history stay intact.
- Canceled-hedge accounting repeatedly awaited a dynamic Next adapter import. The winner could finish before the loser's cost row registered, racing the test's one-event-loop-turn check under load. The loaded adapter is now retained and subsequent work registers directly. Controlled delayed module resolution reproduces **one row before / two after** at the unchanged assertion; both versions eventually record the measured winner and unknown-cost loser. The cost test itself is unchanged.
- RS-02's canonical state/place readers replace the retired prepared-body path. River's deleted `body-rows.ts` and `state-reader.test.ts` remain deleted; the obsolete prepared-body SQL test is removed. State/place campaign facts and request-scoped state-money identities remain connected. Pure statewide-office and meeting-time lookups use RS-02's canonical state-authority reader and shared read-only socket without unrelated state-package families; statewide-office lookups also skip the federal directory.
- The later River merge keeps SH-01's state-reader recovery and RS-03's deleted warm routes and preloads. Its two conflicts are resolved without restoring the old warm tests or removing AQ-01's state/place-money and retained-history assertions.
- Meeting selection and validation now use the same exact instant. Midnight UTC had made a meeting earlier that evening look like a future record and sent a correct held answer through the model. The regression covers that evening across the UTC boundary and still rejects genuinely future records and a past record offered as next.
- Independent holdings settle alongside the canonical calendar. A meeting-time question uses RS-02's existing option to omit unopened agenda contents and first checks its current calendar. A miss reads the full retained calendar; a controlled-clock route test confirms an older sitting remains answerable. Agenda questions retain their full reads. The body-opening link uses the sourced name of Ask's exact resolved body, preventing an unrelated map-coverage committee label. Its existing explicit resolved-body guard is retained; unmatched bodies still render no opener.

These changes move §0's correct, fast answers from the facts already held for a reader's place. No spending limits, pauses, models, publishing policy or test thresholds changed. AQ-01 adds no migrations beyond those inherited unchanged from River. None of the five returned test files was edited for this repair.

## What the production check proves

The actual Ask button is pressed in Chromium on the built application. A fresh native `grounded-ask` engine loads at the first Ask; the measurement ends after the complete answer and its AI section, when present, paint. Every question uses real production canonical data through the verified `readonly` role: no superuser or table write grants, read-only database reads, synthetic questions, blocked other browser mutations and disabled accounting writes. The real Anthropic key was checked without printing it and the existing Admin models were used. A localhost read-only copy of current public settings carries the proposed shipped-default playbook edits; production settings are untouched.

The **6.1 s middle** and **9.3 s slow end** are Sean's reported live figures for 3 PM–11:20 PM ET, repeated beside every new measurement below. They are an operational comparison, not a controlled live A/B test. These are candidate-code browser/native-function measurements against production data; Netlify provisioning, deployed CDN behavior and production latency after River ships remain unverified.

Earlier failures are retained under `.scratch/aq-01-rs02/`: the midnight diagnostic rejected a valid meeting and took 8.092 s; the clock repair alone still had serialized reads. The first full browser matrix missed on Pima budget at 3.046 s, then the final-UI matrix exposed the overbroad governor lookup at 3.103 s. A later cold first Ask took 4.361 s because the retained-calendar read itself took 2.450 s, leading to the current-calendar-first repair. These failures led to code changes; unchanged warm retries are not substituted for them. The first full gate run had one empty-calendar failure, repaired while preserving its original expected gap; the focused empty-calendar/follow-up run passed 40/40.

Production still has no Arizona government-budget promotion for Pima's budget, no held school-district answer for ZIP 60601, and no held Seattle meeting for the requested week. These receive the separate, labeled AI answer, including an explicit unknown when the AI cannot answer. Washington's governor is answered by the labeled AI where the canonical holding is empty. Synthetic read-only runs do not create acquisition tasks; the existing organic-question hunt/brief connection remains covered by its integration test.

Local evidence includes the browser results and HTTP payloads, ten screenshots, role/grant check, delayed-registration reproduction, the returned-file/reader test log, full gate logs and the suite manifests. This branch is not deployed; River owns folding the new READY and shipping it.

Two supplemental held-governor checks also pass: ZIP 85701, “Who is my governor?” → Your governor is Katie Hobbs (Democratic). (0.427 s); ZIP 10001, “Who is the governor of Arizona?” → Your governor is Katie Hobbs (Democratic). (0.124 s).

River advanced during verification. The superseded release-58 gate run was stopped and preserved, not counted as passing; these 30 timings and the final gates use the merged SH-01/RS-03 tree. The first updated focused invocation missed the installed Chromium cache path; correcting the environment produced the 58/58 result without changing tests or application code.

The complete run on the pre-guard tree had 7/8 gates green: 8,679 unit passes, one failure and two skipped source-fixture replays. The owner check requires the explicit resolved-body guard; the sourced-name change had altered its expression. The runtime now applies the sourced name before that unchanged guard. The owner test is unchanged, and the final focused set passes 66/66. The corrected UI's 30-question run above passes independently.

## All 30 timings

| ZIP | Question | Complete answer | Reported live middle | Reported live slow end | Basis |
| --- | --- | --- | --- | --- | --- |
| 85701 | When was the last TUSD meeting? | 2.761 s | 6.1 s | 9.3 s | Held sources |
| 85701 | When is TUSD meeting next? | 0.846 s | 6.1 s | 9.3 s | Held sources |
| 85701 | What is Pima County's budget? | 1.562 s | 6.1 s | 9.3 s | Labeled AI |
| 85701 | How much campaign money has Mark Kelly raised? | 0.763 s | 6.1 s | 9.3 s | Held sources |
| 85701 | How did Mark Kelly vote on HR1? | 0.596 s | 6.1 s | 9.3 s | Held sources |
| 85701 | How much campaign money has Katie Hobbs raised? | 0.443 s | 6.1 s | 9.3 s | Held sources |
| 85701 | How much campaign money has Rodney Glassman raised? | 0.362 s | 6.1 s | 9.3 s | Held sources |
| 85701 | Which school district am I in? | 0.229 s | 6.1 s | 9.3 s | Held sources |
| 85701 | When's the school board getting together again? | 0.944 s | 6.1 s | 9.3 s | Held sources |
| 10001 | Who are my US senators? | 0.628 s | 6.1 s | 9.3 s | Held sources |
| 10001 | What's my congressional district? | 0.229 s | 6.1 s | 9.3 s | Held sources |
| 10001 | Who is running for governor? | 0.814 s | 6.1 s | 9.3 s | Held sources |
| 60601 | Who are my US senators? | 0.708 s | 6.1 s | 9.3 s | Held sources |
| 60601 | Which school district am I in? | 1.011 s | 6.1 s | 9.3 s | Labeled AI |
| 60601 | Who is running for governor? | 0.613 s | 6.1 s | 9.3 s | Held sources |
| 78701 | Who are my US senators? | 0.594 s | 6.1 s | 9.3 s | Held sources |
| 78701 | How did Ted Cruz vote on HR1? | 0.613 s | 6.1 s | 9.3 s | Held sources |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | 0.479 s | 6.1 s | 9.3 s | Held sources |
| 78701 | Who is running for governor? | 0.813 s | 6.1 s | 9.3 s | Held sources |
| 78701 | Which congressional district am I in? | 0.329 s | 6.1 s | 9.3 s | Held sources |
| 95814 | Who are my US senators? | 0.528 s | 6.1 s | 9.3 s | Held sources |
| 95814 | How did Alex Padilla vote on HR1? | 0.529 s | 6.1 s | 9.3 s | Held sources |
| 95814 | Which congressional district am I in? | 0.313 s | 6.1 s | 9.3 s | Held sources |
| 98101 | Who is my governor? | 1.027 s | 6.1 s | 9.3 s | Labeled AI |
| 98101 | Who's my US representative? | 0.530 s | 6.1 s | 9.3 s | Held sources |
| 98101 | Are there any meetings near me this week? | 1.430 s | 6.1 s | 9.3 s | Labeled AI |
| 55101 | What campaign finance records are held for Minnesota? | 1.003 s | 6.1 s | 9.3 s | Held sources |
| 94612 | What campaign finance records are held for Oakland? | 0.911 s | 6.1 s | 9.3 s | Held sources |
| 03301 | How much campaign money has Cinde Warmington raised? | 1.539 s | 6.1 s | 9.3 s | Held sources |
| 07960 | How much campaign money has Tayfun Selen raised? | 0.879 s | 6.1 s | 9.3 s | Held sources |

## Ten questions and answers

| ZIP | Question | Answer shown | Complete answer |
| --- | --- | --- | --- |
| 85701 | When was the last TUSD meeting? | The most recent TUSD meeting was the Alternative Education Advisory Committee on October 19 at 6:00 PM. | 2.761 s |
| 85701 | How did Mark Kelly vote on HR1? | Mark Kelly voted NO on H.R. 1. | 0.596 s |
| 78701 | How did Ted Cruz vote on HR1? | Ted Cruz voted YES on H.R. 1. | 0.613 s |
| 10001 | Who is running for governor? | Governor and Lt. Governor: Kathy C. Hochul and Adrienne E. Adams (Democratic / Working Families) and Bruce A. Blakeman and Todd Hood (Republican / Conservative / Vote Affordable). | 0.814 s |
| 85701 | How much campaign money has Katie Hobbs raised? | "Elect Katie Hobbs" raised $11,109,719.95 for January 1st, 2025 through December 31st, 2026. | 0.443 s |
| 85701 | How much campaign money has Rodney Glassman raised? | "Glassman for Attorney General" raised $3,775,589.91 for January 1st, 2025 through December 31st, 2026. | 0.362 s |
| 03301 | How much campaign money has Cinde Warmington raised? | "Friends of Cinde Warmington" raised $936,971.63 for the 2026 Election Cycle. | 1.539 s |
| 07960 | How much campaign money has Tayfun Selen raised? | "SELEN, TAYFUN" raised $225,025.50 in 14 reports filed through June 22nd, 2026; "SELEN, TAYFUN" raised $73,745.21 in 2 reports filed through October 6th, 2026. | 0.879 s |
| 55101 | What campaign finance records are held for Minnesota? | Held campaign records include “Gruenhagen, Glenn Senate Committee”. | 1.003 s |
| 94612 | What campaign finance records are held for Oakland? | Held campaign records include “Shanthi Gonzales School Board Officeholder Committee”. | 0.911 s |
