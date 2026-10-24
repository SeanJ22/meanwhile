# Place map

Owner: RB-A2. Branch: stream/rb-a2, based on river 21ae9bcfb.

Remaining work (RB-A2 owns each item):

- Finish every-state production-copy reloads, counts and gains, then benchmark every ZIP with source acquisition in a separate process.
- Measure the complete standing refresh and its worker reservation, and finish checks after RB-A1 integration.
- RB-A2: merge integrated river, rerun checks and push READY only after RB-A1 is folded; remain until River's live check passes.

Production read on October 24: 104,047 place entities; Census holds cd:119 (443 districts), county:2020 (3,232), cbsa:2023 (935), sldu:2024 (1,963), sldl:2024 (4,878). ZIP source index: September 23, 33,791 ZIPs, 272,526 edges. These are baselines, not completed import counts.

The place id remains the existing entity id. Boundary year belongs to a membership and a shape, never to the entity identity. ZIPs and ZCTAs have separate tables; a postal alias does not establish a Census overlap. Missing measured shares remain null. A special district attached to its host county must retain an explicit county-attachment marker.

BL-01's reused source changes handle CURSTATE, current GRFN rows, territory legislative metadata and bounded GRF line decoding. Its reader switching and routineTaskDue changes are excluded. Existing reader explainers and people remain on their current path until RB-A10 replaces that path.

The importer and three lookup entry points are built. `placesForCode(query, "zip" | "zcta", code, selection)` selects representation or election maps; `placesAtPoint(query, [longitude, latitude], selection)` uses one GiST candidate lookup and the existing registry polygon test. Neither switches a reader. Admin's existing data screen lists mapped places, ZIPs, ZCTAs and explicit county attachments for all 56 jurisdictions.

RB-A10 connection: its actual `lib/place-map/reader.ts` at 0c9b43b643a4cc03f602f7232084851ad609ea18 ran against the Arizona PostgreSQL copy loaded from the real production inventory and source maps. `readZipPlace("85701")`, `readZipDivisions("85701")`, `readPointPlace(32.2226,-110.9747)` and `readStateZipPlaces("AZ")` succeeded. The state lookup read 572 ZIPs and the point used one query. The shared lookup accepts RB-A10's already fetched state rows as well as its ordinary database result, so its bulk lookup keeps the same plan selection. River must retain the JSON aggregate ZIP query when folding the readers; native California and Arkansas maxima were 14.73 and 8.04 ms before the final all-state benchmark.

Real production connection: the read-only inventory of Ajo-Lukeville Health Services District joins through `entity_place` to its place, the marked Pima County attachment and ZIP 85321. Read-only Census source data joins through the same imported tables to both `cd:119` representation and `cd:120` election results. Ohio ZIP 45660 returned CD 2 for representation and CDs 2 and 15 for the November election; Utah 84713 returned CD 2 and CD 3 respectively. These are production-data copy proofs, not production writes or Chrome checks.

Source lessons used by the standing importer: Census geographic FIPS establishes a district's host county even when its mailing state differs. The New Model Canal record is in New Mexico, not its Arizona mailing state. School names are not unique identities: the two Union Township districts retain the old ID plus a separate GEOID-suffixed ID, separate shapes, NCES aliases and government connections. Repeated Idaho and North Dakota boundary feature keys name district types, so they remain source provenance rather than entity aliases. GEOID and NCES aliases remain. Unassigned ZZ/ZZZ district rows establish no district. Zero land shares and unknown shares are valid. Tribal IDs without a state prefix and every legacy fringe membership remain held. Near-coincident New York polygons need a translated-coordinate retry of the same topology operation; coordinates are never rounded and failed joins are never treated as absence.

RB-A4 handoff: RB-A1 already adds `entity_place.boundary_year` and a three-column primary key. Its current branch still adds that column and uses a two-column conflict target; it must build against the integrated RB-A1 schema. The place-map importer supplies source government-to-place connections with boundary years, including explicitly marked county attachments.

Verification still open: final every-state counts and gains, full refresh memory, full gates, production Chrome reader checks, RB-A1 fold and River live check. No READY claim has been made. The connected Chrome controls are unavailable in this session; HTTP or database counts are not being reported as live page checks.
