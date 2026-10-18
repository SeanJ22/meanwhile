# AQ-01 — production-data acceptance report

**AQ-01 passes the branch acceptance checks and is ready for River.** All 24 questions across Arizona, New York, Illinois, Texas, California and Washington completed on screen in under three seconds. The slowest was **2,344 ms**. The first Ask after starting the optimized server was the requested last-TUSD question, at **2,056 ms**.

Twenty answers used held sources. Two gaps received short, labeled AI answers. Two questions remained explicit unknowns; they are listed below and are not counted as supplied facts. This verifies correct gap handling, not complete data coverage.

Branch: `stream/aq-01`, continued from `911308a12`; ship commit title: `READY: AQ-01`. The branch includes the shared SH-01 federal-directory fallback repair through merge `94c7bc615` (dependency `f2c0d00c6`). The code is built and tested; River integration and deployment remain River's next action. This report does not claim that the change is deployed or already serving production readers.

`ANTHROPIC_API_KEY` was checked first and was present without printing it. A live Anthropic request returned HTTP 200. The earlier credential blocker is resolved.

## What residents get

Ask gives the requested answer first, using the resident's actual words and place, followed by sources. Local abbreviations, loose meeting wording, officials, exact votes, campaign money, ballots and districts work across the tested states. Meeting times use the body's local time. Unrequested biographies, agenda digests and lookup advice no longer follow a simple answer.

The requested TUSD answer is: “The most recent TUSD meeting was the Budget Advisory Committee on October 7 at 4:00 PM.” An explicit school-board question selects the publisher's Governing Board sitting instead of an advisory committee on the same district calendar.

These changes move §0's correct, fast answers about who governs a place, meetings, accountability, funding and ballots. Unheld questions carry an explicit gap and a separately labeled AI answer, and organic questions enter the existing acquisition work and daily brief.

## Implementation

- Bind acronyms, loose wording and long confirmation topics without an unnecessary model call. Join official identities through publisher IDs or the existing candidacy bridge; names do not join people.
- Read only the evidence needed for the question. Known-body meeting-time reads omit agenda text in SQL; area meeting questions skip unrelated officials; government budgets skip unrelated campaign and vote records; district questions read the requested district type.
- Reuse reviewed, held key-vote positions for exact bill questions. Preserve the national question catalog while selecting only the requested members' position cells. Keep concurrent requests' key-vote state separate. Kelly, Cruz and Padilla's H.R. 1 answers now use held positions, not model guesses.
- Distinguish H.R. 1 from H.R. 10 and honor an explicit year or Congress. Keep verification dates separate from vote dates. Exact confirmations distinguish the voting member from the nominee.
- Batch the anchored retained-history chain and select potential exact-bill matches in SQL. Selected records still receive the existing promotion checks; the whole chain still receives ambiguity, missing-link and cycle checks. Encoded payloads remain candidates for the full reader.
- A missing recent vote can prepare the general AI answer while retained records are checked. A held answer wins and cancels unused AI work. The labeled general answer uses the existing Admin-selected model, current date, relevant place and shipped playbook; an explicit unknown stays “I don't know.” Generated answers are not clipped to manufacture shortness or a timing pass.
- Unanswered organic questions create the existing work item, hunt plan and route task. The actual scrubbed question and held place facts reach the hunter; open questions appear in the daily brief. No new data family, checklist, gate or alert was added.
- Shipped-default Ask playbooks refresh through the existing settings log and undo path; custom Admin edits are preserved. Production settings, model choices, budgets and pauses were not changed by this test.

## Verification

The acceptance target was the actual optimized Next.js application and built `/api/ask/grounded` handler, with a localhost-only listener. Production civic data was read through the existing `readonly` database role. Read-only privileges were checked: SELECT allowed and INSERT/UPDATE/DELETE denied for the relevant civic, fact and accounting tables. The injected development database was not used.

Chromium pressed the real Ask button. Timing began at pointer-down and ended after the complete new answer, including any AI answer, was in the DOM and two animation frames had elapsed. No streaming or first-token cutoff was used. Each ZIP started on a new page. The last-TUSD question was the first Ask after server startup, so its time includes the built Ask route's first request. The browser checked that every missing-data case actually displayed its AI answer.

The environment had no production Netlify Blobs binding. A localhost read-only serving copy supplied public production Admin settings with the proposed shipped-default playbooks through the normal Blobs SDK path. Civic-data artifacts missed that mirror and exercised the canonical production database fallback. The final API run used no source-route adapter or test settings injection. These results establish branch behavior against production data; deployed Netlify platform cold-start latency remains unmeasured.

All requests were synthetic. Other browser mutations were suppressed and transfer accounting was disabled for the run. No production civic-data, reader-question, acquisition-work, settings, budget or pause writes were made. The temporary local read-only database credential was removed after verification.

Checks passed:

- 643 tests across Ask, reader, retained history, key votes, playbooks, daily brief and hunter suites, with zero failures or skips. Final changed-route and fallback regression suites also passed, including the area-meeting exclusion check.
- Optimized production build and TypeScript checks; changed-file lint and `git diff --check`. The existing Next.js middleware-to-proxy deprecation warning remains.
- All 24 complete-screen timings below, plus review of the exact held identities, meeting timestamps, office/ballot fields, district divisions and FEC values. The H.R. 1 checks also assert held key-vote records with Congress 119. This is comparison against held production records, not an independent fresh verification of every publisher page.
- Visual inspection of the sourced school-board answer and the Seattle gap/AI answer on the actual page. The browser guard suppresses paid basemap requests, which accounts for the map-background notice in test screenshots.
- In-memory integration of unanswered-question creation, coordinator selection, hunter delivery with held facts, and daily-brief appearance. A finished hunt leaves the question open; it is not mistaken for publication. Live production dispatch, publication and eventual question closure were not exercised by this read-only acceptance run.

The earlier 16/24 timing result failed and was not accepted. Narrowing meeting rows, reusing held key votes, filtering retained bill history and removing unrelated area-meeting reads repaired the measured causes. A later 4.60-second area-meeting follow-up was retained and led to the last exclusion fix. Earlier experimental AI formats that guessed incorrect votes were removed. The final optimized-API run below is a new run after those changes, not faster retries substituted into the failed sample set. A local settings-mirror configuration error was also corrected before this final run; the incomplete fallback run was not counted as passing.

## All 24 complete-screen results

Every row passed the strict under-3,000-ms timing check. “Explicit unknown” means the requested fact is still missing, not that the underlying coverage is complete.

| ZIP | Question | Ask press to full answer | Answer source |
| --- | --- | ---: | --- |
| 85701 | When was the last TUSD meeting? | 2,056 ms | Held sources |
| 85701 | When is TUSD meeting next? | 1,512 ms | Held sources |
| 85701 | What is Pima County's budget? | 1,813 ms | Explicit unknown |
| 85701 | How much campaign money has Mark Kelly raised? | 1,780 ms | Held sources |
| 85701 | How did Mark Kelly vote on HR1? | 1,527 ms | Held sources |
| 85701 | Which school district am I in? | 1,077 ms | Held sources |
| 85701 | When's the school board getting together again? | 1,279 ms | Held sources |
| 10001 | Who are my US senators? | 644 ms | Held sources |
| 10001 | What's my congressional district? | 279 ms | Held sources |
| 10001 | Who is running for governor? | 296 ms | Held sources |
| 60601 | Who are my US senators? | 1,059 ms | Held sources |
| 60601 | Which school district am I in? | 1,035 ms | Labeled AI |
| 60601 | Who is running for governor? | 396 ms | Held sources |
| 78701 | Who are my US senators? | 710 ms | Held sources |
| 78701 | How did Ted Cruz vote on HR1? | 1,000 ms | Held sources |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | 746 ms | Held sources |
| 78701 | Who is running for governor? | 396 ms | Held sources |
| 78701 | Which congressional district am I in? | 263 ms | Held sources |
| 95814 | Who are my US senators? | 808 ms | Held sources |
| 95814 | How did Alex Padilla vote on HR1? | 1,081 ms | Held sources |
| 95814 | Which congressional district am I in? | 311 ms | Held sources |
| 98101 | Who is my governor? | 2,344 ms | Labeled AI |
| 98101 | Who's my US representative? | 585 ms | Held sources |
| 98101 | Are there any meetings near me this week? | 1,279 ms | Explicit unknown |

## Ten observed questions and answers

These answer bodies and timings are verbatim from the final optimized-API browser run.

| ZIP | Question | Answer on screen | Time |
| --- | --- | --- | ---: |
| 85701 | When was the last TUSD meeting? | The most recent TUSD meeting was the Budget Advisory Committee on October 7 at 4:00 PM. | 2,056 ms |
| 85701 | When's the school board getting together again? | The next Tucson Unified School District Governing Board meeting is on October 20 at 5:00 PM. | 1,279 ms |
| 85701 | How much campaign money has Mark Kelly raised? | Mark Kelly's campaign raised $40,775,022.69 in the 2025–26 cycle through June 30th, 2026. | 1,780 ms |
| 85701 | How did Mark Kelly vote on HR1? | Mark Kelly voted NO on H.R. 1. | 1,527 ms |
| 78701 | How did Ted Cruz vote on HR1? | Ted Cruz voted YES on H.R. 1. | 1,000 ms |
| 95814 | How did Alex Padilla vote on HR1? | Alex Padilla voted NO on H.R. 1. | 1,081 ms |
| 10001 | Who is running for governor? | Governor and Lt. Governor: Kathy C. Hochul and Adrienne E. Adams (Democratic / Working Families) and Bruce A. Blakeman and Todd Hood (Republican / Conservative / Vote Affordable). | 296 ms |
| 60601 | Who are my US senators? | Your United States Senators are Richard J. Durbin (Democrat) and Tammy Duckworth (Democrat). | 1,059 ms |
| 10001 | What's my congressional district? | ZIP 10001 is in Congressional District 12. | 279 ms |
| 98101 | Who's my US representative? | Your United States Representative is Pramila Jayapal (Democrat) for District 7. | 585 ms |

Sources remain below the answer. Relevant public production readers include [Tucson meetings](https://meanwhileusa.com/api/meetings?zip=85701&lat=32.21704&lng=-110.97134), [Kelly funding](https://meanwhileusa.com/api/funding/congress:K000377), [Kelly votes](https://meanwhileusa.com/api/votes?member=congress:K000377), and state representation readers at `/api/representation/ocd-division/country:us/state:{az,ca,tx,ny,il,wa}`.

## Coverage still open

| ZIP | Question | Gap and labeled AI answer in this run | Next owner/action |
| --- | --- | --- | --- |
| 85701 | What is Pima County's budget? | “We don't have that answer yet.” / AI answer: “I don't know.” | Existing acquisition runtime: acquire and publish the official budget. No approximate budget was substituted. |
| 60601 | Which school district am I in? | “We don't have that answer yet.” / AI answer: “ZIP 60601 (Chicago, IL) is served by Chicago Public Schools (District 299).” | Existing acquisition runtime: publish the sourced district coverage. This is an AI answer, not a held district fact. |
| 98101 | Who is my governor? | “We have not recorded who your governor is yet.” / AI answer: “Bob Ferguson is the governor of Washington State.” | Shared registry/publication work: recover the statewide executive through the normal path. The current promoted Washington registry has no statewide executive rows; the cause of the contradiction with earlier records is still unknown. |
| 98101 | Are there any meetings near me this week? | “We don't have meeting information in the next 7 days for your area yet.” / AI answer: “I don't know.” | Existing acquisition runtime: acquire and publish the area's meeting coverage. The gap does not assert that no meetings exist. |

Organic questions automatically create the existing standing work. Synthetic acceptance questions created no production work. River owns folding the exact READY commit and running the combined gates; deployment and observation of the live acquisition/publication lifecycle follow the existing release and runtime paths.
