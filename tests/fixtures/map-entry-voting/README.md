# VS-03 browser evidence

The map now accepts all voting pins and the returned address point, including
locations outside the reader's current state. An address answer focuses its
point; an answer with sites but no point focuses its first site. The meeting
view, state filter, ZIP, map implementation and API requests stay unchanged.
This moves §0's requirement that a reader can look at any place.

## Verification

- 44 focused tests passed, including the real MapEntry, VotingSitesPanel and
  MapLibre canvas in Chromium 1234. No browser checks were skipped.
- The regression fails on `river@f328cd2` at the first cross-state lookup.
- ESLint, TypeScript, the production build, build-output budgets and reader
  trace checks passed. River owns the combined `pnpm gates` run.
- Controlled responses exercise address points and point-free ZIP answers in
  AZ, NH and NJ, starting from Sacramento, CA. Every returned marker reaches
  the map. The test checks camera position, address-ring lifecycle, list/pin
  selection, cleared answers, the unchanged active state and no added meeting,
  state or ZIP requests. Desktop and phone wiring pass; the existing phone
  popup layout is unchanged. Screenshots here show desktop.
- Address fixtures label the source Google and ZIP fixtures label it held
  records. These are protocol fixtures, not evidence of real polling places or
  live Google access. The current `river` voting API reads published records
  and uses Census for address geocoding. The map does not inspect the provider.
- Browser tests use the existing ground-only map fallback and make no external
  basemap requests. No map provider quota was used.

## Times and screenshots

Times run from Show me until the answer and settled, visible map markers are
usable, including the existing map presentation reveal after animation. Normal
camera animation is enabled. All individual readings are under 3 seconds.
`protocol-timings.json` also contains the phone wiring readings.

| State | Controlled input | Time and screenshot |
| --- | --- | --- |
| AZ | 255 W Alameda St, Tucson, AZ 85701 | [1352 ms](protocol-az-address.png) |
| AZ | 85701 | [385 ms](protocol-az-zip.png) |
| NH | 229 Main St, Nashua, NH 03060 | [1641 ms](protocol-nh-address.png) |
| NH | 03060 | [1721 ms](protocol-nh-zip.png) |
| NJ | 1 E Main St, Rockaway, NJ 07866 | [1442 ms](protocol-nj-address.png) |
| NJ | 07866 | [463 ms](protocol-nj-zip.png) |

## Connected production responses

The six connected browser lookups used this branch's production-built map and
real responses from `https://meanwhileusa.com/api/voting-sites`. A request bridge
relayed the public API's exact response through the managed session proxy; no
fixture supplied any API facts. Other reader API reads also used production.
The frontend, styles and map worker were served by the local production build.
All six requests returned HTTP 200. The reader's original view stayed in CA.

| State | Connected input | Sites / map pins | Time and screenshot |
| --- | --- | --- | --- |
| AZ | 255 W Alameda St, Tucson, AZ 85701 | 168 / 168 | [2376 ms](connected-az-address.png) |
| AZ | 85701 | 168 / 168 | [2086 ms](connected-az-zip.png) |
| NH | 41 Green St, Concord, NH 03301 | 0 / 0, coverage gap | [1916 ms](connected-nh-address.png) |
| NH | 03301 | 0 / 0, coverage gap | [511 ms](connected-nh-zip.png) |
| NJ | 200 South St, Morristown, NJ 07960 | 7 / 7 | [2459 ms](connected-nj-address.png) |
| NJ | 07960 | 44 / 38, six have no coordinates | [1876 ms](connected-nj-zip.png) |

The AZ and NJ pins are visible in the screenshots. Census returned real address
points in all three states, and the camera reached each returned point. ZIP
answers with coordinates focused a returned site. `connected-results.json`
records the responses, timings, marker counts and camera coordinates. The
connected checks waited for the existing map presentation reveal, not just
marker elements in the DOM.

**Populated NH pins remain unverified:** production returned a New Hampshire
jurisdiction with no sites and `outsideCoverage: true` for both NH lookups.
VS-04/the data lane owns restoring the NH records; VS-02 owns live Google
fallback. Once either supplies sites, rerun the NH connected lookups. The map's
provider-independent NH wiring passed the controlled browser check. Neither
those records nor the voting API changed in VS-03. River owns integration;
this evidence does not claim deployment of the map fix.

Reproduce the regression check from the repository root:

```sh
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/map-entry-voting-browser.test.ts
```

The test writes fresh screenshots and times under `.scratch/ci/vs03` by default.
