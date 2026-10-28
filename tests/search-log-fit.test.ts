import assert from "node:assert/strict";
import { test } from "node:test";
import { fittedLogBody } from "../lib/log/client.ts";
import { LOG_MAX_BODY_BYTES, LOG_MAX_OCD_IDS } from "../lib/log/limits.ts";
import { SYNTHETIC_RUN_BODY_KEY } from "../lib/db/run-marker.ts";

const id = (n: number) => `ocd-division/country:us/state:ca/county:contra_costa/place:example_place_number_${n}`;

test("a search touching more divisions than one event carries is logged with the leading ones and its full count", () => {
  const ids = Array.from({ length: 120 }, (_, n) => id(n));
  const body = fittedLogBody("SEARCH", ids, { tier: "local", radiusKm: 8, meetingCount: 3 }, "94565", undefined);
  const event = JSON.parse(body);
  assert.ok(new TextEncoder().encode(body).length <= LOG_MAX_BODY_BYTES);
  assert.ok(event.ocdIds.length > 0 && event.ocdIds.length <= LOG_MAX_OCD_IDS);
  assert.deepEqual(event.ocdIds, ids.slice(0, event.ocdIds.length), "the leading divisions, in order");
  assert.deepEqual(event.detail, { tier: "local", radiusKm: 8, meetingCount: 3, ocdIdCount: 120 });
  assert.equal(event.approximateLocation, "94565");
});

test("an event that already fits is sent exactly as before", () => {
  const ids = [id(1), id(2), id(1)];
  const event = JSON.parse(fittedLogBody("SEARCH", ids, { tier: "local" }, null, "run-1"));
  assert.deepEqual(event.ocdIds, [id(1), id(2)]);
  assert.deepEqual(event.detail, { tier: "local" });
  assert.equal(event.approximateLocation, null);
  assert.equal(event[SYNTHETIC_RUN_BODY_KEY], "run-1", "a declared run still rides in the body");
});
