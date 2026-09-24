import assert from "node:assert/strict";
import test from "node:test";
import { fetchFailureKind, jobFailureDetail } from "../lib/sources/composite/failure-kind.ts";
import { SourceHttpError } from "../lib/sources/http.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { parseMeetingPartitionRunnerReceipts } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

/**
 * WALL versus JOB is decided from the thrown value (RULING 250: check whose
 * stopwatch ran out before naming a wall; RULING 283: an unclassified failure
 * escalates). 2026-09-24: our own VENUE_RESOLUTIONS_MISSING was filed as a
 * publisher wall on three Legistar partitions for ten days.
 */

test("publisher-side failures are walls", () => {
  assert.equal(fetchFailureKind(new SourceHttpError("HTTP 403 for https://pima.legistar.com/Calendar.aspx", 403, "https://pima.legistar.com/Calendar.aspx", 3)), "WALL");
  assert.equal(fetchFailureKind(sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "pima: the publisher request did not complete (TypeError).")), "WALL");
  assert.equal(fetchFailureKind(new TypeError("fetch failed")), "WALL");
  assert.equal(fetchFailureKind(new Error("HTTP 503 for https://example.gov/")), "WALL");
  assert.equal(fetchFailureKind(Object.assign(new Error("aborted"), { name: "AbortError" })), "WALL");
  assert.equal(fetchFailureKind(new Error("connect ECONNREFUSED 10.0.0.1:443")), "WALL");
  assert.equal(fetchFailureKind(new SyntaxError("Unexpected token < in JSON at position 0")), "WALL", "HTML where JSON was promised is the publisher's response");
});

test("our own code and configuration failures are jobs, and so is an unknown", () => {
  assert.equal(fetchFailureKind(new Error("VENUE_RESOLUTIONS_MISSING:legistar:ocd-division/country:us/state:az/county:pima")), "JOB");
  assert.equal(fetchFailureKind(new Error("LEGISTAR_INSITE_SOURCE_WIRING_INVALID:pima-bos")), "JOB");
  assert.equal(fetchFailureKind(new Error("PIMA_OUTCOME_STORE_UNREACHABLE: HTTP 500 from the store")), "JOB", "a coded failure of ours is decided before an inner transport word");
  assert.equal(fetchFailureKind(new TypeError("Cannot read properties of undefined (reading 'venues')")), "JOB");
  assert.equal(fetchFailureKind(new RangeError("Invalid time value")), "JOB");
  assert.equal(fetchFailureKind("something odd happened"), "JOB", "unknown escalates");
});

test("a JOB failure detail says whose failure it is, once", () => {
  const detail = jobFailureDetail("VENUE_RESOLUTIONS_MISSING:legistar:x");
  assert.match(detail, /^JOB_FAILURE: our own code or configuration failed .* not a publisher wall\. VENUE_RESOLUTIONS_MISSING/);
  assert.equal(jobFailureDetail(detail), detail);
});

test("meeting partition receipts parse with and without the additive failureKind", () => {
  const base = {
    source: "meetings:legistar:x", partitionId: "meetings:legistar:x", meetingSource: "legistar", bodyId: "b", scope: "s",
    candidateId: "c-1", acquisitionSucceeded: false, state: "SOURCE_BLOCKED", decision: "FAIL",
    promotedVersion: null, lastKnownGoodVersion: "v-lkg", failureDetail: "HTTP 503", structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const old = parseMeetingPartitionRunnerReceipts(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify(base)}`);
  assert.equal(old.ok, true, "an old-shape receipt still parses");
  const tagged = parseMeetingPartitionRunnerReceipts(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ ...base, failureKind: "JOB", failureDetail: jobFailureDetail("VENUE_RESOLUTIONS_MISSING:x") })}`);
  assert.equal(tagged.ok, true, "the additive field is accepted by the durable receipt contract");
  if (tagged.ok) assert.equal(tagged.receipts[0]?.lastKnownGoodVersion, "v-lkg", "the partition keeps its last-known-good");
});
