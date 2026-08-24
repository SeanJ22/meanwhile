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
  promote,
  tierExceedsEvidence,
} from "../lib/coverage/tier.ts";
import {
  encodeTierDistribution,
  decodeTierDistribution,
} from "../lib/coverage/zip-tier.ts";
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

/*
 * **RULING 26 (Prompt D item 1, 2026-08-20) — the gate that lived here is
 * GONE, and so are the tests that asserted its behaviour.**
 *
 * Collection state never governs display. There is no threshold, no
 * completeness bar and no equality condition, so there is nothing here to
 * assert about one. What replaces these is `tests/no-suppression.test.ts`,
 * which fails the build if a suppression path is reintroduced anywhere.
 */

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
      /*
       * **RULED ON, 2026-08-23 (`NH104`): `questionnaire_responses` is NOT a
       * sold aggregate record and carries no coverage tier.**
       *
       * The coverage tier exists so a BUYER of an aggregate is told how well
       * researched the place behind a row is. A questionnaire answer is not in
       * any aggregate and is not sold: it is published civic content, written
       * by a named public person about their own candidacy, for the express
       * purpose of being shown verbatim under their name (RULING 112). The
       * reader who sees it is reading the candidate, not a statistic derived
       * from readers.
       *
       * It also holds no zip. A candidacy belongs to a CONTEST, and a contest
       * spans whatever geography the office does — so there is no single place
       * whose coverage depth could honestly be stated, and inventing one to
       * satisfy a column would be a fabricated fact rather than a missing one.
       */
      "lib/db/questionnaire.ts",
      "lib/db/reactions.ts",
      "lib/db/search-log.ts",
      /*
       * **RULED ON, Prompt D item 6.2 (2026-08-20): `write_alarm` is NOT a
       * sold aggregate record and carries no coverage tier.**
       *
       * It records THAT a write to a named store failed and the database's own
       * words about why. It holds no zip, so there is no place whose coverage
       * depth could be stated; it appears in no export and no aggregate, so
       * there is no buyer to state it to; and giving it a zip in order to give
       * it a tier would put a location on the one table whose entire design is
       * that it carries nothing about who was writing.
       */
      "lib/db/write-alarm.ts",
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

/* ---- item 3: the per-government tier distribution on every sold row ------- */

/**
 * PROMPT C ITEM 3 (2026-08-20). The floor tier is the honest public headline
 * and it does not move. It is also `TIER_0` for 97.88% of zips nationally,
 * which makes it nearly useless as a FIELD: a buyer cannot tell a place with a
 * fully enumerated county and one unresolved fire district from a place where
 * nothing at all is known, and those are not the same measurement.
 *
 * So the same stamped values are carried counted as well as floored. These
 * assert the four things that make that safe rather than merely present.
 */

test("item 3.5: a sold row cannot be written without its tier distribution", () => {
  /*
   * NOT NULLABLE AND NOT DEFAULTED, on both stores. The migration adds the
   * column with a default only long enough to fill the rows that already
   * existed, then drops it — so a caller that forgets the column FAILS rather
   * than landing a plausible `UNKNOWN` nobody ever looks at again. That is the
   * same discipline `coverage_tier` got in 0011, for the same reason.
   */
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

  const sql = readFileSync(
    join(ROOT, "lib", "db", "migrations", "0012_spicy_changeling.sql"),
    "utf8",
  );
  for (const t of ["reactions", "search_log"]) {
    assert.match(
      sql,
      new RegExp(
        `ALTER TABLE "${t}" ADD COLUMN "coverage_tier_distribution" text DEFAULT 'UNKNOWN' NOT NULL`,
      ),
      `${t}: the backfill fills existing rows with UNKNOWN`,
    );
    assert.match(
      sql,
      new RegExp(
        `ALTER TABLE "${t}" ALTER COLUMN "coverage_tier_distribution" DROP DEFAULT`,
      ),
      `${t}: and then drops the default, so a future write cannot forget it`,
    );
  }
  assert.ok(
    !/DEFAULT 'T0:0/.test(sql),
    "the backfill is never four zeros — that would claim we counted this " +
      "place's governments and found none",
  );
});

test("item 3: the distribution encodes and decodes, and absence is UNKNOWN", () => {
  const d = { TIER_0: 24, TIER_1: 0, TIER_2: 3, TIER_3: 0 };
  assert.equal(encodeTierDistribution(d), "T0:24,T1:0,T2:3,T3:0");
  assert.deepEqual(decodeTierDistribution("T0:24,T1:0,T2:3,T3:0"), d);
  // Absence is a named gap, never a plausible zero.
  assert.equal(encodeTierDistribution(null), "UNKNOWN");
  assert.equal(decodeTierDistribution("UNKNOWN"), null);
  assert.equal(decodeTierDistribution("T0:1,T1:2"), null, "a partial encoding is not a value");
});

test("item 3.1: the distribution is written at write time from stamped values", () => {
  // Read from the ledger, never derived from live data — the same rule that
  // keeps the tier itself from drifting every time a vendor has a bad
  // afternoon. Both write paths call the ledger accessor, and neither counts
  // anything itself.
  for (const file of ["lib/db/reactions.ts", "lib/db/search-log.ts"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.match(
      src,
      /coverageTierDistribution: encodeTierDistribution\(/,
      `${file} stamps the distribution on the row it writes`,
    );
    assert.match(
      src,
      /tierDistributionFor(Zip|OcdIds)\(/,
      `${file} reads it from the stamped ledger`,
    );
  }
});

test("item 3.1: the stamped ledger carries a distribution for every zip", () => {
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
    // The distribution's TIER_1..TIER_3 must account for exactly the resolved
    // governments, and TIER_0 for exactly the unresolved ones. A distribution
    // that does not reconcile with the evidence beside it is not a measurement.
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

test("item 3.2: the distribution reaches no reader-facing surface", () => {
  /*
   * STORED ONLY, and this is the guard rather than the intention. The floor
   * tier is the only tier stated publicly; a per-government distribution on a
   * reader surface would be a second coverage number for the reader to
   * reconcile against the first, which is the shape that made the old
   * registry-derived coverage figure worthless.
   *
   * `app/` and `components/` are the reader's tree. `lib/db` and
   * `lib/coverage` are the write and stamp paths and are exempt by name.
   */
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        const src = readFileSync(full, "utf8");
        if (
          /coverageTierDistribution|coverage_tier_distribution|tierDistributionFor/.test(src)
        ) {
          offenders.push(posixRelative(ROOT, full));
        }
      }
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));

  assert.deepEqual(
    offenders,
    [],
    "the per-government tier distribution is a stored field. The floor tier is " +
      "the only tier a reader is told, and a second coverage number on a reader " +
      "surface is a number the reader has to reconcile against the first.",
  );
});
