# MD-01 current result

Observed October 24, 2026, 5:49 PM Eastern. The requested production result is unfinished. This is not READY.

The prepared code is on `stream/md-01`. Production is release 102, commit `4ae2e14e6db8827f741baa52e4ca8a9c62a93666`; the newer translation input and Ask changes have not shipped. No database, spending limit, pause, source record or reader target was changed by this inspection.

The read-only production comparison retains all 276 existing measure summaries across all 56 jurisdictions: 265 independently checked translations and 23 held ballot summaries, with 12 overlaps. There are still 223 missing summaries among 499 measures. No summary ID, checked translation ID or checked part ID disappeared. Every jurisdiction, including zero-count territories, is in [the state comparison](md-01-state-observation.csv). These are current production counts before the prepared changes ship, not evidence of improved publication.

Actual Google Chrome on meanwhileusa.com, release 102, October 24 at 5:30 PM Eastern:

| ZIP | Summaries | Missing |
| --- | ---: | --- |
| 85701 | 12 / 12 | None |
| 94102 | 23 / 25 | California propositions 37 and 42 |
| 98101 | 0 / 4 | Washington IL26-001, IL26-638, IP26-645; Seattle Transit Measure |

No page errors occurred. These counts match the saved earlier Chrome baseline; none of those summaries was removed.

## Cost cause and prepared repair

At 10 AM Eastern, translation calls cost $2.98737458 and published 29 explanations: $0.103013 per publication. At 11 AM, calls cost $8.81603812 and published 28: $0.314859 per publication. [Hourly baseline](md-01-explainer-hour-baseline.csv) includes calls and publications in each measured hour.

Average uncached writer input rose from 22,269 to 59,832 tokens; average writer output changed only from 1,124 to 1,240. Three large Sonnet writer calls alone cost $4.645508. They carried repeated copies of text in long official voter guides. Haiku checker prompts over 100,000 input tokens also used its higher input rate. No Opus calls were recorded in this cohort.

The prepared worker starts with a Haiku writer and Sonnet checker. A failed answer check permits a Sonnet rewrite and Opus check; budget or transport refusals do not buy rewrites. Code supplies identity, hashes and exact citation bytes, so the writer returns content and source-passage references. The existing draft checks run before purchasing the independent checker. All returned model responses retain their actual role, served model, tokens and dollar charge, including failed attempts.

The source is sent once before dynamic measure context and receives its own five-minute cache breakpoint. Exact repeated passages refer to their first occurrence. Every source position remains available and every citation expands to the original contiguous bytes; source text is not shortened or discarded.

Two production source connections were exercised through that encoder:

| Held production subject | Original source JSON bytes | Encoded bytes | Reduction | Exact source hash and citation spans |
| --- | ---: | ---: | ---: | --- |
| Maryland, Anne Arundel County question B ([official ballot](https://www.elections.maryland.gov/elections/2026/general_ballots/AnneArundel.pdf)) | 1,941,342 | 480,663 | 75.24% | Preserved |
| West Virginia, Kanawha school levy renewal ([official ballot](https://apps.sos.wv.gov/elections/2026GeneralSampleBallots/SAMPLE%20-%20WV%20Kanawha%20261103%20General%20-%2017inch.pdf)) | 2,094,897 | 439,679 | 79.01% | Preserved |

[Compaction measurements](md-01-source-compaction.json) are byte measurements from saved production sources. They are not measured token savings, dollar savings or publication gains.

The 165 unpublished reader candidate rows are not 165 paid writer failures. Their recorded reasons include publication races, missing captures, unavailable state outcomes and budget refusals. In the paid-attempt cohort, 63 attempts were held on sentence support, 12 on writer fields/passages and two on missing structured output. Failed raw drafts were not retained, so their exact malformed fields cannot be reconstructed.

## Next scheduled run and remaining work

The release-102 supervisor deferred Arizona, California and Washington translations at 5:27:43 PM Eastern with `WORKER_MEMORY_DEADLINE`. At 5:49:35 PM Eastern, the latest metered translation call was still 11:08:57 AM Eastern. No later call has exercised the prepared passage protocol. Post-change spend per publication and checker pass rates therefore remain unmeasured.

River is separately gating RV-VOTE to address source workers waiting until the shared launch deadline; its reported first-pass trade-off gives voting work most of the initial pool. MD-01 has made no speculative scheduling change.

MD-01 owns the remaining checks: after integration and deployment, observe the actual scheduled translation run; compare publications, retained summary/part IDs and checker results in every state; calculate hourly spend per publication; revisit all three ZIPs in Chrome; and verify every remaining summary gap is filled. The initial full-day Haiku > Sonnet > Opus observation also remains owed.

Ask's original 20-question Chrome acceptance is still open. The last full set had only four answers below three seconds. A later seven-question diagnostic on release 102 had none below three seconds, and the secretary-of-state duty question returned its held records without the separate AI answer. The browser check now treats a missing answer without usable AI prose as a failure, regardless of a grounded mode label.

Prepared Ask changes use the held candidate fields, national executive roster, election date and published state election fields without model calls. A missing published deadline still requests the separate AI answer and acquisition work. Exact office-duty questions bind the held contest in code, retain its candidate records and sources, and purchase only the separate Haiku answer when the pack has no duties evidence. Controlled replay retains 16, 10, eight and eight records for governor, secretary of state, attorney general and treasurer. This is not a live timing result. The latest connected suites passed 91 tests; the final route assertions passed 33; production build, dead-code, preflight and 16 bundle checks passed.

Shipping order remains unresolved: `CLAUDE.md` and `scripts/river.mjs` fold only the exact READY commit and leave later ordinary commits behind. Sean's newer instruction requires READY only after an actual scheduled production run proves the three ballot results. The concrete prepared tip is pushed; the async request for how to integrate it before that production proof is still awaiting an answer. No premature READY has been posted. The existing cleared return is monitored every 20 minutes; River has not marked MD-01 passed its live check.
