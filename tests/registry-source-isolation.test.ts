import assert from "node:assert/strict";
import { test } from "node:test";

import { federalDirectoryAppliesToDivision, settleRegistryAuthorityReads } from "../lib/registry/server.ts";

test("federal directory scope is exact and excludes local/state-legislative divisions", () => {
  assert.equal(federalDirectoryAppliesToDivision("ocd-division/country:us/state:az"), true);
  assert.equal(federalDirectoryAppliesToDivision("ocd-division/country:us/state:az/cd:6"), true);
  assert.equal(federalDirectoryAppliesToDivision("ocd-division/country:us/state:az/sldl:21"), false);
  assert.equal(federalDirectoryAppliesToDivision("ocd-division/country:us/state:nj/place:boonton"), false);
});

test("division and geometry authority never opens the unrelated federal roster", async () => {
  const calls: string[] = [];
  await settleRegistryAuthorityReads("REGISTRY", {
    registry: async () => { calls.push("registry"); },
    federal: async () => { throw new Error("planted federal-directory failure"); },
  });
  assert.deepEqual(calls, ["registry"]);
});

test("official lookup still fails closed when its required federal roster is unavailable", async () => {
  await assert.rejects(
    settleRegistryAuthorityReads("OFFICIALS", {
      registry: async () => undefined,
      federal: async () => { throw new Error("planted federal-directory failure"); },
    }),
    /planted federal-directory failure/,
  );
});
