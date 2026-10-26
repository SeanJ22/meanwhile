import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import type { RoutineCandidate } from "./types.ts";
import { confirmSourceHashUnchanged } from "./source-hash.ts";

/** The source identity and content of an input, independent of when it was checked. */
export function derivedSourceInputContent(input: DerivedInputRef): unknown {
  switch (input.kind) {
    case "PROMOTED_VERSION": return [input.kind, input.recordClass, input.scope, input.versionId, input.readModelSha256];
    case "VAULTED_EVIDENCE": return [input.kind, input.artifactId, input.contentHash, input.tier];
    case "DISCOVERY_ATTEMPT": return [input.kind, input.attemptId, input.recordId, input.revision ?? null, input.workItemRevision ?? null];
    case "PIPELINE_APPROVAL": return [input.kind, input.itemId, input.recordId];
    case "MEMBER_ACQUISITION": return [input.kind, input.memberKey, input.requestedUrl, input.finalUrl, input.httpStatus, input.rawHash, input.horizonDay ?? null];
    case "DOOR_RECORD": return [input.kind, input.doorId, input.revision, input.recordSha256];
    case "COMMITTED_ROUTE_HINT": return [input.kind, input.fingerprint];
    case "CROSSWALK_VERSION": return [input.kind, input.versionId];
  }
  return ["UNKNOWN_INPUT"];
}

export function derivedSourceContentHash(inputs: readonly DerivedInputRef[]): string {
  return canonicalCivicDataHash([...new Set(inputs.map(input => canonicalCivicDataJson(derivedSourceInputContent(input))))].sort());
}

/** The previous output preserves facts; it is not a source whose new id means those facts changed. */
export function externalDerivedSourceInputs(inputs: readonly DerivedInputRef[], output: Pick<RoutineCandidate, "recordClass" | "scope">): DerivedInputRef[] {
  const external = inputs.filter(input => input.kind !== "PROMOTED_VERSION" || input.recordClass !== output.recordClass || input.scope !== output.scope);
  return [...new Map(external.map(input => [canonicalCivicDataJson(derivedSourceInputContent(input)), input])).values()]
    .sort((left, right) => canonicalCivicDataJson(derivedSourceInputContent(left)).localeCompare(canonicalCivicDataJson(derivedSourceInputContent(right))));
}

/** Keep the original authority references while committing the independently readable source set. */
export function withDerivedSourceContent(candidate: RoutineCandidate, sourceContentInputs: readonly DerivedInputRef[]): RoutineCandidate {
  if (!candidate.retrieval.succeeded || !candidate.retrieval.derived) return candidate;
  const external = externalDerivedSourceInputs(sourceContentInputs, candidate);
  if (!external.length) return candidate;
  const authority = [...new Map([...candidate.retrieval.derived.inputs, ...external].map(input => [canonicalCivicDataJson(input), input])).values()];
  const rawHash = derivedSourceContentHash(external);
  const retrievedAt = derivedRetrieval(authority).retrievedAt ?? candidate.retrieval.retrievedAt;
  return { ...candidate, id: `cv-${canonicalCivicDataHash([candidate.id, rawHash, candidate.normalization.normalizedPayloadHash]).slice(0, 32)}`,
    retrieval: { ...candidate.retrieval, rawHash, rawHashBasis: "SOURCE_CONTENT_V1", retrievedAt,
      derived: { inputs: authority, sourceContentInputs: external } },
    temporal: { ...candidate.temporal, sourceThrough: retrievedAt } };
}

/** Authority validation checks the source subset as well as every original input. */
export function derivedSourceContentIssue(candidate: RoutineCandidate): string | null {
  const source = candidate.retrieval.derived?.sourceContentInputs;
  if (!Array.isArray(source) || !source.length || source.some(input => !input || typeof input !== "object")) return "The derived source content set is missing.";
  const external = externalDerivedSourceInputs(source, candidate);
  if (external.length !== source.length) return "The derived source content set contains its own prior output or duplicate inputs.";
  const authority = new Set((candidate.retrieval.derived?.inputs ?? []).map(input => canonicalCivicDataJson(derivedSourceInputContent(input))));
  if (source.some(input => !authority.has(canonicalCivicDataJson(derivedSourceInputContent(input))))) return "A derived source content input is absent from its authority inputs.";
  return candidate.retrieval.rawHash === derivedSourceContentHash(source) ? null : "The raw hash is not the canonical hash of the external source content inputs.";
}

export async function confirmDerivedSourceUnchanged(input: Omit<Parameters<typeof confirmSourceHashUnchanged>[0], "rawHash" | "retrieval"> & {
  readonly sourceContentInputs: readonly DerivedInputRef[];
}) {
  const external = externalDerivedSourceInputs(input.sourceContentInputs, input);
  const rawHash = derivedSourceContentHash(external), retrievedAt = derivedRetrieval(external).retrievedAt;
  if (!external.length || !retrievedAt) return null;
  return confirmSourceHashUnchanged({ ...input, rawHash, retrieval: {
    requestedUrl: `derived:${input.sourceId}:${input.scope}`, finalUrl: null, httpStatus: null, rawHash, retrievedAt,
  } });
}
