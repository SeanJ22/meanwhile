# AQ-01 — production-data acceptance report

**AQ-01 is unfinished. No READY commit is justified.** The latest complete browser run returned 16 of 24 answers in under three seconds; eight exceeded the limit, up to 12.923 seconds. General AI answers also still add unwanted caveats and lookup advice. This branch must not be folded as a completed AQ-01.

Branch: `stream/aq-01`, continued from `911308a12`. The branch includes the shared SH-01 federal-directory fallback repair through merge `94c7bc615` (SH-01 dependency `f2c0d00c6`). Nothing in this task is merged into River or deployed.

`ANTHROPIC_API_KEY` was checked first and was present without printing it. A live Anthropic request succeeded with HTTP 200. The earlier credential blocker is resolved.

## Verified improvements

The exact held confirmation vote answered in 885 ms: “Ted Cruz voted YES on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor (PN1129).” The requested nominee is matched independently of other names in the question, using the member's native identity.

Kelly's held FEC total answered in 1,848 ms with the exact amount, cycle and filing-through date. The requested TUSD sentence is reproduced, including the acronym and local time, but its 4,821 ms UI result fails the speed requirement.

These changes move §0's direct answers, correct use of place and held identities, and automatic acquisition of unanswered questions. They do not yet satisfy §0's complete, correct, fast reader experience.

## Changes in this continuation

- Bind local acronyms, loose meeting wording and long vote topics without an unnecessary model call. Join duplicate official roles only through publisher person IDs or the committed candidacy bridge.
- Select exact bill numbers and named confirmations; a different bill or nominee cannot stand in. Use an already answering recent vote without loading its entire history. Missing topics still check retained history.
- Narrow source reads to the question: known bodies, requested offices, exact federal votes or campaign money. Meeting time questions avoid unrelated comment-access and personal records. Recent calendar answers retain an older-calendar fallback when no past sitting is in the shown window.
- Batch the exact retained pointer chain into one database query while preserving the existing promotion, ambiguity and cycle checks. This improves historical reads but does not bring missing-vote requests under three seconds.
- Match joint governor tickets and keep separate lieutenant-governor races distinct. Give missing finance, meeting, district and official answers an explicit gap plus the labeled AI answer.
- Put the actual answer above sources and remove unrelated route/digest blocks when an answer is present. The browser screenshot was inspected.
- Connect unanswered organic questions to the existing hunter plan and task, carry the scrubbed question and held place facts into the hunter's brief, and include open questions in the daily brief. A memory-repository integration test verifies coordinator selection, delivery to the hunter and brief appearance. A finished hunt leaves the question open; it is not treated as evidence of publication. Production dispatch, fact publication and eventual question closure have not been verified in this read-only run.
- Strengthen the shipped general-AI instructions and remove the acquisition-only saved-bytes requirement from that role. Existing Admin edits, budgets and pauses are preserved. The new instructions are not published to production.

## Verification method and limits

Production data was read using the existing `readonly` database role, confirmed without printing its connection string. Its role was not a Neon superuser. Public production manifest/settings and reader responses supplied the remaining inputs. The injected development database was not used for acceptance.

Chromium used the built branch's actual AskBox. Timing began with the Enter key that submitted Ask and ended after the complete new answer, including any AI answer, was in the DOM and two animation frames had elapsed. These are full press-to-screen timings, not interpretation-only or first-token timings. Each ZIP's first Ask used a new page; the run includes first-use state reads. Slow samples were retained and were not replaced with faster retries.

The changed API handler ran through a local source-route adapter with public production Admin values and the proposed shipped playbooks. The frontend was an optimized Next.js build. The environment had no Netlify Blobs binding, so readers exercised the canonical database fallback. This is production-data verification of the branch, **not** a claim about deployed Netlify cold-start performance. The source module was loaded before pressing Ask; server module startup is not included.

All Ask calls were synthetic, and other browser mutation requests were suppressed. No production civic-data, question, acquisition-work, playbook, budget or pause writes were made. Real question-work writes were exercised only in memory repositories.

Checks passed: 600 tests across Ask, reader, retained history, playbooks, daily brief and hunter suites; the final governor regression suite passed 15 tests, and the final route/question-work delta passed 24 tests. TypeScript and changed-file lint passed. The optimized production build passed with the existing Next.js middleware-to-proxy deprecation warning. These passing checks do not turn the failed browser acceptance into a pass.

## All 24 browser timings

The verdict in this table is the strict timing check only; it is not a claim that every answer passed accuracy and concision review.

| ZIP | Question | Press to complete screen | Timing |
| --- | --- | ---: | --- |
| 10001 | Who are my US senators? | 984 ms | Pass |
| 10001 | What's my congressional district? | 1,756 ms | Pass |
| 10001 | Who is running for governor? | 903 ms | Pass |
| 60601 | Who are my US senators? | 1,032 ms | Pass |
| 60601 | Which school district am I in? | 3,971 ms | FAIL |
| 60601 | Who is running for governor? | 843 ms | Pass |
| 78701 | Who are my US senators? | 741 ms | Pass |
| 78701 | How did Ted Cruz vote on HR1? | 8,518 ms | FAIL |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | 885 ms | Pass |
| 78701 | Who is running for governor? | 1,003 ms | Pass |
| 78701 | Which congressional district am I in? | 2,302 ms | Pass |
| 85701 | When was the last TUSD meeting? | 4,821 ms | FAIL |
| 85701 | When is TUSD meeting next? | 3,693 ms | FAIL |
| 85701 | What is Pima County's budget? | 12,923 ms | FAIL |
| 85701 | How much campaign money has Mark Kelly raised? | 1,848 ms | Pass |
| 85701 | How did Mark Kelly vote on HR1? | 4,019 ms | FAIL |
| 85701 | Which school district am I in? | 1,035 ms | Pass |
| 85701 | When's the school board getting together again? | 5,585 ms | FAIL |
| 95814 | Who are my US senators? | 657 ms | Pass |
| 95814 | How did Alex Padilla vote on HR1? | 8,865 ms | FAIL |
| 95814 | Which congressional district am I in? | 2,086 ms | Pass |
| 98101 | Who is my governor? | 1,493 ms | Pass |
| 98101 | Who's my US representative? | 528 ms | Pass |
| 98101 | Are there any meetings near me this week? | 2,503 ms | Pass |

## Ten observed questions and answers

These are verbatim answer bodies from the same browser run. The two slow meeting answers remain failures. The loose school-board question also needs a correctness check: the stored governing-body calendar includes an advisory committee, so that committee must not silently stand in for a requested governing-board sitting.

| ZIP | Question | Answer on screen | Time |
| --- | --- | --- | ---: |
| 85701 | When was the last TUSD meeting? | The most recent TUSD meeting was the Budget Advisory Committee on October 7 at 4:00 PM. | 4,821 ms |
| 85701 | When's the school board getting together again? | The next Tucson Unified School District Governing Board meeting is the Alternative Education Advisory Committee on October 19 at 6:00 PM. | 5,585 ms |
| 85701 | How much campaign money has Mark Kelly raised? | Mark Kelly's campaign raised $40,775,022.69 in the 2025–26 cycle through June 30th, 2026. | 1,848 ms |
| 85701 | Which school district am I in? | ZIP 85701 is in Tucson Unified District. | 1,035 ms |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | Ted Cruz voted YES on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor (PN1129). | 885 ms |
| 10001 | Who is running for governor? | Governor and Lt. Governor: Kathy C. Hochul and Adrienne E. Adams (Democratic / Working Families) and Bruce A. Blakeman and Todd Hood (Republican / Conservative / Vote Affordable). | 903 ms |
| 10001 | What's my congressional district? | ZIP 10001 is in Congressional District 12. | 1,756 ms |
| 60601 | Who are my US senators? | Your United States Senators are Richard J. Durbin (Democrat) and Tammy Duckworth (Democrat). | 1,032 ms |
| 95814 | Who are my US senators? | Your United States Senators are Adam B. Schiff (Democrat) and Alex Padilla (Democrat). | 657 ms |
| 98101 | Who's my US representative? | Your United States Representative is Pramila Jayapal (Democrat) for District 7. | 528 ms |

Held inputs were compared by exact body/member identity, meeting timestamps, ballot office, district division and FEC totals. Sources stayed below the answer. Relevant public reader doors include [Tucson meetings](https://meanwhileusa.com/api/meetings?zip=85701&lat=32.21704&lng=-110.97134), [Kelly funding](https://meanwhileusa.com/api/funding/congress:K000377), [Kelly votes](https://meanwhileusa.com/api/votes?member=congress:K000377), and state representation readers at `/api/representation/ocd-division/country:us/state:{az,ca,tx,ny,il,wa}`. This comparison is against held production records, not an independent re-verification of every publisher's current page.

## Remaining failures and next actions

**AQ-01 owner: Codex.** Reduce cold meeting and government-finance reads and retained-history lookups, then rerun the complete press-to-screen mix. The direct TUSD probes also exceeded three seconds, so this is not merely browser rendering. Pima County budget took 12.923 seconds and returned a gap plus an unverified approximate AI figure; it is not an acceptable direct answer.

**AQ-01 owner: Codex.** Fix general-AI concision and place interpretation. Illinois's missing school-district answer still insists on a street address instead of answering about the ZIP area. Missing H.R. 1 requests still walk history slowly and return lengthy ambiguity or verification narration. Seattle's missing meeting answer adds lookup advice. Do not truncate generated prose or omit retained evidence to manufacture a timing pass.

**Shared reader/publication dependency, coordinated with SH-01/RS-01.** The current production Washington registry projection `cv-efb9964f5815fb57e45223395f42022a` is promoted but has no statewide executive rows. Earlier reader responses had Bob Ferguson. The canonical read does not establish why those rows disappeared. Ask now correctly calls this an unrecorded governor rather than falsely reporting a loading failure from an unrelated empty legislative district. Its separate AI answer names Bob Ferguson. Recover the held official through the normal publication/read path and investigate the contradictory versions; do not manually insert a name or claim the canonical data is complete.

**AQ-01 owner: Codex, with the existing hunter/publication runtime.** Verify actual question dispatch and publication lifecycle in an isolated writable test environment without changing production data or Admin spending authority. The memory integration establishes the wiring, not live fleet operation or automatic closure after a verified answer publishes.

READY requires the requested mix to be correct, concise and complete on screen in under three seconds for every question. That condition remains unmet. The saved branch is WIP, not ready for River to fold as AQ-01.
