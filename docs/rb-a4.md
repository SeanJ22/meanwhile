# Boards everywhere

Owner: RB-A4. Branch: stream/rb-a4, cut from origin/river 21ae9bcfb.

Status: work in progress. No READY, merge, deploy, or production data change is claimed.

Readers will see a board in every served town and ZIP while its existing IDs keep resolving. Placement writes carry all known service associations, boundary years supplied by the source, and a host-county marker when a special district has no shape. A lower place replaces the bare state link. The reader retains every served association rather than choosing a single sorted place. Portal directory names select discovery work; a saved link from the government's site establishes the tenant. Legistar API client paths distinguish tenants on its shared host.

Remaining work:

- RB-A4: connect the final door write and place-map membership contract; depends on RB-A2 and RB-A3.
- RB-A4: finish the portal rescan, confirm the correct government, and list every move or removal by state; production databases remain read-only.
- RB-A4: prove the 174-board cohort and district placements on the integrated production-data copy, including the next scheduled run.
- RB-A4: verify ten multi-city boards in ten states, reader preservation, existing participation links, and Vail 85641 speed in Chrome; browser tooling is unavailable in this session at present.
- RB-A4: after River records and contains both dependency READY commits, merge origin/river, rerun every check, push READY, and continue checking returns/rb-a4.md until River records a passed live check.

Verification completed so far:

- Ten-state database regression: the same board appears in both served cities, stays out of an unrelated city, and retains its identity and boundary year after the next write.
- An unchanged scheduled registration import retains the complete published territory set.
- Existing reader database tests: 5 passed; complete place-package tests: 15 passed.
- Existing platform crosswalk tests: 5 passed; platform enumeration tests: 6 passed; next-day scheduled platform pass tests: 4 passed.
- TypeScript passed after regenerating stale route types inherited from the checkout. Focused ESLint passed. Full checks on the final integrated commit remain open.

Production connections, October 24:

- Reader project tiny-hill-13996172, branch br-delicate-lab-ax02xuo5, current_user readonly. The query finds exactly 174 boards and 2,185 live member facts whose effective government/place parent is a bare state and which have no local entity_place link.
- Control-plane project withered-sunset-39821877, branch br-tiny-frog-aeufpjeq, current_user wtp_cp_release_readonly. Oregon Metro doors for Construction Committee, Executive Management Committee, Gateway Cities Service Council, and Planning and Programming Committee point to https://metro.legistar.com/Calendar.aspx. Reader registration separately identifies Los Angeles County Metro Transit Authority as government:US-CA:cog:142274, jurisdiction ca:special:los-angeles-county-metro-transit-authority, website http://www.metro.net/, and SOURCE_BOUNDARY association to Los Angeles County. Corrected production placement is still unverified.

The current state-root special-district count is 27,571, two above the supplied 27,569. Counts below are the read-only baseline, not completed placements. All states and held territories, including zeroes, are included.

| State | Boards without a local place | Live member facts | Special districts on state root |
| --- | ---: | ---: | ---: |
| AK | 1 | 3 | 18 |
| AL | 3 | 4 | 333 |
| AR | 2 | 4 | 582 |
| AS | 0 | 0 | 0 |
| AZ | 0 | 0 | 162 |
| CA | 136 | 2044 | 2384 |
| CO | 1 | 2 | 679 |
| CT | 0 | 0 | 396 |
| DC | 0 | 0 | 2 |
| DE | 1 | 1 | 253 |
| FL | 0 | 0 | 1275 |
| GA | 0 | 0 | 355 |
| GU | 0 | 0 | 0 |
| HI | 1 | 5 | 17 |
| IA | 0 | 0 | 332 |
| ID | 0 | 0 | 284 |
| IL | 17 | 60 | 2650 |
| IN | 0 | 0 | 306 |
| KS | 0 | 0 | 1332 |
| KY | 0 | 0 | 183 |
| LA | 0 | 0 | 97 |
| MA | 0 | 0 | 335 |
| MD | 0 | 0 | 154 |
| ME | 0 | 0 | 134 |
| MI | 6 | 24 | 341 |
| MN | 0 | 0 | 492 |
| MO | 0 | 0 | 1708 |
| MP | 0 | 0 | 0 |
| MS | 0 | 0 | 313 |
| MT | 0 | 0 | 440 |
| NC | 0 | 0 | 265 |
| ND | 0 | 0 | 366 |
| NE | 0 | 0 | 857 |
| NH | 0 | 0 | 110 |
| NJ | 0 | 0 | 203 |
| NM | 0 | 0 | 731 |
| NV | 0 | 0 | 108 |
| NY | 0 | 0 | 975 |
| OH | 0 | 0 | 658 |
| OK | 0 | 0 | 555 |
| OR | 3 | 16 | 810 |
| PA | 0 | 0 | 1406 |
| PR | 0 | 0 | 0 |
| RI | 0 | 0 | 55 |
| SC | 0 | 0 | 210 |
| SD | 0 | 0 | 395 |
| TN | 0 | 0 | 234 |
| TX | 0 | 0 | 1510 |
| UT | 0 | 0 | 220 |
| VA | 0 | 0 | 185 |
| VI | 0 | 0 | 0 |
| VT | 0 | 0 | 145 |
| WA | 0 | 0 | 792 |
| WI | 3 | 22 | 640 |
| WV | 0 | 0 | 228 |
| WY | 0 | 0 | 356 |

These counts are stored facts. They are not a Chrome live check.

