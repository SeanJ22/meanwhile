import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { candidateChangeSet, civicRecordsFor } from "../lib/civic-data/changes.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

const ROOT = process.cwd();

function trackedProfiles() {
  return {
    cards: JSON.parse(readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8")),
    links: JSON.parse(readFileSync(join(ROOT, "data", "ballot", "candidate-links-2026.json"), "utf8")),
  };
}

test("candidate-profile hunt observations have unique, order-independent exact member identities", () => {
  const payload = trackedProfiles();
  const forward = civicRecordsFor("CANDIDATE_PROFILE", payload);
  const reordered = civicRecordsFor("CANDIDATE_PROFILE", {
    cards: {
      ...payload.cards,
      cards: Object.fromEntries(Object.entries(payload.cards.cards).reverse()),
      hunts: [...payload.cards.hunts].reverse(),
    },
    links: {
      ...payload.links,
      links: Object.fromEntries(Object.entries(payload.links.links).reverse()),
      hunts: [...payload.links.hunts].reverse(),
    },
  });

  assert.ok(forward.length > 500, "the real first seed exercises the repeated observation history");
  assert.equal(new Set(forward.map((member) => member.key)).size, forward.length);
  assert.deepEqual(reordered, forward);
  assert.deepEqual(
    forward.map(({ key }) => key),
    forward.map(({ key }) => key).sort((left, right) => left.localeCompare(right)),
  );
});

test("an exact duplicate hunt remains two members and yields one exact removal", () => {
  const observation = {
    key: "ballot-nh-test:office:candidate",
    name: "Candidate",
    note: "Two independent retained attempts produced the same observation.",
    attemptedAt: "2026-09-08",
  };
  const prior = {
    cards: { cards: {}, hunts: [observation, structuredClone(observation)] },
    links: { links: {}, hunts: [] },
  };
  const next = {
    cards: { cards: {}, hunts: [observation] },
    links: { links: {}, hunts: [] },
  };
  const candidate = {
    recordClass: "CANDIDATE_PROFILE",
    readModel: next,
  } as unknown as RoutineCandidate;

  const changeSet = candidateChangeSet(candidate, prior);
  assert.equal(changeSet.outcome, "CHANGED");
  assert.equal(changeSet.removed.length, 1);
  assert.match(changeSet.removed[0].key, /^card-hunt:.*:occurrence-2$/);
});
