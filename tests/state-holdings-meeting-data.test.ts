import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_SUMMARIES, noticeSummaryFor } from "../lib/meetings/notice-summary.ts";
import { reviewedVenueEntries } from "../lib/meetings/venue-cache.ts";
import { findClient } from "../lib/sources/legistar/client-registry.ts";
import { findTenant } from "../lib/sources/legistar-insite/tenant-registry.ts";

test("meeting consumers retain notice versions and exact calendar doors", () => {
  assert.equal(NOTICE_SUMMARIES.length, 1);
  const notice = NOTICE_SUMMARIES[0];
  assert.strictEqual(noticeSummaryFor(notice.meetingId, notice.contentHash), notice);
  assert.equal(noticeSummaryFor(notice.meetingId, "changed-document-version"), null);
  const pima = findClient("pima");
  const mesa = findTenant("mesa");
  assert.ok(pima && mesa);
  assert.equal(findTenant("pima")?.bodyId, pima.bodyId);
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
