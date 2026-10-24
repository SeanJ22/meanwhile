# READY: RB-A4 — Boards everywhere

All **174 original board identities** have local placements on the integrated production-data copy. They now carry **2,188 live member facts**; the earlier reading held 2,185. All **27,571 original state-root special districts** are locally filed. The replay preserves all 2,366 copied live facts, including their IDs, values and source links. No production database was written.

The door files every supplied and inherited service association with its boundary year before publication, including confirmed repeat writes. A newly filed place refreshes the existing rebuild queue and reader cache even when the saved fact is unchanged; it does not count another fact. The reader returns every association and presents each board in the selected served place. A shapeless district is filed under its exact Census host county and visibly marked. Geographic county FIPS repairs the 98 mailing-state errors without changing government or board IDs. New Jersey's two Union Township school places reuse RB-A2's distinct GEOID identities.

Migration order: apply **0051_rb_a1_shared** first, then the step migrations in the journal. RB-A4 adds only `placement_basis`; it uses 0051's `integer NOT NULL DEFAULT 0` boundary year and three-column key. It does not add boundary_year again. Year zero means the source vintage is unknown.

Integrated dependencies: River f227d227cd481a9d67880abe0b15e7188d3f9737; RB-A2 63ef14f8a9dff846996daf65fdcd1be3467b2cea; RB-A3 b0ee0c60e7ce4c8fb7e8e1d7c38fa6b20aa3ad5d. The transport fallback retrieved 74 trees/blobs and nine commits through GitHub and verified every exact Git hash before merging them. Only stream/rb-a4 is published.

## Production connections

1. Reader project tiny-hill-13996172, br-delicate-lab-ax02xuo5, role readonly: the original 174-board cohort and its actual live facts were exported using SELECT. The three Oregon Metro boards were already placed in production when the fresh export ran; they retain the original 7 + 7 + 2 members. The other 171 were still stranded. The isolated copy runs the ordinary registration entity import across all 56 jurisdictions. Actual Northwest Inupiat Housing Authority and BART board IDs then flow through their held government identity, county filing and `readPlacePackage` and appear in its returned boards. See [the replay](measurements/rb-a4/replay.json).
2. Control-plane project withered-sunset-39821877, br-tiny-frog-aeufpjeq, role wtp_cp_release_readonly: an actual Oregon Metro Construction Committee door points to LA Metro's `metro.legistar.com`. Its real saved Oregon government homepage does not link that tenant. The normal government discovery function suspends that exact existing door in a local control-plane copy and invokes reader withdrawal. A replay 12 hours later keeps it suspended. The ID survives. See [the connection](measurements/rb-a4/portal-connection.json).

The scheduled-run replay also uses the existing maintenance cursor for a full 56-state cycle: every subsequent import is unchanged, every association remains, and all copied facts remain byte-for-byte equal in the compared fields. The source registration cadence is separately checked immediately before and at its next due clock. Future clocks reuse retained source bytes; these are copy replays, not future production observations.

## Portals

Names select governments to inspect. Only an observed link from that government's own website confirms a portal tenant. A portal backlink cannot establish ownership. Legistar's shared API host is matched by its actual client path. Existing census doors are included in recurring checks, ahead of the background inventory.

The fresh scan covers all 637 OPEN census portal/government pairs and 6,690 doors. It confirms 166 pairs, identifies 96 for withdrawal after a completed own-site check, and records 375 for retry because their own sites could not be read. The cloud proxy began returning 503s during the scan; a failed read is not called a wrong-owner finding. No verified move was established. The confirmed Oregon/LA Metro mismatch is withdrawn from Oregon; it is not assigned to California by name or by a portal backlink. The current California own-site portal still needs its own confirmed link and source read.

Every pair, its state, destination/action, checked source URLs and hashes is listed in [the portal report](measurements/rb-a4/portals.json). The per-state withdrawal list is [here](measurements/rb-a4/portal-mismatches.md). Retry rows are open source work, not completed corrections.

The standing writer suspends unconfirmed census doors after a completed own-site check, pulls only that tenant's non-owner facts, and files the calendar source in the existing standing blanks. The place reader withholds that source's calendar, including its archives, while retaining its immutable promotion/history, IDs and independent facts. A later government link closes the blank and resumes only an automatically suspended door. A transport failure or server error retains the last verified reader data. The real-migration database regression proves withdrawal, retry, independent contact preservation, alias resolution and restoration.

## Checks and release

Focused checks: 154 passed; the final follow-up after the last correction: 28 passed. All reader migrations, including 0051 then RB-A4, apply in the reader tests. TypeScript, focused ESLint and unused-code checks pass. Ten-state reader database coverage proves one durable multi-city board appears in both served cities, stays out of an unrelated city and survives the next write. These ten-state fixtures are not a production Chrome check.

Vail 85641's complete production query was measured read-only against its 12 actual held divisions, alternating River and this implementation. Median execution: **126.178 ms before, 112.855 ms after**. The compatibility projection supplies the future placement-basis field without changing production schema. See [the samples](measurements/rb-a4/vail.json). This is not a Chrome page timing.

READY is for River integration and release. Production corrections, Chrome checks on meanwhileusa.com, the ten real multi-city boards, complete live reader preservation and production scheduled-run observation remain River's live check. The final full gate/build run is not claimed here. The prior workspace build could not fetch Google Fonts through the proxy. RB-A1/RB-A2's recorded production event-copy proofs retain all 36 participation target IDs; this lane deletes no entity or event.

## State counts

District counts follow each district's original filing state, including the 98 cross-state corrections. They include the Oregon Metro district that was already corrected before this export. The fresh root-only export found 27,570; the original cohort is 27,571. Every state and held territory, including zeroes, is included.

| State | Boards placed | Current members | Districts placed | Portals confirmed | Withdraw | Retry |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AK | 1 | 3 | 18 | 1 | 0 | 6 |
| AL | 3 | 5 | 333 | 3 | 0 | 5 |
| AR | 2 | 6 | 582 | 2 | 0 | 2 |
| AS | 0 | 0 | 0 | 0 | 0 | 0 |
| AZ | 0 | 0 | 162 | 6 | 4 | 3 |
| CA | 136 | 2044 | 2384 | 33 | 24 | 78 |
| CO | 1 | 2 | 679 | 5 | 2 | 14 |
| CT | 0 | 0 | 396 | 2 | 0 | 8 |
| DC | 0 | 0 | 2 | 0 | 0 | 0 |
| DE | 1 | 1 | 253 | 1 | 0 | 0 |
| FL | 0 | 0 | 1275 | 25 | 7 | 37 |
| GA | 0 | 0 | 355 | 5 | 6 | 8 |
| GU | 0 | 0 | 0 | 0 | 0 | 0 |
| HI | 1 | 5 | 17 | 0 | 1 | 0 |
| IA | 0 | 0 | 332 | 0 | 0 | 1 |
| ID | 0 | 0 | 284 | 4 | 4 | 5 |
| IL | 17 | 60 | 2650 | 10 | 5 | 10 |
| IN | 0 | 0 | 306 | 1 | 0 | 1 |
| KS | 0 | 0 | 1332 | 2 | 0 | 0 |
| KY | 0 | 0 | 183 | 1 | 0 | 0 |
| LA | 0 | 0 | 97 | 0 | 1 | 0 |
| MA | 0 | 0 | 335 | 8 | 1 | 2 |
| MD | 0 | 0 | 154 | 2 | 0 | 2 |
| ME | 0 | 0 | 134 | 0 | 1 | 3 |
| MI | 6 | 24 | 341 | 4 | 3 | 4 |
| MN | 0 | 0 | 492 | 3 | 0 | 14 |
| MO | 0 | 0 | 1708 | 2 | 1 | 9 |
| MP | 0 | 0 | 0 | 0 | 0 | 0 |
| MS | 0 | 0 | 313 | 0 | 1 | 0 |
| MT | 0 | 0 | 440 | 0 | 0 | 0 |
| NC | 0 | 0 | 265 | 6 | 7 | 17 |
| ND | 0 | 0 | 366 | 0 | 1 | 0 |
| NE | 0 | 0 | 857 | 0 | 0 | 0 |
| NH | 0 | 0 | 110 | 2 | 0 | 1 |
| NJ | 0 | 0 | 203 | 0 | 0 | 6 |
| NM | 0 | 0 | 731 | 2 | 0 | 5 |
| NV | 0 | 0 | 108 | 2 | 0 | 2 |
| NY | 0 | 0 | 975 | 2 | 1 | 8 |
| OH | 0 | 0 | 658 | 4 | 6 | 6 |
| OK | 0 | 0 | 555 | 0 | 4 | 4 |
| OR | 3 | 16 | 810 | 1 | 2 | 1 |
| PA | 0 | 0 | 1406 | 2 | 1 | 5 |
| PR | 0 | 0 | 0 | 0 | 0 | 0 |
| RI | 0 | 0 | 55 | 0 | 0 | 2 |
| SC | 0 | 0 | 210 | 0 | 0 | 2 |
| SD | 0 | 0 | 395 | 1 | 1 | 1 |
| TN | 0 | 0 | 234 | 2 | 2 | 1 |
| TX | 0 | 0 | 1510 | 11 | 9 | 46 |
| UT | 0 | 0 | 220 | 0 | 0 | 3 |
| VA | 0 | 0 | 185 | 7 | 0 | 16 |
| VI | 0 | 0 | 0 | 0 | 0 | 0 |
| VT | 0 | 0 | 145 | 0 | 0 | 1 |
| WA | 0 | 0 | 792 | 3 | 0 | 12 |
| WI | 3 | 22 | 640 | 1 | 0 | 20 |
| WV | 0 | 0 | 228 | 0 | 1 | 1 |
| WY | 0 | 0 | 356 | 0 | 0 | 3 |
