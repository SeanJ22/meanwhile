# RS-03: first page visits

**Work in progress; replacement READY has not been pushed.** The stricter cold-server matrix still has pages over three seconds. Earlier measurements that reused a running server cannot establish the requested first-visit result.

River returned READY `099f1b038fa57b76116ec430a8495916ab894dc5` on October 20 at 8:27 AM ET (`fix:f1893897`). The origin/path guard repairs are implemented without weakening either guard. Current work also removes edits to AQ-03 and UI-03's files and checks all reader and Admin behavior against production copies.

The keep-warm replacement is already folded in release 60; see [rs-03.md](rs-03.md). Its measured **51.842 function-hours** is a lower bound for the explicitly recorded October 18–19 24-hour window, not a new rolling total. Whole-state representation metadata is already folded in release 61; [rs-03-representation.md](rs-03-representation.md) contains all 200 first/repeat state and county measurements and the later 200-request recheck.

## Causes and changes

- The map delayed fitting meeting venues by 2,800 ms even after its initial ZIP jump had finished. Automatic bounds updates now settle immediately, waiting for an actual flight when necessary. Repeated equal bounds do not move the camera again.
- Zero-duration positioning and padding were treated as flights, hiding the district layers and rebuilding them on reveal. Instant camera events now skip that motion hold. Assigning a layer its existing visibility does nothing, including its initial default visibility. Genuine software-rendered flights retain their motion hold.
- Fully transparent district interiors were still drawn by the GPU. Their hit areas now skip painting until a selection or narrowed district needs shading. Tap queries, selection shading and theme changes are checked explicitly.
- The ZIP state route indexed the entire static ZIP directory although it already held the requested ZIP. It now uses that entry and passes the ZIP to the existing Census metadata reader.
- Browser ZIP restoration also waited for a server function to load the national postal tables. The build now projects the same held coordinates and postal metadata into 100 regional CDN files. All 42,446 placeable ZIPs match the original lookup, including mail-only aliases. No place facts are invented or dropped. These browser files are excluded from function traces.
- Office pins issued separate directory requests for representatives whose sourced offices had already been read in the state response. The compact ZIP response now carries only its selected people's offices, provenance and held empty directories. Exact identity and ambiguity checks remain in place.
- Control remounts fetched settings again and restarted the minute clock. The page now shares one settings read and one refresh clock, retaining minute and focus updates. Settings and state outlines start with the arriving ZIP data and are consumed once.
- The map starts loading Ask, Meetings and Officials when the reader first presses their controls and hands the resolved component directly to React. This avoids a second suspense delay. The inputs and shared pill component remain with AQ-03 and UI-03; their exact remaining changes are listed below.
- Software graphics compiled the complete vector basemap locally and painted four canvas pixels per CSS pixel at DPR 2. Positively identified software renderers start with MapTiler's published raster TileJSON for the same theme at DPR 1; the provider supplies the tiles, zoom limits and attribution. District boundaries, labels, selection and pins retain their existing interactive layers. Hardware and unknown renderers retain the vector basemap. Reduced-motion visits also disable the initial symbol fade.
- The first controls paint without decorative gradients and shadows, then the map's own graphics context selects the final presentation. Software renderers retain flat surfaces; accelerated and unknown renderers restore the usual treatment. Colours, focus/selection outlines, native select arrows and provider attribution remain. No second graphics context is created for detection.
- Boundary reads and decoding waited for the UI thread. A small worker now owns the existing PMTiles reader. The arriving page starts its bounded header read and, once the ZIP resolves, one center tile at the existing initial zoom. MapLibre consumes that tile once, and all other tiles use the ordinary PMTiles range reader, cancellation and ETag recovery. At most one unused center tile is held. A failed optional prefetch cannot poison the later requested read. No whole archive is downloaded.
- The same worker parses the arriving state response and starts only the selected representatives' missing district-office coordinates, using the existing public-address geocoder and source/identity rules. It runs alongside rendering. The UI shares those pending or recently successful points; the bounded 30-second cache expires and failed matches remain retryable.
- The map engine loads alongside the data without blocking hydration of the ZIP controls. A resolved module is handed directly to React, avoiding a second suspense delay. Meetings and officials load when their controls open. AQ-03 owns the ballot Ask engine change.
- The unopened ballot no longer starts speculative page/data reads while the first map is drawing. Opening its link still loads the real page.
- The after-release fill now uses the arriving page's exact `/api/meetings?zip=...` cache key. Its previous latitude/longitude key differed under `Netlify-Vary`. A test runs the actual arriving-page script and compares its request to the fill URL. Place selection, bounded concurrency, deadlines and rereads remain connected to `deploy-succeeded`.
- Meeting dates and times reuse the time zone's compiled `Intl.DateTimeFormat` objects, bounded to 64 zones. Each call still formats the meeting's current value with the same locale and options. A cold expansion had built 2,067 formatters and spent 4.908 s constructing them; constructor work is now absent during expansion.
- The list submits the same missing agenda/place facts once per visible group, alongside its existing source contribution. This removes hundreds of individual card-registry updates while retaining every displayed meeting's missing facts.

No shared database client is changed. TX-01 retains ownership of those files. The replacement changes callers and browser startup; it adds no scheduled warming.

- A ZIP read fetched the complete state registry and OpenStates roster. The state batch now selects the ZIP's district people, exact alias and same-name closure, relevant registry definitions, statewide/national definitions and every held roster's body definition in the database. Complete selected records, metadata, rosters, photos and candidacy bindings remain. Full-state callers still receive the full registry. NH's Members.txt identity and county/district mapping participate in selection. Census scope metadata remains complete; ZIP grouping overlaps are selected before transfer.
- State fetching begins in the arriving document alongside meetings. Its bytes transfer to the existing worker for parsing; it no longer waits for that worker to download before starting the request.

## Browser method

`scripts/rs-03-pages-check.mts` measures one ZIP, profile and surface per process. Every case starts a fresh browser, empty HTTP storage and a fresh Next production server. The first dynamic request starts Next **inside the navigation clock**. Nothing calls the application or warms the database pool before navigation.

Phone is 390 × 844 with touch; desktop is 1280 × 800; both use DPR 2 and normal motion. Chromium 151 revision 1234 uses SwiftShader software graphics. The production copy has the same configured compute range as production. The readonly role and transaction settings are checked. No production facts or settings are changed. Static build bytes and manifest-confirmed prerendered home HTML are served through a streaming HTTP/2 TLS loopback proxy. Dynamic documents and APIs use cold Next. This includes local server startup and browser rendering, but excludes Netlify's deployment-specific Lambda/CDN latency. It does not simulate a physical phone or hardware GPU.

The timer waits for numeric meeting counts, the loaded nonmoving map, a visible ZIP marker, the selected panel, document completion, visible images, all initial API reads and two painted frames. Ask and ballot controls are pressed for the first time, then their real inputs are tapped and typed into. Answer generation is checked separately. Basemap success, district tap geometry, source reads and unintended ballot prefetches are verified after stopping the clock; failures still fail the case. Settings and link-health GETs use the actual published endpoints because local Next has no Netlify Blobs context.

## Evidence and outstanding measurements

The October 20 strict comparison against release 66 main (`ed0ac299ccf33fe0b1a33429cc8f805b59c5bd1d`) measured 48 first visits on each side: main passed **3/48**, the then-built replacement **14/48**. The slowest replacement page was 07005 desktop ballot at **8.078 seconds**. Raw results, including every failure, remain in `.scratch/rs03/pages/after-return-cold-matrix/`. These are diagnostic results, not acceptance.

The later single-batch pilots passed 85701 phone Ask opening at **2.598 seconds**, while 03046 phone Meetings (3.764), 07005 phone home (4.235) and 07005 desktop ballot (3.575) still failed. The registry projection build is being measured next. A final full cold matrix is required before READY.

Production-copy API comparison before the registry change returned identical existing state fields and meetings data for all four ZIPs; the added office directory field avoids repeat reads. The comparison must be repeated after the new projection.

Current-main functional browser checks opened meetings and officials, submitted an actual Ask question, loaded the ballot and fetched where to vote for all four ZIPs without browser errors. The existing broad question “Who governs me?” produced labelled AI/NO_EVIDENCE responses in 7.15–14.02 seconds. That answer behavior belongs to AQ-03 and is not repaired in these files.

Current-main Admin Now took **37.298 seconds** to apply its actual API data to the table. Its results endpoint returned 503 because the published snapshot has no promotion pipeline items; the other required Now requests returned 200. This existing failure and the large eager country read are reported and left with the Admin owner. The built tree still needs the corresponding production-copy reader and Now comparisons. These functional checks are separate from the reader page-speed matrix.

## Verification, bytes and owner handoffs

The latest registry/NH-focused run passes **20/20** tests. SQL tests build their database from all 46 real migrations. Modified-file lint and the production build pass; the maximum reader route trace remains **429 files** under the 430 ceiling. The final merged tree still needs the returned origin/path checks, preflight, schema gate and full `pnpm gates`. Older full-gate passes do not establish the latest tree.

The previously recorded production reader response total is **1,224,653,103 bytes**. All subsequent copy checks, failed investigations, profiles and functional checks must be added before READY. Captured HTTP response bytes are not an exact Neon invoice: early small queries and internal Neon traffic from live public GETs are unmetered. No manual check dumps whole tables; reads select needed promotion keys, places, metadata and fields. Shared database connection clients remain unchanged.

No edits from RS-03 remain in `components/ask/**`, `components/ballot/ballot-ask-pill.tsx` or `components/shell/pill-cluster.tsx` relative to current River. `app/reader.css` retains only the first-paint/software-renderer speed rules.

- **AQ-03:** focus the mounted AskBox and BallotAsk input through its own ref with `preventScroll`; the parent's animation-frame focus can run before lazy mounting. Load the ballot Ask engine only when opened. Preserve the existing answer workflow.
- **UI-03:** make Ask's readiness explicit in PillCluster with disabled/`aria-busy` until place context exists; reconnect the map parent's readiness prop when that API ships. Keep unopened ballot links from prefetching while the first map draws.

Before READY this lane merges current River, reruns its named checks, records the final cold matrix, functional parity and captured bytes, then pushes only `stream/rs-03`. It checks `board/river` every 15 minutes after pushing and repairs returns until River folds the exact new READY.
