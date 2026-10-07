import assert from "node:assert/strict";
import { test } from "node:test";

import { incumbentHolderFor } from "../lib/ballot/incumbent-record.ts";
import {
  installFundingFirstSeed,
  installRegistryRuntimeFirstSeeds,
} from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([
  installFundingFirstSeed(),
  installRegistryRuntimeFirstSeeds(),
]);

/**
 * The incumbent-record join: ballot key → roster official
 * through the FEC snapshot's exact-key pairing. The contract: a real
 * incumbent resolves to their roster record; everyone else — challengers,
 * unmatched filers, senate runs by incumbents whose current seat we don't
 * hold — resolves to null. No link rather than a wrong one.
 */

test("4: Booker's Senate-race key resolves to his roster record", async () => {
  const holder = await incumbentHolderFor("ballot-nj-morris:us-senate:booker");
  assert.ok(holder, "Booker is a sitting senator on his own ballot — the join must hold");
  assert.equal(holder.id, "congress:B001288");
  assert.equal(holder.officeTitle, "U.S. Senator");
});

test("4: an incumbent House rep on a House ballot resolves (Grijalva, AZ-7)", async () => {
  const holder = await incumbentHolderFor(
    "ballot-az-pima:us-house-7:grijalva-adelita",
  );
  assert.ok(holder, "Grijalva holds AZ-7 and is on its ballot");
  assert.equal(holder.id, "congress:G000606");
});

test("4: challengers get no link — never a wrong one", async () => {
  for (const key of [
    "ballot-nj-morris:us-senate:murphy",
    "ballot-az-pima:us-house-7:butierez-sr--daniel-francis",
    "ballot-nh-merrimack:us-house-2:tang-williams-lily",
  ]) {
    assert.equal(
      await incumbentHolderFor(key),
      null,
      `${key} is not an officeholder we hold — it must not link`,
    );
  }
});

test("4: a key the snapshot never heard of resolves null, not an error", async () => {
  assert.equal(await incumbentHolderFor("ballot-nowhere:us-senate:nobody"), null);
});
