import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { processRegisteredFanOutCandidate } from "../civic-data/promotion.ts";
import type { FederalRepartitionRemovalEvidence } from "../civic-data/types.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { federalMoneyCandidate, federalMoneyCounts, mergeFederalMoneyRecords, type FederalMoneyEvidence } from "./candidate.ts";
import { federalMoneyPartitionWithinBounds, federalMoneyPartitionOf, federalMoneyLookupKeys, federalMoneyPartitionScope, type FederalMoneyFact, type FederalMoneyPage, type FederalMoneyPartition, type FederalMoneyProjection, type FederalMoneyCounts, type FederalMoneySource, type FederalMoneyCapture } from "./model.ts";

export interface FederalMoneyPartitionChange {
  readonly projection: FederalMoneyProjection;
  readonly previous: FederalMoneyProjection | null;
  readonly versionId: string;
  readonly checkedAt: string;
}
export function addFederalMoneyCounts(a: FederalMoneyCounts, b: FederalMoneyCounts, sign = 1): FederalMoneyCounts {
  return { loaded: a.loaded + sign * b.loaded, joined: a.joined + sign * b.joined, unjoined: a.unjoined + sign * b.unjoined };
}
function stableRows(projection: FederalMoneyProjection) {
  return canonicalCivicDataJson({ ...projection, records: projection.records.map(row => {
    const { retrievedAt: _retrieved, rawHash: _rawHash, ...provenance } = row.provenance;
    return { ...row, provenance };
  }) });
}
export async function writeFederalMoneyPartitions(input: {
  readonly source: FederalMoneySource; readonly state: string; readonly page: FederalMoneyPage;
  readonly store: RoutineDataStore; readonly now: string;
  readonly onPartition?: (input: FederalMoneyPartitionChange) => Promise<unknown>;
  readonly baselines: Readonly<Record<string, FederalMoneyCounts>>;
  readonly priorLocations?: readonly { id: string; partition: FederalMoneyPartition }[];
}): Promise<FederalMoneyCounts> {
  const groups = new Map<string, { partition: FederalMoneyPartition; records: FederalMoneyFact[]; remove: string[] }>();
  for (const fact of input.page.facts) {
    const partition = federalMoneyPartitionOf(fact), scope = federalMoneyPartitionScope(input.source, input.state, partition);
    const group = groups.get(scope) ?? { partition, records: [], remove: [] };
    group.records.push(fact); groups.set(scope, group);
  }
  for (const held of input.priorLocations ?? []) {
    const incoming = input.page.facts.find(row => row.id === held.id);
    if (!incoming) continue;
    const partition = { ...held.partition, shard: "" };
    const scope = federalMoneyPartitionScope(input.source, input.state, partition);
    if (scope === federalMoneyPartitionScope(input.source, input.state, federalMoneyPartitionOf(incoming))) continue;
    const group = groups.get(scope) ?? { partition, records: [], remove: [] };
    group.remove.push(held.id); groups.set(scope, group);
  }
  const totals = new Map<string, FederalMoneyCounts>();
  for (const [scope, { partition, records }] of groups) if (records.length) {
    totals.set(scope, await update(partition, records, input.page.captures));
  }
  // Every corrected destination must exist before a cycle removes its original rows.
  for (const [scope, { partition, remove }] of groups) if (remove.length) {
    totals.set(scope, await update(partition, [], [], remove));
  }
  let delta = federalMoneyCounts([]);
  for (const [scope, total] of totals) {
    delta = addFederalMoneyCounts(delta, addFederalMoneyCounts(total, input.baselines[scope] ?? federalMoneyCounts([]), -1));
  }
  return delta;

  async function update(partition: FederalMoneyPartition, incoming: readonly FederalMoneyFact[], captures: readonly FederalMoneyCapture[], remove: readonly string[] = []): Promise<FederalMoneyCounts> {
    const scope = federalMoneyPartitionScope(input.source, input.state, partition);
    const prior = await input.store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope);
    const previous = prior?.payload ?? null;
    if (previous?.children?.length) {
      const byChild = new Map<string, FederalMoneyFact[]>();
      for (const fact of incoming) {
        const shard = sha256(fact.id).slice(0, partition.shard.length + 1);
        const list = byChild.get(shard) ?? []; list.push(fact); byChild.set(shard, list);
      }
      const removed = new Map<string, string[]>();
      for (const id of remove) {
        const shard = sha256(id).slice(0, partition.shard.length + 1);
        const list = removed.get(shard) ?? []; list.push(id); removed.set(shard, list);
        if (!byChild.has(shard)) byChild.set(shard, []);
      }
      const childCounts = { ...previous.childCounts };
      for (const [shard, rows] of byChild) childCounts[shard] = await update({ ...partition, shard }, rows, captures, removed.get(shard));
      const subtreeCounts = Object.values(childCounts).reduce((a, b) => addFederalMoneyCounts(a, b), federalMoneyCounts([]));
      const next = { ...previous, children: Object.keys(childCounts).sort(), subtreeCounts, childCounts };
      await publish(next, [], [], prior?.versionId ?? null, previous);
      return subtreeCounts;
    }
    const records = mergeFederalMoneyRecords((previous?.records ?? []).filter(row => !remove.includes(row.id)), incoming);
    const counts = federalMoneyCounts(records);
    const priorCandidate = prior ? await input.store.readCandidate(prior.versionId) : null;
    const retained = (priorCandidate?.candidate.normalizedPayload as FederalMoneyEvidence | undefined)?.captures ?? [];
    if (!federalMoneyPartitionWithinBounds(records)) {
      if (partition.shard.length >= 64) throw new Error("Federal native identifiers exceed a full hash partition.");
      const byChild = new Map<string, FederalMoneyFact[]>();
      for (const fact of records) {
        const shard = sha256(fact.id).slice(0, partition.shard.length + 1);
        const list = byChild.get(shard) ?? []; list.push(fact); byChild.set(shard, list);
      }
      const childCounts: Record<string, FederalMoneyCounts> = {};
      for (const [shard, rows] of byChild) childCounts[shard] = await update({ ...partition, shard }, rows, [...retained, ...captures]);
      await publish({ formatVersion: 2, source: input.source, state: input.state, partition, records: [], lookupKeys: [], counts: federalMoneyCounts([]),
        children: [...byChild.keys()].sort(), subtreeCounts: counts, childCounts }, [], [], prior?.versionId ?? null, previous);
    } else {
      await publish({ formatVersion: 2, source: input.source, state: input.state, partition, records, counts, lookupKeys: federalMoneyLookupKeys(records) }, incoming, [...retained, ...captures], prior?.versionId ?? null, previous);
    }
    return counts;
  }
  async function publish(projection: FederalMoneyProjection, incoming: readonly FederalMoneyFact[], captures: readonly FederalMoneyCapture[], version: string | null, previous: FederalMoneyProjection | null) {
    if (previous && stableRows(previous) === stableRows(projection)) {
      if (input.onPartition) {
        const held = await input.store.readCandidate(version!);
        const predecessorId = (held?.candidate.normalizedPayload as FederalMoneyEvidence | undefined)?.predecessorVersionId;
        const predecessor = predecessorId ? await input.store.readCandidate(predecessorId) : null;
        await input.onPartition({ projection: previous, previous: predecessor?.candidate.readModel as FederalMoneyProjection ?? null, versionId: version!, checkedAt: input.now });
      }
      return;
    }
    const built = federalMoneyCandidate({ projection, page: { ...input.page, facts: incoming, captures }, now: input.now, predecessorVersionId: version });
    const removalEvidence: FederalRepartitionRemovalEvidence[] = [];
    const retainedIds = new Set(projection.records.map(row => row.id));
    const destinations = new Map<string, { partition: FederalMoneyPartition; rows: FederalMoneyFact[] }>();
    for (const row of previous?.records ?? []) {
      if (retainedIds.has(row.id)) continue;
      const incoming = input.page.facts.find(fact => fact.id === row.id) ?? row;
      const partition = projection.children?.length ? { ...projection.partition, shard: sha256(row.id).slice(0, projection.partition.shard.length + 1) } : federalMoneyPartitionOf(incoming);
      const scope = federalMoneyPartitionScope(input.source, input.state, partition);
      const group = destinations.get(scope) ?? { partition, rows: [] };
      group.rows.push(row); destinations.set(scope, group);
    }
    async function proveDestination(partition: FederalMoneyPartition, rows: readonly FederalMoneyFact[]): Promise<void> {
      const scope = federalMoneyPartitionScope(input.source, input.state, partition);
      if (scope === built.scope) throw new Error("Federal record removal has no destination partition.");
      const target = await input.store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope);
      if (!target) throw new Error("Federal repartition destination has not published.");
      if (!target.payload.children?.length) {
        const ids = new Set(target.payload.records.map(fact => fact.id));
        for (const row of rows) {
          if (!ids.has(row.id)) throw new Error("Federal repartition destination does not contain the moved record.");
          removalEvidence.push({ key: `federal-money:${row.id}`, code: "FEDERAL_RECORD_REPARTITIONED", targetScope: scope, targetVersionId: target.versionId });
        }
        return;
      }
      const children = new Map<string, FederalMoneyFact[]>();
      for (const row of rows) {
        const shard = sha256(row.id).slice(0, partition.shard.length + 1);
        const values = children.get(shard) ?? []; values.push(row); children.set(shard, values);
      }
      for (const [shard, facts] of children) await proveDestination({ ...partition, shard }, facts);
    }
    for (const { partition, rows } of destinations.values()) await proveDestination(partition, rows);
    const candidate = { ...built, ...(removalEvidence.length ? { removalEvidence } : {}) };
    const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, input.now, version);
    if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? `Federal partition ${candidate.scope} did not publish.`);
    await input.onPartition?.({ projection, previous, versionId: outcome.promoted.versionId, checkedAt: input.now });
  }
}

export async function federalMoneyPartitionBaselines(store: RoutineDataStore, source: FederalMoneySource, state: string, facts: readonly FederalMoneyFact[], locations: readonly { partition: FederalMoneyPartition }[] = []): Promise<Readonly<Record<string, FederalMoneyCounts>>> {
  const result: Record<string, FederalMoneyCounts> = {};
  for (const partition of [...facts.map(federalMoneyPartitionOf), ...locations.map(row => ({ ...row.partition, shard: "" }))]) {
    const scope = federalMoneyPartitionScope(source, state, partition);
    if (result[scope]) continue;
    const prior = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope);
    result[scope] = prior?.payload.subtreeCounts ?? prior?.payload.counts ?? federalMoneyCounts([]);
  }
  return result;
}
