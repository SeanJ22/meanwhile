import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { completeOfficialBallotContests, manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { authorityForManualReceipt } from "../lib/civic-data/source-authority.ts";
import type { BallotStateFile } from "../scripts/assemble-ballot-package.mts";
import { genericBallotProblems } from "../lib/ballot/generic-projection.ts";

const baseline = {
  az: "fdeeea2230f9563567c0d90a245bf07954ef705e3fa6862fc754828eda53478c",
  nh: "dfc18b457006fbd240d1ae5c5e0106e79c5d66d6fd3c5949dcd17a98823cf933",
  nj: "c4f97d39663313440b704082bec5e8cf17c6a51a23a0dd510cfc860f23541f7c",
};

for (const state of ["az", "nh", "nj"] as const) {
  test(`${state.toUpperCase()} retains every held ballot row and source through national publication`, async () => {
    const file = JSON.parse(await readFile(`data/ballot/2026-general/${state}.json`, "utf8")) as BallotStateFile;
    const ballot = Object.values(file.ballots)[0];
    const records = Object.fromEntries((["contests", "candidacies", "measures", "absences", "removals"] as const).map(key => [key,
      (ballot[key] ?? []).filter(row => state !== "az" || !("id" in row) || row.id.startsWith("ballot-az-pima:"))
        .map(row => {
          const copy = { ...row } as Record<string, unknown>;
          delete copy.candidateListComplete;
          delete copy.scopeNote;
          if (state === "nj" && "provenance" in row && row.provenance.collectedAt >= "2026-10-14") {
            assert.equal(row.provenance.collectedAt, key === "contests" || key === "candidacies" ? "2026-10-15" : "2026-10-14");
            assert.equal(row.provenance.verifiedAt, row.provenance.collectedAt);
            copy.provenance = { ...row.provenance, collectedAt: "2026-10-14", verifiedAt: "2026-10-14" };
          }
          return copy;
        })
        .sort((a, b) => canonicalCivicDataJson(a).localeCompare(canonicalCivicDataJson(b))),
    ]));
    assert.equal(createHash("sha256").update(canonicalCivicDataJson(records)).digest("hex"), baseline[state]);
    const payload = { kind: "ballot-contests" as const, ballots: file.ballots };
    assert.deepEqual(genericBallotProblems(payload), []);
    const candidate = manualProjectionCandidate({ contractId: "ballot-contests", version: "BL-30", sourceThrough: file.sourceReceipt.reviewedAt,
      sourceReceipt: file.sourceReceipt, payload });
    assert.deepEqual(candidate.normalization.missingRequiredFields, []);
    assert.deepEqual(candidate.semantics.violations, []);
    const proof = authorityForManualReceipt(candidate.sourceId, candidate.recordClass, file.sourceReceipt, candidate.retrieval.finalUrl);
    assert.equal(proof.ok, true, JSON.stringify(proof));
    if (state === "az") {
      assert.equal(ballot.measureRecords?.length, 15);
      assert.equal(ballot.measureAnalyses?.analyses.length, 11);
      assert.ok(ballot.identityRegistry?.candidates.length);
      assert.ok(ballot.lineupReconciliation?.rows.length);
      const complete = completeOfficialBallotContests(payload, file.sourceReceipt);
      for (const [family, count] of [["cd", 9], ["sldu", 30], ["sldl", 30]] as const) {
        const districts = new Set(ballot.contests.filter(contest => contest.ocdId.includes(`/${family}:`)).map(contest => contest.ocdId));
        assert.equal(districts.size, count, family);
      }
      const house = ballot.contests.find(contest => contest.ocdId === "ocd-division/country:us/state:az/cd:1")!;
      assert.ok(complete.some(row => row.contest.id === house.id));
      assert.ok(ballot.candidacies.some(row => row.contestId === house.id && /Shah/i.test(row.familyName)));
      assert.ok(ballot.candidacies.some(row => row.contestId === house.id && /Feely/i.test(row.familyName)));
    }
    if (state === "nj") {
      assert.equal(ballot.contacts?.length, 275);
      assert.ok(ballot.contacts?.every(contact => !("filedAddress" in contact)));
    }
  });
}
