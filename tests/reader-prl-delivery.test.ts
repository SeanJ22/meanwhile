import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prlProfileForSubject, projectPrlProfile } from "../lib/sources/prl/snapshot.ts";
import { PRL_CATEGORIES, PRL_RHETORIC_ATTRIBUTION, type PrlSnapshot } from "../lib/sources/prl/types.ts";

const snapshot = JSON.parse(readFileSync("data/prl/prl-profiles.json", "utf8")) as PrlSnapshot;

test("all held eligible PRL profiles survive exact bioguide reader projection", () => {
  assert.ok(snapshot.profiles.length > 0);
  for (const profile of snapshot.profiles) {
    const answer = prlProfileForSubject(`congress:${profile.bioguideId}`);
    assert.ok(answer, profile.bioguideId);
    assert.equal(answer.bioguideId, profile.bioguideId);
    assert.equal(answer.statementCount, profile.statementCount);
    assert.deepEqual(answer.shares, profile.shares);
    assert.equal(answer.measuredAt, profile.measuredAt);
    assert.equal(answer.retrievedAt, snapshot.fetchedAt);
    assert.equal(answer.sourceUrl, snapshot.sourceUrl);
    assert.deepEqual(answer.communicationSources, profile.sources);
    assert.equal(answer.categories.length, PRL_CATEGORIES.filter(c => profile.shares[c.key] !== null).length);
    assert.equal(answer.attribution.citation, PRL_RHETORIC_ATTRIBUTION.citation);
    for (const category of answer.categories) {
      assert.match(category.sentence, /Polarization Research Lab/);
      assert.ok(category.sentence.includes(profile.statementCount.toLocaleString("en-US")));
      assert.equal(category.share, profile.shares[category.id]);
    }
  }
});

test("PRL is exact official identity only, never a display-name or wrong-tier join", () => {
  assert.equal(prlProfileForSubject("Mark Kelly"), null);
  assert.equal(prlProfileForSubject("statewide:az/governor"), null);
  assert.equal(prlProfileForSubject("congress:Z999999"), null);
  assert.notDeepEqual(prlProfileForSubject("congress:K000377"), prlProfileForSubject("congress:G000574"));
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
