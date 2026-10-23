# PB-01 nationwide replay — NOT READY

All **165 production Legistar tenants** were examined across **33 states**. The state copies contain **10,356 held membership facts**, 24 above Sean's 10,332 baseline. They reconcile to the production census taken October 23 at **5:00 AM Eastern**. The table follows that held cohort; members added by replay publication do not inflate its numerator.

**Zero empty Legistar boards** appeared in **4,756 answers covering 2,378 distinct local-government footprints**. All answers meet the 1,000,000-byte raw and 100,000-byte local-gzip budgets. **37 answers exceed the three-second budget.** There are **1,610 held seats without usable place bindings**, and six unavailable API routes. PB-01 remains **NOT READY**. The earlier two-place READY is withdrawn from this unmerged lane history so River cannot select it for shipping.

The reader receives **8,746 / 10,356 held seats**. Its in-scope rosters contain 10,174 memberships including additional publication and other verified roster data; that larger number is not the held-cohort coverage result. The controlled October 24 pass shows 10,173 after one actual Milwaukee term expires, while held-cohort coverage remains 8,746.

“Named” counts unique in-scope body entities with a live verified name after local publication. “Shown” counts in-scope bodies appearing in the normal reader answers, once across ZIPs. Empty counts apply to Legistar bodies. Each footprint is represented by one held ZIP, with Madison 53703 and Milwaukee 53202 explicitly included. The largest and slowest lists are observations from these tested answers.

| State | Boards named | Boards shown | Empty shown | Held seats shown / held |
| --- | ---: | ---: | ---: | ---: |
| AK | 29 | 14 | 0 | 91 / 91 |
| AL | 15 | 11 | 0 | 47 / 47 |
| AZ | 69 | 26 | 0 | 27 / 27 |
| CA | 1,168 | 244 | 0 | 1,379 / 2,844 |
| CO | 78 | 33 | 0 | 251 / 251 |
| FL | 322 | 171 | 0 | 888 / 888 |
| GA | 36 | 23 | 0 | 78 / 78 |
| HI | 59 | 0 | 0 | 0 / 0 |
| ID | 1 | 1 | 0 | 7 / 7 |
| IL | 360 | 130 | 0 | 957 / 1,056 |
| KY | 7 | 7 | 0 | 0 / 0 |
| MA | 24 | 12 | 0 | 60 / 60 |
| MD | 128 | 16 | 0 | 105 / 105 |
| ME | 10 | 7 | 0 | 60 / 60 |
| MI | 137 | 59 | 0 | 340 / 364 |
| MN | 15 | 14 | 0 | 90 / 90 |
| MO | 420 | 64 | 0 | 319 / 319 |
| MS | 0 | 0 | 0 | 0 / 0 |
| NC | 131 | 22 | 0 | 77 / 77 |
| NJ | 1 | 1 | 0 | 7 / 7 |
| NM | 69 | 52 | 0 | 318 / 318 |
| NV | 27 | 27 | 0 | 151 / 151 |
| NY | 119 | 58 | 0 | 339 / 339 |
| OH | 98 | 14 | 0 | 85 / 85 |
| OK | 33 | 27 | 0 | 237 / 237 |
| OR | 6 | 0 | 0 | 0 / 0 |
| PA | 8 | 4 | 0 | 27 / 27 |
| TX | 288 | 122 | 0 | 604 / 604 |
| UT | 10 | 4 | 0 | 27 / 27 |
| VA | 1 | 1 | 0 | 6 / 6 |
| WA | 57 | 21 | 0 | 135 / 135 |
| WI | 605 | 346 | 0 | 2,024 / 2,046 |
| WY | 3 | 2 | 0 | 10 / 10 |
| **Total** | **4,334** | **1,533** | **0** | **8,746 / 10,356** |

Largest measured ZIP answers:

| ZIP | State | Bytes | Gzip bytes | Server total | Complete answer | Phase |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 53209 | WI | 804,748 | 88,910 | 1542 ms | 1,560 ms | first |
| 53211 | WI | 803,948 | 88,797 | 1310 ms | 1,333 ms | first |
| 53228 | WI | 802,688 | 88,536 | 1599 ms | 1,616 ms | first |
| 53214 | WI | 802,617 | 88,580 | 1623 ms | 1,641 ms | first |
| 53221 | WI | 801,887 | 88,476 | 1366 ms | 1,386 ms | first |

Slowest measured ZIP answers:

| ZIP | State | Bytes | Gzip bytes | Server total | Complete answer | Phase |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 94401 | CA | 33,551 | 7,566 | 10271 ms | 10,884 ms | tomorrow |
| 60482 | IL | 205,017 | 18,741 | 9544 ms | 10,391 ms | tomorrow |
| 10601 | NY | 259,722 | 28,004 | 9518 ms | 9,549 ms | first |
| 60131 | IL | 204,174 | 18,556 | 8593 ms | 8,610 ms | tomorrow |
| 60480 | IL | 206,120 | 18,986 | 8544 ms | 8,603 ms | tomorrow |


## Repairs proved by this audit

- Registered Legistar boards now receive the same no-empty-board rule as acquired boards. The check also covers names supplied by Legistar calendars. Mesa exposed the registered-board gap; the current Arizona replay has zero empty Legistar boards.
- Key West's official person records publish some members by surname only. A stable native identity and official evidence now allow those names through publication. Navigation labels still fail. The built Tree Commission card shows Pope once, seven members and the complete official source link on both passes.
- Exact native body IDs take precedence over name-only doors. The shared `metro` tenant had California native bindings alongside Oregon name-only bindings. The isolated Oregon copy retires the incorrect names.
- Cleanup preserves the last verified name beside a live roster when a door is ambiguous. The earlier cleanup lost two Los Angeles board names covering **17 held seats**. The new publication and reader replay restore all 17. A browser opens the restored Proposed Special Event Fare Public Hearing card at 91759 with 14 members and a working source link on both passes.
- Vacancy labels no longer qualify a department as holding a current member. The name test is shared with roster publication.

The isolated stores retire **204 ineligible name facts**. Seatless bodies that Legistar types as boards or commissions keep their verified names under the requested type exception; they do not create empty reader boards. The audit does not claim that 651 names were deleted in production.

CS-01 retains all casing work. PB-01 leaves the already-built formatter call in place and adds no casing changes. The former two-place replay script is deleted; the nationwide scripts replace it.

## What still prevents READY

Every one of these unplaced held seats has a verified body name in the replay. Publication reaches the fact store, but the place indexes cannot take these regional districts to the appropriate ZIP answers:

| State | Tenant | Held seats without a place answer |
| --- | --- | ---: |
| CA | mwdh2o | 782 |
| CA | mtc | 644 |
| CA | lossan | 22 |
| CA | bart | 9 |
| CA | scvwd | 8 |
| IL | mwrd | 75 |
| IL | chicagoparkdistrict | 24 |
| MI | glwater | 24 |
| WI | mmsd | 22 |
| **Total** | | **1,610** |

These need verified service-area associations from the standing jurisdiction/door work, consumed by PB-03's place assembly. For example, production registration has an empty associations array for Milwaukee Metropolitan Sewerage District. Its office county does not establish its service territory. PB-01 records the reviewed government website on each body so the existing place join can use it when those associations exist.

The unavailable source routes are `roch`, `harrisoncounty`, `alleghenycounty` and `lackawanna` (HTTP 500), plus `nyc` and `brokenarrow` (HTTP 403). None has held seats in this census. They remain failures, and no successful next-day source refresh is claimed for them.

PB-03 also owns the remaining place-read speed work. The actual production query collects every live person field for each membership, including that person's fields from other boards. A read-only variant using the same body-specific field predicate already present in `lib/facts/roster-read.ts` preserves both the database roster projection and the complete decoded reader answer:

| ZIP | Database result before → scoped | Complete answer before → scoped |
| --- | ---: | ---: |
| 53703 | 5,262,263 → 3,020,198 bytes | 1,467 → 1,251 ms |
| 53202 | 6,062,891 → 3,328,210 bytes | 1,695 → 1,261 ms |
| 60120 | 20,267,397 → 2,327,700 bytes | 3,434 → 1,292 ms |

The proposed predicate is:

```sql
WHERE p.entity_id=substr(f.field,8) AND p.status='live'
  AND (p.field IN ('name','email','phone','website') OR p.field LIKE '%:'||f.entity_id)
```

[The exact comparison](measurements/pb-01/pb-03-query-comparison.json) preserves all three before/after measurements. This is a measured PB-03 handoff, not a shipped query fix. **Neither protected file, `lib/reader/place.ts` nor `lib/facts/box-publication.ts`, is changed.** Further profiling and a repeat of the failed cases remain necessary; the single predicate is not claimed to resolve every timing failure.

## Connected and scheduled proofs

The feeding step is the standing **Legistar member refresh and registered doors**. PB-01 publishes source-quoted names and current memberships. Its output feeds **PB-03 place assembly → stateCoverage → /api/meetings → wire decoder and ZIP bootstrap → body card**. The same normal handler and built reader consume the replay output.

Both production handles enforce read-only transactions and have no public-table write privileges: reader `readonly`, controller `wtp_cp_release_readonly`. Each worker copies only its state's relevant facts and necessary source identity metadata under the real fact-store migrations. Publication writes to isolated PGlite and local evidence storage. The cache purger is injected locally. Production data, settings and caches are unchanged.

Reader measurements include the actual production place SQL, normal composition and complete encoded response consumption. Locally published field/roster rows are projected before timing. New local entities are selected through request body IDs; reviewed website links use the place query's existing government association conditions. These substitutions do not reproduce the future production query plan or future network conditions. The Elgin comparison independently reproduces the real unmodified production request exceeding three seconds. Raw bytes and gzip level 6 are reported separately; gzip is a reproducible local encoding, not an observed future CDN transfer.

The scheduler replay checks `routineTaskDue` one millisecond before and at each source's 12-hour boundary, checks that tomorrow is due, then calls the normal `refreshLegistarMembers` using recorded official source pages at a controlled October 24 clock. **159 distinct API-readable tenants** complete that refresh, including stable names/retirements and the Milwaukee term expiry. The six access failures above do not receive a fabricated successful source pass. This is controlled next-day proof, not an actual future production run.

**72 browser checks across all 33 states** render the first and next-day responses with actual read-only state data. Every opened card matches its API member count and restores the full official office-record link; no page errors occur. The Wisconsin checks show Dane County Board's 37 members with Henry Fries once and Milwaukee's 171 nonempty boards. Key West and the restored Los Angeles board are checked explicitly. States with no in-scope member cards are recorded as such. The browser uses the built local page and blocks provider quota and writes; it does not certify live basemap or public-network latency.

An early browser attempt raced the first-run tour, and another began while its state report was being rewritten. Both failures remain in scratch evidence. The browser now waits for the tour and requires the state replay to finish. A broader empty-calendar audit found zero empty Legistar calendar bodies in all 4,756 saved answers. Earlier two-place and replay-only projection failures remain preserved separately; they are not counted as passing current measurements.

The machine-readable [nationwide evidence](measurements/pb-01/national.json) contains state counts, every failed timing, source failures, retained source clocks/signatures, scope hashes and browser results. It is the current result; the earlier [two-place report](pb-01.md) is historical.

## Validation and reproduction

The current focused suite passes **33 tests**, covering native bindings, retained names, eligibility, vacancies, exact quotes, surnames, refresh/cache behavior and both registered/acquired reader boards. The expanded calendar-source coverage case passes as well. TypeScript and changed-file lint pass. The earlier production build and wire/browser checks belong to the prior READY commit; a new full build or combined River gate pass is not claimed here.

Use the existing private read-only handles `WTP_PRODUCTION_DATABASE_URL_READONLY` and `WTP_CONTROL_PLANE_DATABASE_URL_READONLY`, with `NODE_USE_ENV_PROXY=1` in this environment:

```sh
node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/pb-01-census.mts
node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/pb-01-national.mts --state=WI
node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/pb-01-browser.mts --state=WI
node scripts/pb-01-report.mjs --state=WI
```

Run the state commands for every state in the census, then run `node scripts/pb-01-report.mjs` to combine compact summaries. `--reuse-captures` replays saved official captures through the normal refresh. Census metadata stays small; full door bindings and evidence are stored per tenant/state. Screenshots, local copies, raw answers and preserved failures are under `.scratch/pb01/national`; credentials are excluded.

After the blockers are repaired, repeat the affected place answers and their next scheduled refresh before marking READY. River's post-ship checks include 53703 and 53202, plus proven named-body examples in Arizona **85119**, Washington **98220**, Colorado **80014** and California **93426**. River owns the combined gates and deployment. This branch work is built and replayed, with readiness and deployment still pending. It advances §0 by making held facts visible while keeping the unresolved connections and speed failures explicit.
