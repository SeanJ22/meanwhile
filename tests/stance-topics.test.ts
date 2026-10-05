import assert from "node:assert/strict";
import test from "node:test";

import { POSITION_TOPICS } from "../lib/corpus/positions.ts";
import { DEFAULT_STANCE_TOPICS, STANCE_TOPICS_SETTING, validStanceTopics } from "../lib/stances/topics.ts";
import { positionsFor } from "../lib/candidates/positions.ts";
import { settingDefinition } from "../lib/control-plane/settings.ts";
import { installCandidateCorpusFirstSeed, installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([installCandidateCorpusFirstSeed(), installRegistryRuntimeFirstSeeds()]);

test("CA-10: the person card and the ballot card read the same ten plain nouns", () => {
  assert.equal(DEFAULT_STANCE_TOPICS.length, 10);
  assert.deepEqual(POSITION_TOPICS, DEFAULT_STANCE_TOPICS.map((t) => t.label));
  assert.deepEqual(positionsFor("nobody-at-all").map((p) => p.issue.label), [...POSITION_TOPICS]);
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
  assert.deepEqual(positionsFor("nobody-at-all", null, changed).map((p) => p.issue.id), changed.map((t) => t.id));
});
