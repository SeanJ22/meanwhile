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

## Workspace interruption, October 24

The managed cloud workspace went offline during the full checks. Its runtime-status API later reported connected, but the shell still returned No usable execution environment; no resumed execution is claimed. The last code pushed is 3199ab08e. No READY, production correction, deployment, completed full check set, or live pass is claimed.

Before the interruption, the 174 real production board IDs were replayed on isolated reader copies, one state at a time. All 174 acquired local placements; the cohort carries 2,185 live member facts. Each affected state's unchanged next registration invocation performed no import. By state: AK 1 board / 3 members; AL 3 / 4; AR 2 / 4; CA 136 / 2,044; CO 1 / 2; DE 1 / 1; HI 1 / 5; IL 17 / 60; MI 6 / 24; OR 3 / 16; WI 3 / 22. Every other state and territory has zero boards in this specific cohort. These results precede the pending shared-schema integration and must be rerun on the final code.

The broader district replay completed 55 state/territory imports: 40,030 special districts, 39,932 locally filed, 98 still without a local place. New Jersey failed with the existing duplicate Union Township school-district identity. Inspection of the Census CSV confirmed mailing-state errors among the unresolved examples: New Model Canal Community Ditch Association and Upper Maestas Ditch were filed in AZ but Census government FIPS place them in NM; Hyder Valley was filed in CA but belongs to AZ/Maricopa; Ashland Fire Protection was filed in CA but belongs to IL/Cass; Vya Conservation was filed in CA but belongs to NV/Washoe. An additional read-only production query then confirmed all 98 state mismatches: registration's countyFips prefix maps to a different state through the held census-geoid:state aliases. The same rows' county FIPS identify the destination county without name matching. No guessed county or state was published.

Portal snapshots and HTTP source scans cover all 56 state/territory partitions locally under /tmp/rb-a4-portals and /tmp/rb-a4-portal-results. The final per-portal moves/removals report and scheduled withdrawal/reassignment path are unfinished. A failed HTTP request or a missing homepage link was not treated as proof of a mismatch. The databases were never written.

Pending local integration is in /workspace/rb-a4-combined. RB-A2 8e7da3e0e, RB-A1 2da436296 and RB-A3 7857f247a were combined there. All source blobs, trees and commits obtained through the GitHub connector were verified against GitHub's exact hashes after git transport failures. RB-A2's three focused place-map tests and RB-A3's nine focused door tests passed on that combination. The newer A1/A2 tips still need to be fetched and merged.


The 98 confirmed source-state transfers, still unapplied:

| Filed state | Source state | Districts |
| --- | --- | ---: |
| AK | AR | 1 |
| AZ | NM | 2 |
| CA | AZ | 1 |
| CA | IL | 1 |
| CA | NV | 1 |
| CO | NE | 1 |
| CO | WY | 1 |
| CT | FL | 1 |
| DC | VA | 1 |
| FL | AL | 1 |
| IA | ID | 1 |
| IA | MO | 3 |
| IA | SD | 2 |
| IA | WI | 2 |
| ID | OR | 1 |
| ID | WY | 2 |
| IL | ID | 1 |
| IL | IN | 1 |
| IL | WI | 3 |
| IN | IL | 1 |
| IN | KS | 1 |
| IN | OH | 1 |
| KS | NE | 1 |
| LA | MS | 1 |
| MA | CT | 1 |
| MA | RI | 1 |
| ME | MA | 1 |
| MI | OH | 1 |
| MN | SD | 2 |
| MN | WI | 12 |
| MO | KS | 1 |
| MT | ND | 1 |
| MT | TN | 1 |
| ND | SD | 2 |
| NE | KS | 5 |
| NE | SD | 1 |
| NM | CO | 1 |
| NM | NE | 1 |
| NV | CA | 1 |
| NY | CT | 1 |
| NY | MA | 1 |
| NY | TX | 1 |
| OH | KY | 1 |
| OK | KS | 1 |
| OR | CA | 1 |
| OR | WA | 1 |
| SC | ME | 1 |
| SD | ND | 2 |
| SD | WY | 2 |
| TN | KY | 1 |
| TX | AL | 1 |
| TX | AR | 5 |
| TX | NM | 2 |
| TX | OR | 1 |
| WA | CA | 1 |
| WA | ID | 4 |
| WA | NM | 1 |
| WI | MT | 1 |
| WV | OH | 2 |
| WY | ID | 3 |

The repair must update existing entities' state/parent and place links by their exact census-pid6 identity, preserving IDs and moving their boards with them. The wrong mailing state's next registration import must not overwrite the correction. RB-A2's newer geographicSpecialDistricts reader already streams fips_state/fips_county; reuse its exact source mapping and the known government ID when connecting the door.

The next implementation steps are concrete:

- RB-A4: finish replacing the draft two-column/null-year association writer with RB-A1's (entity_id, place_id, boundary_year) key and year 0 for unknown vintage. The local draft removes its duplicate boundary_year migration and uses the shared shape. Resolve the remaining unknown-year duplicate on pre-existing meeting links, then rerun the regression.
- RB-A4: finish the central lib/core/door.ts integration so accepted facts file every served place before the existing rebuild queue is populated. The local draft adds DoorInput.places and removes the old ancestor-only filing implementation.
- RB-A4: use the Census government's fips_state/fips_county, preserving held IDs, to finish the district corrections. The mailing state's registration reload must not move them back.
- RB-A4: rerun every required check, the production-data replays, the next scheduled-run proof and the Chrome acceptance checks. The full suite was interrupted; no final suite result was collected. The build failed fetching Google Fonts through the cloud proxy. The pinned test Chrome downloaded and assert:browser subsequently passed, but that is not a live reader check.
- RB-A4: wait for River's actual integration record and ancestry for both RB-A2/RB-A3, merge that River commit, rerun every check, and push READY only when the requested results are true. River has not recorded either dependency or an RB-A4 live pass as of the interruption.

The last workspace files and temporary results may become reachable if the managed environment returns. This checkpoint preserves the findings without treating the unpushed integration draft as delivered code.

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

