import assert from "node:assert/strict";
import test from "node:test";
import { federalMoneyAskProof } from "../scripts/lib/reader-ask-federal-money-proof.ts";

test("all held FEC primary totals and sourced absences survive actual Ask with exact identity and provenance", async () => {
  const result = await federalMoneyAskProof();
  assert.equal(result.proofs.length, result.candidateDenominator + result.absenceDenominator);
  // The promoted FEC contract makes no absence claim: the 14 frozen absence
  // rows lack the bounded authoritative horizon / completed pagination needed to
  // prove a "no filing" negative, so the bootstrap withholds them
  // (lib/funding/snapshot.ts) rather than reviving them as Reader authority. The
  // 24 held candidate records remain Reader-eligible; the historical file keeps
  // the absence rows. (Was 24+14=38 before the absence-eligibility repair.)
  assert.equal(result.candidateDenominator, 24);
  assert.equal(result.absenceDenominator, 0);
  assert.equal(result.proofs.length, 24);
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN"), []);
});
