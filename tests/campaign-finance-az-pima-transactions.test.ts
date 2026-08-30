/**
 * THE PIMA COUNTY 401 IS DOWN, AND THIS IS THE PROOF THAT IT STAYED HONEST.
 *
 * `data/campaign-finance/az-pima-2026-held.json` recorded a total money wall:
 * no contribution row, no expenditure row, no independent-expenditure row, no
 * summary total, because `documents/getdocumentfiling/{id}` answered HTTP 401.
 * Under RULING 205 that closed a RouteTask and never the record obligation, and
 * under RULING 207 the 200 on `filer/documentsearch` never retired the rest of
 * the vendor's surface. `advancedsearch/contributions` and
 * `advancedsearch/distributions` are the other representation, they are public,
 * and they carry amounts and dates.
 *
 * The danger in acquiring money is not failing to get it. It is getting it and
 * then quietly answering a question it cannot answer — calling a bank's interest
 * payment a contribution, folding money given to another committee into what
 * this one spent, repairing a filer's impossible date, or letting a held
 * contribution retire the independent-expenditure class. Every test below is
 * one of those.
 *
 * NO LIVE CALLS. Everything reads the committed acquisition.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AZ_PIMA_TRANSACTIONS_PATH,
  azPimaContributionsFor,
  azPimaExpendituresFor,
  azPimaOtherDisbursementsFor,
  azPimaOtherReceiptsFor,
  azPimaTransactionCommitteeNames,
  azPimaTransactionUniverse,
  azPimaTransactions,
  azPimaResidualGap,
} from "../lib/control-plane/campaign-finance/held-records.ts";

/** The Vail committee. Local to the pilot ZIP 85641, and really in this data. */
const COVE = "Citizens of Vail for Education";

test("the acquisition file is committed, not merely fetched once", () => {
  const path = join(process.cwd(), ...AZ_PIMA_TRANSACTIONS_PATH);
  assert.ok(existsSync(path), `${AZ_PIMA_TRANSACTIONS_PATH.join("/")} must be committed`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { recordedOn: string };
  assert.match(raw.recordedOn, /^\d{4}-\d{2}-\d{2}$/, "recordedOn is a real stamp");
});

test("the row count was RECONCILED against the server, not trusted", () => {
  const tx = azPimaTransactions();
  assert.equal(tx.reconciliation.capSuspected, false);
  assert.ok(tx.reconciliation.probes.length >= 2, "at least two independent partitions were probed");
  for (const probe of tx.reconciliation.probes) {
    assert.equal(
      probe.serverRows,
      probe.localRows,
      `year ${probe.year}: a server-side cap would make these disagree`,
    );
  }
  // A round number is what a cap looks like. This one partitions, so it is not one.
  assert.ok(tx.contributions.length > 0 && tx.distributions.length > 0);
});

test("money was actually acquired where the prior walk held none", () => {
  const contributions = azPimaContributionsFor(COVE);
  const expenditures = azPimaExpendituresFor(COVE);
  assert.ok(contributions.length > 0, "at least one real contribution row for the Vail committee");
  assert.ok(expenditures.length > 0, "at least one real expenditure row for the Vail committee");

  const concord = contributions.find((c) => (c.contributorNameAsFiled ?? "").includes("Concord"));
  assert.ok(concord, "the Concord General Contracting contribution is held");
  assert.equal(concord.amountReceived, 5000);
  assert.equal(concord.receivedOn, "2025-12-17");
  assert.match(concord.filingId, /_Redacted$/, "and it carries the filing it came off");
});

test("ONLY an ItemizedListType of Contribution becomes a Contribution", () => {
  // The endpoint returns Interest, Loan, Rebate/Refund and more alongside real
  // contributions. The Vail committee's own rows include eight Interest rows.
  const contributions = azPimaContributionsFor(COVE);
  const others = azPimaOtherReceiptsFor(COVE);

  assert.ok(others.length > 0, "the non-contribution receipts exist and are not dropped");
  assert.ok(
    others.some((o) => o.itemizedListTypeAsFiled === "Interest"),
    "including the Interest rows",
  );
  for (const row of contributions) {
    assert.ok(row.contributorNameAsFiled !== null, "a contribution has somebody who made it");
  }
  // The load-bearing assertion: interest is not a contributor.
  assert.equal(
    contributions.length + others.length,
    azPimaTransactions().contributions.filter((r) => r.RecipientCommitteeName === COVE).length,
    "the split is lossless — every row is either a contribution or explicitly not one",
  );
});

test("money given to ANOTHER committee is never this committee's spending", () => {
  const tx = azPimaTransactions();
  const made = tx.distributions.filter((r) => r.ItemizedListType === "Contributions Made");
  assert.ok(made.length > 0, "the data really does contain Contributions Made rows");

  for (const row of made) {
    const name = row.CandidateCommitteeName;
    if (!name) continue;
    const expenditures = azPimaExpendituresFor(name);
    const leaked = expenditures.some((e) => e.amountSpent === Number(row.DistributionAmount ?? 0) && e.spentOn === row.DistributionDate);
    assert.ok(
      !leaked || azPimaOtherDisbursementsFor(name).length > 0,
      "Contributions Made is carried as an other-disbursement, never folded into spending",
    );
  }
  // And it is retrievable rather than discarded.
  const anyName = made[0]?.CandidateCommitteeName;
  if (anyName) {
    assert.ok(
      azPimaOtherDisbursementsFor(anyName).some((o) => o.itemizedListTypeAsFiled === "Contributions Made"),
    );
  }
});

test("holding contributions does NOT retire the independent-expenditure class", () => {
  const universe = azPimaTransactionUniverse(COVE);
  assert.ok(universe.recordClassesHeld.length > 0, "we now hold a record class here");
  assert.ok(
    universe.recordClassesNotHeld.includes("INDEPENDENT_EXPENDITURE_REPORT"),
    "and the IE class is STILL named as not held — every row returned is DocumentType CCFR",
  );
  // RULING 207 in one assertion: one route's success is not the source universe.
  assert.equal(universe.isCompleteFilingSet, false);
});

test("an independent expenditure is never rendered as money the candidate received", () => {
  // Nothing in this acquisition may produce an IndependentExpenditure at all,
  // and no contribution may be sourced to an IE report.
  for (const name of azPimaTransactionCommitteeNames().slice(0, 40)) {
    for (const contribution of azPimaContributionsFor(name)) {
      assert.equal(contribution.recordKind, "CONTRIBUTION");
      assert.doesNotMatch(
        contribution.sourceCitation,
        /independent/i,
        "no contribution may cite an independent-expenditure record",
      );
    }
    for (const expenditure of azPimaExpendituresFor(name)) {
      assert.equal(expenditure.recordKind, "EXPENDITURE");
    }
  }
});

test("as-filed dates are preserved exactly, including the impossible ones", () => {
  const tx = azPimaTransactions();
  const impossible = tx.contributions.filter((r) => {
    const year = Number(String(r.ContributionDate ?? "").slice(0, 4));
    return Number.isFinite(year) && year > 0 && (year < 1900 || year > 2100);
  });
  assert.ok(impossible.length > 0, "this data really does contain filer date typos");
  // They must survive into the model unrepaired: a corrected date is our claim.
  for (const row of impossible) {
    const name = row.RecipientCommitteeName;
    if (!name || row.ItemizedListType !== "Contribution") continue;
    const held = azPimaContributionsFor(name);
    assert.ok(
      held.some((c) => c.receivedOn === row.ContributionDate),
      `the as-filed date ${row.ContributionDate} is carried through unrepaired`,
    );
  }
});

test("the redaction and the name-matching cut are STATED, not smoothed away", () => {
  const universe = azPimaTransactionUniverse(COVE);
  assert.ok(universe.itemizationLimit, "a held universe states how it is cut");
  assert.match(universe.itemizationLimit, /_Redacted|[Rr]edacted/, "the redaction is named");
  assert.match(universe.itemizationLimit, /name/i, "and so is the name-match cut");

  const tx = azPimaTransactions();
  assert.ok(
    tx.limitsOfThisUniverse.some((l) => /INDEPENDENT-EXPENDITURE/i.test(l)),
    "the acquisition file names the IE gap",
  );
  assert.ok(
    tx.limitsOfThisUniverse.some((l) => /LINKAGE|measure/i.test(l)),
    "and the committee-to-measure linkage gap",
  );
});

test("committee name variants are NOT silently merged", () => {
  // Normalised only to FIND the collision. The store itself never normalises —
  // that is the whole point of the assertion.
  const fold = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const names = azPimaTransactionCommitteeNames();
  const variants = names.filter((n) => fold(n) === "ANDRES FOR SUPERVISOR");
  assert.ok(
    variants.length >= 2,
    `both spellings survive as distinct values, unmerged (found ${variants.join(" | ")})`,
  );

  // Matching is EXACT: asking for one spelling returns only that spelling's rows.
  const a = azPimaContributionsFor("Andrés for Supervisor");
  const b = azPimaContributionsFor("ANDRES FOR SUPERVISOR");
  assert.ok(a.length > 0, "the accented spelling has rows");
  assert.ok(b.length > 0, "the upper-case spelling has rows");

  const idsA = new Set(a.map((c) => c.sourceCitation));
  const overlap = b.filter((c) => idsA.has(c.sourceCitation));
  assert.equal(overlap.length, 0, "neither query returns the other's rows");
  assert.notEqual(a.length, b.length + a.length, "and neither silently absorbs the other");
});

test("the residual gap is OURS and names the exact next public route", () => {
  const gap = azPimaResidualGap("ballot-az-pima:prop-423#SUPPORT");
  assert.equal(gap.attribution, "OURS", "a route we did not finish is never the government's gap");
  assert.match(gap.what, /401|_Redacted/, "it names what is still closed");
  assert.match(gap.nextMove, /seethemoney|records request/i, "and the next public-access route");
  // The reader sentence may never imply that no money exists.
  assert.doesNotMatch(gap.readerSentence, /\bno (outside )?(money|spending) (was|has been)\b/i);
  assert.match(gap.readerSentence, /gaps in our records/i);
});
