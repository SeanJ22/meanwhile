/**
 * **A ZERO THAT SAYS WHICH KIND OF ZERO IT IS.** (ADM-58, the 9.7.26 feedback.)
 *
 * The owner: *"Map provider: 0 requests this billing period of 500,000 … The
 * section looks really good and I like it. I also don't think it's capturing
 * anything."*
 *
 * He was right to distrust it and wrong about the cause. The record on disk
 * says both classifiers answered HTTP 200 with zero datasets and 70-byte
 * bodies, the service token is installed, and the 500,000 allowance is
 * confirmed rather than assumed — the connection is real. What the card never
 * said is that the billing period had begun THAT DAY.
 *
 * So the fix is not a bigger number, it is a named reason. These assertions
 * pin the four kinds of nothing apart, and pin the one that used to be
 * invisible: a total assembled from a half-failed reading.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { projectPanel } from "@/lib/control-plane/maptiler/usage.ts";
import {
  MAPTILER_USAGE_FORMAT_VERSION,
  type MapTilerFetchProvenance,
  type MapTilerUsageSnapshot,
} from "@/lib/control-plane/maptiler/types.ts";

function provenance(over: Partial<MapTilerFetchProvenance> = {}): MapTilerFetchProvenance {
  return {
    endpoint: "https://api.maptiler.com/analytics",
    classifier: "api_keys",
    group: "request",
    requestedAt: "2026-09-07T19:10:55.354Z",
    status: 200,
    responseBytes: 70,
    responseSha256: "0".repeat(64),
    datasets: 0,
    points: 0,
    error: null,
    ...over,
  };
}

function snapshot(over: Partial<MapTilerUsageSnapshot> = {}): MapTilerUsageSnapshot {
  return {
    formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
    collectedAt: "2026-09-07T19:10:55.354Z",
    publisher: "pnpm maptiler:usage",
    connection: "CONNECTED",
    detail: null,
    period: "current_billing_period",
    since: "2026-09-07",
    until: "2026-10-06",
    allowance: 500_000,
    allowanceIsAssumed: false,
    days: [],
    provenance: [provenance(), provenance({ classifier: "services" })],
    actors: null,
    ...over,
  };
}

test("the 9.7.26 reading: a real connected zero on a period that began the same day", () => {
  const panel = projectPanel({ snapshot: snapshot() });
  assert.equal(panel.connection, "CONNECTED");
  assert.equal(panel.used, 0);
  assert.equal(panel.emptyReading, "PERIOD_JUST_BEGAN");
  assert.match(panel.says, /began today/i, panel.says);
  assert.match(panel.says, /the provider answered/i, panel.says);
});

test("a zero a fortnight into the period is a different fact and says so", () => {
  const panel = projectPanel({
    snapshot: snapshot({ since: "2026-08-20", collectedAt: "2026-09-07T19:10:55.354Z" }),
  });
  assert.equal(panel.emptyReading, "NO_DATASETS");
  assert.match(panel.says, /18 days old/, panel.says);
  assert.match(panel.says, /reported no usage at all/i, panel.says);
  assert.doesNotMatch(panel.says, /began today/i);
});

/**
 * The latent defect, and the reason this file exists beyond the copy fix: a
 * CONNECTED panel would render a confident zero even when half the evidence
 * behind it had failed.
 */
test("a half-failed reading is never a confident zero", () => {
  const panel = projectPanel({
    snapshot: snapshot({
      provenance: [provenance(), provenance({ classifier: "services", status: 403, error: "forbidden" })],
    }),
  });
  assert.equal(panel.emptyReading, "PARTIAL");
  assert.match(panel.says, /incomplete/i, panel.says);
  assert.match(panel.says, /higher/i, panel.says);
  assert.equal(
    panel.classifiers.filter((c) => c.error !== null || c.status < 200 || c.status >= 300).length,
    1,
    "the failing classifier must reach the panel so the face can name it",
  );
});

test("rows that came back and matched no declared key are not the same as no rows", () => {
  const panel = projectPanel({
    snapshot: snapshot({
      since: "2026-08-20",
      provenance: [provenance({ datasets: 4 }), provenance({ classifier: "services", datasets: 4 })],
    }),
  });
  assert.equal(panel.emptyReading, "ROWS_FILTERED_OUT");
  assert.match(panel.says, /none of them matched a key/i, panel.says);
});

test("a non-zero reading has nothing to explain", () => {
  const panel = projectPanel({
    snapshot: snapshot({
      since: "2026-08-20",
      days: [
        {
          date: "2026-08-21",
          classifier: "api_keys",
          itemId: "k1",
          label: "prod-browser",
          group: "request",
          count: 1200,
          estimated: false,
        },
      ],
    }),
  });
  assert.equal(panel.emptyReading, null);
  assert.doesNotMatch(panel.says, /the provider answered and reported no usage/i);
});

/**
 * NOT_CONNECTED is not a zero and must never acquire a zero's explanation —
 * `used` is null because nobody asked, and the panel already has `connection`
 * and `detail` to say so.
 */
test("NOT CONNECTED carries no empty-reading reason, because there is no reading", () => {
  const panel = projectPanel({
    snapshot: snapshot({ connection: "NOT_CONNECTED", detail: "no credential in this runtime", provenance: [] }),
  });
  assert.equal(panel.used, null);
  assert.equal(panel.emptyReading, null);
  assert.equal(panel.detail, "no credential in this runtime");
});
