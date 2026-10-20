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
  censusGeographyContractId,
  CENSUS_GEO_PARSER_VERSION,
  CENSUS_GEO_RECORD_CLASS,
  censusGeographyScope,
  CENSUS_GEO_SOURCE_ID,
} from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";

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
  const c = requiredRoutineContract(censusGeographyContractId("AZ"));
  assert.equal(c.sourceId, CENSUS_GEO_SOURCE_ID);
  assert.equal(c.recordClass, CENSUS_GEO_RECORD_CLASS);
  assert.equal(c.scope, censusGeographyScope("AZ"));
  assert.equal(c.parserNormalizerVersion, CENSUS_GEO_PARSER_VERSION);
  assert.equal(c.autoPromotable, true);
});

test("a valid dataset auto-promotes through the routine door and the pointer serves the lookup", async () => {
  const store = new MemoryRoutineDataStore();
  const dataset = azDataset();
  const outcome = await processRegisteredRoutineCandidate(
    store,
    censusGeographyContractId("AZ"),
    censusGeographyCandidate(dataset,"AZ"),
    dataset.builtAt,
  );
  assert.ok(
    outcome.promoted,
    `expected promotion; state=${outcome.candidate.state} decision=${outcome.candidate.receipt?.decision ?? "?"}`,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");

  const read = await readPromotedCivicData<BuiltDataset>(CENSUS_GEO_RECORD_CLASS, censusGeographyScope("AZ"), {
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
    censusGeographyContractId("AZ"),
    censusGeographyCandidate(empty,"AZ"),
    NOW,
  );
  assert.equal(outcome.promoted, null);
});
