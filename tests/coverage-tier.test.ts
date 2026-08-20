import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative } from "../scripts/repo-path.mjs";
import {
  COVERAGE_TIERS,
  COVERAGE_TIER_NEXT_STEP,
  COVERAGE_TIER_RANK,
  COVERAGE_TIER_READER_LABEL,
  COVERAGE_TIER_UNKNOWN,
  COVERAGE_TIER_ZIP_HEADLINE,
  depthOf,
  equalDepthGate,
  promote,
  tierExceedsEvidence,
} from "../lib/coverage/tier.ts";
import type { CoverageEvidence, CoverageTier } from "../lib/coverage/tier.ts";
import { reactions, searchLog } from "../lib/db/schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE COVERAGE TIER (RULING 6, Prompt B items 6 to 8, 2026-08-20).
 *
 * Until this session the product reported coverage against its own registry:
 * how many of the bodies we already knew about were filled in. That number
 * always looked good and meant nothing. The coverage tier replaces it with a
 * position on a ladder whose rungs are defined outside us.
 *
 * The claims worth guarding are the ones that would silently flatter us:
 *
 *   - a tier may never be RAISED by a session that did not do the work,
 *   - a tier may never be INFERRED at read time from what happens to load,
 *   - Census may never establish Tier 2 (RULING 9), and
 *   - an aggregate record may never be written without one (item 8).
 */

/* ---- 6.2: the promotion rules --------------------------------------------- */

const evidence = (over: Partial<CoverageEvidence> = {}): CoverageEvidence => ({
  universeGovernments: 10,
  territoryResolved: 10,
  bodiesEnumeratedFor: 10,
  people: 5,
  peopleAtKellyDepth: 5,
  ...over,
});

test("RULING 6: the four tiers exist in this vocabulary and no other", () => {
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

test("6.2: a tier is all-or-nothing against its own denominator", () => {
  assert.equal(promote(evidence()), "TIER_3");

  // Nine of ten territory-resolved is NOT Tier 1. The tenth is exactly the
  // government a reader might live under, and a tier that rounds up is the
  // flattering coverage claim this model exists to replace.
  assert.equal(promote(evidence({ territoryResolved: 9 })), "TIER_0");
  assert.equal(promote(evidence({ bodiesEnumeratedFor: 9 })), "TIER_1");
  assert.equal(promote(evidence({ peopleAtKellyDepth: 4 })), "TIER_2");
});

test("6.2: zero people is not 'every person is complete'", () => {
  // The vacuous truth. "Every element of the empty set has property P" is
  // formally true and would promote a zip with no officials at all to Kelly
  // depth — a false coverage claim arrived at by pure logic.
  assert.equal(
    promote(evidence({ people: 0, peopleAtKellyDepth: 0 })),
    "TIER_2",
    "a body with no recorded people has not reached Kelly depth",
  );
});

test("6.2: an empty universe is Tier 0, not an error and not Tier 3", () => {
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

/* ---- 6.5 / 6.6: a tier may never exceed its evidence ---------------------- */

test("6.5: a stamped tier above its evidence is caught; below it is fine", () => {
  const thin = evidence({ territoryResolved: 3 }); // promotes to TIER_0
  assert.equal(tierExceedsEvidence("TIER_2", thin), true);
  assert.equal(tierExceedsEvidence("TIER_1", thin), true);
  assert.equal(tierExceedsEvidence("TIER_0", thin), false);

  // Asymmetric ON PURPOSE. A stamp BELOW the evidence means work was done and
  // the stamp has not caught up, which is the safe direction; a stamp ABOVE it
  // is a false coverage claim, and that is the only thing this catches.
  assert.equal(tierExceedsEvidence("TIER_0", evidence()), false);
});

test("6.6: there is no setter — a tier can only be computed from evidence", async () => {
  const source = readFileSync(join(ROOT, "lib", "coverage", "tier.ts"), "utf8");
  assert.ok(
    !/export function setTier|export function assignTier|tier\s*=\s*input/.test(source),
    "a tier may never be raised by a session that did not do the work that raises it, " +
      "so promote() takes EVIDENCE and there is no way to hand it a tier",
  );
  const mod = (await import("../lib/coverage/tier.ts")) as Record<string, unknown>;
  const setters = Object.keys(mod).filter((k) => /^set[A-Z]/.test(k));
  assert.deepEqual(setters, [], `these look like tier setters: ${setters.join(", ")}`);
});

/* ---- RULING 9: Census can never establish Tier 2 -------------------------- */

test("RULING 9: bodies enumerated is its own count, never derived from governments", () => {
  // Ten governments, every one territory-resolved, zero bodies enumerated.
  // If a government count could stand in for a body count this would promote.
  // Tucson is ONE row in the Census file and holds a dozen governing bodies.
  assert.equal(promote(evidence({ bodiesEnumeratedFor: 0 })), "TIER_1");

  const stamper = readFileSync(join(ROOT, "scripts", "stamp-coverage-tiers.mts"), "utf8");
  assert.ok(
    stamper.includes("enumeratedGeoids"),
    "the stamper's only route to Tier 2 is the registry's actually-enumerated bodies",
  );
});

/* ---- item 7.3: the equal-depth gate is shared, not per-surface ------------ */

const candidate = (n: string, depth: number) => ({
  candidateId: n,
  hasPhoto: depth > 0,
  hasBlurb: depth > 1,
  hasContact: depth > 2,
  hasCampaignSite: depth > 3,
});

test("RULING 7: a contest renders only when every candidate is at equal depth", () => {
  const even = equalDepthGate([candidate("a", 3), candidate("b", 3)]);
  assert.equal(even.render, true);

  // The tester's finding, in her words: "Karen might be the perfect fit for
  // me, but she has no information here. So I'm only going to look at the
  // folks that do." A thin card tracks incumbency and campaign
  // professionalism, not merit.
  const uneven = equalDepthGate([candidate("incumbent", 4), candidate("karen", 0)]);
  assert.equal(uneven.render, false);
  if (!uneven.render) {
    assert.equal(uneven.shallowest, 0);
    assert.equal(uneven.deepest, 4);
    assert.ok(
      uneven.reason.length > 40,
      "a surface that hides cards says WHY rather than rendering an unexplained blank",
    );
  }
});

test("RULING 7: an empty contest renders — there is nothing to skew", () => {
  assert.deepEqual(equalDepthGate([]), { render: true, depth: 0 });
});

test("RULING 7: equal SHALLOW depth still renders — the rule is equality, not richness", () => {
  // Two candidates we know nothing about are equally served by the thin-card
  // line. The defect is asymmetry, never thinness.
  const both = equalDepthGate([candidate("a", 0), candidate("b", 0)]);
  assert.deepEqual(both, { render: true, depth: 0 });
});

test("depthOf counts the four Kelly-standard fields", () => {
  assert.equal(depthOf(candidate("x", 0)), 0);
  assert.equal(depthOf(candidate("x", 4)), 4);
});

/* ---- item 8: every aggregate record carries a tier ------------------------ */

const SOLD_STORES = [
  { name: "reactions", table: reactions },
  { name: "search_log", table: searchLog },
] as const;

test("item 8: both sold stores carry coverage_tier, NOT NULL and not defaulted", () => {
  for (const { name, table } of SOLD_STORES) {
    const col = getTableConfig(table).columns.find((c) => c.name === "coverage_tier");
    assert.ok(col, `${name} has no coverage_tier column — a buyer cannot weight its rows`);
    assert.equal(col!.notNull, true, `${name}.coverage_tier must be NOT NULL`);
    assert.equal(
      col!.hasDefault,
      false,
      `${name}.coverage_tier must have NO default — item 8.3: a write that cannot ` +
        "state a tier fails rather than silently landing as one",
    );
  }
});

/**
 * Item 8.4 — EVERY code path that writes an aggregate record.
 *
 * Four `.insert(` sites exist in this repo. Two write the SOLD stores and both
 * are updated here. The other two are not aggregate records and deliberately
 * do NOT get the column: `feedback` is a reader writing to the author and is
 * never sold, and `intake_limiter` holds expiring counters with no place, no
 * content and nothing to weight.
 */
test("item 8.4: every write path into a sold store states a tier", () => {
  const writers = [
    { file: "lib/db/reactions.ts", call: "coverageTierForOcdIds" },
    { file: "lib/db/search-log.ts", call: "coverageTierForZip" },
  ];
  for (const { file, call } of writers) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.ok(
      src.includes("coverageTier:"),
      `${file} inserts into a sold store without stating a coverage tier`,
    );
    assert.ok(src.includes(call), `${file} derives the tier server-side via ${call}`);
    assert.ok(
      !/coverageTier:\s*(row|event|input|body)\./.test(src),
      `${file} takes the tier from its CALLER — a client does not get to say how ` +
        "well researched the place it is looking at is",
    );
  }

  // The count itself, asserted so a fifth writer cannot appear unnoticed.
  const inserts: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e) && readFileSync(full, "utf8").includes(".insert("))
        inserts.push(posixRelative(ROOT, full));
    }
  };
  walk(join(ROOT, "lib"));
  walk(join(ROOT, "app"));
  assert.deepEqual(
    inserts.sort(),
    [
      "lib/db/feedback.ts",
      "lib/db/intake-limiter.ts",
      "lib/db/reactions.ts",
      "lib/db/search-log.ts",
    ],
    "the set of insert sites moved — a new one must be ruled on: is it a SOLD " +
      "aggregate record (it needs the tier) or not (say why here)",
  );
});

test("item 8: the migration backfills UNKNOWN and then removes the default", () => {
  const sql = readFileSync(
    join(ROOT, "lib", "db", "migrations", "0011_organic_cerise.sql"),
    "utf8",
  );
  for (const table of ["reactions", "search_log"]) {
    assert.ok(
      new RegExp(`ALTER TABLE "${table}" ADD COLUMN "coverage_tier" text DEFAULT 'UNKNOWN' NOT NULL`).test(sql),
      `${table}: existing rows must backfill to UNKNOWN — a bare NOT NULL ADD COLUMN ` +
        "is refused by Postgres on a non-empty table, so it would pass locally and " +
        "fail on production",
    );
    assert.ok(
      new RegExp(`ALTER TABLE "${table}" ALTER COLUMN "coverage_tier" DROP DEFAULT`).test(sql),
      `${table}: the default must be dropped, or every future caller could forget ` +
        "the column and never find out",
    );
  }
});

/* ---- RULING 6: stored and stamped, never inferred at read time ------------ */

test("RULING 6: the read side looks a stamp up and cannot compute one", () => {
  const src = readFileSync(join(ROOT, "lib", "coverage", "zip-tier.ts"), "utf8");
  assert.ok(
    !src.includes("promote("),
    "lib/coverage/zip-tier.ts must not compute a tier — a tier that recomputed " +
      "itself would drift every time a vendor had a bad afternoon, and a zip " +
      "would demote and promote without anybody deciding either",
  );
  assert.ok(
    src.includes("COVERAGE_TIER_UNKNOWN"),
    "a missing ledger resolves to UNKNOWN, never to TIER_0",
  );
});

test("RULING 6: the stamped ledger exists and its distribution sums to its denominator", () => {
  const ledger = JSON.parse(
    readFileSync(join(ROOT, "data", "derived", "zip-coverage-tiers.json"), "utf8"),
  ) as {
    stampedAt: string;
    denominator: { zips: number };
    distribution: Record<string, number>;
    zips: Record<string, { tier: CoverageTier; stampedAt: string }>;
  };

  assert.match(ledger.stampedAt, /^\d{4}-\d{2}-\d{2}$/, "stamped with a wall-clock date");
  const summed = Object.values(ledger.distribution).reduce((a, b) => a + b, 0);
  assert.equal(
    summed,
    ledger.denominator.zips,
    "STATED N EQUALS RENDERED ROWS — the tier distribution must account for every " +
      "zip in the denominator, or one of the two numbers is wrong",
  );
  assert.equal(Object.keys(ledger.zips).length, ledger.denominator.zips);
});

test("6.5: no stamped zip carries a tier its own evidence does not support", () => {
  const ledger = JSON.parse(
    readFileSync(join(ROOT, "data", "derived", "zip-coverage-tiers.json"), "utf8"),
  ) as { zips: Record<string, { tier: CoverageTier; evidence: CoverageEvidence }> };

  const overstated: string[] = [];
  for (const [zip, row] of Object.entries(ledger.zips)) {
    if (tierExceedsEvidence(row.tier, row.evidence)) overstated.push(zip);
  }
  assert.deepEqual(
    overstated.slice(0, 20),
    [],
    `${overstated.length} zips are stamped above their own evidence`,
  );
});

/* ---- the runtime ledger, and the deploy that has to carry it ------------- */

/**
 * TWO FILES, ONE TRUTH (2026-08-20).
 *
 * The audit ledger is 18 MB — every zip, its evidence, and every
 * government-to-zip edge with its own tier. The read path loads a 666 KB
 * compact copy instead, because tracing 18 MB into a serverless function to
 * answer "what tier is 85701" would pay the whole ledger's weight on every
 * cold start.
 *
 * A second copy is a second thing that can be wrong, so this asserts they
 * agree zip for zip. They are written in the same pass from the same values,
 * which is what makes the assertion cheap rather than aspirational.
 */
test("the runtime ledger agrees with the audit ledger, zip for zip", () => {
  const audit = JSON.parse(
    readFileSync(join(ROOT, "data", "derived", "zip-coverage-tiers.json"), "utf8"),
  ) as {
    stampedAt: string;
    zips: Record<
      string,
      {
        tier: CoverageTier;
        evidence: { territoryResolved: number; bodiesEnumeratedFor: number };
        unresolvedSpecialDistrictsInCounties: number;
      }
    >;
  };
  const runtime = JSON.parse(
    readFileSync(join(ROOT, "data", "derived", "zip-coverage-tiers-runtime.json"), "utf8"),
  ) as {
    stampedAt: string;
    tiers: CoverageTier[];
    zips: Record<string, [number, number, number, number]>;
  };

  assert.equal(runtime.stampedAt, audit.stampedAt, "both files carry the same stamp");
  assert.equal(
    Object.keys(runtime.zips).length,
    Object.keys(audit.zips).length,
    "STATED N EQUALS RENDERED ROWS — the two ledgers must hold the same zips",
  );

  const disagreements: string[] = [];
  for (const [zip, a] of Object.entries(audit.zips)) {
    const r = runtime.zips[zip];
    if (!r) {
      disagreements.push(`${zip}: missing from the runtime ledger`);
      continue;
    }
    if (runtime.tiers[r[0]] !== a.tier) disagreements.push(`${zip}: tier`);
    if (r[1] !== a.evidence.territoryResolved) disagreements.push(`${zip}: territoryResolved`);
    if (r[2] !== a.evidence.bodiesEnumeratedFor) disagreements.push(`${zip}: bodiesEnumeratedFor`);
    if (r[3] !== a.unresolvedSpecialDistrictsInCounties) {
      disagreements.push(`${zip}: unresolvedSpecialDistrictsInCounties`);
    }
  }
  assert.deepEqual(
    disagreements.slice(0, 10),
    [],
    `${disagreements.length} zip(s) disagree between the two ledgers — rerun ` +
      "corepack pnpm tiers:stamp, which writes both in one pass",
  );
});

/**
 * THE FAILURE THIS GUARDS IS INVISIBLE ON PRODUCTION.
 *
 * `lib/coverage/zip-tier.ts` builds its path with `process.cwd()`, which Next
 * cannot resolve statically, so without an explicit tracing include the file
 * is simply absent from the deploy. The read throws, the catch returns null,
 * and every zip renders "we have not worked this ZIP code out yet" while
 * every sold row is stamped UNKNOWN.
 *
 * That is worse than a crash: the surface's own honest gap wording is exactly
 * what a broken deploy produces, so nothing looks wrong. Every route that can
 * reach the ledger must name it.
 */
test("every route that reads the coverage ledger traces it into the deploy", () => {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  const RUNTIME = "zip-coverage-tiers-runtime.json";
  for (const route of [
    "/api/meetings",
    "/ballot",
    "/about-area",
    "/api/reactions",
    "/api/log",
  ]) {
    const at = config.indexOf(`"${route}"`);
    assert.ok(at > 0, `${route} is not named in outputFileTracingIncludes`);
    const block = config.slice(at, at + 600);
    assert.ok(
      block.includes(RUNTIME),
      `${route} reaches the coverage ledger but does not trace it — on production ` +
        "the read would fail silently and every zip would render as unresearched",
    );
  }

  assert.ok(
    !config.includes(`"./data/derived/zip-coverage-tiers.json"`),
    "the 18 MB AUDIT ledger must never be traced into a function bundle — only " +
      "the 666 KB runtime copy",
  );
});
