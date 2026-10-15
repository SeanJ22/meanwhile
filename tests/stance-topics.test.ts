import assert from "node:assert/strict";
import test from "node:test";

import { POSITION_TOPICS } from "../lib/corpus/positions.ts";
import { DEFAULT_STANCE_TOPICS, STANCE_TOPICS_SETTING, validStanceTopics } from "../lib/stances/topics.ts";
import { positionsFor } from "../lib/candidates/positions.ts";
import { settingDefinition } from "../lib/control-plane/settings.ts";
import type { CandidateCorpus } from "../lib/candidates/corpus.ts";
import { readCandidateCorpusProjection } from "../lib/civic-data/manual-read-models.ts";
import { installManualValue, installRegistryRuntime } from "./helpers/promoted-fixtures.ts";

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
await Promise.all([installRegistryRuntime(), readCandidateCorpusProjection("AZ")]);

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
