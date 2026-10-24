# MD-01 current result

Observed October 24, 2026, 5:55 PM Eastern. The requested production result is unfinished. This is not READY.

The prepared code is on `stream/md-01`, merged with release 103. Production is release 103, commit `d3416a24f38edb1c331e9dab4d92bc3bfa4e399b`; the newer MD-01 translation input and Ask changes have not shipped. All database inspection used the supplied read-only roles. No direct database write, spending-limit change, pause change or reader-target change was made.

The 5:49 PM read-only production comparison retains all 276 existing measure summaries across all 56 jurisdictions: 265 independently checked translations and 23 held ballot summaries, with 12 overlaps. There are still 223 missing summaries among 499 measures. No summary ID, checked translation ID or checked part ID disappeared. Every jurisdiction, including zero-count territories, is in [the state comparison](md-01-state-observation.csv). These are production counts before the prepared changes ship, not evidence of improved publication.

Actual Google Chrome on meanwhileusa.com, release 103, October 24 at 5:55 PM Eastern:

| ZIP | Summaries | Missing |
| --- | ---: | --- |
| 85701 | 12 / 12 | None |
| 94102 | 23 / 25 | California propositions 37 and 42 |
| 98101 | 0 / 4 | Washington IL26-001, IL26-638, IP26-645; Seattle Transit Measure |

No page errors occurred. These counts match the saved earlier Chrome baseline; none of those summaries was removed or changed. Screenshots and the live card text were inspected.

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

The existing scheduled caller already excludes older unnumbered reader sections from a checked rewrite, because draft validation requires an official section number. The prepared code moves that existing rule into the writer and deletes the caller's duplicate filtering. Existing unnumbered sections remain in reader composition with their exact text, reaction IDs, original source and original date. Arizona proposition 318 has five such sections and still lacks a checked summary; its failure cannot be attributed to unnumbered sections, which the scheduled caller already excluded. Its saved failed attempt does not contain the raw draft.

A controlled replay with the actual production Arizona ballot and ten published checked translations retains all 52 original section IDs, texts and citation URLs across 15 native measure records, with zero network or model calls. It also corrects 47 retained sections whose original writing date was being replaced by their new summary's date. Repeated composition retains the original provenance. The six affected translation/reader suites pass 54 tests, TypeScript and targeted lint pass, and the dead-code check passes. The production build with postbuild, both preflight checks and all 16 bundle checks also pass. This is reader composition against saved production records, not a deployed Chrome or scheduled-run proof.

## Next scheduled run and remaining work

The release-103 supervisor again deferred Arizona, California and Washington translations at 6:22:09 PM Eastern with `WORKER_MEMORY_DEADLINE`. At 6:27:55 PM Eastern, the latest metered translation call was still 11:08:57 AM Eastern. No later call has exercised the prepared passage protocol. Post-change spend per publication and checker pass rates therefore remain unmeasured.

River's RV-VOTE change addresses voting workers waiting until the shared launch deadline; its reported first-pass trade-off gives voting work most of the initial pool. MD-01 extends that existing order so due measure explainers follow ballots and voting sites, ahead of the meeting backlog. Every admitted job remains in the same pool, and the existing paid-work controls still decide every model call. In a controlled three-GiB worker-memory allocation, the prior voting-first order admits one of the three deferred state translators; the prepared order admits all three, with voting still first. This is a worker-admission test, not a production run. The affected scheduler, voting and translation suites pass 125 tests with the canonical two-file concurrency.

MD-01 owns the remaining checks: after integration and deployment, observe the actual scheduled translation run; compare publications, retained summary/part IDs and checker results in every state; calculate hourly spend per publication; revisit all three ZIPs in Chrome; and verify every remaining summary gap is filled. The initial full-day Haiku > Sonnet > Opus observation also remains owed.

Ask's original 20-question Chrome acceptance is still open. The last full set had only four answers below three seconds. A later seven-question diagnostic on release 102 had none below three seconds, and the secretary-of-state duty question returned its held records without the separate AI answer. The browser check now treats a missing answer without usable AI prose as a failure, regardless of a grounded mode label.

Prepared Ask changes use the held candidate fields, national executive roster, election date and published state election fields without model calls. A missing published deadline still requests the separate AI answer and acquisition work. Closed duty questions about held state executive offices bind the contest in code, retain its candidate records and sources, and purchase only the separate Haiku answer when the pack has no duties evidence. Local councils and school/county boards retain the existing body reader and its records. Controlled replay retains 16, 10, eight and eight records for governor, secretary of state, attorney general and treasurer. This is not a live timing result. After merging release 103, 103 Ask/reader tests and 46 translation tests passed; production build, dead-code, preflight and 16 bundle checks passed. Lint reported zero errors and 56 existing warnings, none in the changed Ask files. The subsequent local-body preservation suite passes 92 tests.

Publication uses the explicit Codex exception in `CLAUDE.md`: [draft PR #815](https://github.com/SeanJ22/meanwhile/pull/815) targets `river`. This makes the checked code available for integration before the actual scheduled production proof. Ordinary commits alone are not folded by `scripts/river.mjs`, which selects an exact READY commit. Sean's newer instruction requires READY only after that live run proves the three ballot results, so no premature READY has been posted. The existing cleared return is monitored every 20 minutes; River has not marked MD-01 passed its live check.
