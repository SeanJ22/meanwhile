# Open-data cursor delivery

The actual map component now requests opaque cursors instead of offsets. “Show more” remains available when a bounded page has no matching rows. Same-edition pages append without duplicate IDs and keep their current citation dates. A 409 accepted-publication response clears the previous rows and dates, fetches the cursorless first page and replaces the list. A place change aborts both an in-flight continuation and its fresh-page reset.

The focused real-component browser regression passed on its first run. It verifies opaque cursor characters, overlapping-page deduplication, clearing the previous edition before its delayed replacement arrives, new checked-at dates, an empty first page with a reachable continuation, and changing ZIP during a 409 reset. The source owner separately verifies that an actual newly promoted publication causes the real API to return 409.

The connected proof uses the already accepted complete national EPA publication in an isolated native local PostgreSQL database, real held artifacts through the normal Netlify SDK transport, the actual `/api/open-data` GET/reader selection and real `PlaceOpenData`/`Card` components. For California ZIP 90001, the first 50 records became usable in **1,677 ms**. Clicking “Show more” produced **100 distinct records in 2,332 ms**. The rendered IDs and order exactly match both API pages, and another continuation remains available. No source request, publication or production write occurred.

Both actual screenshots were inspected. The first page displays EPA facility names, ZIPs, compliance and inspection facts, publisher dates and source links. The second image shows appended facilities, the next “Show more” control and the shared Sources footer with 100 citations. These are unstyled actual components. System `/usr/bin/chromium` substitutes for the missing pinned build1234. Local PostgreSQL/artifact transports exclude production network latency and this is not a deployed production page.

The first connected proof used a division-only request and incorrectly expected EPA facilities. The existing EPA reader uses ZIP/radius; division-only selects Socrata datasets. A direct actual GET returned 200 with zero records, no continuation and Socrata not held in this EPA-only test store. The harness input was corrected to the existing dense ZIP 90001 case; source, reader and component code did not change to recover. `open-data-cursor-ui-first-failure.json` preserves the timeout and diagnostic.

Reproduction:

```sh
TMPDIR=/workspace/src01-scratch WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
node --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  tests/open-data-cursor-browser.test.ts

TMPDIR=/workspace/src01-scratch NODE_USE_ENV_PROXY=1 \
WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
node --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  scripts/replay-open-data-cursor-ui.mts --zip=90001
```

The second command requires the existing accepted local replay database and the retained full EPA artifact manifest. It reads the private loopback credential locator; no credential is written into its proof. `open-data-cursor-ui.json` records the source manifest hash, component/reader/API file hashes, page counts, exact ID hashes, timing and screenshot paths. Source counts, complete cursor enumeration and the three scheduled clocks remain in the source owner's national proofs.
