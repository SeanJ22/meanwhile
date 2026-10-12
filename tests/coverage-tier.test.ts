import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import {
  COVERAGE_TIERS,
  COVERAGE_TIER_NEXT_STEP,
  COVERAGE_TIER_RANK,
  COVERAGE_TIER_READER_LABEL,
  COVERAGE_TIER_UNKNOWN,
  COVERAGE_TIER_ZIP_HEADLINE,
  promote,
  tierExceedsEvidence,
} from "../lib/coverage/tier.ts";
import {
  encodeTierDistribution,
  decodeTierDistribution,
} from "../lib/coverage/zip-tier.ts";
import type { CoverageEvidence } from "../lib/coverage/tier.ts";
import { reactions, searchLog } from "../lib/db/schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const evidence = (over: Partial<CoverageEvidence> = {}): CoverageEvidence => ({
  universeGovernments: 10,
  territoryResolved: 10,
  bodiesEnumeratedFor: 10,
  people: 5,
  peopleAtKellyDepth: 5,
  ...over,
});

test("the four tiers exist in this vocabulary and no other", () => {
  assert.deepEqual([...COVERAGE_TIERS], ["TIER_0", "TIER_1", "TIER_2", "TIER_3"]);
  for (const t of COVERAGE_TIERS) {
    assert.ok(COVERAGE_TIER_READER_LABEL[t], `${t} has reader wording`);
    assert.ok(COVERAGE_TIER_ZIP_HEADLINE[t], `${t} has a zip headline`);
    assert.ok(COVERAGE_TIER_NEXT_STEP[t], `${t} states what stands between it and the next`);
  }
  assert.notEqual(
    COVERAGE_TIER_UNKNOWN,
    "TIER_0",
    "UNKNOWN is the ABSENCE of a tier, not the bottom of the ladder — a row we " +
      "cannot place must never read as a place we looked at and found nothing in",
  );
  assert.ok(
    !(COVERAGE_TIER_UNKNOWN in COVERAGE_TIER_RANK),
    "UNKNOWN is never ordered against the four tiers",
  );
});

test("a tier is all-or-nothing against its own denominator", () => {
  assert.equal(promote(evidence()), "TIER_3");

  // Nine of ten territory-resolved is not Tier 1: the tenth may be the government a reader lives under.
  assert.equal(promote(evidence({ territoryResolved: 9 })), "TIER_0");
  assert.equal(promote(evidence({ bodiesEnumeratedFor: 9 })), "TIER_1");
  assert.equal(promote(evidence({ peopleAtKellyDepth: 4 })), "TIER_2");
});

test("zero people is not 'every person is complete'", () => {
  assert.equal(
    promote(evidence({ people: 0, peopleAtKellyDepth: 0 })),
    "TIER_2",
    "a body with no recorded people has not reached Kelly depth",
  );
});

test("an empty universe is Tier 0, not an error and not Tier 3", () => {
  assert.equal(
    promote(evidence({
      universeGovernments: 0,
      territoryResolved: 0,
      bodiesEnumeratedFor: 0,
      people: 0,
      peopleAtKellyDepth: 0,
    })),
    "TIER_0",
  );
});

test("a stamped tier above its evidence is caught; below it is fine", () => {
  const thin = evidence({ territoryResolved: 3 }); // promotes to TIER_0
  assert.equal(tierExceedsEvidence("TIER_2", thin), true);
  assert.equal(tierExceedsEvidence("TIER_1", thin), true);
  assert.equal(tierExceedsEvidence("TIER_0", thin), false);

  // Asymmetric on purpose: a stamp below the evidence is the safe direction; only a stamp above it is a false claim.
  assert.equal(tierExceedsEvidence("TIER_0", evidence()), false);
});

test("there is no setter — a tier can only be computed from evidence", async () => {
  const mod = (await import("../lib/coverage/tier.ts")) as Record<string, unknown>;
  const setters = Object.keys(mod).filter((k) => /^set[A-Z]/.test(k));
  assert.deepEqual(setters, [], `these look like tier setters: ${setters.join(", ")}`);
});

test("bodies enumerated is its own count, never derived from governments", () => {
  assert.equal(promote(evidence({ bodiesEnumeratedFor: 0 })), "TIER_1");
});

const SOLD_STORES = [
  { name: "reactions", table: reactions },
  { name: "search_log", table: searchLog },
] as const;

test("both sold stores carry coverage_tier, NOT NULL and not defaulted", () => {
  for (const { name, table } of SOLD_STORES) {
    const col = getTableConfig(table).columns.find((c) => c.name === "coverage_tier");
    assert.ok(col, `${name} has no coverage_tier column — a buyer cannot weight its rows`);
    assert.equal(col!.notNull, true, `${name}.coverage_tier must be NOT NULL`);
    assert.equal(
      col!.hasDefault,
      false,
      `${name}.coverage_tier must have NO default — a write that cannot ` +
        "state a tier fails rather than silently landing as one",
    );
  }
});

test("a sold row cannot be written without its tier distribution", () => {
  for (const { name, table } of SOLD_STORES) {
    const col = getTableConfig(table).columns.find(
      (c) => c.name === "coverage_tier_distribution",
    );
    assert.ok(col, `${name} carries coverage_tier_distribution`);
    assert.equal(col!.notNull, true, `${name}: the column is NOT NULL`);
    assert.equal(
      col!.hasDefault,
      false,
      `${name}: no default — a write that cannot state the distribution must ` +
        "fail, not land as UNKNOWN and be weighted by a buyer as a measurement",
    );
  }
});

test("the distribution encodes and decodes, and absence is UNKNOWN", () => {
  const d = { TIER_0: 24, TIER_1: 0, TIER_2: 3, TIER_3: 0 };
  assert.equal(encodeTierDistribution(d), "T0:24,T1:0,T2:3,T3:0");
  assert.deepEqual(decodeTierDistribution("T0:24,T1:0,T2:3,T3:0"), d);
  assert.equal(encodeTierDistribution(null), "UNKNOWN");
  assert.equal(decodeTierDistribution("UNKNOWN"), null);
  assert.equal(decodeTierDistribution("T0:1,T1:2"), null, "a partial encoding is not a value");
});

test("the stamped ledger carries a distribution for every zip", () => {
  const runtime = JSON.parse(
    readFileSync(join(ROOT, "data", "derived", "zip-coverage-tiers-runtime.json"), "utf8"),
  ) as {
    shape: string[];
    zips: Record<string, number[]>;
    ocdDistributions: Record<string, number[]>;
  };

  assert.deepEqual(
    runtime.shape.slice(4),
    ["governmentsAtTier0", "governmentsAtTier1", "governmentsAtTier2", "governmentsAtTier3"],
    "the runtime tuple names its four new numbers",
  );

  const zips = Object.entries(runtime.zips);
  assert.ok(zips.length > 30000, `expected the national ledger, found ${zips.length} zips`);

  let short = 0;
  let inconsistent = 0;
  for (const [zip, t] of zips) {
    if (t.length !== 8) {
      short += 1;
      continue;
    }
    // TIER_1..TIER_3 account for exactly the resolved governments, and TIER_0 for exactly the unresolved ones.
    const resolved = t[1]!;
    const unresolved = t[3]!;
    if (t[5]! + t[6]! + t[7]! !== resolved || t[4]! !== unresolved) {
      inconsistent += 1;
      if (inconsistent === 1) {
        console.error(`first inconsistent zip: ${zip} ${JSON.stringify(t)}`);
      }
    }
  }
  assert.equal(short, 0, "every zip carries all eight numbers");
  assert.equal(
    inconsistent,
    0,
    "the distribution must reconcile against the evidence stamped beside it",
  );

  assert.ok(
    Object.keys(runtime.ocdDistributions).length > 0,
    "the reaction write path holds divisions, so the ledger publishes the " +
      "distribution keyed that way too",
  );
});
