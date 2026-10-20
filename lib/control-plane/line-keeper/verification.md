# LK-01 read-only production verification

Observed October 20, 7:00 AM ET. Event window: October 20, 6:00 AM ET through October 20, 7:00 AM ET. Both Neon connections used read-only database roles. No production fix, brief, checkpoint, stamp, spending, pause or alert setting was written.

## What Admin would display

Now: 0 confirmed new/changed reader records; cost per fact unavailable when the denominator is zero or spend is incomplete; at least 1.540727954 GB/hour against the under-0.7 GB target; 0 rounds finished, 0 killed; 0 of 0 paid jobs ended empty.

| Existing Scoreboard row | Value | Count / meaning |
| --- | --- | --- |
| Public delivery | 0% | 0 of 177 known accepted records seen on the public page · 21 not found there · 156 not checked · 258 published jobs have no accepted record count |
| Facts live per hour | 0 | 0 confirmed new or changed reader records; unobserved records earn no credit |
| Facts live per hour (fact store) | 0 | 164 stored · 0 reach reader views |
| Cost per fact | — | $0.0013 recorded spend · 1 unpriced charges |
| Freshness | 0% | 4 of 4,168 held items are current across 56 state views |
| Posted to live | at least 32% | 30 of 93 changes confirmed live within an hour · 47 without a delivery stamp · 10 timed from the body's own posting, 36 from when we first saw it |
| Overdue doors | 752 | 752 of 1,049 sources are past their check |

The independent public check observed 85 of 688 eligible paths. Its state/family breakdown stays in the existing Public delivery row. The existing publication-index measure keeps its own denominator; the two are not added together. No observed sample is extrapolated into a national live-fact count.

Launch checks: 3 pass, 3 need attention, 5 not measured. Readiness: 3 checks have production observations; the other 72 stay explicitly unmeasured and create owned work. Existing recovery measurements remain in the full Scoreboard reader.

## Proposed fixes and configuration growth

[Every proposed fix, with its owner, next action and evidence](verification-fixes.tsv): 737 findings raised today. the runner: 72; River: 438; diggers: 216; hunters: 11. These are a read-only preview, not production queue writes.

The exact PostgreSQL JSONB SELECT predicts 366,417 added fix-list bytes, 198,305 added daily-brief bytes and 564,743 added Admin-record bytes. At the observed whole-record read rate, the four callers would read about 125,632,398 extra bytes/hour. Findings deduplicate by source key.

## Database cost

This execution read 19,211,081 direct database response bytes ($0.00192111 at $0.10/GB), including 2,423,115 bytes of explicit initialization/refresh. The hourly delta check read 7,131,963 direct bytes ($0.00071320); AI cost was $0. Retained checkpoints and country inputs were supplied locally for this read-only preview, so this figure excludes the deployed keeper's own snapshot/cache I/O. The runtime meters that I/O and logs its final total.

[Recorded direct reads across verification](verification-costs.tsv) reports the retained measurements. Some early failed requests did not retain a byte total. Public HTTP responses do not expose their underlying SQL bytes: that attribution gap is explicit fix work owned by River. HTTP payload bytes are never labeled database bytes. TX-01's project-wide hourly comparison includes both web and runner counters, with its exact sample window shown in Admin.

## Reader repairs and live inspection

Results no longer expects the removed deliveryTrail arrays. It reads the retained assignment publications and joins exact item/approval/version witnesses; published jobs lacking accepted-record counts remain unknown. The production Results projection returned 26 groups using 3,635 database bytes. Country scores reuse the existing held-place calculation, with source-specific retained inputs; Admin reads only the published compact scores.

Meeting partitions had omitted the existing readback writer and depended on a later fleet repair. Publication and unchanged confirmations now invoke that writer directly. Its failure cannot undo publication. The observer raises exact missing-stamp fixes after 90 minutes and retains unresolved checks beyond the weekly display window.

The authenticated live Admin Now and Scoreboard were inspected. Both reported Tucson Oct 19 meetings were confirmed through the actual public API and visible live meeting cards. The proposed Now and Scoreboard components were also rendered with production data and visually inspected. Every inspection browser was closed. The original desktop tab is outside this cloud workspace's browser controls.

## Shipping checks

Focused reader, stamp, brief and observer tests, TypeScript and lint were run. The Netlify bundler recognized the independent hourly schedule (five minutes past every hour Eastern) and production deploy event initializer. Repository gate results are recorded with the READY handoff. This branch is not a production deployment.
