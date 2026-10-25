# BL-02 — sponsored bills on state legislator cards

Gonzales's exact card ID `az-legislature:2381` returns **119 bills**, up from zero, on an isolated copy of production. Alma Hernandez's `az-legislature:2312` continues to return **66**. The actual `/api/bills` handler returns HTTP 200 for both IDs. River owns shipping and the Chrome check at **85701**.

Current sessions are loaded for **all 50 states and DC**: 64 state/DC sessions containing 194,450 source bills. The comparison covers **7,555 held legislator records**; 7,021 have matched bills afterward, up from 249. The canonical reader returns 192,958 bills, with Alabama's 1,540 current bills held behind its existing reader error. Earlier held history is retained.

The job selects current regular and special sessions from LegiScan's legislative years, processes every jurisdiction with the least recently checked states first, and uses four state workers with two bounded part publications each. A higher session ID can be an older special session: Minnesota and Utah both demonstrate why numeric ID alone is insufficient. Acquisition deadlines apply to each download rather than the entire national run.

Publishing the catalog formerly made the weekly clock look complete while session work was still missing. The existing continuation flag now derives completion from the actual current session pointers, dataset hashes and sponsor matcher version. Interrupted work remains due on the next standing pass. Verified completed parts are reused only after comparing the exact source bytes and recomputed sponsor joins. Current serving sessions remain available until a complete replacement passes the existing checks. No migration or new progress ledger is required.

The old sponsor join needed a shared native identifier. Gonzales's LegiScan people ID is **10704**; its profile identifies a different source record from the official card. Its display name is `Sally Gonzales`, while the components identify `Sally Ann Gonzales` and `SD-020`. Matching now prefers LegiScan's people ID, then other exact native IDs, then a unique name with the same state, chamber and current district. Missing middle names, accents and district prefixes are normalized across states. Conflicting native IDs and ambiguous matches remain unjoined, including across archive parts. The native HB2316 fixture retains this real source evidence without a named alias.

## Production-copy replay

The reader database copy is Neon branch `br-calm-grass-axzhcte9` in `tiny-hill-13996172`; the control-plane copy is `br-flat-fire-aenmqp84` in `withered-sunset-39821877`. Production received **zero writes**. The baseline reader is River revision `4040fb2273b7a3135b86717d4cf7c9ba9dbd45e1`. Every state's held legislator roster was captured before refresh and reused unchanged afterward.

The replay uses real LegiScan archives, normal registered publications and the canonical bill reader. Copy attempts were interrupted while diagnosing resume behavior and session-year selection; their verified publications remain in the copy. This is a resumed coverage and preservation replay, **not a clean first-fill duration or deployed performance measurement**. The normal standing parent's pass wall remains in place; a cold fill can continue across passes. Actual route SQL ran through read-only Neon HTTP transactions on the copy. River still owns production browser timing.

The final resumed invocation completed 65 current sessions across 52 jurisdictions, including Congress, with no failed or empty sessions. It took 45m 54s, including the federal archive; this does not establish that a cold fill fits the standing 30-minute pass. The actual copy clock was due while fan-out was incomplete and returned to its weekly cadence after completion (`continuationPending: false`, next-cycle due: false). Oldest-first selection and verified-part reuse carry unfinished work into the next standing pass.

Full [per-legislator before/after counts](measurements/bl-02-bills/bills-per-legislator.csv) include every held state legislator, district and reader identity aliases. The [machine-readable replay](measurements/bl-02-bills/replay.json) records state counts, source results, API responses, scheduler behavior and memory. Alabama's already-failing historical reader remains River's repair; its held bill IDs are checked separately for preservation.

The four-state publisher's measured peak was **2,127,003,648 bytes**. Its reservation retains that peak plus 5%, rounded up to **2,130 MiB**, including after a smaller run has been observed on the host.

## Focused checks

**156 checks pass:** 41 LegiScan bill/dataset/vote checks, 76 routine scheduler checks, and 39 worker/memory checks. Tests cover the 1,000-dataset catalog reaching every jurisdiction, source-year selection, oldest-first ordering, independent state failures, incomplete fan-out remaining due, exact ID priority, name-and-seat fallback in every state/DC, ambiguous identities across parts, interrupted publication and unchanged/changed part reuse. TypeScript, changed-file ESLint and `git diff --check` pass.

Built on `stream/bl-02-bills`. River merges and ships the exact READY commit, combines the Alabama repair, and checks Gonzales and Alma at 85701 in Chrome.

## Bills by state on the same held rosters

All **3,040 previously visible bills** and **3,049 previously held canonical bill IDs** are preserved. No legislator count decreases. Counts below use the canonical reader; Alabama retains its known reader failure, with 1,540 current-session source bills loaded separately. The CSV provides every legislator behind these totals.

| State | Bills before | Bills after | Held legislators with bills before | After |
| --- | ---: | ---: | ---: | ---: |
| AL | 0 | 0 | 0 | 0 |
| AK | 848 | 848 | 59 | 60 |
| AZ | 2,190 | 2,190 | 90 | 98 |
| AR | 2 | 281 | 100 | 129 |
| CA | 0 | 5,060 | 0 | 118 |
| CO | 0 | 714 | 0 | 99 |
| CT | 0 | 1,283 | 0 | 183 |
| DE | 0 | 1,296 | 0 | 62 |
| FL | 0 | 1,930 | 0 | 144 |
| GA | 0 | 5,656 | 0 | 233 |
| HI | 0 | 6,132 | 0 | 74 |
| ID | 0 | 817 | 0 | 45 |
| IL | 0 | 12,113 | 0 | 176 |
| IN | 0 | 935 | 0 | 150 |
| IA | 0 | 4,231 | 0 | 148 |
| KS | 0 | 1,483 | 0 | 165 |
| KY | 0 | 1,737 | 0 | 138 |
| LA | 0 | 2,616 | 0 | 136 |
| ME | 0 | 2,454 | 0 | 186 |
| MD | 0 | 2,675 | 0 | 187 |
| MA | 0 | 8,960 | 0 | 195 |
| MI | 0 | 4,230 | 0 | 147 |
| MN | 0 | 10,638 | 0 | 200 |
| MS | 0 | 4,014 | 0 | 170 |
| MO | 0 | 3,146 | 0 | 187 |
| MT | 0 | 1,761 | 0 | 142 |
| NE | 0 | 1,847 | 0 | 49 |
| NV | 0 | 1,237 | 0 | 62 |
| NH | 0 | 1,394 | 0 | 357 |
| NJ | 0 | 11,256 | 0 | 120 |
| NM | 0 | 812 | 0 | 109 |
| NY | 0 | 25,440 | 0 | 212 |
| NC | 0 | 2,343 | 0 | 169 |
| ND | 0 | 1,106 | 0 | 134 |
| OH | 0 | 2,586 | 0 | 130 |
| OK | 0 | 6,008 | 0 | 145 |
| OR | 0 | 304 | 0 | 90 |
| PA | 0 | 5,202 | 0 | 253 |
| RI | 0 | 3,013 | 0 | 111 |
| SC | 0 | 4,035 | 0 | 170 |
| SD | 0 | 666 | 0 | 103 |
| TN | 0 | 9,159 | 0 | 130 |
| TX | 0 | 11,503 | 0 | 177 |
| UT | 0 | 1,016 | 0 | 100 |
| VT | 0 | 1,717 | 0 | 180 |
| VA | 0 | 3,733 | 0 | 135 |
| WA | 0 | 3,413 | 0 | 146 |
| WV | 0 | 2,975 | 0 | 130 |
| WI | 0 | 2,751 | 0 | 132 |
| WY | 0 | 335 | 0 | 92 |
| DC | 0 | 1,907 | 0 | 13 |
