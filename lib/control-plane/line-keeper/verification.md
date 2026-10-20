# LK-01 read-only production verification

Observed October 20, 12:34 PM ET. Event window: October 20, 11:00 AM ET through October 20, 12:00 PM ET. Both Neon connections used read-only database roles. No production fix, brief, checkpoint, stamp, spending, pause or alert setting was written.

## What Admin would display

Now: 0 confirmed new/changed reader records; cost per fact unavailable when the denominator is zero or spend is incomplete; at least 0.000956802 GB/hour against the under-0.7 GB target; 0 rounds finished, 0 killed; 0 of 0 paid jobs ended empty.

| Existing Scoreboard row | Value | Count / meaning |
| --- | --- | --- |
| Public delivery | 0% | 0 of 21 known accepted records seen on the public page · 21 not found there · 271 published jobs have no accepted record count |
| Facts live per hour | 0 | 0 confirmed new or changed reader records; unobserved records earn no credit |
| Facts live per hour (fact store) | 0 | 0 stored · 0 reach reader views |
| Cost per fact | — | $0.0010 recorded spend · 1 unpriced charges |
| Freshness | 0% | 4 of 4,168 held items are current across 56 state views |
| Posted to live | at least 28% | 27 of 95 changes confirmed live within an hour · 52 without a delivery stamp · 10 timed from the body's own posting, 33 from when we first saw it |
| Overdue doors | 796 | 796 of 1,045 sources are past their check |

The independent public check observed 47 of 216 eligible paths. Its state/family breakdown stays in the existing Public delivery row. The existing publication-index measure keeps its own denominator; the two are not added together. No observed sample is extrapolated into a national live-fact count.

Launch checks: 1 pass, 5 need attention, 5 not measured. Readiness: 3 checks have production observations; the other 72 stay explicitly unmeasured and create owned work. Existing recovery measurements remain in the full Scoreboard reader.

## Proposed fixes and configuration growth

[Every proposed fix, with its owner, next action and evidence](verification-fixes.tsv): 848 findings raised today. the runner: 74; River: 520; diggers: 241; hunters: 13. These are a read-only preview, not production queue writes.

The exact PostgreSQL JSONB SELECT predicts 417,986 added bytes in CP-01’s separate fix rows, 229,406 added daily-brief bytes and 229,427 added Admin-record bytes. Fix rows add zero bytes to the four whole-config reads. The four callers’ extra hourly transfer is unmeasured because this window has no recorded caller-read rate; completed rounds are never used as a substitute. Findings deduplicate by source key.

## Database cost

This execution read 2,383,191 direct database response bytes ($0.00023832 at $0.10/GB), including 2,352,225 bytes of explicit initialization/refresh. The hourly delta check read 28,506 direct bytes ($0.00000285); AI cost was $0. Retained checkpoints and country inputs were supplied locally for this read-only preview, so this figure excludes the deployed keeper's own snapshot/cache I/O. The runtime meters that I/O and logs its final total.

[Recorded direct reads across verification](verification-costs.tsv) totals **972,373,604 recorded database response bytes**, approximately **$0.09724 at $0.10/GB**, across production and its isolated copies. This is a recorded minimum, not a Neon invoice. Some early failed requests did not retain a byte total. Public HTTP responses do not expose their underlying SQL bytes: that attribution gap is explicit fix work owned by River. HTTP payload bytes are never labeled database bytes. TX-01's project-wide hourly comparison includes both web and runner counters, with its exact sample window shown in Admin. The completed earlier production sample (7:10–8:11 AM ET) measured **7.395719 GB/hour**, over the 0.7 GB target. The latest preview has a new baseline awaiting its next hourly sample, so its 956,802-byte process reading is explicitly a lower bound and does not claim to meet the target.

## Reader repairs and live inspection

Results no longer expects the removed deliveryTrail arrays. The country and Results capability announcements now survive an unread whole-owner snapshot, and the country reader reads CP-01’s saved expansion scopes directly with independent read budgets. It reads the retained assignment publications and joins exact item/approval/version witnesses; published jobs lacking accepted-record counts remain unknown. The production Results projection returned 26 groups using 3,612 database bytes. Country scores reuse the existing held-place calculation, with source-specific retained inputs; Admin reads only the published compact scores.

Meeting partitions had omitted the existing readback writer and depended on a later fleet repair. Publication and unchanged confirmations now invoke that writer directly. Its failure cannot undo publication. The observer raises exact missing-stamp fixes after 90 minutes and retains unresolved checks beyond the weekly display window.

The authenticated live Admin Now and Scoreboard were inspected. HF-01 restored the meetings endpoint in release 65. Both reported Tucson Oct 19 meetings were confirmed through the actual public API and visible live meeting cards after that recovery. The optimized build ran against isolated production copies in Neon: reader branch br-muddy-glade-axj71bhj and control branch br-dawn-hill-ae48p92m, both expiring October 21. The comparison preserved 236 meetings (including both reported Oct 19 cards), the complete officials list and Mark Kelly card, all 22 ballot contests, all 168 voting locations and the same sourced Ask answer naming Mark Kelly and Ruben Gallego. Native browser checks returned 200 for meetings, ballot, voting locations, Ask and Admin. Now’s country table displays Arizona at 0.7% and recorded scores for all 56 state and territory rows. No production civic records or settings were changed. The plain-code keeper also ran with real writes on the isolated control copy: 679 owned fix rows, the daily brief and its checkpoint were saved; the config retained no embedded fix list. That copy invocation read 59,606,535 direct database bytes including initialization, and its hourly portion read 10,516,905 bytes. These are separate from the read-only preview above. The proposed Now and Scoreboard were visually inspected. Every inspection browser was closed. The original desktop tab is outside this cloud workspace's browser controls.

## Shipping checks

The final focused check passes **118/118**, with no failures or skips; the final SQL/caller-cost regression passes separately. The SQL tests apply real civic migrations and the control-plane schema used by production migrations. TypeScript, lint and both optimized builds pass. The merged full suite registered **8,785 tests: 8,783 passed, zero failed, two optional saved-capture checks skipped**. Lint, TypeScript, browser assertions, bundle checks and both builds passed in that run. Its database gate initially returned “could not tell” against a stale origin/main; fetching current main and rerunning that gate passed migration immutability and confirmed no schema changes, without a database read. All eight underlying CI commands have passed; the original aggregate run records that initial database-gate failure rather than rewriting it as a pass. The Netlify bundler recognized the independent hourly schedule (five minutes past every hour Eastern) and production deploy event initializer. The independent hourly function has 2,048 MB for its browser. Its packaged Chromium was also exercised with Lambda runtime selection: both reported Tucson meeting changes were confirmed in the API and visible cards (2/2). This branch is not a production deployment.

## Existing issues outside LK-01

The live officials list shows “Actions” for Arizona’s attorney general, and the Oct 19 TUSD Alternative Education card says “Held by District Wellness Committee.” These were also present in the production copy. Diggers own source/identity repair and a later reader recheck; those source and public-reader files are unchanged. Existing reader/Admin SQL tests outside LK-01 still construct hand-made schemas; River owns converting those separate tests to migrations. LK-01’s SQL fixtures use the real migrations.
