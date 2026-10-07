import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_SUMMARIES, noticeSummaryFor } from "../lib/meetings/notice-summary.ts";
import { reviewedVenueEntries } from "../lib/meetings/venue-cache.ts";
import { findClient, findVenue } from "../lib/sources/legistar/client-registry.ts";
import { findTenant, findTenantVenue } from "../lib/sources/legistar-insite/tenant-registry.ts";

test("meeting consumers use the canonical venue test seam and retain version and venue matching", () => {
  assert.equal(NOTICE_SUMMARIES.length, 1);
  const notice = NOTICE_SUMMARIES[0];
  assert.strictEqual(noticeSummaryFor(notice.meetingId, notice.contentHash), notice);
  assert.equal(noticeSummaryFor(notice.meetingId, "changed-document-version"), null);
  const pima = findClient("pima");
  const mesa = findTenant("mesa");
  assert.ok(pima && mesa);
  assert.equal(pima.venues.length, 2);
  assert.equal(mesa.venues.length, 1);
  assert.deepEqual(findTenant("pima")?.venues, pima.venues, "Pima InSite must derive the canonical Legistar venue projection");
  for (const venue of pima.venues) assert.deepEqual(findVenue(pima, venue.match.toUpperCase()), venue);
  assert.deepEqual(findTenantVenue(mesa, "COUNCIL CHAMBERS"), mesa.venues[0]);
  assert.equal(findTenantVenue(mesa, "unrecorded room"), undefined);
});

test("an empty canonical Legistar venue scope is an empty list, never a failure", () => {
  const scope = (): unknown[] => reviewedVenueEntries(
    "legistar",
    "ocd-division/country:us/state:az/county:pima",
    null,
    [],
  );
  assert.doesNotThrow(scope);
  assert.deepEqual(scope(), []);
});
