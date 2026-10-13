import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { sha256 } from "../civic-data/candidate-builders.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import type { FederalMoneyCapture, FederalMoneyFact, FederalMoneyProjection, FederalMoneySource } from "./model.ts";
import { parseFederalMoney } from "./parse.ts";
import { FEDERAL_MONEY_CONFIG } from "./sources.ts";

const nativeFact = (fact: FederalMoneyFact) => {
  const { bodyIds: _bodies, divisionIds: _divisions, joinStatus: _status, joinReason: _reason, ...native } = fact;
  return native;
};
/** Reparse saved provider bytes; a source label alone never verifies a fact. */
export function federalMoneySavedSourceIssue(candidate: RoutineCandidate, source: FederalMoneySource, predecessor: RoutineCandidate | null = null): string | null {
  const projection = candidate.readModel as FederalMoneyProjection;
  if (projection.state === "US") return null;
  const payload = candidate.normalizedPayload as { captures?: FederalMoneyCapture[]; incomingIds?: string[]; readModelHash?: string; predecessorVersionId?: string | null };
  if (!Array.isArray(payload?.captures) || !Array.isArray(payload.incomingIds)) return "The federal source captures are missing.";
  if (payload.readModelHash !== sha256(canonicalCivicDataJson(projection))) return "The saved-source envelope does not bind the federal projection.";
  if (payload.captures.some(capture => typeof capture.body !== "string" || typeof capture.url !== "string" ||
    !Number.isFinite(Date.parse(capture.retrievedAt)) || !new URL(capture.url).hostname.endsWith(".gov"))) return "A federal capture is not a saved official source response.";
  const read = payload.captures.flatMap(capture => parseFederalMoney(source, capture, projection.state));
  if (canonicalCivicDataJson(read.map(row => row.id)) !== canonicalCivicDataJson(payload.incomingIds)) return "The saved-source rows do not equal the incoming federal row inventory.";
  const published = new Map(projection.records.map(row => [row.id, row]));
  for (const fact of read) {
    const held = published.get(fact.id);
    if (!held || canonicalCivicDataJson(nativeFact(held)) !== canonicalCivicDataJson(nativeFact(fact))) return "A federal fact differs from its saved official source row.";
  }
  const incoming = new Set(read.map(row => row.id));
  const retained = projection.records.filter(row => !incoming.has(row.id));
  if (retained.length) {
    if (!predecessor || predecessor.id !== payload.predecessorVersionId || predecessor.sourceId !== source || predecessor.scope !== candidate.scope) return "Retained federal facts have no exact predecessor evidence.";
    const previous = new Map((predecessor.readModel as FederalMoneyProjection).records.map(row => [row.id, row]));
    if (retained.some(fact => !previous.has(fact.id) || canonicalCivicDataJson(nativeFact(previous.get(fact.id)!)) !== canonicalCivicDataJson(nativeFact(fact)))) return "A retained federal fact differs from its verified predecessor.";
  }
  if (!candidate.retrieval.requestedUrl.startsWith(FEDERAL_MONEY_CONFIG[source].route) && payload.captures.length === 0) return "The federal snapshot has no source route.";
  return null;
}
