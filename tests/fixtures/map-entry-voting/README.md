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

Times run from Show me until the answer and settled camera/markers are usable.
Normal camera animation is enabled. All individual readings are under 3 seconds.
`protocol-timings.json` also contains the phone readings.

| State | Input | Protocol pins | Connected serving store |
| --- | --- | --- | --- |
| AZ | 255 W Alameda St, Tucson, AZ 85701 | [1352 ms](protocol-az-address.png) | [1895 ms, no sites](connected-az-address.png) |
| AZ | 85701 | [385 ms](protocol-az-zip.png) | [646 ms, no sites](connected-az-zip.png) |
| NH | 229 Main St, Nashua, NH 03060 | [1641 ms](protocol-nh-address.png) | [1525 ms, no sites](connected-nh-address.png) |
| NH | 03060 | [1721 ms](protocol-nh-zip.png) | [814 ms, no sites](connected-nh-zip.png) |
| NJ | 1 E Main St, Rockaway, NJ 07866 | [1442 ms](protocol-nj-address.png) | [1478 ms, no sites](connected-nj-address.png) |
| NJ | 07866 | [463 ms](protocol-nj-zip.png) | [566 ms, no sites](connected-nj-zip.png) |

## Connected result and remaining limitation

The six connected browser lookups used the production build with the configured
serving database, without response interception. All returned HTTP 200 with
zero jurisdictions/sites and `outsideCoverage: true`. Census returned real
address points in all three states, and the camera reached each returned point.
`connected-results.json` records the responses, timings, marker counts and
camera coordinates. The configured store independently reported `NOT_RECORDED`
for `VOTING_SITE:US-AZ:voting-sites`, `VOTING_SITE:US-NH:voting-sites` and
`VOTING_SITE:US-NJ:voting-sites`. A public-site ZIP probe also returned no sites.
The initial meeting request also returned 503 in this environment; that failure
is visible in the connected screenshots and does not prevent voting lookup.

**Populated live pins are unverified.** The data lane needs to publish/restore
the state voting-site records, then rerun these connected browser lookups.
Neither those records nor the voting API were changed by VS-03. River owns
integration and the data dependency; this evidence does not claim deployment
or populated live-site success.

Reproduce the regression check from the repository root:

```sh
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/map-entry-voting-browser.test.ts
```

The test writes fresh screenshots and times under `.scratch/ci/vs03` by default.
