/**
 * The slogan field at 07866 — guarding the finding, not the number.
 *
 * `pnpm nj:slogan-audit` re-derives the county's Slogan column from both clerk
 * PDFs and compares it against what shipped. On 2026-08-23 it agreed with the
 * shipped parser on **272 of 272** rows: 70 carry a slogan, 202 have an empty
 * cell.
 *
 * What this guards is the CONCLUSION that rests on it — that 202 candidates are
 * not owed a slogan hunt. If the audit artifact ever comes back carrying
 * disagreements, that conclusion is no longer supported and somebody has to
 * look, because the alternative is a session reading "202 not owed" out of a
 * document whose evidence has quietly stopped saying so.
 *
 * It reads the committed artifact rather than making network calls — no live
 * calls in tests, per the fixture rule.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface AuditRow {
  candidacyId: string;
  name: string;
  ballotSlogan: string | null;
  sourceSlogan: string | null;
  verdict: string;
}

interface Audit {
  walkedAt: string;
  sourceUrls: string[];
  matched: number;
  ofTotal: number;
  unmatched: string[];
  tally: Record<string, number>;
  rows: AuditRow[];
  countAssertion: { verdict: string; reason: string };
}

const audit = JSON.parse(
  readFileSync(join(process.cwd(), "data/hunt/nj-slogan-audit.json"), "utf8"),
) as Audit;

describe("the NJ slogan audit at 07866", () => {
  it("read BOTH clerk documents, not just the general one", () => {
    // The school document holds 128 of the 272 candidacies and is a separate
    // PDF. A run that read only the general list would still reconcile to a
    // total and would be missing every non-partisan row.
    assert.equal(audit.sourceUrls.length, 2);
    assert.ok(audit.sourceUrls.some((u) => u.includes("general-candidates")));
    assert.ok(audit.sourceUrls.some((u) => u.includes("general-school-candidates")));
  });

  it("matched every candidacy to a source record", () => {
    assert.equal(
      audit.matched,
      audit.ofTotal,
      `${audit.ofTotal - audit.matched} candidacy(ies) were not found in the county's own ` +
        "documents. A partial that reconciles is still a wrong answer (RULING 100).",
    );
    assert.deepEqual(audit.unmatched, []);
  });

  it("states its count assertion rather than passing quietly", () => {
    // Neither PDF says how many candidates it holds, so NOT_ASSERTABLE is the
    // honest verdict and it has to be SAID. Silence here would be a reader
    // claiming a check it never made.
    assert.equal(audit.countAssertion.verdict, "NOT_ASSERTABLE");
    assert.ok(audit.countAssertion.reason.length > 0);
  });

  it("agrees with the shipped parser on every row", () => {
    const disagreements = audit.rows.filter(
      (r) => r.verdict !== "AGREE_PRESENT" && r.verdict !== "AGREE_ABSENT",
    );
    assert.deepEqual(
      disagreements.map((r) => `${r.name}: ballot=${r.ballotSlogan} source=${r.sourceSlogan}`),
      [],
      "An independent read of the county's Slogan column now disagrees with what ships. " +
        "Until this is resolved, the claim that 202 candidates are not owed a slogan is unsupported.",
    );
  });

  it("holds the finding the 202 rest on: an EMPTY cell, not a failed hunt", () => {
    const absent = audit.rows.filter((r) => r.verdict === "AGREE_ABSENT");
    const present = audit.rows.filter((r) => r.verdict === "AGREE_PRESENT");
    assert.equal(absent.length + present.length, audit.ofTotal);
    // Every AGREE_ABSENT row must genuinely carry nothing on BOTH sides. A row
    // counted as absent while holding a value would make the 202 a fiction.
    for (const r of absent) {
      assert.equal(r.ballotSlogan, null, `${r.name} is counted absent but the ballot holds a slogan`);
      assert.equal(r.sourceSlogan, null, `${r.name} is counted absent but the source holds a slogan`);
    }
    // And every AGREE_PRESENT row must carry one on both sides.
    for (const r of present) {
      assert.ok(r.ballotSlogan, `${r.name} is counted present with no ballot slogan`);
      assert.ok(r.sourceSlogan, `${r.name} is counted present with no source slogan`);
    }
  });

  it("carries a walked date, so the reading can go stale rather than stay true forever", () => {
    // RULING 53: a measurement with no date reads as stale. RULING 107: the
    // date is written by the code path that performed the read.
    assert.match(audit.walkedAt, /^\d{4}-\d{2}-\d{2}$/);
  });
});
