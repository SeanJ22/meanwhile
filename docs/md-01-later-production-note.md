# MD-01 later production observation

At October 25, **12:11 PM EDT**, readers have **361 summaries for 499 measures**, up from 276: **85 new visible summaries in 18 jurisdictions**, with 138 still missing. No state lost a summary. All 265 previously checked translation IDs and all 52 tracked Arizona section targets remain; there are now 351 checked translations. No tracked section number or text changed. All sixty stored references, across 36 input IDs, still resolve without canonical changes.

This measures the **initial implementation 576965f / READY a7014d303**, shipped in release 115. The ordinary later source outcomes ran releases 116 and 117. The live Chrome check served exact release-117 SHA `03e0526b6ade932c00fac5483d2b5722081f2ba9`. Git ancestry excludes follow-up `fb66ac393` and READY `02d702e34`; no outcome here proves those queued changes work in production. The first scheduled release-115 run remains the previously reported zero-publication, memory-deferred result.

## Calls, cost and unsuccessful attempts

The bounded control-plane window is October 25, **8:38:35 AM–12:10:02 PM EDT**. It records **83 completed publications in 19 jurisdictions**, 23 paid holds, six unpaid holds and forty unresolved RUNNING attempts. All 106 attempts with retained model responses start on Haiku; none start on Sonnet or Opus. The ledger records 116 Haiku writes, 39 Sonnet rewrites, 110 Sonnet checks and 36 Opus checks. There are no Haiku checks or Opus writes. Calls whose parent attempt has not finished account for some differences between ledger and attempt response counts.

Total recorded translation spend is **$15.838203845**, with no unknown prices or other/unattributed translation charges in this window. The denominator below uses **durable completed publications recorded by the control plane**, and preserves both completion and attempt-start clocks.

| Eastern hour | Calls | Spend | Completed publications | Published by attempt-start hour | Spend / recorded completion |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8 AM, from 8:38 | 0 | $0 | 0 | 0 | N/A |
| 9 AM | 0 | $0 | 0 | 0 | N/A |
| 10 AM | 22 | $0.44308123 | 5 | 8 | $0.088616 |
| 11 AM | 279 | $15.395122615 | 78 | 75 | $0.197373 |
| Noon, through 12:10 | 0 | $0 | 0 | 0 | N/A |
| Whole observed window | 301 | $15.838203845 | 83 | 83 | $0.190822 |

The prior day's completed-publication rates were $0.119495 at 10 AM and $0.275501 at 11 AM. These are different days and state mixes, not a controlled estimate of the queued follow-up's savings. New writer uncached input averages 700 tokens, with cache usage excluded from that number; mean writer output is 2,102 tokens. The smaller total prompt and direct-source changes remain queued, so this does not claim that those byte reductions caused current spending.

There are **zero writer-field/passages holds** in this window, compared with twelve in the earlier baseline. Twenty-two paid holds retain the shared sentence/source-support diagnostic and one has another error. Old attempts do not retain response roles or every checker decision: the per-state CSV reports 301 response-ledger calls separately from 281 retained attempt responses, including unknown roles. These counts cannot establish individual checker pass rates or prove no quality-rate regression.

**The reader and CP counts are kept separate.** The reader has 86 newly visible checked records: 85 fill formerly blank summaries and one adds independent checking and vote meanings to an existing summary. The CP cohort records 83 publications. Maryland accounts for the difference: eight newly visible checked records versus five recorded publications, with 31 unresolved RUNNING attempts. All 86 reader written-at clocks fall inside the observed window, but that does not supply missing durable completion times. The three unmatched records are not assigned to an hourly denominator.

## Chrome and preservation

Actual **Google Chrome 156** used the pages at approximately **12:12 PM EDT**, scrolled the requested cards into view, opened their Sources sections and opened three original Arizona reaction targets. The exact release-117 SHA was served before and after all three visits. Screenshots were inspected. No page error or lost summary occurred.

| ZIP | Summaries | Still missing |
| --- | ---: | --- |
| 85701 | 12 / 12 | None |
| 94102 | 23 / 25 | Propositions 37 and 42 |
| 98101 | 1 / 4 | IL26-001, IL26-638 and IP26-645 |

Seattle Transit now has a summary and YES/NO meanings. Arizona Proposition 318 is the one changed preexisting summary: its expanded text retains the earlier sports, team-designation, private-space and lawsuit points, adds YES/NO meanings and retains all five original sections and the original source link. A separate Chrome visit opened all five sections at 12:20 PM EDT. No existing summary is reported as byte-identical when it changed.

Five small held-attempt samples identify explicit unsupported checker sentences for California 37/42 and Washington IL26-638/IP26-645. IL26-001's final diagnostic has five supported sentences and no false decision. One approved sentence contains “Initiative Measure No. IL26-001”; the existing sentence-break regex mistakes the period in “No.” for a second sentence. Its failure is reproduced by a synthetic local test using the small diagnostic sample. The complete failed writer draft was not retained, so this is not claimed to be its only failure.

## Every state and territory

The before baseline is October 24 at 23:32:10 UTC. “Published in CP window” is a count of recorded attempt completions, not the net number of new visible summaries. UNKNOWN has zero attempts and publications. Source supervisor successes are not counted as published explanations.

| State | Measures | Summaries before | Now | New visible | Published in CP window | Paid held | Missing | Lost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AK | 2 | 1 | 1 | 0 | 0 | 0 | 1 | 0 |
| AL | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| AR | 13 | 4 | 4 | 0 | 0 | 0 | 9 | 0 |
| AS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| AZ | 18 | 15 | 15 | 0 | 1 | 0 | 3 | 0 |
| CA | 79 | 71 | 74 | 3 | 3 | 5 | 5 | 0 |
| CO | 20 | 6 | 6 | 0 | 0 | 0 | 14 | 0 |
| CT | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| DC | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| DE | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FL | 62 | 55 | 58 | 3 | 3 | 1 | 4 | 0 |
| GA | 6 | 3 | 5 | 2 | 2 | 1 | 1 | 0 |
| GU | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| HI | 32 | 31 | 32 | 1 | 1 | 0 | 0 | 0 |
| IA | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| ID | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| IL | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| IN | 2 | 0 | 1 | 1 | 1 | 1 | 1 | 0 |
| KS | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| KY | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| LA | 10 | 7 | 10 | 3 | 3 | 0 | 0 | 0 |
| MA | 9 | 5 | 5 | 0 | 0 | 0 | 4 | 0 |
| MD | 51 | 9 | 17 | 8 | 5 | 0 | 34 | 0 |
| ME | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| MI | 2 | 1 | 2 | 1 | 1 | 0 | 0 | 0 |
| MN | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| MO | 5 | 2 | 2 | 0 | 0 | 3 | 3 | 0 |
| MP | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| MS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| MT | 3 | 2 | 3 | 1 | 1 | 0 | 0 | 0 |
| NC | 6 | 3 | 3 | 0 | 0 | 0 | 3 | 0 |
| ND | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| NE | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| NH | 28 | 7 | 7 | 0 | 0 | 0 | 21 | 0 |
| NJ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| NM | 7 | 6 | 7 | 1 | 1 | 0 | 0 | 0 |
| NV | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| NY | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| OH | 8 | 3 | 3 | 0 | 0 | 0 | 5 | 0 |
| OK | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| OR | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| PA | 4 | 1 | 2 | 1 | 1 | 1 | 2 | 0 |
| PR | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| RI | 5 | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| SC | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| SD | 4 | 3 | 3 | 0 | 0 | 1 | 1 | 0 |
| TN | 3 | 0 | 1 | 1 | 1 | 1 | 2 | 0 |
| TX | 8 | 7 | 8 | 1 | 1 | 0 | 0 | 0 |
| UT | 3 | 1 | 3 | 2 | 2 | 1 | 0 | 0 |
| VA | 64 | 2 | 55 | 53 | 53 | 4 | 9 | 0 |
| VI | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| VT | 2 | 0 | 1 | 1 | 1 | 1 | 1 | 0 |
| WA | 4 | 0 | 1 | 1 | 1 | 3 | 3 | 0 |
| WI | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| WV | 3 | 2 | 3 | 1 | 1 | 0 | 0 | 0 |
| WY | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |

## Bounded verification and remaining work

Verification asked Neon only for counts and small samples, using the supplied reader `readonly` and control-plane `wtp_cp_release_readonly` roles on the named production branches. The main four aggregate queries returned 132 rows, approximately 63 KB of compact JSON; five source-outcome rows, one changed-summary hash row, five held-attempt metadata rows, one 908-character diagnostic and one clock-count row are separately bounded. No source/table payload export, new production-copy branch, bulk-copy replay, manual production run or DB write occurred.

- River owns shipping the selected MD-01 READY. The follow-up reduces source repetition, prefers current full measure text, continues genuine missing-source work, gives translators fair worker turns and fixes the abbreviation rejection.
- MD-01 owns checking the first scheduled run on the deployed follow-up, completing all 138 remaining summaries, comparing every-state results and hourly cost, and repeating the three live ZIP walks. Existing Admin budgets and pauses remain unchanged.
- The original twenty-question Ask under-three-seconds test and full-day Haiku > Sonnet > Opus observation remain open. This note is live evidence for the already shipped code, not a new READY or a claim of task completion.
