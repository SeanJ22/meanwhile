import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { FederalRollCallsReadModel } from "../votes/data-plane.ts";

const SCOPE = "US:recent-federal-rollcalls", SOURCE = "federal-legislative-records";
interface RollPriorProof {
  readonly projection: PromotedProjection; readonly versionId: string;
  readonly readModelHash: string; readonly normalizedPayloadHash: string; readonly viewHash: string;
}
const proofs = new WeakMap<RoutineCandidate, RollPriorProof>();

/** This is a semantic publication view, never a partial canonical hash. The
 * original candidate hashes remain attached to its SQL-verified GOOD version. */
export function federalRollPublicationPriorProof(candidate: RoutineCandidate, projection: PromotedProjection): RollPriorProof | undefined {
  const proof = proofs.get(candidate);
  if (!proof) return undefined;
  if (projection !== proof.projection || candidate.id !== proof.versionId || candidate.recordClass !== "FEDERAL_ROLL_CALL" ||
      candidate.scope !== SCOPE || candidate.sourceId !== SOURCE || canonicalCivicDataHash(candidate.readModel) !== proof.viewHash)
    throw new Error("FEDERAL_ROLL_PUBLICATION_PRIOR_CHANGED");
  return proof;
}

export async function readFederalRollCallPublicationBase(store: Pick<RoutineDataStore, "readPublishedCandidateMetadata">, query: ReadOnlyQuery | null):
Promise<{ readonly current: PromotedProjection | null; readonly lkg: CandidateVersionRecord | null }> {
  if (!query) throw new Error("FEDERAL_ROLL_PUBLICATION_READER_NOT_CONFIGURED");
  const { readPublishedArraySlice } = await import("./published-array-slice.ts");
  const { immutableStateValue } = await import("./state-publication.ts");
  const identity = await readPublishedArraySlice<{ formatVersion: 1 }>({ recordClass: "FEDERAL_ROLL_CALL", scope: SCOPE,
    path: [], statePath: [], statePattern: ".*", objectRecord: true, keepKeys: ["formatVersion"], query });
  if (!identity) return { current: null, lkg: null };
  const formatVersion = identity.records[0]?.formatVersion;
  if (formatVersion !== 1) throw new Error("FEDERAL_ROLL_PUBLICATION_SOURCE_SHAPE:formatVersion");
  const object = async <T>(path: readonly string[], omitKeys: readonly string[] = []): Promise<T> => {
    const read = await readPublishedArraySlice<T>({ recordClass: "FEDERAL_ROLL_CALL", scope: SCOPE,
      path, statePath: [], statePattern: ".*", objectRecord: true, omitKeys, query });
    if (!read || read.input.versionId !== identity.input.versionId || read.input.readModelSha256 !== identity.input.readModelSha256)
      throw new Error("FEDERAL_ROLL_PUBLICATION_SOURCE_MOVED");
    if (!read.records[0]) throw new Error(`FEDERAL_ROLL_PUBLICATION_SOURCE_SHAPE:${path.join(".")}`);
    return read.records[0];
  };
  const header = await object<Omit<FederalRollCallsReadModel["snapshot"], "votes">>(["snapshot"], ["positions", "votes"]);
  const voteRead = await readPublishedArraySlice<FederalRollCallsReadModel["snapshot"]["votes"][number]>({ recordClass: "FEDERAL_ROLL_CALL", scope: SCOPE,
    path: ["snapshot", "votes"], statePath: [], statePattern: ".*", query });
  if (!voteRead || voteRead.input.versionId !== identity.input.versionId || voteRead.input.readModelSha256 !== identity.input.readModelSha256)
    throw new Error("FEDERAL_ROLL_PUBLICATION_SOURCE_MOVED");
  const view: FederalRollCallsReadModel = immutableStateValue({ formatVersion,
    snapshot: { ...header, votes: [...voteRead.records] }, partyBreakdowns: await object(["partyBreakdowns"]), billSummaries: await object(["billSummaries"]) });
  const metadata = await store.readPublishedCandidateMetadata(identity.input.versionId);
  if (!metadata || metadata.candidate.id !== identity.input.versionId || metadata.candidate.recordClass !== "FEDERAL_ROLL_CALL" ||
      metadata.candidate.scope !== SCOPE || metadata.candidate.sourceId !== SOURCE ||
      metadata.candidate.normalization.normalizedHash !== identity.input.readModelSha256 || !metadata.receipt ||
      canonicalCivicDataHash(Object.fromEntries(Object.entries(metadata.receipt).filter(([key]) => key !== "excludedFacts"))) !== canonicalCivicDataHash(identity.receipt))
    throw new Error("FEDERAL_ROLL_PUBLICATION_METADATA_MISMATCH");
  const normalizedPayloadHash = metadata.candidate.normalization.normalizedPayloadHash;
  if (typeof normalizedPayloadHash !== "string" || !/^[a-f0-9]{64}$/.test(normalizedPayloadHash))
    throw new Error("FEDERAL_ROLL_PUBLICATION_EVIDENCE_HASH_MISSING");
  const held = metadata.candidate, normalization = held.normalization;
  if (typeof normalization.parserVersion !== "string" || typeof normalization.schemaVersion !== "string" ||
      typeof normalization.inputRecords !== "number" || typeof normalization.outputRecords !== "number" ||
      typeof normalization.droppedRecords !== "number" || !Array.isArray(normalization.missingRequiredFields) ||
      !held.semantics || !held.horizon || !held.absence || !held.sourceProjectionEvidence || !Array.isArray(held.dependentChecks))
    throw new Error("FEDERAL_ROLL_PUBLICATION_METADATA_SHAPE");
  const candidate: RoutineCandidate = immutableStateValue({ ...held, readModel: view, normalizedPayload: null, identities: [],
    normalization: { ...normalization, parserVersion: normalization.parserVersion, schemaVersion: normalization.schemaVersion,
      inputRecords: normalization.inputRecords, outputRecords: normalization.outputRecords, droppedRecords: normalization.droppedRecords,
      missingRequiredFields: normalization.missingRequiredFields },
    semantics: held.semantics, horizon: held.horizon, absence: held.absence, sourceProjectionEvidence: held.sourceProjectionEvidence,
    excludedFacts: metadata.receipt.excludedFacts, civicRecords: [], dependentChecks: held.dependentChecks });
  const current: PromotedProjection = { key: `FEDERAL_ROLL_CALL:${SCOPE}`, recordClass: "FEDERAL_ROLL_CALL", scope: SCOPE,
    sourceId: SOURCE, versionId: identity.input.versionId, lastKnownGoodVersionId: identity.input.versionId,
    promotedAt: identity.input.promotedAt, receipt: metadata.receipt, payload: view };
  proofs.set(candidate, { projection: current, versionId: candidate.id, readModelHash: identity.input.readModelSha256,
    normalizedPayloadHash, viewHash: canonicalCivicDataHash(view) });
  return { current, lkg: { ...metadata, candidate } };
}
