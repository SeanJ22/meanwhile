# RB-A4 returned (River, 1:50 AM EDT Oct 25, Sean's order of 1:20 AM)

READY 0bdb1353d does not fold. lib/facts/portal-publication.ts `withdrawPlatformPublication` pulls live facts with its own
`UPDATE fact SET status='pulled', held_reason='PORTAL_AUTHORITY_UNCONFIRMED'`, outside the front door (lib/core/door.ts).

What readers would lose (production, read-only counts, 1:45 AM EDT):
- The census calls it for every door with config.crosswalkRowId and a platform-hosted portal whose government's own site does
  not link that portal (lib/control-plane/discovery/platform-government.ts:210). 6,781 such doors (6,775 OPEN, 3 SHUT,
  3 SUSPENDED); none is flagged "not confirmed" yet, so nothing is pulled today.
- Live, non-owner facts on those doors' bodies and their meetings whose source copy is on the door's portal tenant (host,
  or Legistar client; an upper bound for BoardDocs/Granicus/Municode/BoardBook tenants): 99,690 in 43 states.
  CA 11,216, TX 9,614, WI 8,963, FL 8,103, CO 6,722, MN 5,636, MO 5,454, CT 5,040, VA 4,588, OH 4,499, IL 3,504,
  WA 3,454, NC 3,384, AZ 2,848, NJ 2,747, MA 1,892, OK 1,683, NY 1,674, MI 1,253, AK 1,048, NV 791, PA 657, NM 633,
  OR 570, ME 538, ID 477, GA 465, WY 421, AL 421, UT 308, HI 258, IA 153, RI 126, WV 121, SD 84, MD 77, AR 66, MS 66,
  NH 48, DE 25, KY 24, SC 9, TN 8, no state 22.
- Every government whose site does not link its portal loses those facts on its next census check.

What to change: a fact leaves readers only through lib/core/door.ts. Either give the door the withdrawal decision (so its
provenance and owner rules apply, and it purges the reader cache as it does for every other change), or do not pull: keep the
open CHECK blank and the suspended door, and let the next read through the door replace or confirm the facts. Then repost
READY with a test that a census withdrawal leaves no live fact changed outside door.ts, and the same production count.

Standing order: River owns this lane (its workspace died); River finishes it if no new READY lands by 2:50 AM EDT.
RB-A7 folds after RB-A4 (both change lib/reader/place.ts and lib/core/door.ts).

## River finished it, 2:54 AM EDT (standing order: no new READY by 2:50 AM EDT)
- READY on stream/rb-a4 (after 0bdb1353d). lib/facts/portal-publication.ts `withdrawPlatformPublication` no longer touches facts:
  the raw `UPDATE fact SET status='pulled'` and the query that fed it are deleted.
- It still opens the CHECK blank (PORTAL_AUTHORITY_UNCONFIRMED), which keeps that portal's calendar off reader pages
  (lib/reader/place.ts), removes the portal host from entity_host, and the census still suspends the door. The calendar comes
  back when the government's own site links the portal.
- Readers lose 0 facts to a withdrawal (was up to 99,690 in 43 states). tests/rb-a4-portals.test.ts now checks that agenda_url
  and office_phone stay live through two withdrawals and a confirmation.
- Checks: rb-a4-portals 2/2; eslint, tsc and knip clean. Folds in its queue place (after RB-A6, CL-01, MD-01), then RB-A7.
- For Sean: hiding an unconfirmed portal's calendar while keeping its facts is RB-A4's own design. Whether calendars should hide
  at all is his call.
