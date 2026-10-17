import assert from "node:assert/strict";
import test from "node:test";

import { POSITION_TOPICS } from "../lib/corpus/positions.ts";
import { DEFAULT_STANCE_TOPICS, STANCE_TOPICS_SETTING, validStanceTopics } from "../lib/stances/topics.ts";
import { positionsFor } from "../lib/candidates/positions.ts";
import { settingDefinition } from "../lib/control-plane/settings.ts";
import type { CandidateCorpus } from "../lib/candidates/corpus.ts";
import { settleCandidateCorpusRead } from "../lib/civic-data/manual-read-models.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { rosterFactReader } from "./helpers/roster-fact-reader.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";


function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}


// A promoted candidate publication corpus holding one other candidate's page;
// "nobody-at-all" holds none, so every topic reads as not found.
installManualValue<CandidateCorpus>("candidate-corpus:AZ", {
  formatVersion: 1,
  fetchedAt: "2026-09-25T12:00:00.000Z",
  attempted: 1,
  documents: [{
    id: "ballot-az-pima:governor:someone-else@0000",
    candidateKey: "ballot-az-pima:governor:someone-else",
    sourceClass: "CAMPAIGN_SITE",
    basis: "HUNTED_AND_VERIFIED",
    metaDescription: null,
    documentUrl: "https://someone-else.example/issues",
    contentHash: "0000",
    retrievedAt: "2026-09-25T12:00:00.000Z",
    contentType: "text/html",
    text: "Housing and water for every family.",
    extraction: "html",
    extractionNote: null,
  }],
  failures: [],
});
await Promise.all([installRegistryRuntime(), settleCandidateCorpusRead("AZ")]);

test("CA-10: the person card and the ballot card read the same ten plain nouns", () => {
  assert.equal(DEFAULT_STANCE_TOPICS.length, 10);
  assert.deepEqual(POSITION_TOPICS, DEFAULT_STANCE_TOPICS.map((t) => t.label));
  assert.deepEqual(positionsFor("AZ", "nobody-at-all").map((p) => p.issue.label), [...POSITION_TOPICS]);
  assert.deepEqual([...POSITION_TOPICS], ["housing", "water", "schools", "taxes", "immigration", "health care", "public safety", "jobs", "environment", "transportation"]);
});

test("CA-10: the list is a reader-facing setting that only accepts exactly ten valid topics", () => {
  const definition = settingDefinition(STANCE_TOPICS_SETTING);
  assert.ok(definition?.readerFacing);
  assert.ok(definition.validate(DEFAULT_STANCE_TOPICS));
  assert.equal(validStanceTopics(DEFAULT_STANCE_TOPICS.slice(1)), false);
  assert.equal(validStanceTopics(DEFAULT_STANCE_TOPICS.map((t, i) => i === 0 ? { ...t, label: "Housing Crisis" } : t)), false);
  assert.equal(validStanceTopics(DEFAULT_STANCE_TOPICS.map((t, i) => i === 0 ? { ...t, phrases: [] } : t)), false);
  assert.equal(validStanceTopics(DEFAULT_STANCE_TOPICS.map((t, i) => i === 1 ? { ...t, id: "housing" } : t)), false);
});

test("CA-10: a changed list is searched for every person in its own order", () => {
  const changed = [...DEFAULT_STANCE_TOPICS].reverse();
  assert.deepEqual(positionsFor("AZ", "nobody-at-all", null, changed).map((p) => p.issue.id), changed.map((t) => t.id));
});
