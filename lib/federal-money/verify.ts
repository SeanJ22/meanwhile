import { AsyncLocalStorage } from "node:async_hooks";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { federalMoneySourceStates } from "./sources.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { sha256 } from "../civic-data/candidate-builders.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import { federalMoneyProjectionIssue, FEDERAL_MONEY_RECORD_CLASS, federalMoneyPartitionWithinBounds, type FederalMoneyCheckpoint, type FederalMoneyCapture, type FederalMoneyFact, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import type { FederalMoneyEvidence, FederalMoneyNationalProjection } from "./candidate.ts";
import { parseFederalMoney } from "./parse.ts";
import { readFederalMoneyCapture } from "./vault.ts";

const verificationCaptures = new AsyncLocalStorage<Map<string, Promise<FederalMoneyFact[]>>>();
export function withFederalMoneyVerificationCache<T>(work: () => Promise<T>): Promise<T> {
  const cache = new Map<string, Promise<FederalMoneyFact[]>>();
  return verificationCaptures.run(cache, async () => {
    try { return await work(); }
    finally { cache.clear(); }
  });
}
function verifiedCapture(source: FederalMoneySource, state: string, capture: FederalMoneyCapture): Promise<FederalMoneyFact[]> {
  const cache = verificationCaptures.getStore();
  const key = JSON.stringify([source, state, capture]);
  const held = cache?.get(key);
  if (held) return held;
  const parsed = readFederalMoneyCapture(capture).then(body => parseFederalMoney(source, capture, state, body));
  if (cache) {
    if (cache.size >= 2) cache.delete(cache.keys().next().value!);
    cache.set(key, parsed);
  }
  return parsed;
}

const nativeFact = (fact: FederalMoneyFact) => {
  const { bodyIds: _bodies, divisionIds: _divisions, joinStatus: _status, joinReason: _reason, ...native } = fact;
  return native;
};
export async function federalMoneySavedSourceIssue(candidate: RoutineCandidate, source: FederalMoneySource, predecessor: RoutineCandidate | null = null, store?: RoutineDataStore): Promise<string | null> {
  const projection = candidate.readModel as FederalMoneyProjection;
  const payload = candidate.normalizedPayload as FederalMoneyEvidence;
  if (payload?.readModelHash !== sha256(canonicalCivicDataJson(projection))) return "The saved-source envelope does not bind the federal projection.";
  if (!("partition" in projection)) return null;
  if (!federalMoneyPartitionWithinBounds(projection.records)) return "Federal partition exceeds its bounded row or byte inventory.";
  if (!Array.isArray(payload?.captures) || !Array.isArray(payload.incomingIds)) return "The federal source captures are missing.";
  const incoming = new Set(payload.incomingIds);
  const published = new Map(projection.records.map(row => [row.id, row]));
  if (incoming.size !== payload.incomingIds.length || [...incoming].some(id => !published.has(id))) return "The incoming federal row inventory is invalid.";
  const verified = new Set<string>();
  for (const capture of payload.captures) {
    try {
      const url = new URL(capture.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".gov") || !Number.isFinite(Date.parse(capture.retrievedAt))) return "A federal capture is not a saved official source response.";
      if (!projection.records.some(row => incoming.has(row.id) && row.provenance.rawHash === capture.rawHash)) continue;
      const read = await verifiedCapture(source, projection.state, capture);
      for (const fact of read) {
        const held = published.get(fact.id);
        if (!held || !incoming.has(fact.id) || held.provenance.rawHash !== capture.rawHash) continue;
        if (canonicalCivicDataJson(nativeFact(held)) !== canonicalCivicDataJson(nativeFact(fact))) return "A federal fact differs from its saved official source row.";
        verified.add(fact.id);
      }
    } catch (error) { return error instanceof Error ? error.message : "The federal evidence vault could not be read."; }
  }
  if (verified.size !== incoming.size) return "An incoming federal fact has no matching saved official source row.";
  const retained = projection.records.filter(row => !incoming.has(row.id));
  if (retained.length) {
    if (!predecessor || predecessor.id !== payload.predecessorVersionId || predecessor.sourceId !== source || predecessor.scope !== candidate.scope) return "Retained federal facts have no exact predecessor evidence.";
    const previous = new Map((predecessor.readModel as FederalMoneyProjection).records.map(row => [row.id, row]));
    if (retained.some(fact => !previous.has(fact.id) || canonicalCivicDataJson(nativeFact(previous.get(fact.id)!)) !== canonicalCivicDataJson(nativeFact(fact)))) return "A retained federal fact differs from its verified predecessor.";
  }
  if (predecessor) {
    const removed = (predecessor.readModel as FederalMoneyProjection).records.filter(row => !published.has(row.id));
    const relocations = candidate.removalEvidence ?? [];
    if (relocations.length !== removed.length) return "Federal partition removal has no exact destination evidence.";
    const grouped = new Map<string, typeof removed>();
    for (const fact of removed) {
      const proof = relocations.find(row => row.key === `federal-money:${fact.id}`);
      if (!store || !proof || proof.code !== "FEDERAL_RECORD_REPARTITIONED" || proof.targetScope === candidate.scope) return "Federal partition removal has no verified destination.";
      const rows = grouped.get(proof.targetScope) ?? []; rows.push(fact); grouped.set(proof.targetScope, rows);
    }
    for (const [scope, rows] of grouped) {
      const target = await store!.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope);
      if (!target || target.sourceId !== source || target.payload.state !== projection.state) return "Federal repartition destination is not held for this source and state.";
      for (const row of rows) {
        const proof = relocations.find(item => item.key === `federal-money:${row.id}`)!;
        if (proof.code !== "FEDERAL_RECORD_REPARTITIONED" || target.versionId !== proof.targetVersionId || !target.payload.records.some(held => held.id === row.id && held.sourceId === row.sourceId)) return "A moved federal record is missing from its verified destination.";
      }
    }
  }
  return null;
}

export async function readFederalMoneyNationalProjection(source: FederalMoneySource, options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<FederalMoneyNationalProjection>("FEDERAL_MONEY", `${source}:US`, options);
  if (result.kind === "PROMOTED") {
    const value = result.value;
    if (value.formatVersion !== 2 || value.source !== source || value.state !== "US" || !Array.isArray(value.states) ||
      new Set(value.states.map(row => row.state)).size !== value.states.length ||
      value.states.some(row => !federalMoneySourceStates(source).includes(row.state) || !["COMPLETE", "BACKFILL", "OUTAGE"].includes(row.status) ||
        row.counts.loaded !== row.counts.joined + row.counts.unjoined) ||
      value.counts.loaded !== value.states.reduce((n, row) => n + row.counts.loaded, 0) ||
      value.counts.joined !== value.states.reduce((n, row) => n + row.counts.joined, 0) ||
      value.counts.unjoined !== value.states.reduce((n, row) => n + row.counts.unjoined, 0)) throw new Error("Federal national acquisition progress is invalid.");
  }
  return result;
}

export async function readFederalMoneyCheckpoint(source: FederalMoneySource, state: string, options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<FederalMoneyCheckpoint>("FEDERAL_MONEY", `${source}:${state}`, options);
  if (result.kind === "PROMOTED") {
    const value = result.value;
    if (value.formatVersion !== 2 || value.source !== source || value.state !== state || !value.checkpoint ||
      value.counts.loaded !== value.counts.joined + value.counts.unjoined || "records" in value)
      throw new Error("Federal state checkpoint is invalid.");
  }
  return result;
}

export async function readFederalMoneyPartition(source: FederalMoneySource, scope: string, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<FederalMoneyProjection>> {
  const state = scope.split(":")[1];
  const read = await readPromotedCivicData<FederalMoneyProjection>(FEDERAL_MONEY_RECORD_CLASS, scope, options);
  if (read.kind === "PROMOTED") { const issue = federalMoneyProjectionIssue(read.value, source, state); if (issue) throw new Error(issue); }
  return read;
}
