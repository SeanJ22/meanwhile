import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ROLL_MAX_CATCH_UP, windowStart } from "../lib/votes/catch-up.ts";
import { AUTOMATIC_REFRESH_CONTRACT_IDS, AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { FEDERAL_DIRECTORY_STATES, federalDirectoryContractId } from "../lib/officials/federal-directory-data-plane.ts";

/** Congress refreshes itself daily, and no roll call falls in a gap between versions. */

test("DB-08: the usual window is the latest twenty; a held version that ends earlier pulls the start back to the next roll", () => {
  assert.deepEqual(windowStart({ latest: 300, previousNewest: null }), { start: 281, unreached: 0 });
  assert.deepEqual(windowStart({ latest: 300, previousNewest: 299 }), { start: 281, unreached: 0 }, "a quiet day reads only the usual window");
  assert.deepEqual(windowStart({ latest: 300, previousNewest: 300 }), { start: 281, unreached: 0 });
  assert.deepEqual(windowStart({ latest: 300, previousNewest: 250 }), { start: 251, unreached: 0 }, "a busy day or a missed run reads every roll since");
  assert.deepEqual(windowStart({ latest: 10, previousNewest: null }), { start: 1, unreached: 0 });
});

test("DB-08: a gap beyond the catch-up cap is reported, not silently shortened", () => {
  const far = windowStart({ latest: 500, previousNewest: 100 });
  assert.equal(far.start, 500 - ROLL_MAX_CATCH_UP + 1);
  assert.equal(far.unreached, far.start - 101);
  assert.ok(far.unreached > 0);
});

test("DB-08: every place's roster, the roll calls and key votes are on the daily automatic refresh, with no Send", () => {
  for (const id of [...FEDERAL_DIRECTORY_STATES.map(federalDirectoryContractId), "congress-rollcalls", "federal-key-votes"] as const) {
    assert.ok(AUTOMATIC_REFRESH_CONTRACT_IDS.includes(id), id);
    const task = AUTOMATIC_REFRESH_TASKS.find((row) => row.id === id)!;
    assert.equal(task.cadenceMs, 24 * 60 * 60_000, `${id} is daily`);
  }
});

test("DB-08: the roll-call script reads from the roll after the held version's newest", () => {
  const source = readFileSync(new URL("../scripts/fetch-votes.mts", import.meta.url), "utf8");
  assert.match(source, /windowStart\(\{ latest: latestHouse, previousNewest: newestHeld\(heldWindow\?\.houseRolls\)/);
  assert.match(source, /windowStart\(\{ latest: latestSenate, previousNewest: newestHeld\(heldWindow\?\.senateRolls\)/);
});
