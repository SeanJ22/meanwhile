import assert from "node:assert/strict";
import { test } from "node:test";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

import { GET } from "../app/api/representation/[...division]/route.ts";
import { STATEWIDE_EXECUTIVES, statewideExecutivesFor } from "../lib/officials/statewide-executives.ts";
import { governingRosterHoldersForDivision } from "../lib/registry/body-rosters.ts";
import { BODY_ROSTERS } from "./fixtures/held-body-rosters.ts";
import { seatHoldersForDivision } from "../lib/registry/server.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

async function answer(ocdId: string): Promise<SeatHolder[]> {
  const response = await GET(new Request(`http://localhost/api/representation/${ocdId}`), { params: Promise.resolve({ division: ocdId.split("/") }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ocdId, ocdId);
  return payload.holders;
}

test("all14 held statewide executives reach the actual representation route only for their own state", async () => {
  assert.equal(STATEWIDE_EXECUTIVES.length, 14);
  for (const stateId of new Set(STATEWIDE_EXECUTIVES.map(row => row.stateOcdId))) {
    const actual = await answer(stateId);
    for (const expected of statewideExecutivesFor([stateId])) assert.deepEqual(actual.find(holder => holder.id === expected.id), expected);
    for (const other of STATEWIDE_EXECUTIVES.filter(row => row.stateOcdId !== stateId)) assert.ok(!actual.some(holder => holder.id === other.holder.id));
  }
  const district = await answer("ocd-division/country:us/state:az/cd:7");
  assert.ok(district.length > 0);
  assert.ok(district.every(holder => !STATEWIDE_EXECUTIVES.some(executive => executive.holder.id === holder.id)));
});

test("held governing-body and indexed division identities survive the representation route together", async () => {
  for (const division of new Set(BODY_ROSTERS.filter(row => /#(?:governing|board)$/.test(row.bodyId)).map(row => row.bodyId.split("#")[0]).filter(id => id.startsWith("ocd-division/")))) {
    const expected = [...await seatHoldersForDivision(division), ...governingRosterHoldersForDivision(division)];
    const actual = await answer(division);
    assert.deepEqual([...new Set(actual.map(holder => holder.id))].sort(), [...new Set(expected.map(holder => holder.id))].sort(), division);
  }
});
