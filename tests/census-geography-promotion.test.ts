import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { SOURCE_AUTHORITIES, isOfficialSource } from "../lib/civic-data/source-authority.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { buildCensusDistrictEdge, createCensusDistrictReaderEdge, type CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import {
  CENSUS_GEO_CONTRACT_ID,
  CENSUS_GEO_PARSER_VERSION,
  CENSUS_GEO_RECORD_CLASS,
  CENSUS_GEO_SCOPE,
  CENSUS_GEO_SOURCE_ID,
} from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { overlaySourceRows } from "../lib/overlay-geography/reference.ts";

const NOW = "2026-09-21T12:00:00.000Z";
const artifactDirectory = mkdtempSync(join(tmpdir(), "census-promotion-artifacts-"));
after(() => rmSync(artifactDirectory, { recursive: true, force: true }));
const artifactStore = new LocalFileArtifactStore(artifactDirectory);
function azDataset(): BuiltDataset {
  return JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
}

test("routine geography accepts Census and exact reference-declared official overlay sources", () => {
  const auth = SOURCE_AUTHORITIES["census-geography-relationships"];
  assert.ok(auth, "the census-geography-relationships source authority exists");
  const overlayRoutes = new Set(overlaySourceRows.flatMap((source) => [source.fileUrl, source.townDocumentUrl, ...(source.townDocumentMirrors ?? []), source.townBoundaryUrl]));
  assert.ok(auth.routePrefixes.length > 0 && auth.routePrefixes.every((prefix) => isOfficialSource(prefix) || overlayRoutes.has(prefix)), "every route is official government or an exact registered official overlay source");
  assert.equal(auth.sourceClass, "MULTI_PUBLISHER_PRIMARY");
  assert.ok(overlaySourceRows.every((source) => source.sourceOrg && isOfficialSource(source.officialLinkUrl)));
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

test("a valid dataset auto-promotes through the routine door and the pointer serves the ZIP artifacts", async () => {
  const store = new MemoryRoutineDataStore();
  const dataset = azDataset();
  const index = await buildCensusDistrictEdge(dataset, "promotion-fixture", artifactStore);
  const outcome = await processRegisteredRoutineCandidate(
    store,
    CENSUS_GEO_CONTRACT_ID,
    censusGeographyCandidate(index),
    dataset.builtAt,
  );
  assert.ok(
    outcome.promoted,
    `expected promotion; state=${outcome.candidate.state} decision=${outcome.candidate.receipt?.decision ?? "?"}`,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");

  const read = await readPromotedCivicData<CensusDistrictEdge>(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, {
    store,
    now: NOW,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;

  const reader = createCensusDistrictReaderEdge(read.value, artifactStore);
  const expected = dataset.scopes.find(scope => scope.version === "cd:119")!.groupings.find(group => group.geoid === "0406")!.overlaps;
  assert.equal(expected.length, 79);
  for (const overlap of expected) {
    const slice = await reader.loadZip(overlap.zcta5);
    assert.equal(slice.kind, "HELD");
    if (slice.kind !== "HELD") throw new Error("The promoted ZIP artifact was not readable");
    assert.ok(slice.value.containers.some(container => container.ref.version === "cd:119" && container.ref.geoid === "0406"));
  }
  assert.equal(Object.hasOwn(read.value, "containers"), false);
  assert.equal(Object.hasOwn(read.value, "codes"), false);
  assert.doesNotMatch(JSON.stringify(read.value), /"coordinates"/);
});

test("an empty dataset is refused and never promotes (fail closed)", async () => {
  const store = new MemoryRoutineDataStore();
  const empty: BuiltDataset = { formatVersion: 1, builtAt: NOW, coverage: "empty", scopes: [], zctaUniverse: [] };
  const index = await buildCensusDistrictEdge(empty, "empty-fixture", artifactStore);
  const outcome = await processRegisteredRoutineCandidate(
    store,
    CENSUS_GEO_CONTRACT_ID,
    censusGeographyCandidate(index),
    NOW,
  );
  assert.equal(outcome.promoted, null);
});
