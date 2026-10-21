# RS-03: first page visits

The production-copy build passed **48/48 first browser visits under three seconds**, with a slowest visit of **2.561 s** (85701 phone Ballot). Source `11112f9dba8c` includes River `f328cd2f2` and main release 68 `4c4f7f8fd`. The returned origin/path failures are repaired. **All eight full gates pass; this replacement is READY for River.** This proves the named first visits on the copy; live Netlify timing still needs verification after River deploys it.

River returned `099f1b038fa57b76116ec430a8495916ab894dc5` on October 20 at 8:27 AM ET (`fix:f1893897`). The script imports `PUBLIC_SITE_ORIGIN`; all four flagged file-URL paths use `fileURLToPath`. Neither guard was weakened. River's exact 14 origin/path checks passed separately and are included in the full suite.

Keep-warm was removed in release 60. [rs-03.md](rs-03.md) records **at least 51.842 function-hours** spent on periodic warming in the requested October 18, 11:36:10 PM–October 19, 11:36:10 PM ET window, including failed work. This is that measured 24-hour window, not a new rolling total. Whole-state metadata shipped in release 61; [rs-03-representation.md](rs-03-representation.md) records all 400 state/county first/repeat requests under three seconds, with labels and cacheable metadata. Unchanged representation reads were not repeated.

## The page changes

- The arriving page starts one `/api/meetings?zip=...&include=state` read before hydration. State and local failures remain independently labelled. Its transferred bytes are parsed by the existing boundary worker. Separate API endpoints remain for their other callers.
- Native Netlify adapters serve the existing Meetings and public-address geocoder handlers. They remove the Next page server's cold initialization from those requests. Validation, source/identity checks, cache tags, readonly queries, address privacy and the Admin host's 404 remain. They add no schedule, memory increase or region change. Next's route handlers remain the shared implementation and development entry points. Runtime file includes cover ZIPs, postal coordinates, geometry and office references.
- The ZIP state query selects the requested district overlaps, complete selected official records, all seven people sources, federal directories and relevant registry records. Country/state roots retain senators and statewide executives. Exact aliases, recursive name ambiguity, former holders, historical selected memberships, source audits, rosters, portraits and candidacy bindings remain. Full-state consumers still read the full state. The official roster is reused inside the query instead of scanned twice. State comparisons explicitly use the migrated char(2) type, keeping the state/kind index qualified rather than scanning national body rows.
- The ballot reuses that same verified ZIP roster and directory, including held absences, instead of fetching another state roster. Profiles, publications, campaign evidence and money select all displayed and earlier filing candidates. Selected records remain complete. Ballot geography resolves before its independent people query: both use the identical held Census snapshot, so candidate and funding reads overlap the people read. The local ballot query omits unused registry/domain/routing/publication packages while retaining all consumed body facts, rosters, calendars and calendar-derived body names. Ballot-only FEC slices retain every selected candidate field/cycle and required one-hop committee book, without recursively loading unrelated candidates mentioned as donors; general Ask/Admin slices retain their existing behavior. The source-resolved controls stream while independent reads finish; the test still waits for every contest card and the real footer to be visible. Leading portraits and the needed extended numeral font load before the late card layout. All battlecards share one current topic-setting read. Independent district-pointer and translation/money reads run together; candidate objects select the requested keys directly instead of expanding unrelated cards.
- Browser ZIP restoration reads one of 100 static regional projections of the held lookup. All 42,446 placeable ZIPs, postal types and aliases match. Server point lookups parse only the requested postal row; national enumeration remains available to its callers.
- Map engine and panel modules load alongside the data or the reader's first press. Resolved components go directly to React. An unopened ballot does not prefetch its page or civic data. The after-release fill requests the arriving page's exact combined Meetings cache key, consumes the complete answer and retains its bounded fills/rereads.
- Automatic map arrival, padding and equal-bound updates settle without artificial flight holds. A view already containing the ZIP and all venues stays put. The measured phone header survives menu unmounting at the same viewport width. While a phone detail card covers the inert map, the camera keeps its current viewport; closing restores the visible layout. A real NJ return check restored padding from top/bottom 12/531 to 227/76 and rendered 415 map features in **0.463 s**.
- Software graphics use the provider's published raster TileJSON at DPR 1 while retaining the interactive district, label and pin layers. Hardware and unknown renderers retain the vector style and DPR. Pending/software surfaces use the necessary flat decoration and instant card-entry rules in `app/reader.css`; focus and selection remain. Boundary reads start early for the arriving viewport and its automatic wider fit, with each dimension capped at 2,048 pixels. On-screen adjacent tiles consume those reads once, avoiding a late boundary-fetch chain after the ZIP data arrives. The same worker starts only selected officials' missing public-office geocodes. Missing district-office coordinates are resolved alongside the server response within a bounded 450 ms; already verified office coordinates remain distinct and the browser retains its fallback. Software graphics request at most nine adjacent parent tiles early from the same published TileJSON, before the venue fit widens the camera. Failed optional reads remain retryable.
- Meeting date formatters are shared by time zone, bounded to 64 zones. List source/gap contributions register once per visible group. Settings and minute/focus refreshes remain current across control remounts.

No TX-01 database connection client is edited. No RS-03 change remains in `components/ask/**`, `components/ballot/ballot-ask-pill.tsx` or `components/shell/pill-cluster.tsx` relative to River.


## Full first visits on the production copy

Seconds from navigation through the complete usable page, including cold application startup. Build **`lYbfQoRUmuosFvJJNHec6`**, source **`11112f9dba8c`**. Each case uses a fresh browser, empty storage, and separate generated standalone/native processes starting on their first request. The first case is 07005 phone Ballot, followed by phone Home; they are not preceded by an application or data-query warmup.

| ZIP | Device | Home | Map | Meetings | Officials | Ask opening | Ballot |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 03046 | phone | 1.562 | 1.640 | 1.880 | 1.916 | 1.753 | 2.431 |
| 03046 | desktop | 1.710 | 1.814 | 1.618 | 1.718 | 1.902 | 1.961 |
| 03032 | phone | 1.698 | 1.946 | 2.049 | 1.670 | 1.466 | 1.832 |
| 03032 | desktop | 1.620 | 1.717 | 1.907 | 2.125 | 1.978 | 1.904 |
| 07005 | phone | 2.412 | 2.447 | 2.363 | 2.406 | 2.298 | 2.536 |
| 07005 | desktop | 1.862 | 2.410 | 2.029 | 2.052 | 2.190 | 1.903 |
| 85701 | phone | 1.502 | 1.571 | 1.808 | 1.937 | 1.567 | 2.561 |
| 85701 | desktop | 1.658 | 1.681 | 1.803 | 1.943 | 1.793 | 1.899 |

The parent verifies the copy's readonly identity before navigation. That SQL activates database compute outside the browser clock; the table proves cold application/browser visits on active compute, not database-resume latency. The distinct no-query idle API check below measures resumption. Copy compute limits match production (0.25–8 CU). `suspend_timeout_seconds=0` means the plan's default five-minute suspension; it does **not** mean always-on. The production reader was observed active from October 19; its endpoint configuration was not changed.

Static build bytes and manifest-confirmed prerendered home HTML use an HTTP/2 TLS loopback proxy; dynamic requests use their actual handler. Phone is 390×844 with touch, desktop 1280×800, both DPR 2 and normal motion. Chromium 151 revision 1234 uses SwiftShader WebGL fallback. This is an emulated phone and excludes deployment-specific Lambda/CDN latency.

The real tour-skip, menu/panel press and first Ask input tap/type are inside the clock. Completion requires numeric counts, the requested panel, a loaded nonmoving map, visible images loaded with nonzero natural dimensions, complete document and initial API reads, and two painted frames. Ballot requires every streamed contest and its real footer. Basemap bytes, district tap geometry and absence of unopened ballot prefetches are also checked. Ask answer generation is separate. Public settings/link-health GETs use the actual publication because local Next has no Netlify Blobs context.

The actual Netlify bundler (`@netlify/zip-it-and-ship-it` 16.4.0) packages both adapters with repository configuration, Node 24 and API v2. Their packaged user modules run from isolated packaged working directories under plain Node, without the test loader. Meetings returns complete ZIP data, state metadata and cache tags; the geocoder retains its no-store validation response. Both reject the Admin host with 404. The actual deploy-succeeded adapter verified the built commit and completed five bounded combined fills plus five rereads, all HTTP 200 with complete metadata and cache headers. This concurrent functional batch took 3.201–4.079 s per fill and 1.653–2.465 s per reread; it is separate from the quiet sequential first-visit measurements. Loopback cannot prove a CDN cache hit.

## Live comparison recorded on release 66

Release 66 main `ed0ac299ccf33fe0b1a33429cc8f805b59c5bd1d`, live first browsers with the same device sizes, normal motion, WebGL fallback and real tour/Ask actions. Server/CDN warmth is uncontrolled. **5/48** finished under three seconds. The final copy checker improves control readiness polling and additionally verifies its streamed ballot footer; main has no such marker. These are observed visits, not a matched statistical latency estimate.

| ZIP | Device | Home | Map | Meetings | Officials | Ask opening | Ballot |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 03046 | phone | 3.673 | 3.910 | 4.722 | 4.961 | 4.072 | 2.989 |
| 03046 | desktop | 11.948 | 4.615 | 11.454 | 4.724 | 7.627 | 4.169 |
| 03032 | phone | 4.261 | 3.431 | 4.076 | 5.163 | 3.399 | 2.322 |
| 03032 | desktop | 5.349 | 3.978 | 4.842 | 3.785 | 5.038 | 2.539 |
| 07005 | phone | 4.367 | 3.349 | 6.409 | 5.348 | 3.889 | 2.193 |
| 07005 | desktop | 4.899 | 4.694 | 5.754 | 5.161 | 4.361 | 2.455 |
| 85701 | phone | 3.164 | 3.468 | 8.552 | 5.142 | 3.614 | 3.950 |
| 85701 | desktop | 4.745 | 5.082 | 5.592 | 4.932 | 5.729 | 4.079 |

Failed attempts remain in `.scratch/rs03/pages/`, including the earlier 4.094 s database-idle API result, 3.4055 s first NJ ballot after money slicing, rejected HTTP-state trial (4.2612 s), body-facts build's 3.1004 s NJ Home, and overview build's 3.2974 s first NJ ballot. They prompted the indexed one-shot API, narrower body read, early overview and staged geography fixes. The final matrix uses a new build, completes all 48 cases once and has no failed visit retried into its table. One focused PGlite process also crashed in Node's Wasm allocator (`jit_page_->allocations_.erase(addr) == 1`); the isolated file passed unchanged. No runtime/test flag was changed.

## Meetings API, first and idle

Five separate native function processes, one request at a time, readonly copy, no keep-warm. On the same final source with active database compute:

| ZIP | First HTTP | Process launch plus first | Repeat HTTP | After no-query idle |
| --- | ---: | ---: | ---: | ---: |
| 85701 | 0.709 | 1.013 | 0.404 | 2.141 |
| 03301 | 0.327 | 0.604 | 0.127 | 0.473 |
| 07960 | 0.536 | 0.836 | 0.297 | 0.756 |
| 77002 | 0.361 | 0.612 | 0.149 | 0.406 |
| 10001 | 0.341 | 0.615 | 0.135 | 0.354 |

The supplied live warm HTTP baseline was 85701 1.0–1.4 s, 03301 0.4–0.5 s and 07960 about 0.5 s. Tucson and 03301 improve; 07960's 0.536 s is comparable to about 0.5 s, not evidence of an improvement. Process startup is shown separately because it was outside that supplied HTTP baseline. All five instances received no requests for more than 25 minutes through the full gates. No copy SQL ran during that interval. Neon metadata confirmed natural suspension at 12:21:16 AM ET and resumption on the first request at 12:43:45 AM ET. That first Tucson request took 2.141 s; all ten after-idle/repeat reads returned 200 under three seconds. Those database-resume conditions differ from the supplied active-database warm baseline.

## Reader and Admin parity

Meetings and officials open in all 48 page visits. Earlier same-copy main/RS checks preserve officials and all in-window meeting facts; one NJ sitting crossed the ordinary 90-day cutoff and two AZ sittings concluded between captures, recorded by ID in the API comparison. Those unchanged workflows are retained rather than reread broadly.

The final four ballots have the same held facts, contest/candidate targets and exact funding content as the preceding same-copy baseline: 9/3/16/22 contests and 18/6/50/29 candidate targets for 03046/03032/07005/85701. NH full text remains exact. NJ/AZ source counters and eleven client-registered “Still gathering: final ballot wording” labels differ with client registration timing; the held facts do not. The final four where-to-vote JSON answers match exactly, including all location details (0/0/31/168 sites), and return 200. All four browser-error lists are empty. The complete footer and latest NJ map/Tucson ballot were inspected visually.

A bounded read-only FEC comparison returned only hashes/counts: selected complete candidates, required committee books and metadata are identical. NJ's selected payload falls from 158,314 to 38,797 bytes (20 recursively linked candidates to the four needed candidates; 42 committee books to 13). General Ask/Admin readers keep their earlier broad-slice semantics.

Actual “Who governs me?” Ask answers were checked for all four ZIPs on the production copy, using copy-only question/session writes. They retain AI/NO_EVIDENCE labels as on main: main 7.15–14.02 s, copy 6.65–15.64 s. These unchanged generated-answer paths remain AQ-03's work. The 48-visit table proves opening, tapping and typing, not sub-three-second generation.

Admin Now applied its real API data in **33.022 s** on the merged build versus **37.298 s** in the main comparison. River's OT-01 history changes are included. Both return results 503 for the existing absence of published promotion pipeline items, with other required Now endpoints returning 200. The existing slow country/door reads and results failure remain with the Admin owner. This is functional parity, not a sub-three-second Now claim. Admin code is unchanged by the later ballot-only projection/scheduling fixes, so its broad existing reads were not repeated. Both copy branches expire October 22 at noon ET; their endpoints are suspended after final verification.

## Checks and database bytes

Full `pnpm gates` passed on `11112f9dba8cb941a667da31011a7b717a0e8c4f`, with current River and shipped main merged: **8/8 gates green**, **8,809 registered tests, 8,807 passed, zero failed, two skipped**, across **1,193 files**. The two optional already-held profile/roster captures were not supplied; they are skipped, not passes. The separate repository `.env.local` secret sweep did not run because that file is absent; its parser/unit checks ran. No test or runtime flag was weakened.

| Check | Result |
| --- | --- |
| Preflight | PASS, 22.12 s |
| Lint | PASS, 77 s |
| TypeScript | PASS, 60 s |
| Browser assertion | PASS, 1 s |
| Full suite | PASS, 1,449 s |
| Database shipping gate | PASS, 2 s |
| Default production build | PASS, 19 s |
| Bundle tests | 16/16 PASS, 2 s |
| Standalone production build | PASS, 22 s |

The app trace maximum is **420 files**; `/api/voting-sites` is **298**, below 430. Framework runtime is **1,185** under 1,300. Initial home JS is **902,013 raw / 284,261 gzip bytes**. Full gate evidence is retained under `.scratch/rs03/gates-11112f9dba8c/`; browser, native API, packaged-function and parity artifacts are under `.scratch/rs03/pages/`.

New/changed SQL execution fixtures use all **46 real reader migrations**. The place fixture also uses the actual production `BOOTSTRAP_DDL` declaration of the legacy `cp_work_items` table, not a made-up schema. An unchanged older place fixture still hand-builds canonical tables through `tests/helpers/fact-db.ts`; it remains an explicit owner finding, not a claim that all pre-existing fixtures follow the newer standing rule. The earlier interrupted/failed gate attempts are retained; only the final complete green run establishes READY.

Captured database reads total at least **4,220,799,228 response/frame bytes**: **3,047,459,063 reader** and **1,173,340,165 control-plane**. At $0.10 per decimal GB, the captured reader quantity corresponds to about **$0.305** beyond the reader allowance; this is not an invoice. The accounting includes original production reads, subsequent copy checks, failed attempts, diagnostics, first visits, Ask/Now checks and explicit role/schema reads. It retains distinguishable SSR/route counter streams and deduplicates cumulative snapshots. This is captured database response/frame payload, not exact billed wire traffic: public live GETs' internal Neon traffic is not independently attributable, and separate counter instances can share an identifier. Manual SQL selects needed keys, places or metadata, never a whole-table dump. The required Now workflow itself retains its existing broad reads. TX-01's shared clients/counter remain untouched.

## Owner handoffs and River

- **AQ-03:** in `components/ask/ask-box.tsx` and `components/ask/ballot-ask.tsx`, focus the mounted input using its own ref/effect with `preventScroll`; the parent's animation frame can precede lazy mounting. In `components/ballot/ballot-ask-pill.tsx`, defer the ballot Ask engine until opening while retaining the answer workflow. Existing generated-answer latency remains with AQ-03.
- **UI-03:** in `components/shell/pill-cluster.tsx`, add `askReady`, disable Ask and mark it `aria-busy` until context exists. The map parent can pass `Boolean(clusterCoverage && clusterZip)`. Retain its existing `prefetchReady=false` behavior; the RS-03 map parent leaves background ballot prefetch off. No RS-03 diff remains in any reserved Ask/pill file relative to River; `app/reader.css` contains only necessary speed rules.
- **VS-01:** release 68's voting-panel change removed the earlier consent-gated Google election-data control and address-use notice. That unrelated owner change was reported and left untouched. Official voting answers remain intact; restore the existing consent-gated Google control and address-use privacy notice.
- **CP-01 / reader-schema owner:** `lib/reader/place.ts` already reads legacy `cp_work_items`, absent from the 46 reader migrations but present on the production copy. Preserve displayed publication outcomes when separating that reader dependency; replace the older hand-built test fixture from the actual schema. RS-03 does not edit shared clients or that unrelated schema dependency.

RS-03 pushes only `stream/rs-03`. After replacement READY, fetch `board/river` and `river` with the required explicit refspecs every 15 minutes; repair returns with current River merged and their named checks rerun. Stop when River folds the exact READY. No other lane's unshipped branch was merged. Deployment and live first-visit confirmation remain River's release step.
