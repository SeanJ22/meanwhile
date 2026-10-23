# SP-01: production replay, October 23

The fixed code replays 3,930 real publications and 4,166 real unchanged checks from October 22 at 08:59:14.769 UTC through October 23 at 08:59:14.769 UTC. The original code requests 8,096 purges; the fixed code requests 294, a 96.4% reduction. Every unchanged check requests zero purges.

[All hourly and state counts](counts.md), [purges per hour by tag](purges-hourly.csv), [every scope's tags](scope-tags.csv), [office counts and canonical versions](office-counts.csv), and [every office's point or missing-point reason](office-points.csv) are retained with this change.

## What the purge replay measures

These are replayed purge requests, not measurements of historical successful Netlify API calls. Each `Atomic pointer` event represents one committed publication. Each `UNCHANGED_CONFIRMATION_V1` event represents one successful unchanged check. Validation events and reader-readback events are excluded so they cannot double-count a publication. The original mapper is the implementation at `78f82a232dd1d0545a46835e7716032ff3807425`, before SP-01. Both implementations consume the same event window.

The replay calls the current invalidator with a collector instead of Netlify. It parses every actual unchanged receipt and executes the real Postgres confirmation method with a non-writing database double whose purge callback fails immediately if called. The regression suite separately covers its inserted and already-confirmed paths on October 23 and October 24.

The 24 hourly buckets start at the exact window start. A multi-tag request counts once as a request and once against each tag it names. The hourly CSV includes zeroes for both national tags and all 56 state/territory tags. The scope CSV includes all 5,203 current or observed scopes, including scopes with no event in the window. An empty `after_tags` cell means no reader-tag purge; an unchanged event never purges even when its publication scope has tags.

The event counts cover the canonical civic-data publication store. The separate native fact store does not retain append-only unchanged-check receipts, so its historical confirmations cannot be counted from this event log. Its fact, campaign-money and page-restamp confirmation paths have also been fixed to skip purges and are covered by focused tests; no historical counts are invented for them.

## Scope corrections

Unrecognized scopes no longer mean every state. `+` members are resolved separately, including state money and derived-family prefixes. Vote record classes and `legiscan-votes` / `openstates-votes` spellings have no reader tags, as do the specified feeds and other federal feeds whose routes have no shared reader cache. Operational/retired aggregate pointers have no reader tags. National executives and the national Congress directory use `reader-national-people`.

Shared publications use the geography in their actual read models, including exact source-native person jurisdictions and Census state FIPS. The store includes both the replaced and replacement model so removing a state's last record still purges that state. Unknown geography produces no blanket purge.

The only current scope whose geographic mapping names all 56 state/territory tags is `US:zcta-geography-overlaps`. An independent READ ONLY SQL traversal found all 56 distinct `scopes[].groupings[].stateFips` values in production version `cv-2a58dfdf917b660c5efb433265c9e4a3`; [the exact values and database identity are retained](nationwide-scope.json). Its nationwide mapping follows held geography. It has zero publication/unchanged events in this window. National executive/directory tags also reach every place because those people serve the whole country.

## Office counts and delivery

The audit reads one state's canonical people and Congress directory at a time, in a separate process. It uses the actual merged state-person reader, directory builders and point publisher. Offices are deduplicated by reader person identity and published address; contact-only rows use their phone/email. Repeated captures and repeated phone formatting do not create another physical office. These are held reader offices, not a claim that every office in government has been acquired.

Across all 50 states, DC and five territories, the reader holds 12,804 distinct offices. Production has 1,286 valid saved points. The read-only publication replay has 7,798: those 1,286 source points plus 6,512 saved Census points. The other 5,006 offices retain their contacts and a concrete reason:

| Reason | Offices | Meaning |
| --- | ---: | --- |
| `MAILING_ADDRESS` | 1,382 | The published address starts with a postal box; no building point is invented. |
| `NO_STREET_ADDRESS` | 9 | The contact has no published street line. |
| `NO_MATCH` | 2,881 | Census supplied no single usable address match. |
| `ZIP_MISMATCH` | 732 | Census returned another ZIP and did not establish the exact numbered street, city and state. |
| `UPSTREAM_HTTP_400` | 2 | Census rejected the submitted published address. |

Transient errors were retried during the audit; no timeout or transport-error result remains in the final count. `NOT_SAVED_IN_PRODUCTION` in the before column means no point was held; it does not claim that Census had previously failed. Production and replay counts are deliberately separate: this audit writes no production data. The source publishers save the new points and missing-point reasons when they next publish.

All known publication entry points now save points, including official state-roster publication and the held federal-directory split. Successful points retain the exact Census reply, SHA-256, retrieval time and query URL. The member-office publisher includes the Census evidence in its supported source receipt; source-isolation checks remain in force. Reader office records carry the point and source link without copying the reply bytes into those records. A different mailing ZIP is accepted only when the numbered street, city and state match exactly. The source address remains unchanged.

The CSV also reports held people without any office contact and source-read dispositions. AS, GU, MP and VI have no recorded native state-person projection in this snapshot; their available congressional offices are counted. Missing source offices and addresses remain acquisition work for OF-01/SH-01. They are not silently treated as offices with coordinates.

## Connected reader proof and next run

OF-01's people/executive publications and SH-01's directory publications feed this work. SP-01 feeds place delivery and BL-01's ballot page. [The retained reader proof](reader-replay.json) starts from real production candidate versions and saved source captures, publishes in memory, performs typed reader readback, builds each ZIP's directories and pins, and renders the actual office-card component. Chromium displayed the rendered cards after the shared caption was corrected to stop attributing congressional contacts to Open States.

| ZIP | Cards | Office rows displayed | Map point outputs |
| --- | ---: | ---: | ---: |
| 03301 | 3 | 15 | 13 |
| 07102 | 7 | 14 | 9 |

The New Jersey replay saves points for 106 distinct native office addresses, publishes the derived member-office package with its Census evidence, then confirms that package unchanged the next day. Both ZIPs' actual federal refresh tasks are not due five minutes after a success and are due under the October 24 controlled clock. Their next-day publications confirm unchanged, and typed reader values retain every saved point. Independently, every one of the 56 state/territory office replays compares the next source run against the saved result and passes exact equality; successful points cause no new lookup, while missing points remain retryable.

Both scripts require the existing production `readonly` role and force READ ONLY transactions. The default write-capable database and asset-store environment entries are removed from the replay process. Production writes and real Netlify purge calls: zero.

```sh
SP01_AUDIT_END=2026-10-23T08:59:14.769Z NODE_USE_ENV_PROXY=1 \
  node --env-file=<readonly.env> --experimental-strip-types \
  --import ./scripts/register-test-loader.mjs scripts/sp-01-audit.mts purges

# Run once per state/territory, each in its own process, then produce the reports.
NODE_USE_ENV_PROXY=1 node --env-file=<readonly.env> --experimental-strip-types \
  --import ./scripts/register-test-loader.mjs scripts/sp-01-audit.mts offices NH
node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/sp-01-audit.mts report

NODE_USE_ENV_PROXY=1 node --env-file=<readonly.env> --experimental-strip-types \
  --import ./scripts/register-test-loader.mjs scripts/sp-01-check.mts
```

The audit keeps geocoder replies in ignored local scratch files so the report can be reproduced without repeatedly looking up successful addresses. No credentials or full production snapshot are committed.

## READY checks and release handoff

The 124 focused tests pass with zero skips; the final scope/FIPS regression rerun passes all 15 cache tests. TypeScript, changed-file lint and the production build pass, including bundle/reader-trace checks. `lib/civic-data/runner.ts`, `app/ballot/page.tsx` and `docs/rulings.md` remain unchanged.

This is built and replayed, not a claim that the stream has already shipped. River still owns the post-release check: ten previously unvisited ZIPs in ten states, including 03301 and 07102, under three seconds on the first place and ballot visits and under 300 ms five minutes later. River also checks comparable-traffic reader requests/bytes in `database_transfer_daily`. The replay retains the baseline; it does not claim an unshipped change has reduced live database reads.
