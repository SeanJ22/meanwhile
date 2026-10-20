import assert from "node:assert/strict";
import { test } from "node:test";
import { prlProfileForSubject, projectPrlProfile } from "../lib/sources/prl/snapshot.ts";
import { PRL_RHETORIC_ATTRIBUTION, type PrlSnapshot } from "../lib/sources/prl/types.ts";

const snapshot: PrlSnapshot = {
  formatVersion: 1,
  fetchedAt: "2026-09-28T00:00:00.000Z",
  sourceFile: "fixture.csv",
  sourceUrl: "https://americaspoliticalpulse.com/elites/data",
  rowsInFile: 1,
  rowsWithStatements: 1,
  profiles: [{
    bioguideId: "A000001",
    prlName: "Fixture Member",
    statementCount: 1200,
    shares: { policy: 60, "attack-policy": 10, "attack-personal": 2, creditclaiming: 20, bipartisanship: 8 },
    sources: ["press releases"],
    measuredAt: "2026-09-27",
  }],
  rosterMisses: [],
  attribution: PRL_RHETORIC_ATTRIBUTION,
};

test("PRL is exact official identity only, never a display-name or wrong-tier join", async () => {
  assert.equal(await prlProfileForSubject("Mark Kelly"), null);
  assert.equal(await prlProfileForSubject("statewide:az/governor"), null);
});

test("reader projection preserves the counts/shares allowlist and refuses an uncited measurement", () => {
  const p = snapshot.profiles[0];
  const planted = { ...p, ideology: 1, rank: 3, rawStatements: ["not permitted"] };
  const answer = projectPrlProfile(planted, snapshot);
  assert.ok(answer);
  assert.equal("ideology" in answer, false);
  assert.equal("rank" in answer, false);
  assert.equal("rawStatements" in answer, false);
  assert.deepEqual(answer.shares, p.shares);
  assert.equal(projectPrlProfile({ ...p, statementCount: 0 }, snapshot), null);
  assert.equal(projectPrlProfile(p, { ...snapshot, attribution: { ...snapshot.attribution, citation: "wrong source" } } as unknown as PrlSnapshot), null);
});

test("missing or invalid PRL shares remain absent numeric values, without a derived denominator or source channels", () => {
  const p = snapshot.profiles[0];
  const partial = projectPrlProfile({ ...p, shares: { ...p.shares,
    policy: null, "attack-policy": Number.NaN, "attack-personal": -1,
    creditclaiming: 101, bipartisanship: 0 }, sources: [] }, snapshot);
  assert.ok(partial);
  assert.deepEqual(partial.shares, { policy: null, "attack-policy": null,
    "attack-personal": null, creditclaiming: null, bipartisanship: 0 });
  assert.deepEqual(partial.categories.map(category => category.id), ["bipartisanship"]);
  assert.equal(partial.categories[0].share, 0);
  assert.deepEqual(partial.communicationSources, []);
  assert.equal("denominator" in partial, false);
  assert.equal("statementFeed" in partial, false);
  assert.equal(partial.statementCount, p.statementCount);
  assert.equal(partial.retrievedAt, snapshot.fetchedAt);
});
