import { installManualValue } from "./helpers/promoted-fixtures.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { manualProjectionCandidate, type CandidateProfilesProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";

const AT = "2026-09-20T12:00:00.000Z";

const payload: CandidateProfilesProjection = {
  cards: { curatedAt: "2026-09-08", note: "reviewed cards", cards: {}, hunts: [] },
  links: {
    curatedAt: "2026-09-08",
    note: "reviewed links",
    links: {
      "ballot-nj-example:mayor:doe-jane": {
        official: null,
        campaign: { url: "https://www.janedoe.example", verification: "Fetched 2026-08-13: 'Jane Doe for Mayor'.", attemptedAt: "2026-08-13" },
      },
    },
    hunts: [{ key: "ballot-nj-example:council-1:poe-alex", name: "Alex Poe", note: "MISS — no campaign site found", attemptedAt: "2026-08-13" }],
  },
};

async function promoteFixture() {
  const store = new MemoryRoutineDataStore();
  const pkg: ManualProjectionPackage = {
    contractId: "candidate-profiles:NJ", version: AT, sourceThrough: AT,
    sourceReceipt: { contractVersion: 1, reviewedAt: AT, reviewedBy: "owner-test", sources: [{
      requestedUrl: "https://www.janedoe.example", finalUrl: "https://www.janedoe.example", publisher: "www.janedoe.example", sourceClass: "CANDIDATE_CONTROLLED",
      retrievedAt: AT, httpStatus: 200, rawHash: "a".repeat(64), reviewedEvidence: "Exact response bytes reviewed by the owner.",
    }] },
    payload,
  };
  const outcome = await processRegisteredManualCandidate(store, "candidate-profiles:NJ", manualProjectionCandidate(pkg), AT, null);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? undefined);
  const read = await readPromotedCivicData<CandidateProfilesProjection>("CANDIDATE_PROFILE", "US-NJ:candidate-profiles", { store, bypassCache: true, now: AT });
  assert.equal(read.kind, "PROMOTED");
  return read;
}

const published = await promoteFixture();
installManualValue("candidate-profiles:NJ", published.value!, published.metadata.versionId!);
await readStateAuthorityProjection("candidate-profiles", "NJ");

test("every link was fetch-verified: url, verification sentence, and date present", () => {
  const { links, hunts } = allCandidateLinks("NJ");
  assert.ok(Object.keys(links).length > 0);
  for (const [key, entry] of Object.entries(links)) {
    for (const side of ["official", "campaign"] as const) {
      const link = entry[side];
      if (link === null) continue;
      // http:// is allowed only when the verification records that https was measured and refused.
      if (link.url.startsWith("http://")) {
        assert.match(
          link.verification,
          /https refused|refuses https|no https|https did not answer/i,
          `${key} ${side}: an http:// link must record that https was measured and refused`,
        );
      } else {
        assert.match(link.url, /^https:\/\//, `${key} ${side}`);
      }
      assert.ok(link.verification.length > 20, `${key} ${side}: verification sentence required`);
      assert.match(link.attemptedAt, /^\d{4}-\d{2}-\d{2}$/, `${key} ${side}`);
    }
  }
  assert.ok(hunts.length > 0);
  for (const hunt of hunts) {
    assert.match(hunt.note, /^(MISS|NOT_ATTEMPTED)/, `${hunt.key}: hunt note must state which kind of absence it is`);
  }
});

test("no ranking vocabulary anywhere in the links file", () => {
  const raw = JSON.stringify(allCandidateLinks("NJ")).toLowerCase();
  for (const banned of ['"score"', '"rank"', '"rating"', '"match"', '"fit"', '"grade"', '"alignment"', '"recommendation"']) {
    assert.ok(!raw.includes(banned), `banned key ${banned} in candidate-links`);
  }
});
