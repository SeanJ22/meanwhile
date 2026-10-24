# Place map

Owner: RB-A2. Branch: stream/rb-a2, based on river 21ae9bcfb.

Remaining work:

- RB-A2: import existing places, ZIP memberships and source shapes without changing ids; depends on RB-A1's year-aware tables.
- RB-A2: add every held Census plan and acquire the 2026 district plans; reuse BL-01's GRF parser, with no reader or routine scheduler changes.
- RB-A2: provide ZIP, ZCTA and point lookups for RB-A10, and place counts in Admin.
- RB-A2: verify state-line points, preservation, speed, production connections and the next scheduled run; depends on the import and RB-A1 integration.
- RB-A2: merge integrated river, rerun checks and push READY only after RB-A1 is folded; remain until River's live check passes.

Production read on October 24: 104,047 place entities; Census holds cd:119 (443 districts), county:2020 (3,232), cbsa:2023 (935), sldu:2024 (1,963), sldl:2024 (4,878). ZIP source index: September 23, 33,791 ZIPs, 272,526 edges. These are baselines, not completed import counts.

The place id remains the existing entity id. Boundary year belongs to a membership and a shape, never to the entity identity. ZIPs and ZCTAs have separate tables; a postal alias does not establish a Census overlap. Missing measured shares remain null. A special district attached to its host county must retain an explicit county-attachment marker.

BL-01's reused source changes handle CURSTATE, current GRFN rows, territory legislative metadata and bounded GRF line decoding. Its reader switching and routineTaskDue changes are excluded. Existing reader explainers and people remain on their current path until RB-A10 replaces that path.

Verification still open: loading, every-state counts and gains, production-copy connections, schedule, Chrome reader checks, RB-A1 fold and River live check. No READY claim has been made.
