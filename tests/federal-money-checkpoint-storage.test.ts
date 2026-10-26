import assert from "node:assert/strict";
import test from "node:test";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { federalMoneyCandidate } from "../lib/federal-money/candidate.ts";
import { storeFederalMoneyCheckpoint } from "../lib/federal-money/checkpoint-storage.ts";
import type { FederalMoneyCheckpoint } from "../lib/federal-money/model.ts";

test("county progress shares immutable saved evidence without changing the decoded candidate", async () => {
  const held = new Map<string, unknown>();
  const parts = new CivicPayloadParts({ existing: async hashes => hashes.filter(hash => held.has(hash)),
    write: async values => { for (const value of values) held.set(value.hash, structuredClone(value.payload)); },
    read: async hashes => hashes.flatMap(hash => held.has(hash) ? [{ hash, payload: structuredClone(held.get(hash)) }] : []) });
  const baseline = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`openfema:WI:2026:county%3A${String(index).padStart(5, "0")}:root`, { loaded: 0, joined: 0, unjoined: 0 }]));
  const projection: FederalMoneyCheckpoint = { formatVersion: 2, source: "openfema", state: "WI", counts: { loaded: 0, joined: 0, unjoined: 0 },
    checkpoint: { complete: false, cursor: null, lastCompleteAt: null, refreshStartedAt: "2026-10-26T06:00:00.000Z",
      pending: { page: { captures: [], complete: false, declaredTotal: 100 }, baselines: baseline, priorLocations: [] } } };
  const build = (loaded: number) => {
    const current: FederalMoneyCheckpoint = { ...structuredClone(projection), checkpoint: { ...projection.checkpoint,
      pending: { ...projection.checkpoint.pending!, partitionProgress: { through: `1:county-${loaded}`, delta: { loaded, joined: loaded, unjoined: 0 } } } } };
    const candidate = federalMoneyCandidate({ projection: current, page: { facts: [], captures: [], complete: false, declaredTotal: null }, now: "2026-10-26T06:00:00.000Z" });
    return { ...candidate, civicRecords: [{ key: "federal-money-checkpoint", record: { ...current.checkpoint, counts: current.counts } }] };
  };
  const candidate = build(1), encoded = await storeFederalMoneyCheckpoint(candidate, parts);
  assert.equal(held.size, 3);
  assert.ok(Buffer.byteLength(JSON.stringify(encoded)) < Buffer.byteLength(JSON.stringify(candidate)) / 2);
  assert.deepEqual(await parts.load(encoded), candidate);
  const next = build(2), encodedNext = await storeFederalMoneyCheckpoint(next, parts);
  assert.equal(held.size, 3, "a new county cursor reuses the same saved page, baselines and locations");
  assert.equal(canonicalCivicDataJson(await parts.load(encodedNext)), canonicalCivicDataJson(next));
});
