# AQ-01 — Ask answer quality

Branch: `stream/aq-01`. Status: **verification pending; no READY commit**.

Ask now resolves a unique local abbreviation or typo directly, puts the answer first, uses the body’s time zone, and keeps unrelated gaps and source narration out of the answer. The TUSD example reproduces the requested sentence from production data. Sources remain below.

This moves §0’s correct, fast reader answers, use of the place’s held data, and acquisition of missing answers.

## Changes

- Updated the default reader, writer and fallback instructions. Normal bootstrap upgrades the shipped defaults through the existing versioned playbook edit/undo path; existing Admin edits are preserved. These instructions have not been published to production.
- Added local name resolution and real ambiguity choices; expanded the deterministic reading to those resolved abbreviations.
- Replaced verbose meeting, decision and vote templates; narrowed campaign answers to the requested figures, preserving exact FEC totals. District answers use sourced place divisions, including split ZIPs.
- Separated general AI text under “AI answer.” Missing answers create an open acquisition work item in the existing queue; synthetic runs create none. Dispatch from those new items and daily-brief inclusion are still unverified.
- Connected the existing scrubbed question capture to its writer. Question and cost writes run after the response.

## Production-data checks

Public production reads only; no production Ask submission, question row, hunting work or civic-data mutation was generated. The samples below replay the changed interpretation/selection/composition functions over the public production responses. They are **not** complete Ask requests or click-to-render measurements. The latest 14 component replays took less than 6 ms each after their input data was read. This does not establish the three-second requirement.

Vote samples check the requested member ID against the public state roster before attaching a person’s name. Meeting selection was compared with independent timestamp ordering. Campaign figures were compared with the held FEC totals.

| ZIP | Question | Answer |
| --- | --- | --- |
| 85701 | When was the last TUSD meeting? | The most recent TUSD meeting was the Budget Advisory Committee on October 7 at 4:00 PM. |
| 85701 | When is TUSD meeting next? | The next TUSD meeting is the Alternative Education Advisory Committee on October 19 at 6:00 PM. |
| 85701 | When does the Pima County Board of Supervisors meet next? | The next Pima County meeting is the Special Meeting on October 20 at 1:00 PM. |
| 85701 | When was the last Pima County Board of Supervisors meeting? | The most recent Pima County meeting was the Board of Supervisors on October 13 at 5:00 PM. |
| 85701 | Who is my governor? | Your governor is Katie Hobbs (Democratic). |
| 98101 | Who is my governor? | Your governor is Bob Ferguson (Democratic). |
| 85701 | How much campaign money has Mark Kelly raised? | Mark Kelly's campaign raised $40,775,022.69 in the 2025–26 cycle through June 30th, 2026. |
| 85701 | How did Mark Kelly vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | Mark Kelly voted NO on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor. |
| 78701 | How did Ted Cruz vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | Ted Cruz voted YES on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor. |
| 95814 | How did Alex Padilla vote on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor? | Alex Padilla voted NO on Confirmation: Keith Sonderling, of F.L., to be Secretary of Labor. |

Production sources: [Tucson meetings](https://meanwhileusa.com/api/meetings?zip=85701&lat=32.21704&lng=-110.97134), state rosters at `/api/representation/ocd-division/country:us/state:{az,ca,tx,ny,il,wa}`, [Kelly funding](https://meanwhileusa.com/api/funding/congress:K000377), and [Kelly votes](https://meanwhileusa.com/api/votes?member=congress:K000377). The meeting and FEC/roll-call source URLs returned by those records were retained with each answer.

## Verification and remaining work

- Baseline verification at `73a9a64c3` passed: 537 tests across 56 Ask/playbook/reader suites (the final acronym regression adds one test), TypeScript checking, lint for the changed files, and an optimized Next.js production build. Relevant suites were rechecked after the final name-resolution change. These use fixtures and memory stores, not live model calls. The build completed with Next.js’s existing middleware-to-proxy deprecation warning.
- **Still required, Codex:** live model and complete on-screen tests, including cold starts, across meetings, officials, votes, campaign/government money, ballots, districts, abbreviations and loose wording. Every result must finish in under three seconds.
- **Blocked, runtime integration:** the user’s configuration screenshot includes `ANTHROPIC_API_KEY`. This chat’s active environment still reports revision 7 with no Anthropic runtime binding, and a fresh process cannot see the variable. A direct request through the inherited proxy returned HTTP 401, `authentication_error`, “x-api-key header is required.” The key is configured in the editor; its delivery to this running instance is unresolved. No Netlify environment listing was queried during this follow-up.
- **Still required, Codex:** investigate production place-read failures. `/api/meetings` returned HTTP 500 for 95814, 78701, 10001, 60601 and 98101. A second Sacramento read also returned 500 (request `01M56NZBBATBDSB3MGEMP0D0GS`, 6.16 seconds at Netlify). State roster reads succeeded for all six states. Ballot scope reads succeeded for 85701 and 78701; full ballot page and scope reads exceeded three seconds. Those are data/page observations, not Ask timing results.
- **Still required, Codex:** verify production persistence of questions, acquisition dispatch and daily-brief appearance. The question/work wiring was tested with local fixtures and memory repositories, without production writes.

The latest read-only refresh on October 18 reproduced the five state meeting failures. Tucson’s meeting-data request succeeded in 17.256 seconds; the five failures took 2.389–8.440 seconds. These timings include this workspace’s network path and are data-request observations, not click-to-Ask measurements. The public state roster responses now omit a governor in CA, TX, NY and IL, although the prior captured responses included one. The table above was refreshed against the current responses and does not reuse those four older governor answers.

That missing-official case exposed a defect: a composed holding-gap answer did not request AI fallback when other officials were held. The composition now marks the missing requested answer and the route carries the flag to its existing fallback/acquisition path. A focused regression covers an unrelated held senator beside a missing governor. Follow-up checks passed: 15 official-answer tests, the roster-gap route integration test, lint for the changed code, and TypeScript checking. The production build reported above belongs to the baseline commit; a build after this follow-up remains pending.

Pinned Chromium 1234 is installed for the pending browser run. Live model, complete UI timing and cold-start acceptance are still unrun; no pass is claimed for them.

Nothing is merged or deployed. River must not fold this step until the required production checks pass and a `READY: AQ-01` commit is pushed.

Automatic approval review rejected listing all Netlify production environment variables because it could expose unrelated secrets. No values were retrieved. The remaining model verification uses only the environment binding; no further secret lookup was attempted.
