# RS-03: first page visits

**48/48 first page visits finish under three seconds; maximum 2.860 s.** All eight first Ask presses open a focused input and accept typing. Current main passes 14/48 visits and fails that first Ask use in all eight profiles. The matrix covers 03046, 03032, 07005 and 85701 on phone and desktop, across home, map, meetings, officials, Ask opening and ballot.

The branch includes tested River `026804b0e9034df7b40566c20fbc2d85a43da17e` (AQ-01, UI-04 and VT-01). Every final main visit serves release 62, `2d31bd5775d011d2955fb112b3f94b788826a696`, whose tree matches that River. The replacement build ID is `KWnb5_0hvrexIUj6S3wlj`.

The preceding whole-state metadata READY (`9ae9a00d47a07dcf6976f94992aeffacae68db05`) was folded at October 20, 3:44 AM ET and deployed in release 61. A fresh 200-request recheck on this merged build passes; its complete state/county timings are in [rs-03-representation.md](rs-03-representation.md). The keep-warm removal, idle meetings checks and measured **51.842 function-hours** of periodic warming in the recorded 24-hour window are in [rs-03.md](rs-03.md).

## Causes and changes

- The map delayed fitting meeting venues by 2,800 ms even after its initial ZIP jump had finished. Automatic bounds updates now settle immediately, waiting for an actual flight when necessary. Repeated equal bounds do not move the camera again.
- Zero-duration positioning and padding were treated as flights, hiding the district layers and rebuilding them on reveal. Instant camera events now skip that motion hold. Assigning a layer its existing visibility does nothing, including its initial default visibility. Genuine software-rendered flights retain their motion hold.
- Fully transparent district interiors were still drawn by the GPU. Their hit areas now skip painting until a selection or narrowed district needs shading. Tap queries, selection shading and theme changes are checked explicitly.
- The ZIP state route indexed the entire static ZIP directory although it already held the requested ZIP. It now uses that entry and passes the ZIP to the existing Census metadata reader.
- Browser ZIP restoration also waited for a server function to load the national postal tables. The build now projects the same held coordinates and postal metadata into 100 regional CDN files. All 42,446 placeable ZIPs match the original lookup, including mail-only aliases. No place facts are invented or dropped. These browser files are excluded from function traces.
- Office pins issued separate directory requests for representatives whose sourced offices had already been read in the state response. The compact ZIP response now carries only its selected people's offices, provenance and held empty directories. Exact identity and ambiguity checks remain in place.
- Control remounts fetched settings again and restarted the minute clock. The page now shares one settings read and one refresh clock, retaining minute and focus updates. Settings and state outlines start with the arriving ZIP data and are consumed once.
- An enabled first Ask press could arrive before its place context, and focus could run before the lazy input mounted. Ask becomes enabled with its context, and each actual input focuses when it mounts. The Admin speed runner also presses the real button instead of dispatching an event before hydration.
- Software graphics compiled the complete vector basemap locally and painted four canvas pixels per CSS pixel at DPR 2. Positively identified software renderers start with MapTiler's published raster TileJSON for the same theme at DPR 1; the provider supplies the tiles, zoom limits and attribution. District boundaries, labels, selection and pins retain their existing interactive layers. Hardware and unknown renderers retain the vector basemap. Reduced-motion visits also disable the initial symbol fade.
- The first controls paint without decorative gradients and shadows, then the map's own graphics context selects the final presentation. Software renderers retain flat surfaces; accelerated and unknown renderers restore the usual treatment. Colours, focus/selection outlines, native select arrows and provider attribution remain. No second graphics context is created for detection.
- Boundary reads and decoding waited for the UI thread. A small worker now owns the existing PMTiles reader. The arriving page starts its bounded header read and, once the ZIP resolves, one center tile at the existing initial zoom. MapLibre consumes that tile once, and all other tiles use the ordinary PMTiles range reader, cancellation and ETag recovery. At most one unused center tile is held. A failed optional prefetch cannot poison the later requested read. No whole archive is downloaded.
- The same worker parses the arriving state response and starts only the selected representatives' missing district-office coordinates, using the existing public-address geocoder and source/identity rules. It runs alongside rendering. The UI shares those pending or recently successful points; the bounded 30-second cache expires and failed matches remain retryable.
- The map engine loads alongside the data without blocking hydration of the ZIP controls. A resolved module is handed directly to React, avoiding a second suspense delay. Meetings, officials and the ballot Ask engine load when their controls open.
- The unopened ballot no longer starts speculative page/data reads while the first map is drawing. Opening its link still loads the real page.
- The after-release fill now uses the arriving page's exact `/api/meetings?zip=...` cache key. Its previous latitude/longitude key differed under `Netlify-Vary`. A test runs the actual arriving-page script and compares its request to the fill URL. Place selection, bounded concurrency, deadlines and rereads remain connected to `deploy-succeeded`.

No shared database client is changed. TX-01 retains ownership of those files. The replacement changes callers and browser startup; it adds no scheduled warming.

## Browser method

`scripts/rs-03-pages-check.mts` uses the existing guarded browser with writes blocked and a synthetic run marker. Each visit has a fresh browser context, empty HTTP storage and a selected ZIP. Local storage starts empty except for the existing Admin speed runner's tutorial-dismissed marker. Phone is 390 × 844 with touch; desktop is 1280 × 800; both use DPR 2. Both sides of the final comparison use ordinary motion. The checker waits for numeric meeting counts, the complete loaded map, a visible ZIP marker, the requested panel, document completion, visible images, all initial API reads and two painted frames. Ask and ballot inputs must acquire focus and accept typing on their first press. No question is submitted and no model is called.

Normal MapTiler access is explicitly enabled and capped at 200 requests per six-visit ZIP/profile run. The final comparison uses pinned Playwright Chromium revision 1234 (151.0.7922.34), with SwiftShader software graphics. Source geometry, tap hit areas, a successful basemap and the single archive header read are verified after stopping the timing; their inspection cost is excluded from both sides. Geometry verification failures still fail the visit. Hardware rendering and physical phones are outside this emulated-browser measurement.

Current main is measured on `https://meanwhileusa.com`. The replacement is a Next production build using the existing production `readonly` role. Only the test browser resolves the production host to a streaming HTTP/2 TLS loopback proxy, matching production's protocol and MapTiler's permitted browser origin. Its certificate is local, temporary and removed after the run. Each navigation must carry the proxy's exact build-ID header. A read-only transaction verifies the database role, read-only setting and lack of public-table write privileges. Each built ZIP/profile run starts a fresh server and browser process. The first timed home visit makes its first API requests; later surfaces retain the server process but receive fresh browser contexts. Settings and link-health GETs come from their actual live endpoints because local Next has no Netlify Blobs context; their wait remains included. Built measurements include browser rendering and production data, with local delivery of the build's static bytes, and exclude Netlify Lambda/CDN deployment latency.

The proxy serves the build's immutable static assets and its manifest-confirmed pre-rendered home HTML directly, precompressed as CDN assets. Dynamic documents and APIs reach the fresh Next process. No application request warms the process or database pool before navigation.

Earlier failures are retained under `.scratch/rs03/pages/`, including refused localhost basemaps, buffered proxy transport, software compositor experiments and slow cold visits. A graphics probe added overhead and was removed. Flat-surface diagnostics reduced the gap between receiving state data and publishing it from 1,018 ms to 58 ms. Instant camera holds and transparent GPU fills accounted for further avoidable work. The timing harness also stopped charging layout inspection and locator polling delays to page completion; the final main and replacement matrices both use that correction. These diagnostics are included in the read-byte accounting.

## Final measurements and transfer

Complete page seconds, **release 62 main → replacement**:

| ZIP | Browser | Home | Map | Meetings | Officials | Ask opening | Ballot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 03046 | phone | 4.30 → 2.30 | 2.53 → 1.39 | 2.70 → 1.56 | 3.99 → 1.64 | Failed¹ → 1.95 | 3.08 → 2.53 |
| 03046 | desktop | 5.76 → 2.49 | 3.86 → 1.95 | 4.19 → 1.94 | 4.21 → 1.91 | Failed¹ → 2.13 | 2.36 → 2.11 |
| 03032 | phone | 5.35 → 1.95 | 2.70 → 1.43 | 2.96 → 1.64 | 2.58 → 1.77 | Failed¹ → 1.34 | 2.63 → 2.31 |
| 03032 | desktop | 3.83 → 2.56 | 3.90 → 1.82 | 3.72 → 1.83 | 3.69 → 2.04 | Failed¹ → 2.18 | 2.07 → 2.21 |
| 07005 | phone | 3.75 → 2.77 | 2.94 → 1.49 | 3.98 → 1.68 | 3.87 → 2.33 | Failed¹ → 1.52 | 3.05 → 2.14 |
| 07005 | desktop | 4.46 → 2.46 | 3.80 → 1.89 | 3.45 → 1.61 | 5.37 → 2.02 | Failed¹ → 1.92 | 2.86 → 2.07 |
| 85701 | phone | 3.94 → 2.02 | 2.38 → 1.20 | 2.98 → 1.78 | 3.32 → 1.70 | Failed¹ → 1.28 | 2.25 → 2.05 |
| 85701 | desktop | 3.60 → 2.86 | 3.05 → 1.99 | 3.93 → 2.02 | 3.39 → 1.72 | Failed¹ → 2.33 | 2.91 → 2.07 |

¹ The first press failed to produce a visible, focused input: some panels never opened; others opened without focus. The replacement passes all three checks: opening, focus and typing. No answer-generation timing is claimed.

The 48 passing visits span October 20, **7:23–7:34 AM ET**. The 200 state/county rechecks finish at **7:37 AM ET**, with a 1.850 s HTTP maximum and 2.322 s maximum including process startup and first request. Raw page evidence is in `.scratch/rs03/pages/current-matrix/`; metadata evidence is in `.scratch/rs03/representation-current/`.

| Captured production reader responses | Bytes |
| --- | ---: |
| Final 48-page replacement matrix | 96,960,006 |
| Earlier page investigations, including failed attempts | 553,799,246 |
| Initial 200-request state/county proof | 286,961,466 |
| Merged-build 200-request state/county recheck | 286,928,249 |
| **Total recorded Neon response bytes** | **1,224,648,967** |

At the supplied $0.10 per decimal GB, the recorded responses represent about **$0.12** of reader-project overage. Queries select the required promotion keys, metadata fields and state/place records; there are no production table dumps. Existing counters measure server responses and direct Neon HTTP response bodies; diagnostic mode suppresses transfer-accounting inserts. TX-01's shared database clients are unchanged.

These totals cover captured Neon responses. Initial small proof/selection queries before capture and the internal Neon traffic of live public GETs are unmetered. Final browser response-body traffic is separately 91,261,537 bytes for live main and 95,961,775 bytes for the replacement; it includes scripts, map tiles, portraits and API responses, so it is separate from Neon transfer.

## Verification and handoff

All **144 focused tests** pass, covering ZIP projections and aliases, real browser bootstrap/worker transfer, cache clocks, office provenance and reuse, first Ask focus, transparent district tap areas and shading, instant camera visibility, representation metadata, and the deployment fill. Modified-file lint, TypeScript and both preflight checks pass. The production build passes its bundle budgets and all 15 reader-trace requirements.

After the deployment-hook URL correction, the final production rebuild (`1pzjd9j4xAzFVKm3m6xo9`) has **819/819 identical compiled application JavaScript/CSS bundle hashes** compared with the measured build. The measured browser/API code is unchanged by that server-only callback correction. Phone home/Ask and desktop officials screenshots were inspected with the real basemap and held data.

The code is prepared for READY on `stream/rs-03`. River owns combined gates and release. After pushing, this lane checks its return every 15 minutes and repairs it until the exact READY is folded.
