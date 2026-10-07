import assert from "node:assert/strict";
import test from "node:test";

import { candidateChangeSet, civicRecordsFor } from "../lib/civic-data/changes.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

function profiles() {
  const hunt = (key: string, note: string) => ({ key, name: key, note, attemptedAt: "2026-09-08" });
  return {
    cards: {
      curatedAt: "2026-09-08",
      note: "fixture cards",
      cards: { "ballot-nh-example:a": { bio: "A." }, "ballot-nh-example:b": { bio: "B." } },
      hunts: [hunt("ballot-nh-example:c", "MISS — none"), hunt("ballot-nh-example:c", "MISS — none"), hunt("ballot-nh-example:d", "NOT_ATTEMPTED")],
    },
    links: {
      curatedAt: "2026-09-08",
      note: "fixture links",
      links: {
        "ballot-nh-example:a": { official: null, campaign: { url: "https://a.example", verification: "Fetched.", attemptedAt: "2026-09-08" } },
        "ballot-nh-example:b": { official: { url: "https://b.example", verification: "Fetched.", attemptedAt: "2026-09-08" }, campaign: null },
      },
      hunts: [hunt("ballot-nh-example:e", "MISS — none"), hunt("ballot-nh-example:f", "MISS — none")],
    },
  };
}

test("candidate-profile hunt observations have unique, order-independent exact member identities", () => {
  const payload = profiles();
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

  assert.ok(forward.length > 0);
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
