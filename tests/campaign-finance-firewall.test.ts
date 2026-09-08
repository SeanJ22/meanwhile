import { isRenderable } from "../lib/funding/state-money-reader.ts";
/**
 * **RULING 126 — campaign-finance data renders for readers and never enters
 * anything sold.** (Adopted 2026-08-24, Sean's ruling.)
 *
 * This is the assertion the ruling names. It is deliberately ARCHITECTURAL
 * rather than behavioural: a test that checked one export function's output
 * would pass forever while a second export path was added beside it. What is
 * asserted instead is that **there is no route** — no table, no import, no
 * shared column — by which a campaign-finance row could reach a sold store.
 *
 * The three walls, in the order they would fail:
 *
 * 1. **Campaign-finance data may exist only in the isolated operational civic
 *    data plane.** The V2 routine-promotion contract supersedes the old
 *    committed-JSON transport, while preserving the important boundary: no
 *    reader collection/sold store can receive or join that public-source data.
 * 2. **The aggregation and export layer never imports the money.** Already true
 *    of the FEC corpus and asserted in `tests/funding.test.ts`; extended here to
 *    every campaign-finance module, present and future, by scanning the
 *    directory rather than a named list.
 * 3. **The operational civic projection** shares no joinable identity domain
 *    with any collection store — the same predicate the n-stores rule already
 *    applies to the search log, the reactions store and the intake limiter.
 *
 * Wall 3 is guarding a table that does not exist yet, and that is the point. A
 * firewall written down in a document is one the next migration breaks by
 * accident; this one goes red in the commit that would have broken it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";
import { tablesInClass } from "../lib/db/identity-domains.ts";
import {
  computeSplit,
  judgeMatch,
  namesAgree,
  officeClassOf,
  officesAgree,
  type StateMoneyRecord,
} from "../lib/funding/state-money.ts";

const ROOT = resolve(import.meta.dirname, "..");

/* ── WALL 1: money is confined to the operational civic data plane ───────── */

/**
 * Every pgTable in the schema, enumerated through Drizzle's own
 * `getTableConfig` — the SAME mechanism `tests/db-schema.test.ts` uses. A
 * second way of reading the schema would be the duplicated implementation
 * RULING 103 forbids, and would be free to disagree with the first.
 */
function allTables(): { name: string; export: string; columns: string[] }[] {
  const out: { name: string; export: string; columns: string[] }[] = [];
  for (const [exportName, value] of Object.entries(schema)) {
    let config;
    try {
      config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue; // not a table
    }
    out.push({ name: config.name, export: exportName, columns: config.columns.map((c) => c.name) });
  }
  return out;
}

test("RULING 126 + RCD-4 wall 1: campaign finance is confined to isolated operational civic tables", () => {
  const MONEY_WORDS =
    /(contribution|contributor|campaign_finance|campaignfinance|receipt|disbursement|committee|donor|fundrais|cash_on_hand)/i;

  const tables = allTables();
  // Not vacuous: the schema really was read, and the real tables really are here.
  assert.ok(tables.length >= 8, `only ${tables.length} tables enumerated — the sweep would report clean without having looked`);
  for (const expected of ["search_log", "reactions", "feedback", "intake_limiter"]) {
    assert.ok(
      tables.some((t) => t.name === expected),
      `${expected} was not enumerated — this guard is reading the schema wrong`,
    );
  }

  const civicTables = ["civic_data_candidate_events", "civic_data_candidates", "civic_data_promotions"];
  assert.deepEqual(
    tablesInClass("OPERATIONAL").filter((name) => name.startsWith("civic_data_")),
    civicTables,
    "the routine data plane must remain explicitly classified as operational, never as a reader collection or sold store",
  );
  for (const name of civicTables) assert.ok(tables.some((table) => table.name === name), `${name} is not in the schema`);

  const offenders: string[] = [];
  for (const t of tables.filter((table) => !civicTables.includes(table.name))) {
    if (MONEY_WORDS.test(t.name) || MONEY_WORDS.test(t.export)) offenders.push(`table ${t.name}`);
    for (const col of t.columns) if (MONEY_WORDS.test(col)) offenders.push(`${t.name}.${col}`);
  }

  assert.deepEqual(
    offenders,
    [],
    "campaign-finance vocabulary entered a table outside the isolated operational civic data plane. " +
      "RULING 126 still forbids that data from reader collection and sold stores: " +
      offenders.join(", "),
  );
});

/* ── WALL 2: aggregation and export cannot even see it ────────────────────── */

test("RULING 126 wall 2: the aggregation layer imports no campaign-finance module", () => {
  const signalDir = join(ROOT, "lib", "signal");
  const signalFiles = readdirSync(signalDir).filter((f) => f.endsWith(".ts"));
  assert.ok(signalFiles.length > 0, "no aggregation modules found — this test would pass vacuously");

  const violations: string[] = [];
  for (const file of signalFiles) {
    const text = readFileSync(join(signalDir, file), "utf8");
    // Match the IMPORT, not a mention: the reasoning comments in this repo name
    // these paths on purpose and must not trip the sweep (RULING 110 — search
    // by shape, and prove the shape does not catch the honest lines).
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      if (/\bfunding\b/.test(m[1])) violations.push(`lib/signal/${file} imports ${m[1]}`);
    }
    for (const m of text.matchAll(/\bawait\s+import\(\s*["']([^"']+)["']/g)) {
      if (/\bfunding\b/.test(m[1])) violations.push(`lib/signal/${file} dynamically imports ${m[1]}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    "the aggregation/export layer can reach campaign-finance data — it must be structurally unreachable from anything sold",
  );
});

test("RULING 126 wall 2: the sweep would catch a real import rather than reporting green about nothing", () => {
  // The instrument shown catching the instance (RULING 110). A planted line in
  // the same shape the sweep looks for must be found.
  const planted = [
    'import { getFundingSnapshot } from "../funding/snapshot.ts";',
    'const x = await import("../funding/state-money.ts");',
    'export { thing } from "../funding/types.ts";',
  ];
  for (const line of planted) {
    const staticHit = [...line.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].some(
      (m) => /\bfunding\b/.test(m[1]),
    );
    const dynamicHit = [...line.matchAll(/\bawait\s+import\(\s*["']([^"']+)["']/g)].some((m) =>
      /\bfunding\b/.test(m[1]),
    );
    assert.ok(staticHit || dynamicHit, `the sweep would MISS this real violation: ${line}`);
  }

  // And it must NOT flag prose that merely names the path — otherwise the guard
  // becomes pressure to delete the reasoning comments.
  const honest = " * lib/funding/state-money.ts is deliberately unreachable from here.";
  const falsePositive =
    [...honest.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].length > 0;
  assert.equal(falsePositive, false, "the sweep flags a comment that only names the path");
});

/* ── WALL 3: and if it ever did enter the database, it could not join ─────── */

test("RULING 126 wall 3: a future money table would share no column with a collection store", () => {
  const COLLECTION_STORES = ["searchLog", "reactions", "feedback", "intakeLimiter"] as const;
  const storeColumns = new Map<string, Set<string>>();
  for (const name of COLLECTION_STORES) {
    const table = (schema as Record<string, unknown>)[name];
    assert.ok(table, `${name} is missing from the schema — this guard cannot run`);
    storeColumns.set(
      name,
      new Set(getTableConfig(table as Parameters<typeof getTableConfig>[0]).columns.map((c) => c.name)),
    );
  }

  // The columns a state-money row carries. If any of these is ever put on a
  // database table, THIS is the list that must not intersect a store's.
  const moneyColumns = new Set([
    "dataClass", "jurisdiction", "agency", "filingsUrl", "committeeId", "registeredName",
    "candidateNameAsFiled", "officeSought", "electionYear", "filingState", "totals",
    "targetKeys", "match", "checkedAt", "provenance",
  ]);

  for (const [store, cols] of storeColumns) {
    const shared = [...moneyColumns].filter((c) => cols.has(c));
    assert.deepEqual(
      shared,
      [],
      `a campaign-finance row and ${store} would share ${shared.join(", ")} — that is a join path into a sold store`,
    );
  }
});

/* ── The matching bar, which is the other way this data does harm ─────────── */

test("a match needs name, office AND year — two of three is a LEAD", () => {
  const base = {
    registeredName: "ROYAL FOR ROCKAWAY TOWNSHIP COUNCIL",
    candidateNameAsFiled: "ROYAL, WILLIAM C III",
    ballotName: "William Royal",
    officeAsFiled: "MUNICIPAL OFFICE - COUNCIL",
    officeOnBallot: "Township Council",
    electionYearAsFiled: 2026,
    electionYearOnBallot: 2026,
  };
  assert.equal(judgeMatch(base).allThreeAgree, true);

  assert.equal(judgeMatch({ ...base, electionYearAsFiled: 2025 }).allThreeAgree, false);
  assert.equal(judgeMatch({ ...base, officeAsFiled: null }).allThreeAgree, false);
  assert.equal(judgeMatch({ ...base, ballotName: "Patrick McDonald" }).allThreeAgree, false);

  // And a failure says WHICH criterion failed, so a wrong match is reviewable.
  assert.match(judgeMatch({ ...base, electionYearAsFiled: 2025 }).note, /2025 is not the ballot year 2026/);
});

test("one shared surname is never agreement", () => {
  assert.equal(namesAgree("SMITH, JOHN", "Jane Smith"), false);
  assert.equal(namesAgree("Smith", "Smith"), false, "a bare surname is not a person");
  assert.equal(namesAgree("BURNSIDE, MELISSA", "Melissa Burnside"), true);
  // A generational suffix is stripped on both sides — RULING 103's "TI".
  assert.equal(namesAgree("HAYNES, THOMAS J III", "Thomas Haynes"), true);
  assert.equal(namesAgree("DAWKINS, CLIFFORD D JR", "Clifford Dawkins"), true);
});

/**
 * OFFICE AGREEMENT IS A CLASS COMPARISON, and this test was rewritten when the
 * first version of it passed against an implementation that produced ZERO
 * matches on the whole Morris County ballot.
 *
 * The original compared token overlap and asserted that `SCHOOL BOARD` and
 * `Board of Education` do NOT agree — "no shared carrying word", which was true
 * of the letters and false about the world. They are the same body under two
 * names, and NJ ELEC files one while the certified ballot carries the other.
 */
test("office agreement bridges the two vocabularies, and refuses across classes", () => {
  // ELEC's category vocabulary against the ballot's title vocabulary.
  assert.equal(officesAgree("MUNICIPAL OFFICE", "Member of the Township Committee"), true);
  assert.equal(officesAgree("SCHOOL BOARD", "Member of the Board of Education"), true);
  assert.equal(
    officesAgree("COUNTY COMMISSIONER", "Member of the Board of County Commissioners"),
    true,
  );

  // And it must REFUSE across classes — a school board is not a township
  // committee, and matching them would put a stranger's money on a card.
  assert.equal(officesAgree("SCHOOL BOARD", "Member of the Township Committee"), false);
  assert.equal(officesAgree("MUNICIPAL OFFICE", "Member of the Board of Education"), false);
  assert.equal(officesAgree("COUNTY EXECUTIVE", "Member of the Borough Council"), false);

  // ORDER IS LOAD-BEARING: "Board of County Commissioners" contains the word
  // "commissioner", so COUNTY must be tested before MUNICIPAL.
  assert.equal(officeClassOf("Member of the Board of County Commissioners"), "COUNTY");
  assert.equal(officeClassOf("Member of the Township Committee"), "MUNICIPAL");

  // An office neither side can classify is never agreement.
  assert.equal(officeClassOf("Grand Poobah"), null);
  assert.equal(officesAgree("Grand Poobah", "Grand Poobah"), false);
});

/* ── The three-way split, and the rule that a LEAD never renders ──────────── */

const record = (filingState: StateMoneyRecord["filingState"]): StateMoneyRecord => ({
  dataClass: "STATE_COMMITTEE",
  jurisdiction: "NJ",
  agency: "New Jersey Election Law Enforcement Commission",
  filingsUrl: null,
  committeeId: "X",
  registeredName: "R",
  candidateNameAsFiled: "N",
  officeSought: null,
  electionYear: 2026,
  filingState,
  totals: { receipts: null, expenditures: null, cashOnHand: null, reportCount: null, coveringPeriod: null },
  targetKeys: [],
  match: {
    registeredName: "R", officeAsFiled: null, officeOnBallot: null,
    electionYearAsFiled: null, electionYearOnBallot: 2026, allThreeAgree: false, note: "",
  },
  checkedAt: "2026-08-24",
  provenance: { sourceUrl: "https://example.gov", sourceOrg: "x", collectedAt: "2026-08-24" } as StateMoneyRecord["provenance"],
});

test("a LEAD never renders; a sourced absence does", () => {
  const verified = (state: StateMoneyRecord["filingState"]): StateMoneyRecord => {
    const r = record(state);
    return { ...r, targetKeys: ["ballot-nj-fixture:candidate"], match: { ...r.match, allThreeAgree: true },
      provenance: { ...r.provenance, verifiedAt: r.checkedAt } };
  };
  assert.equal(isRenderable(verified("FILED")), true);
  assert.equal(isRenderable(verified("NO_REPORTS_ON_FILE")), true, "a sourced, dated absence is a finding and renders");
  assert.equal(isRenderable(record("FILED")), false, "an unverified unmatched enum is not reader eligibility");
  assert.equal(isRenderable(record("LEAD")), false, "a LEAD is a guess about a named person's money");
});

test("the split counts CANDIDACIES, and the record count is a separate number", () => {
  /*
   * The first version of `computeSplit` counted RECORDS and reported
   * "FILED 296 of 235" — more answers than there were questions. The cause is
   * real data rather than a bug: a New Jersey candidate may file a primary
   * committee AND a general committee, and ELEC lists each. So the two are
   * different questions and both get answered.
   */
  const withKey = (state: StateMoneyRecord["filingState"], key: string): StateMoneyRecord => ({
    ...record(state),
    targetKeys: [key],
  });
  const records = [
    withKey("FILED", "a"),
    withKey("FILED", "a"), // the SAME candidate's second committee
    withKey("FILED", "b"),
    withKey("NO_REPORTS_ON_FILE", "c"),
    withKey("LEAD", "d"),
  ];
  const split = computeSplit(records, 10);

  assert.equal(split.filed, 2, "two CANDIDACIES have money, not three records");
  assert.equal(split.filedRecords, 3, "three committee records back them");
  assert.equal(split.noReportsOnFile, 1);
  assert.equal(split.lead, 1);
  // A LEAD is NOT resolved — it leaves the candidate still owed.
  assert.equal(split.unresolved, 7, "a LEAD may not be counted as an answer");
  assert.equal(split.filed + split.noReportsOnFile + split.unresolved, split.candidaciesInScope);

  // And a candidate with BOTH a filing and an absence record resolves as filed:
  // the absence was written for a pass another committee answered.
  const both = computeSplit([withKey("FILED", "x"), withKey("NO_REPORTS_ON_FILE", "x")], 1);
  assert.equal(both.filed, 1);
  assert.equal(both.noReportsOnFile, 0, "one candidate may not be counted in two buckets");
});

/**
 * **NEW HAMPSHIRE'S OFFICE VOCABULARY.** (Session C, 2026-08-31.)
 *
 * The classifier was written against New Jersey's filed categories and NH
 * broke it in three ways at once. These are pinned because the first is a
 * WRONG class rather than an absent one, and a wrong class is the failure
 * `officesAgree` cannot catch — two wrong classes agree with each other, and
 * the result is somebody else's money on a named person's card.
 */
test("NH: Executive Council is a STATE office, not a town council", () => {
  // `council` sits in the MUNICIPAL pattern, so before STATE named this
  // explicitly the state executive council classified as municipal.
  assert.equal(officeClassOf("Executive Council"), "STATE");
  assert.equal(officeClassOf("Executive Councilor, District 2"), "STATE");
  assert.equal(
    officesAgree("Executive Council", "Executive Councilor, District 2"),
    true,
    "the filing says Council and the ballot says Councilor; they are one office",
  );
  // And it must NOT agree with an actual municipal council.
  assert.equal(officesAgree("Executive Council", "Town Council"), false);
});

test("NH: senate/senator and State Representative classify as STATE", () => {
  // The word boundary after `senate` fails against `senator`, so the ballot's
  // spelling matched nothing before both were named.
  assert.equal(officeClassOf("State Senator, District 7"), "STATE");
  assert.equal(officeClassOf("State Senate"), "STATE");
  assert.equal(officeClassOf("State Representative"), "STATE");
  assert.equal(
    officeClassOf("State Representative, Merrimack County District 7"),
    "STATE",
    "a state seat whose district name contains the word County is still a state seat",
  );
  assert.equal(officesAgree("State Senate", "State Senator, District 7"), true);
  assert.equal(officesAgree("State Representative", "State Representative, Merrimack County District 7"), true);
  // A state house seat is not a county seat, however its district is named.
  assert.equal(
    officesAgree("State Representative", "Merrimack County Sheriff"),
    false,
    "STATE and COUNTY may never agree",
  );
});

test("NH: the county row offices classify as COUNTY", () => {
  for (const office of [
    "County Attorney",
    "County Treasurer",
    "Register of Deeds",
    "Register of Probate",
    "Sheriff",
  ]) {
    assert.equal(officeClassOf(office), "COUNTY", `${office} is a county office`);
  }
  assert.equal(officesAgree("County Attorney", "Merrimack County Attorney"), true);
  assert.equal(officesAgree("Register of Deeds", "Merrimack County Register of Deeds"), true);
  // Two different county offices still agree on CLASS — the class is all this
  // function claims, and the NAME is what separates two county candidates.
  assert.equal(officesAgree("Sheriff", "Merrimack County Attorney"), true);
});

test("a federal seat is FEDERAL whether the ballot says Senate or Senator", () => {
  assert.equal(officeClassOf("United States Senator"), "FEDERAL");
  assert.equal(officeClassOf("Representative in Congress, District 2"), "FEDERAL");
  // And it may never agree with the state chamber of the same name.
  assert.equal(officesAgree("United States Senator", "State Senator, District 7"), false);
});
