/**
 * **THE ARIZONA 2026 FINANCE CORPUS IS STATEWIDE, AND ITS DENOMINATOR IS NOT A
 * ZIP.** (Session C3, 2026-09-01. RULING 229, RULING 207, RULING 167.)
 *
 * `scripts/state-money-az.mts` used to say so in its own header — *"FOR THE
 * 85701 AND 85641 BALLOT"* — and mean it: it loaded `data/ballot/az-pima-2026.json`,
 * built its committee list by name-matching those candidacies against the
 * portal, and read the itemised ledger for 58 of 732 entities. The acquisition
 * DENOMINATOR was the currently enabled reader location, so activating a third
 * ZIP would have meant hunting the same portal again for money already held.
 *
 * These tests are the standing refusal of that pattern. They assert the SHAPE
 * of the acquisition rather than a figure: that the walk's population is the
 * publisher's whole cycle universe, that the script has no ballot dependency at
 * all, that unread ledgers are ROUTE GAPS carrying the agency's own next filing
 * deadline rather than absences, and that no contributor detail was persisted.
 *
 * NO LIVE CALLS. Everything reads the committed corpus.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { AzIdentityRegistry } from "../lib/identity/types.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, "data", "campaign-finance", "az-2026-statewide-corpus.json");
const SCRIPT_PATH = join(ROOT, "scripts", "state-money-az.mts");

interface Corpus {
  collectedAt: string;
  cycle: number;
  source: Record<string, string>;
  denominators: {
    perQuery: { label: string; rows: number; entities: number }[];
    unionRows: number;
    unionEntities: number;
    statewideCandidateCommittees: number;
    registerRows: number;
    reconciledAgainstItemisedLedger: number;
    reconciliationsHeld: number;
    routeGaps: number;
    identityRegistryCandidates: number;
    identityRegistryCandidaciesProjectable: number;
  };
  nextFilingDeadline: { reportName: string; filingPeriodEndDate: string } | null;
  routeGaps: { entityId: number; committeeName: string; reason: string; nextDue: string | null }[];
  entities: {
    entityId: number;
    committeeName: string;
    candidateDisplay: string;
    entityTypeName: string | null;
    officeNames: string[];
    income: number;
    expense: number;
    reconciledAgainstItemisedLedger: boolean;
  }[];
  reconciliations: {
    entityId: number;
    summaryIncome: number;
    summaryExpense: number;
    itemisedIncome: number;
    itemisedExpense: number;
    incomeTransactions: number;
    expenseTransactions: number;
    agrees: boolean;
    walkedAt: string;
  }[];
}

const corpus: Corpus | null = existsSync(CORPUS_PATH)
  ? (JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as Corpus)
  : null;
const registry = JSON.parse(
  readFileSync(join(ROOT, "data", "identity", "az-2026-candidate-registry.json"), "utf8"),
) as AzIdentityRegistry;
const snapshot = JSON.parse(
  readFileSync(join(ROOT, "data", "funding", "state-money-az-2026.json"), "utf8"),
) as StateMoneySnapshot;

/* ── The acquisition layer has no ballot dependency. Read from the source. ─ */

test("the acquisition script reads no ballot file and names no pilot ZIP", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  /* The comments explain the pattern that was removed, so the check is on what
     the script READS, not on whether the words appear. */
  const reads = [...source.matchAll(/join\(\s*ROOT,\s*("[^"]+"(?:\s*,\s*"[^"]+")*)\s*\)/g)].map((m) =>
    m[1].replace(/"/g, "").replace(/\s*,\s*/g, "/"),
  );
  for (const path of reads) {
    assert.ok(
      !path.startsWith("data/ballot"),
      `the acquisition script builds a path into data/ballot: ${path}`,
    );
  }
  assert.ok(reads.length > 0, "no ROOT-relative path was found — the matcher is broken, not the script");
  assert.ok(
    reads.some((p) => p.startsWith("data/identity")),
    "the script does not read the identity layer, so it has nothing to project onto",
  );
});

test("the acquisition script's candidate population comes from the publisher, not a page", () => {
  /*
   * COMMENTS ARE STRIPPED FIRST, and that is not a loophole.
   *
   * The script's own header explains the pilot-bound pattern it replaced and
   * names the identifier it removed, so a raw text sweep reads the explanation
   * as the defect. A guard that cannot tell prose from code teaches the next
   * session to delete the prose. This one reads the CODE.
   */
  const code = readFileSync(SCRIPT_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(
    /statewideCandidateEntities\s*=\s*\[\.\.\.entities\.values\(\)\]/.test(code),
    "the statewide population is no longer derived from the whole cycle universe",
  );
  assert.ok(!/candidateOfInterest/.test(code), "the pilot-bound committee list is back");
  assert.ok(
    !/az-pima-2026\.json/.test(code),
    "the acquisition script loads the pilot ballot again",
  );
});

/* ── The corpus itself ───────────────────────────────────────────────────── */

test("the statewide corpus exists and is the whole cycle universe", () => {
  assert.ok(corpus, `${CORPUS_PATH} is absent — run \`pnpm money:az\``);
  const d = corpus!.denominators;
  assert.equal(corpus!.entities.length, d.unionEntities, "the entity list is not the union");
  assert.ok(d.unionEntities > 0);
  /* THE DENOMINATOR IS NOT THE READER'S BALLOT. The statewide candidate
     population is an order of magnitude larger than the candidacies any one
     page can be about, and that gap is the whole point of RULING 229. */
  assert.ok(
    d.statewideCandidateCommittees > d.identityRegistryCandidaciesProjectable * 5,
    `statewide candidate committees ${d.statewideCandidateCommittees} vs ` +
      `${d.identityRegistryCandidaciesProjectable} projectable candidacies — the denominator looks ballot-shaped`,
  );
  assert.equal(d.identityRegistryCandidates, registry.candidates.length);
});

test("the union is the union of all three publisher filter states", () => {
  const labels = corpus!.denominators.perQuery.map((q) => q.label);
  assert.deepEqual(labels, [
    "IsLessActive=false ShowOfficeHolder=false",
    "IsLessActive=true ShowOfficeHolder=false",
    "IsLessActive=true ShowOfficeHolder=true",
  ]);
  /* A default-view-only walk would record an absence our own query manufactured. */
  const def = corpus!.denominators.perQuery[0];
  assert.ok(corpus!.denominators.unionEntities > def.entities, "the union is no larger than the default view");
});

test("every entity in the corpus carries its own identity and aggregates", () => {
  for (const e of corpus!.entities) {
    assert.ok(Number.isFinite(e.entityId));
    assert.equal(typeof e.committeeName, "string");
    assert.equal(typeof e.income, "number");
    assert.equal(typeof e.expense, "number");
    assert.ok(Array.isArray(e.officeNames));
  }
});

test("an unread ledger is a ROUTE GAP with the agency's own next date, never an absence", () => {
  assert.equal(corpus!.denominators.routeGaps, corpus!.routeGaps.length);
  for (const gap of corpus!.routeGaps) {
    assert.ok(gap.reason.length > 0, `route gap ${gap.entityId} carries no reason`);
    /* `null` is lawful only when the published calendar states none after today. */
    if (corpus!.nextFilingDeadline) {
      assert.equal(gap.nextDue, corpus!.nextFilingDeadline.filingPeriodEndDate);
    }
  }
});

test("every reconciliation compares the summary against the publisher's own ledger", () => {
  assert.equal(corpus!.denominators.reconciliationsHeld, corpus!.reconciliations.length);
  let agreeing = 0;
  for (const r of corpus!.reconciliations) {
    assert.ok(Number.isFinite(r.itemisedIncome));
    assert.ok(Number.isFinite(r.itemisedExpense));
    assert.ok(Number.isInteger(r.incomeTransactions));
    assert.ok(Number.isInteger(r.expenseTransactions));
    assert.match(r.walkedAt, /^\d{4}-\d{2}-\d{2}$/);
    const agrees =
      Math.abs(r.summaryIncome - r.itemisedIncome) < 0.005 &&
      Math.abs(r.summaryExpense - r.itemisedExpense) < 0.005;
    assert.equal(r.agrees, agrees, `entity ${r.entityId} records a verdict its own numbers do not support`);
    if (r.agrees) agreeing += 1;
  }
  assert.equal(agreeing, corpus!.denominators.reconciledAgainstItemisedLedger);
});

/* ── Privacy: RULING 167, asserted on the bytes ──────────────────────────── */

test("no contributor detail was persisted anywhere in the corpus", () => {
  const raw = readFileSync(CORPUS_PATH, "utf8");
  for (const field of [
    "TransactionFirstName",
    "TransactionLastName",
    "TransactionOccupation",
    "TransactionEmployer",
    "TransactionCity",
    "TransactionZipCode",
  ]) {
    assert.ok(!raw.includes(field), `${field} reached the committed corpus`);
  }
  /* And no transaction array by any other name: what is kept is counts. */
  for (const r of corpus!.reconciliations) {
    assert.equal(typeof r.incomeTransactions, "number");
    assert.ok(!Array.isArray((r as unknown as { transactions?: unknown }).transactions));
  }
});

/* ── The projection: the reader snapshot is keyed on canonical candidacies ─ */

test("every reader-snapshot record is keyed to a candidacy the registry names", () => {
  const known = new Set(
    registry.candidates.map((c) => c.canonicalCandidacyId).filter((id): id is string => id !== null),
  );
  for (const record of snapshot.records) {
    for (const key of record.targetKeys) {
      assert.ok(known.has(key), `snapshot record targets ${key}, which the identity registry does not name`);
      assert.ok(!key.includes("|"), `snapshot record is keyed on a nominee name: ${key}`);
    }
  }
});

test("the snapshot's split is stated with its denominator and adds up", () => {
  const s = snapshot.split;
  assert.ok(s.candidaciesInScope > 0);
  assert.equal(
    s.filed + s.registeredNoActivityReported + s.noReportsOnFile + s.unresolved,
    s.candidaciesInScope,
    `split ${JSON.stringify(s)} does not partition its own denominator`,
  );
});
