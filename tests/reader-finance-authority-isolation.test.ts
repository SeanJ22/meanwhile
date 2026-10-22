import assert from "node:assert/strict";
import test from "node:test";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { lineupForContest } from "../lib/ballot/general-lineup.ts";
import { analysisForContest } from "../lib/ballot/analyses.ts";
import { lineupBridgeCovers, lineupRowForCard, reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
const failedStore={async readPromotion(){throw new Error("planted independent authority failure");},async readCandidate(){throw new Error("a failed pointer must not read a candidate");}};

test("lineup and measure lookups answer null when the ballot projection is unreadable", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    assert.equal((await readGenericBallotProjection("AZ", { store: failedStore, bypassCache: true })).kind, "STORE_UNREACHABLE");
    for (const id of ["ballot-nh-merrimack:governor", "ballot-nj-morris:county-commissioner"]) {
      assert.equal(lineupForContest("AZ", id), null, `${id}: the AZ canvass has no authority over this contest`);
      assert.equal(analysisForContest("AZ", id), null, `${id}: AZ measure analyses have no authority over this contest`);
    }
    assert.equal(lineupForContest("AZ", "ballot-az-pima:governor"), null);
    assert.equal(analysisForContest("AZ", "ballot-az-pima:prop-139"), null);
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
});

test("foreign contest and card keys do not initialize the AZ identity bridge", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    await readGenericBallotProjection("AZ", { store: failedStore, bypassCache: true });
    for (const id of ["ballot-nh-merrimack:governor", "ballot-nj-morris:county-commissioner"]) {
      assert.equal(lineupBridgeCovers(id), false);
      assert.equal(lineupRowForCard(`${id}|Public test nominee`), null);
      assert.equal(reconciledCandidacyIdForCard(`${id}|Public test nominee`), null);
    }
    assert.throws(() => lineupBridgeCovers("ballot-az-pima:governor"), /Ballot for AZ is UNREAD/);
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
});
