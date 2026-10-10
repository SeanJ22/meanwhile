import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import type { CandidateVersionRecord, RoutineCandidate, SourceCheckEvidence } from "../civic-data/types.ts";
import type { RegistrationSourceReceipt } from "./acquire.ts";
import type { LoadedReference } from "./reference.ts";
import {
  REGISTRATION_HELD_RETRIEVED_AT, REGISTRATION_PARSER_VERSION,
  REGISTRATION_SOURCE_ID, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL,
} from "./publication.ts";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Parser 3 called a conditional provider check an acquisition. Reconcile only
 * its exact GOOD source/reference; this is not permission to replay older facts. */
function legacyEvidence(prior: CandidateVersionRecord | null) {
  if (!prior || prior.state !== "PROMOTED" || !prior.acquisitionSucceeded ||
    prior.promotedVersion !== prior.candidate.id || prior.lastKnownGoodVersion !== prior.candidate.id ||
    prior.receipt?.decision !== "GOOD" || prior.receipt.candidateId !== prior.candidate.id) return null;
  const candidate = prior.candidate;
  const model = object(candidate.readModel), vintage = object(model?.vintage), payload = object(candidate.normalizedPayload);
  if (candidate.sourceId !== REGISTRATION_SOURCE_ID || candidate.recordClass !== "REGISTRATION" ||
    candidate.normalization.parserVersion !== "registration/3" || !candidate.retrieval.succeeded ||
    ![200, 304].includes(candidate.retrieval.httpStatus ?? 0) ||
    candidate.retrieval.requestedUrl !== REGISTRATION_SOURCE_URL || candidate.retrieval.finalUrl !== REGISTRATION_SOURCE_URL ||
    !model || model.governments !== undefined || !Array.isArray(model.divisions) || !Array.isArray(model.bodies) ||
    model.scope !== candidate.scope || vintage?.sourceSha256 !== REGISTRATION_SOURCE_SHA256 ||
    typeof vintage.referenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(vintage.referenceSha256) ||
    payload?.sourceSha256 !== vintage.sourceSha256 || payload.referenceSha256 !== vintage.referenceSha256 ||
    candidate.retrieval.rawHash !== hash(`${vintage.sourceSha256}\n${vintage.referenceSha256}\nnull`)) return null;
  const checkedAt = candidate.retrieval.retrievedAt;
  if (!Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) < Date.parse(REGISTRATION_HELD_RETRIEVED_AT)) return null;
  const sourceCheck: SourceCheckEvidence = {
    requestedUrl: candidate.retrieval.requestedUrl, finalUrl: candidate.retrieval.finalUrl,
    httpStatus: candidate.retrieval.httpStatus as 200 | 304,
    rawHash: REGISTRATION_SOURCE_SHA256, checkedAt,
  };
  return { candidate, model, sourceCheck, referenceSha256: vintage.referenceSha256 };
}

/** Keep the original capture date and retain the later real HTTP check as a
 * check. The immutable predecessor identifies why these dates differ. */
export function reconcileRegistrationHeldReceipt(
  receipt: RegistrationSourceReceipt, reference: LoadedReference, prior: CandidateVersionRecord | null,
): RegistrationSourceReceipt {
  const held = legacyEvidence(prior);
  if (!held || receipt.confirmedBy !== "HELD_RELEASE" || receipt.retrievedAt !== REGISTRATION_HELD_RETRIEVED_AT ||
    receipt.sha256 !== REGISTRATION_SOURCE_SHA256 || reference.sha256 !== held.referenceSha256 ||
    reference.reference.state !== held.model.state) return receipt;
  return { ...receipt, sourceCheck: held.sourceCheck, replayedFromVersionId: held.candidate.id };
}

const INVENTORY_BODY_FIELDS = new Set(["id", "ocdId", "name", "bodyClass", "bodyOrigin", "coverageStatus",
  "agendaSourceType", "agendaSourceRef", "meetingCadence", "homepageUrl", "demandCount", "sourceDataset",
  "censusId", "censusUnitType", "jurisdictionId", "alsoServesOcdIds", "provenance"]);

function inventoryPlaceholder(value: unknown): boolean {
  const body = object(value);
  return body !== null && Object.keys(body).every(key => INVENTORY_BODY_FIELDS.has(key)) && body.demandCount === 0 &&
    object(body.provenance)?.verifiedAt === null && body.name === null && body.homepageUrl === null && body.agendaSourceRef === null &&
    body.meetingCadence === null && body.coverageStatus === "NOT_ATTEMPTED" && body.agendaSourceType === "NONE" &&
    body.bodyClass === "GOVERNING" && ["REGISTERED_FROM_CENSUS_OF_GOVERNMENTS", "REGISTERED_FROM_TIGER_FUNCSTAT", "DERIVED_FROM_DIVISION_TYPE"].includes(String(body.bodyOrigin));
}

/** The only permitted date correction is a parser-3 recheck of the same held
 * archive and state extract. Divisions and valid facts cannot regress, and
 * known native body aliases survive the removal of inferred placeholders. */
export function registrationHeldReplayIsExact(candidate: RoutineCandidate, prior: CandidateVersionRecord | null): boolean {
  const held = legacyEvidence(prior);
  const payload = object(candidate.normalizedPayload), model = object(candidate.readModel), vintage = object(model?.vintage);
  if (!held || candidate.sourceId !== REGISTRATION_SOURCE_ID || candidate.recordClass !== "REGISTRATION" ||
    candidate.normalization.parserVersion !== REGISTRATION_PARSER_VERSION || candidate.scope !== held.candidate.scope ||
    payload?.replayedFromVersionId !== held.candidate.id || payload.sourceSha256 !== REGISTRATION_SOURCE_SHA256 ||
    payload.referenceSha256 !== held.referenceSha256 || vintage?.sourceSha256 !== payload.sourceSha256 ||
    vintage?.referenceSha256 !== payload.referenceSha256 || model?.state !== held.model.state ||
    candidate.temporal.version !== held.candidate.temporal.version || candidate.temporal.sourceThrough !== held.candidate.temporal.sourceThrough ||
    candidate.retrieval.retrievedAt !== REGISTRATION_HELD_RETRIEVED_AT || candidate.retrieval.httpStatus !== 200 ||
    candidate.retrieval.requestedUrl !== REGISTRATION_SOURCE_URL || candidate.retrieval.finalUrl !== REGISTRATION_SOURCE_URL ||
    canonicalCivicDataJson(candidate.retrieval.sourceCheck) !== canonicalCivicDataJson(held.sourceCheck) ||
    !Array.isArray(model?.governments) || !Array.isArray(model.divisions) || !Array.isArray(model.bodies) || model.bodies.length !== 0 ||
    canonicalCivicDataJson(model.divisions) !== canonicalCivicDataJson(held.model.divisions) ||
    !(held.model.bodies as unknown[]).every(inventoryPlaceholder)) return false;
  if (candidate.retrieval.rawHash !== hash(`${REGISTRATION_SOURCE_SHA256}\n${held.referenceSha256}\n${hash(canonicalCivicDataJson(model.governments))}`)) return false;
  return (held.model.bodies as unknown[]).every(value => {
    const body = object(value)!;
    return !body.censusId || (model.governments as unknown[]).some(value => {
      const listing = object(value);
      return object(listing?.nativeIds)?.census_pid6 === body.censusId && Array.isArray(listing?.aliases) && listing.aliases.includes(body.id);
    });
  });
}
