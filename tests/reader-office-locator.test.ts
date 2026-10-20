import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeLocator } from "../lib/map/office-locator.ts";

test("office readers share in-flight and recent coordinates, expire them, and retry failed matches", async () => {
  let now = 1, calls = 0, match = true;
  const locate = createOfficeLocator((async () => { calls++; return Response.json({ match, lat: 32, lng: -110 }); }) as typeof fetch, () => now);
  const first = locate("One office");
  assert.equal(locate("One office"), first);
  assert.deepEqual(await first, { lat: 32, lng: -110 });
  assert.deepEqual(await locate("One office"), { lat: 32, lng: -110 });
  assert.equal(calls, 1);
  now += 30_000;
  match = false;
  assert.equal(await locate("One office"), null);
  match = true;
  assert.deepEqual(await locate("One office"), { lat: 32, lng: -110 });
  assert.equal(calls, 3);
});
