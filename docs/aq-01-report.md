# AQ-01 — River return repaired

**The SRC-MN merge conflict is resolved and AQ-01 is ready for River again.** Current `river` (`6b4ea17aff9153d1f4da0cfc03ce5f23a7186b3c`) is merged into `stream/aq-01`. This supersedes the returned `01f987827` READY. River returned that commit for an integration conflict, without running the combined gates; it did not report its earlier Ask acceptance as a failed test.

The final optimized-application run completed **30 of 30 questions in under three seconds**, across ten ZIPs in nine states. Slowest: **2,377 ms**. The first Ask after server startup, “When was the last TUSD meeting?”, took **2,034 ms**. There were 26 sourced answers, 2 labeled AI factual answers and 2 explicit unknowns. Unknowns are coverage gaps, not supplied facts.

The branch is built and tested for a new `READY: AQ-01` push. River owns folding that exact commit and the combined gates. This continuation is not yet integrated into River or deployed.

## What changed

The conflict in `app/api/ask/grounded/route.ts` now keeps AQ-01's concise answer composition and narrow vote reads, SRC-MN's applicable campaign-finance preload, and both state/place campaign-evidence connections. No later SRC-MN WIP was merged.

The expanded tests exposed additional integration failures, which were repaired before READY:

- Named state-money questions select the requested source filer's rows in the finance query. The filing's own verified target aliases supply one subject, so Katie Hobbs's campaign question no longer offers three identical names. This reads the source filing as its own identity; a name does not join separate officeholder or ballot identities.
- State-money request caches are separate, so concurrent questions cannot inherit another reader's selected filings. Source queries return matching rows rather than the entire state's payload.
- A held named place can be resolved through SRC-MN's existing state/place fact index when the Ask request's meeting divisions omit its city. Oakland now reaches its held campaign facts. The resolver stays inside the selected state and uses an existing canonical place ID.
- State campaign-money answers keep the applicable curated campaign source and skip unrelated FEC, Pima, biography, ballot and comment-access reads once the source filer is selected. Votes keep their existing exact-member and exact-bill reads.
- Multiple filings state only the requested measures, keep their own periods and stay separate. Source report codes are omitted from the prose. A cycle ending in the future is not presented as a filing checked through that date.

The original AQ-01 behavior remains: answer first, sources below; local abbreviations and loose meeting wording; the Governing Board sitting for an explicit school-board question; exact H.R. 1 and confirmation matching; body-local meeting times; and a plain gap plus labeled AI answer when the site lacks the answer. Unanswered organic questions still enter the existing hunt work and daily brief.

These changes move §0's correct, fast answers about government, meetings, votes, campaign money, ballots and districts, while reusing held facts for the requested place.

## Verification and limits

The actual optimized Next.js client and built Ask handler ran on localhost. Chromium pressed the real Ask button; timing began at pointer-down and ended after the entire new answer, including any AI answer, was in the DOM and two animation frames had elapsed. Each ZIP began on a new page. The first Ask was after a fresh server start. No streaming or first-token cutoff was used.

Production data came from Neon production branch `br-delicate-lab-ax02xuo5`, through the existing `readonly` role. SELECT permission and denied INSERT/UPDATE/DELETE permissions were verified for the civic, fact, entity and accounting tables. The injected development database was not used. All Ask requests were synthetic, other browser writes were suppressed, and transfer-accounting writes were disabled. No production civic data, reader questions, work, settings, budgets or pauses were written. The temporary local database credential was removed after the run.

Public production Admin values and the proposed shipped-default Ask playbooks were served through the normal Blobs SDK path from a local read-only settings copy. The current Admin fallback model, Claude Haiku 5.5, was preserved. Civic artifacts exercised the canonical production database fallback because this environment has no production Netlify Blobs binding. This is branch verification against production data; Netlify platform cold-start latency is unmeasured.

The final native campaign questions read actual Minnesota and Oakland fact pages, with publisher URLs and checked times. They identify committees in the first held page; further filings remain paged. The state-person answers use actual held Arizona, New Hampshire and New Jersey filings. Their amounts and periods were compared to the returned source records; the separate Selen filings were not summed.

Checks passed: **607 Ask, reader and campaign-source tests, zero failures or skips**, plus the native-finance identity checks; optimized build and TypeScript; changed-file lint; build-output and runtime-file checks; and `git diff --check`. The actual page was inspected for the new source answers. The browser guard suppresses paid basemap requests, which explains the map-background notice in screenshots. The existing Next.js middleware deprecation warning remains.

The earlier expanded sweep failed the added campaign questions, including duplicate Hobbs choices, unbound native place questions and missing held filings. A later sweep still failed Oakland at 5,310 ms and Selen at 3,141 ms; those caused the final place-resolution and source-selection fixes. Those samples were retained. This table comes from one complete run after those changes, with no individual fast retries substituted for slow rows.

A separate sweep stopped when Anthropic exceeded the existing 2.5-second deadline for Illinois's missing school district, leaving no AI answer. The external provider check recovered in 1,088 ms. That incomplete sweep is retained separately and was not counted as passing. General-AI availability remains subject to provider timeouts; this change does not remove that dependency.

The automatic unanswered-question/hunter/brief connection is covered by the existing in-memory integration test. Live production dispatch, publication and eventual question closure were not exercised during this read-only run.

## All 30 complete-screen timings

| ZIP | Question | Ask press to complete answer | Answer source |
| --- | --- | ---: | --- |
| 85701 | When was the last TUSD meeting? | 2,034 ms | Held sources |
| 85701 | When is TUSD meeting next? | 1,412 ms | Held sources |
| 85701 | What is Pima County's budget? | 2,377 ms | Explicit unknown |
| 85701 | How much campaign money has Mark Kelly raised? | 1,527 ms | Held sources |
| 85701 | How did Mark Kelly vote on HR1? | 1,145 ms | Held sources |
| 85701 | How much campaign money has Katie Hobbs raised? | 1,043 ms | Held sources |
| 85701 | How much campaign money has Rodney Glassman raised? | 1,079 ms | Held sources |
| 85701 | Which school district am I in? | 1,084 ms | Held sources |
| 85701 | When's the school board getting together again? | 1,045 ms | Held sources |
| 10001 | Who are my US senators? | 564 ms | Held sources |
| 10001 | What's my congressional district? | 342 ms | Held sources |
| 10001 | Who is running for governor? | 511 ms | Held sources |
| 60601 | Who are my US senators? | 1,284 ms | Held sources |
| 60601 | Which school district am I in? | 1,195 ms | Labeled AI |
| 60601 | Who is running for governor? | 245 ms | Held sources |
| 78701 | Who are my US senators? | 647 ms | Held sources |
| 78701 | How did Ted Cruz vote on HR1? | 845 ms | Held sources |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | 563 ms | Held sources |
| 78701 | Who is running for governor? | 444 ms | Held sources |
| 78701 | Which congressional district am I in? | 192 ms | Held sources |
| 95814 | Who are my US senators? | 638 ms | Held sources |
| 95814 | How did Alex Padilla vote on HR1? | 794 ms | Held sources |
| 95814 | Which congressional district am I in? | 178 ms | Held sources |
| 98101 | Who is my governor? | 1,501 ms | Labeled AI |
| 98101 | Who's my US representative? | 545 ms | Held sources |
| 98101 | Are there any meetings near me this week? | 1,229 ms | Explicit unknown |
| 55101 | What campaign finance records are held for Minnesota? | 556 ms | Held sources |
| 94612 | What campaign finance records are held for Oakland? | 915 ms | Held sources |
| 03301 | How much campaign money has Cinde Warmington raised? | 958 ms | Held sources |
| 07960 | How much campaign money has Tayfun Selen raised? | 1,323 ms | Held sources |

## Ten observed questions and answers

These are verbatim answer bodies from the final browser run.

| ZIP | Question | Answer on screen | Time |
| --- | --- | --- | ---: |
| 85701 | When was the last TUSD meeting? | The most recent TUSD meeting was the Budget Advisory Committee on October 7 at 4:00 PM. | 2,034 ms |
| 85701 | How did Mark Kelly vote on HR1? | Mark Kelly voted NO on H.R. 1. | 1,145 ms |
| 78701 | How did Ted Cruz vote on HR1? | Ted Cruz voted YES on H.R. 1. | 845 ms |
| 10001 | Who is running for governor? | Governor and Lt. Governor: Kathy C. Hochul and Adrienne E. Adams (Democratic / Working Families) and Bruce A. Blakeman and Todd Hood (Republican / Conservative / Vote Affordable). | 511 ms |
| 85701 | How much campaign money has Katie Hobbs raised? | "Elect Katie Hobbs" raised $11,109,719.95 for January 1st, 2025 through December 31st, 2026. | 1,043 ms |
| 85701 | How much campaign money has Rodney Glassman raised? | "Glassman for Attorney General" raised $3,775,589.91 for January 1st, 2025 through December 31st, 2026. | 1,079 ms |
| 03301 | How much campaign money has Cinde Warmington raised? | "Friends of Cinde Warmington" raised $936,971.63 for the 2026 Election Cycle. | 958 ms |
| 07960 | How much campaign money has Tayfun Selen raised? | "SELEN, TAYFUN" raised $225,025.50 in 14 reports filed through June 22nd, 2026; "SELEN, TAYFUN" raised $73,745.21 in 2 reports filed through October 6th, 2026. | 1,323 ms |
| 55101 | What campaign finance records are held for Minnesota? | Held campaign records include “Gruenhagen, Glenn Senate Committee”. | 556 ms |
| 94612 | What campaign finance records are held for Oakland? | Held campaign records include “Shanthi Gonzales School Board Officeholder Committee”. | 915 ms |

## Coverage still open

The final run exposed the following held-data gaps. Organic requests create existing acquisition work; synthetic tests created none. The existing acquisition/publication runtime owns obtaining and publishing these answers. The Washington executive-row contradiction remains shared registry/publication work.

| ZIP | Question | Held-data gap | Labeled AI answer |
| --- | --- | --- | --- |
| 85701 | What is Pima County's budget? | We don't have that answer yet. | I don't know. |
| 60601 | Which school district am I in? | We don't have that answer yet. | ZIP 60601 (Chicago, IL) is served by Chicago Public Schools (District 299). |
| 98101 | Who is my governor? | We have not recorded who your governor is yet. | Bob Ferguson is Washington's governor. |
| 98101 | Are there any meetings near me this week? | We don't have meeting information in the next 7 days for your area yet. | I don't know. |

River owns integrating the new READY and releasing it through the existing flow. Source acquisition continues through the existing runtime; this code handoff does not claim complete nationwide coverage or a deployed change.
