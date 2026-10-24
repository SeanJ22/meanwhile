import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { SOURCE_AUTHORITIES, isOfficialSource } from "../lib/civic-data/source-authority.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import {
  CENSUS_GEO_CONTRACT_ID,
  CENSUS_GEO_PARSER_VERSION,
  CENSUS_GEO_RECORD_CLASS,
  CENSUS_GEO_SCOPE,
  CENSUS_GEO_SOURCE_ID,
} from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { CENSUS_GEO_REQUIRED_VERSIONS } from "../lib/census-geography/publication.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";

const NOW = "2026-09-21T12:00:00.000Z";
function azDataset(): BuiltDataset {
  return JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
}

test("census-geography-relationships is an official .gov source that auto-qualifies (owner policy)", () => {
  const auth = SOURCE_AUTHORITIES["census-geography-relationships"];
  assert.ok(auth, "the census-geography-relationships source authority exists");
  assert.ok(auth.routePrefixes.length > 0 && auth.routePrefixes.every((prefix) => isOfficialSource(prefix)), "every route is on an official .gov site");
  assert.equal(auth.routineAutoPromotion, true);
});

test("the routine contract auto-publishes and matches the publication identity", () => {
  const c = requiredRoutineContract(CENSUS_GEO_CONTRACT_ID);
  assert.equal(c.sourceId, CENSUS_GEO_SOURCE_ID);
  assert.equal(c.recordClass, CENSUS_GEO_RECORD_CLASS);
  assert.equal(c.scope, CENSUS_GEO_SCOPE);
  assert.equal(c.parserNormalizerVersion, CENSUS_GEO_PARSER_VERSION);
  assert.equal(c.autoPromotable, true);
});

test("streamed geography hashes preserve the published canonical digest and reject a changed pointer payload", async () => {
  const store = new MemoryRoutineDataStore(), dataset = azDataset();
  const candidate = censusGeographyCandidate(dataset);
  assert.equal(candidate.normalization.normalizedHash, createHash("sha256").update(canonicalCivicDataJson(dataset)).digest("hex"));
  const result = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate, dataset.builtAt);
  assert.ok(result.promoted);
  assert.equal(promotionProofIssue(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, result.promoted, result.candidate), null);
  const payload = { ...dataset, coverage: "changed after validation" };
  assert.match(promotionProofIssue(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, { ...result.promoted, payload }, result.candidate) ?? "", /payload differs/);
});

test("a valid dataset auto-promotes through the routine door and the pointer serves the lookup", async () => {
  const store = new MemoryRoutineDataStore();
  const dataset = azDataset();
  const outcome = await processRegisteredRoutineCandidate(
    store,
    CENSUS_GEO_CONTRACT_ID,
    censusGeographyCandidate(dataset),
    dataset.builtAt,
  );
  assert.ok(
    outcome.promoted,
    `expected promotion; state=${outcome.candidate.state} decision=${outcome.candidate.receipt?.decision ?? "?"}`,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");

  const read = await readPromotedCivicData<BuiltDataset>(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, {
    store,
    now: NOW,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;

  const lookup = createLookup(read.value, read.projection.versionId);
  const az06 = await lookup.zctasForGrouping({ type: "congressional_district", geoid: "0406", version: "cd:119" });
  assert.equal(az06.status.kind, "OK");
  assert.equal(az06.count, 79);
  assert.equal(az06.publishedVersion, read.projection.versionId);
});

test("an empty dataset is refused and never promotes (fail closed)", async () => {
  const store = new MemoryRoutineDataStore();
  const empty: BuiltDataset = { formatVersion: 1, builtAt: NOW, coverage: "empty", scopes: [], zctaUniverse: [] };
  const outcome = await processRegisteredRoutineCandidate(
    store,
    CENSUS_GEO_CONTRACT_ID,
    censusGeographyCandidate(empty),
    NOW,
  );
  assert.equal(outcome.promoted, null);
});

test("missing election plans remain owed tomorrow, with one attempt per retry window, until all three publish", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
  const store = new MemoryRoutineDataStore();
  const task = routineTaskFromContract(requiredRoutineContract(CENSUS_GEO_CONTRACT_ID));
  const day = Date.parse("2026-10-23T12:00:00.000Z");
  let dataset = { ...azDataset(), builtAt: new Date(day).toISOString() };
  const first = await processRegisteredRoutineCandidate(store, task.id, censusGeographyCandidate(dataset), dataset.builtAt);
  assert.ok(first.promoted);
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(routineTaskDue(task, clock, day + task.retryMs - 1), false);
  assert.equal(routineTaskDue(task, clock, day + task.retryMs), true);
  assert.equal(routineTaskDue(task, clock, day + 86_400_000), true, "tomorrow still owes the missing plans, despite a successful old-map publication");
  for (const [index, key] of CENSUS_GEO_REQUIRED_VERSIONS.entries()) {
    const type = key.startsWith("cd:") ? "congressional_district" : key.startsWith("sldu:") ? "state_leg_upper" : "state_leg_lower";
    const prior = dataset.scopes.find(scope => scope.type === type)!;
    dataset = { ...dataset, scopes: [...dataset.scopes, { ...prior, version: key, versionMeta: { ...prior.versionMeta, key, retrievalComplete: true } }],
      builtAt: new Date(day + task.retryMs + index * 60_000).toISOString() };
    const result = await processRegisteredRoutineCandidate(store, task.id, censusGeographyCandidate(dataset), dataset.builtAt);
    assert.ok(result.promoted, result.candidate.failureDetail ?? JSON.stringify(result.candidate.receipt));
    const next = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.ok(next.publishedScopeVersions?.includes(key));
    const all = key === CENSUS_GEO_REQUIRED_VERSIONS.at(-1);
    assert.equal(routineTaskDue(task, next, day + 86_400_000), !all);
    assert.equal(routineTaskDue(task, next, day + 2 * task.retryMs - 1), false);
  }
});
