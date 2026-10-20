# RS-03: first page visits

The production copy passes **48/48 first browser visits under three seconds**. The slowest is **07005 phone home: 2.9927 s**. The returned origin/path failures are repaired; **the replacement READY is waiting for the full gates**. Live Netlify timing remains to be verified after River deploys the change.

River returned `099f1b038fa57b76116ec430a8495916ab894dc5` on October 20 at 8:27 AM ET (`fix:f1893897`). The script now imports `PUBLIC_SITE_ORIGIN`; all four file-URL paths use `fileURLToPath`. Neither guard was weakened. The 14 returned checks pass with River's exact CI flags.

Keep-warm was removed in release 60; [rs-03.md](rs-03.md) records its replacement and the measured **51.842 function-hours** lower bound in the October 18–19 24-hour window. This is the recorded window, not a new rolling total. Whole-state metadata shipped in release 61; [rs-03-representation.md](rs-03-representation.md) records every state's whole-state and county first/repeat timings, including the 200-request recheck. All 400 requests finished under three seconds, with nonempty labels and cacheable metadata.

## The page changes

- The arriving page starts one `/api/meetings?zip=...&include=state` read before hydration. State and local failures remain independently labelled. Its transferred bytes are parsed by the existing boundary worker. Separate API endpoints remain for their other callers.
- Native Netlify adapters serve the existing Meetings and public-address geocoder handlers. They remove the Next page server's cold initialization from those requests. Validation, source/identity checks, cache tags, readonly queries, address privacy and the Admin host's 404 remain. They add no schedule, memory increase or region change. Next's route handlers remain the shared implementation and development entry points. Runtime file includes cover ZIPs, postal coordinates, geometry and office references.
- The ZIP state query selects the requested district overlaps, complete selected official records, all seven people sources, federal directories and relevant registry records. Country/state roots retain senators and statewide executives. Exact aliases, recursive name ambiguity, former holders, historical selected memberships, source audits, rosters, portraits and candidacy bindings remain. Full-state consumers still read the full state. The official roster is reused inside the query instead of scanned twice.
- The ballot reuses that same verified ZIP roster and directory, including held absences, instead of fetching another state roster. Profiles, publications, campaign evidence and money select all displayed and earlier filing candidates. Selected records remain complete. The source-resolved controls stream while independent reads finish; the test still waits for every contest card and the real footer to be visible. Leading portraits and the needed extended numeral font load before the late card layout. All battlecards share one current topic-setting read.
- Browser ZIP restoration reads one of 100 static regional projections of the held lookup. All 42,446 placeable ZIPs, postal types and aliases match. Server point lookups parse only the requested postal row; national enumeration remains available to its callers.
- Map engine and panel modules load alongside the data or the reader's first press. Resolved components go directly to React. An unopened ballot does not prefetch its page or civic data. The after-release fill requests the arriving page's exact combined Meetings cache key, consumes the complete answer and retains its bounded fills/rereads.
- Automatic map arrival, padding and equal-bound updates settle without artificial flight holds. A view already containing the ZIP and all venues stays put. The measured phone header survives menu unmounting at the same viewport width. While a phone detail card covers the inert map, the camera keeps its current viewport; closing restores the visible layout. A real NJ return check restored padding from top/bottom 12/531 to 227/76 and rendered 415 map features in **0.463 s**.
- Software graphics use the provider's published raster TileJSON at DPR 1 while retaining the interactive district, label and pin layers. Hardware and unknown renderers retain the vector style and DPR. Pending/software surfaces use the necessary flat decoration and instant card-entry rules in `app/reader.css`; focus and selection remain. Boundary header and two bounded center-tile reads start early and are consumed once. The same worker starts only selected officials' missing public-office geocodes. Failed optional reads remain retryable.
- Meeting date formatters are shared by time zone, bounded to 64 zones. List source/gap contributions register once per visible group. Settings and minute/focus refreshes remain current across control remounts.

No TX-01 database connection client is edited. No RS-03 change remains in `components/ask/**`, `components/ballot/ballot-ask-pill.tsx` or `components/shell/pill-cluster.tsx` relative to River.

## Full first visits on the production copy

Seconds, from navigation through the complete usable page, including cold server startup. Build **`Xb3-FG4RsRh532u9IbR0j`**, source `f318d46be` (the same source compiled immediately before that checkpoint commit).

| ZIP | Device | Home | Map | Meetings | Officials | Ask opening | Ballot |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 03046 | phone | 1.846 | 2.328 | 2.453 | 2.673 | 1.969 | 2.465 |
| 03046 | desktop | 2.317 | 2.197 | 2.022 | 2.287 | 2.614 | 2.987 |
| 03032 | phone | 2.057 | 2.455 | 2.020 | 2.374 | 2.262 | 2.428 |
| 03032 | desktop | 2.483 | 2.155 | 2.117 | 2.533 | 2.243 | 2.444 |
| 07005 | phone | 2.993 | 2.619 | 2.368 | 2.937 | 2.236 | 2.623 |
| 07005 | desktop | 2.662 | 2.499 | 2.459 | 2.442 | 2.006 | 2.653 |
| 85701 | phone | 1.962 | 1.699 | 1.974 | 1.838 | 1.856 | 2.578 |
| 85701 | desktop | 1.722 | 2.002 | 1.929 | 1.976 | 1.947 | 2.489 |

Each case starts a fresh browser, empty storage and separate cold generated-standalone/native processes on their first request. No application or database pool is warmed before navigation. The parent checks the copy's readonly identity. Static build bytes and manifest-confirmed prerendered home HTML use an HTTP/2 TLS loopback proxy; dynamic requests use their actual handler. Phone is 390×844 with touch, desktop 1280×800, both DPR 2 and normal motion. Chromium 151 revision 1234 uses SwiftShader WebGL fallback (`--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`). Compute limits match production. This is an emulated phone and excludes Netlify deployment-specific Lambda/CDN latency.

A real first tour-skip, menu/panel press and Ask input tap/type are inside the clock. Controls are detected in animation frames, then pressed normally; the browser scrolls where needed. Completion requires numeric counts, the requested panel, a loaded nonmoving map, decoded visible images, the complete document, all initial API reads and two painted frames. Ballot completion requires its real footer to be visible, including streamed contents. Basemap bytes, district tap geometry and absence of unintended ballot prefetches are checked as well. Ask answer generation is measured separately. Settings/link-health GETs use the actual publication because local Next has no Netlify Blobs context.

## Current-main comparison

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

Earlier failed cold-copy attempts are retained in `.scratch/rs03/pages/`. The preceding complete build passed 43/48 and failed five visits; it did not establish READY. The original whole-browser GPU-driver emulation also stalled on an initial blank-widget GL flush; both comparisons above use Chromium's documented WebGL fallback, which still runs the map in software. One main `/api/build` precheck returned HTTP 500 before any page navigation; the failed precheck and fresh replacement process are both retained. No failed page visit was silently retried into the final table.

## Meetings API, first and idle

The five original ZIPs use separate native function processes, readonly copies, one request at a time, with no keep-warm. After the first/repeat reads every process receives no requests for at least six minutes. HTTP seconds and separately labelled process-launch-plus-first seconds:

| ZIP | Initial HTTP | Launch plus first | Repeat HTTP | After six idle minutes |
| --- | ---: | ---: | ---: | ---: |
| 85701 | 0.902 | 1.250 | 0.303 | 0.557 |
| 03301 | 0.404 | 0.805 | 0.127 | 0.332 |
| 07960 | 0.508 | 1.120 | 0.188 | 0.345 |
| 77002 | 0.422 | 0.767 | 0.151 | 0.324 |
| 10001 | 0.390 | 0.869 | 0.126 | 0.241 |

The supplied live warm HTTP baseline was 85701 1.0–1.4 s, 03301 0.4–0.5 s and 07960 about 0.5 s. New initial HTTP times are 0.902, 0.404 and 0.508 s respectively; after-idle HTTP is 0.557, 0.332 and 0.345 s. Process launch is reported separately and was not part of that supplied HTTP baseline.

## Reader and Admin parity

Production-copy browser checks opened meetings and officials, loaded every ballot, obtained where-to-vote answers and submitted a real “Who governs me?” Ask question for all four ZIPs. All responses returned 200 and all four browser-error lists are empty. Officials and where-to-vote text match main exactly. In-window meeting facts remain; one NJ sitting crossed the ordinary 90-day cutoff and two AZ sittings concluded between checks, as recorded by ID in the API comparison.

The latest ballot comparison, after reusing state reads, is exact for 03046 (12,200 characters), 03032 (4,986) and 07005 (22,649). AZ retains all facts, contacts and money; its sole text difference is one blank line before Brian Matlock's battlecard. All four voting-location answers remain exact. The complete NH footer was verified visibly, rather than treating a hidden streaming container as completion. The NJ phone map and full NH ballot were also inspected visually.

Actual Ask answers remain labelled AI/NO_EVIDENCE, as on main. Main took 7.15–14.02 s; the copy took 6.65–15.64 s. That existing answer latency remains AQ-03's work. The 48-visit table proves opening, tapping and typing, not sub-three-second generated answers.

Admin Now applied its real API data in **31.333 s** on the build versus **37.298 s** on main. Its displayed body differs only in checked-at clock times. Both return results 503 for the existing absence of published promotion pipeline items; their other required Now endpoints return 200. The existing slow country/door reads and results failure remain with the Admin owner. These functional checks do not claim Admin Now is under three seconds. Copy-only Admin authentication/question writes were isolated from production. Both copy endpoints are suspended after verification; their branches have an expiration.

## Checks and captured database bytes

Focused origin/path/native/layout/context checks pass **24/24**, including River's exact 14 checks. The selected SQL/source checks pass **16/16**; earlier point/map, streaming, legacy proof and settings runs are retained. SQL tests create their database from all **46 real migrations**. Modified-file lint and the production build pass. The maximum app trace remains **429 files**, including `/api/voting-sites`, under 430; standalone framework runtime is 1,185 under 1,300. Initial home JS is 902,058 raw / 284,206 gzip bytes.

The first full-gate attempt was stopped after three ballot test files ignored streamed Promise children or used source-definition order as DOM order. The retained run is not a passing gate run. The two render visitors now await React children; the pill guard checks the main's rendered child order and a single mounted pill. Their existing 26 tests pass without changing the application or repeating database reads.

**Full merged-tree `pnpm gates` is pending. No replacement READY is pushed yet.** The source checkpoint includes current River and shipped main; the final gate run and READY will name their exact source commit.

Captured database response/frame bytes across this work are at least **3,248,396,184 bytes**: **2,373,764,149 reader** and **874,632,035 control-plane**. This includes the original 1,224,653,103 production-reader bytes and subsequent copy investigations, failed attempts, profiles, first visits, actual Ask/Now checks and explicit metadata/role reads. The private aggregation retains independent SSR/route counter streams when distinguishable and deduplicates cumulative reports. At $0.10/decimal GB, the captured reader portion corresponds to approximately $0.237 beyond the reader project's allowance; it is not an invoice.

This is a captured minimum. Live public GETs' internal Neon traffic cannot be attributed exactly from browser response sizes, and independent counter instances can share a process identifier. No manual query dumps a whole table: checks select needed keys, places and metadata; the mandated Now page itself still performs the broad existing reads noted above. TX-01 owns the shared transfer counter and clients; an instance identifier in its cumulative reports would allow exact SSR/route aggregation. They remain untouched here. The retained byte summary is `.scratch/rs03/pages/copy-byte-summary.json`.

## Owner handoffs and River

- **AQ-03:** focus each mounted AskBox/BallotAsk input using its own ref/effect with `preventScroll`; the parent's animation frame can precede lazy mounting. Defer the ballot Ask engine until its pill opens, preserving the answer workflow. Existing slow generated answers remain AQ-03's responsibility.
- **UI-03:** add `askReady` to `PillCluster`, disabling/marking Ask `aria-busy` until context exists. The map parent can pass `Boolean(clusterCoverage && clusterZip)` when that prop ships. Keep unopened ballot links from prefetching during the first map draw.

RS-03 pushes only `stream/rs-03`. After the replacement READY it fetches `board/river` and `river` with the required explicit refspecs every 15 minutes, repairs any return with current River merged and named checks rerun, and stops the return watch when River folds the exact READY. Live first-visit measurements remain required after the deployed change is serving.
