import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import { sourceAuthority } from "./source-authority.ts";
import type { CandidateVersionRecord, RoutineCandidate, SourceAuthorityContract } from "./types.ts";
import { PostgresRoutineDataStore, type PublishedCandidateMetadata } from "./store.ts";
import { readPublishedArraySlice } from "./published-array-slice.ts";
import { derivedRequestedUrl } from "./derived-request.ts";
export { derivedRequestedUrl } from "./derived-request.ts";

/**
 * A derived candidate has no route of its own; it is authentic only as its exact inputs. Pure check: every input is
 * well formed, and the raw hash and retrieval time equal `derivedRetrieval` of them. At the door: every named version
 * exists and holds the hashed read model, and every member read is on the host its wiring row attests.
 */
export const DERIVED_WIRING_RECORD_CLASS = "CURATED_READER_RECORD" as const;
export const DERIVED_WIRING_SCOPE = "US:meeting-source-wiring" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const VAULT_HASH = /^sha256-[a-f0-9]{64}$/;
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** A URL's host when it is a credential-free https URL, lower-cased; null otherwise. */
export function httpsHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Why one input is not well formed, or null. */
export function derivedInputIssue(input: DerivedInputRef): string | null {
  switch (input.kind) {
    case "PROMOTED_VERSION":
      return text(input.recordClass) && text(input.scope) && text(input.versionId) && SHA256.test(input.readModelSha256) && instant(input.promotedAt)
        ? null
        : `a promoted-version input lacks its class, scope, version, read-model sha256 or promotion time`;
    case "VAULTED_EVIDENCE":
      return text(input.artifactId) && VAULT_HASH.test(input.contentHash) && (input.tier === "RAW" || input.tier === "SANITIZED_DERIVED") && instant(input.retrievedAt)
        ? null
        : `a vaulted-evidence input lacks its artifact, content hash, tier or retrieval time`;
    case "DISCOVERY_ATTEMPT":
      return text(input.attemptId) && text(input.recordId) && instant(input.recordedAt) ? null : `a discovery-attempt input lacks its ids or time`;
    case "COMMITTED_ROUTE_HINT":
      return text(input.fingerprint) ? null : `a route-hint input has no fingerprint`;
    case "CROSSWALK_VERSION":
      return text(input.versionId) ? null : `a crosswalk input has no version`;
    case "PIPELINE_APPROVAL":
      return text(input.itemId) && text(input.recordId) && instant(input.approvedAt) ? null : `a pipeline-approval input lacks its item, record or approval time`;
    case "MEMBER_ACQUISITION":
      return text(input.memberKey) && httpsHost(input.requestedUrl) !== null && httpsHost(input.finalUrl) !== null &&
          Number.isInteger(input.httpStatus) && input.httpStatus >= 200 && input.httpStatus < 300 &&
          SHA256.test(input.rawHash) && instant(input.retrievedAt)
        ? null
        : `a member read lacks its member, https URLs, a 2xx status, its sha256 or its time`;
    case "DOOR_RECORD":
      return text(input.doorId) && Number.isInteger(input.revision) && input.revision > 0 && instant(input.updatedAt) && SHA256.test(input.recordSha256)
        ? null
        : `a door-record input lacks its door, revision, write time or sha256`;
    default:
      return `an input of unknown kind`;
  }
}

export type DerivedAuthority =
  | { readonly ok: true; readonly contract: SourceAuthorityContract }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/**
 * **(1), pure.** Whether a candidate is authentic as its named inputs under its DERIVED authority. The validator's
 * SOURCE_AUTHENTICITY uses this in place of a final-URL authority for any candidate carrying `retrieval.derived`.
 */
export function derivedAuthorityFor(candidate: RoutineCandidate): DerivedAuthority {
  const authority = sourceAuthority(candidate.sourceId);
  if (authority === null) return { ok: false, code: "SOURCE_NOT_REGISTERED", detail: `${candidate.sourceId} is not a registered authority.` };
  const policy = authority.derivedPromotion;
  if (policy === undefined) {
    return { ok: false, code: "SOURCE_NOT_DERIVED", detail: `${candidate.sourceId} has routes of its own; a derived retrieval cannot authorize it.` };
  }
  if (!authority.recordClasses.includes(candidate.recordClass)) {
    return { ok: false, code: "SOURCE_NOT_COMPETENT_FOR_RECORD_CLASS", detail: `${candidate.sourceId} is not competent for ${candidate.recordClass}.` };
  }
  const inputs = candidate.retrieval.derived?.inputs ?? [];
  if (inputs.length === 0) return { ok: false, code: "DERIVED_INPUTS_MISSING", detail: "A derived candidate names the inputs it was computed from." };
  const stray = inputs.find((input) => !policy.inputKinds.includes(input.kind));
  if (stray !== undefined) return { ok: false, code: "DERIVED_INPUT_KIND_NOT_AUTHORIZED", detail: `${candidate.sourceId} takes no ${stray.kind} input.` };
  for (const input of inputs) {
    const issue = derivedInputIssue(input);
    if (issue !== null) return { ok: false, code: "DERIVED_INPUT_MALFORMED", detail: issue };
  }
  if (candidate.retrieval.finalUrl !== null || candidate.retrieval.requestedUrl !== derivedRequestedUrl(candidate.sourceId, candidate.scope)) {
    return { ok: false, code: "DERIVED_REQUEST_MISMATCH", detail: `A derived candidate requests ${derivedRequestedUrl(candidate.sourceId, candidate.scope)} and has no final URL.` };
  }
  const recomputed = derivedRetrieval(inputs);
  if (candidate.retrieval.rawHash !== recomputed.rawHash) {
    return { ok: false, code: "DERIVED_RAW_HASH_MISMATCH", detail: "The raw hash is not the canonical hash of the named inputs." };
  }
  if (recomputed.retrievedAt === null || candidate.retrieval.retrievedAt !== recomputed.retrievedAt) {
    return { ok: false, code: "DERIVED_RETRIEVAL_TIME_MISMATCH", detail: `The version claims ${candidate.retrieval.retrievedAt}; its newest input is ${recomputed.retrievedAt ?? "untimed"}.` };
  }
  return { ok: true, contract: authority };
}

export interface DerivedDoorStore {
  readCandidate(candidateId: string): Promise<CandidateVersionRecord | null>;
  readPublishedCandidateMetadata?(candidateId: string): Promise<PublishedCandidateMetadata | null>;
}

const readModelSha256 = (record: CandidateVersionRecord): string =>
  createHash("sha256").update(canonicalCivicDataJson(record.candidate.readModel)).digest("hex");

interface WiringRowForDoor {
  readonly key: string;
  readonly status: string;
  readonly officialHost: string;
  readonly route: string;
}

function wiringRows(readModel: unknown): readonly WiringRowForDoor[] | null {
  const records = (readModel as { kind?: unknown; records?: unknown } | null);
  if (records?.kind !== "meeting-source-wiring" || !Array.isArray(records.records)) return null;
  return records.records.flatMap((entry): WiringRowForDoor[] => {
    const e = entry as { id?: unknown; status?: unknown; row?: { officialHost?: unknown; route?: unknown } } | null;
    return e && text(e.id) && text(e.status) && text(e.row?.officialHost) && text(e.row?.route)
      ? [{ key: e.id, status: e.status, officialHost: e.row.officialHost.toLowerCase(), route: e.row.route }]
      : [];
  });
}

const bare = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/**
 * **(2), the door.** Why a derived candidate's inputs are not what they claim, or null. Run in the promotion door
 * with the store before validation; an issue refuses the candidate by name.
 */
export async function derivedInputAuthorityIssue(store: DerivedDoorStore, candidate: RoutineCandidate): Promise<string | null> {
  const inputs = candidate.retrieval.derived?.inputs ?? [];
  const members = inputs.filter((input): input is Extract<DerivedInputRef, { kind: "MEMBER_ACQUISITION" }> => input.kind === "MEMBER_ACQUISITION");
  const promoted = new Map<string, unknown>();
  for (const input of inputs) {
    if (input.kind !== "PROMOTED_VERSION") continue;
    // Published metadata carries the immutable read-model hash. Only a member acquisition
    // needs the wiring rows themselves to attest the member's host.
    const needsWiringRows = members.length > 0 && input.recordClass === DERIVED_WIRING_RECORD_CLASS &&
      (input.scope === DERIVED_WIRING_SCOPE || /^US-[A-Z]{2}:meeting-source-wiring$/.test(input.scope));
    const metadataOnly = typeof store.readPublishedCandidateMetadata === "function";
    const record = metadataOnly ? await store.readPublishedCandidateMetadata!(input.versionId) : await store.readCandidate(input.versionId);
    if (record === null) return `DERIVED_INPUT_NOT_DURABLE: ${input.versionId} is not a stored version`;
    if (record.candidate.recordClass !== input.recordClass || record.candidate.scope !== input.scope) {
      return `DERIVED_INPUT_IDENTITY_MISMATCH: ${input.versionId} is ${record.candidate.recordClass}:${record.candidate.scope}`;
    }
    if (record.state !== "PROMOTED") return `DERIVED_INPUT_NOT_PROMOTED: ${input.versionId} is ${record.state}`;
    const hash = metadataOnly ? record.candidate.normalization.normalizedHash : readModelSha256(record as CandidateVersionRecord);
    if (hash !== input.readModelSha256) return `DERIVED_INPUT_READ_MODEL_MISMATCH: ${input.versionId}`;
    if (needsWiringRows) {
      if (input.scope === DERIVED_WIRING_SCOPE && store instanceof PostgresRoutineDataStore) {
        const state = /(?:^|:)US-([A-Z]{2})(?=:|$)/.exec(candidate.scope)?.[1];
        if (!state) return "DERIVED_MEMBER_STATE_REQUIRED: a member reads one state's wiring";
        const slice = await readPublishedArraySlice({ recordClass: DERIVED_WIRING_RECORD_CLASS, scope: input.scope,
          path: ["records"], statePath: ["row", "state"], statePattern: `^US-${state}$` });
        if (!slice || slice.input.versionId !== input.versionId || slice.input.readModelSha256 !== input.readModelSha256)
          return `DERIVED_INPUT_READ_MODEL_MISMATCH: ${input.versionId}`;
        promoted.set(input.versionId, { kind: "meeting-source-wiring", records: slice.records });
      } else {
        const full = metadataOnly ? await store.readCandidate(input.versionId) : record as CandidateVersionRecord;
        if (!full || readModelSha256(full) !== input.readModelSha256) return `DERIVED_INPUT_READ_MODEL_MISMATCH: ${input.versionId}`;
        promoted.set(input.versionId, full.candidate.readModel);
      }
    }
  }
  if (members.length === 0) return null;
  const wiring = [...promoted.values()];
  if (wiring.length !== 1) return "DERIVED_MEMBERS_WITHOUT_ONE_WIRING_VERSION: a member read is authorized only by exactly one named wiring version";
  const rows = wiringRows(wiring[0]);
  if (rows === null) return "DERIVED_WIRING_UNREADABLE: the named wiring version has no rows";
  for (const member of members) {
    const row = rows.find((r) => r.key === member.memberKey);
    if (row === undefined || row.status !== "ACTIVE") return `DERIVED_MEMBER_NOT_ACTIVE: ${member.memberKey} is not an active row of the named wiring version`;
    for (const url of [member.requestedUrl, member.finalUrl]) {
      const host = httpsHost(url);
      if (host === null || bare(host) !== bare(row.officialHost)) return `DERIVED_MEMBER_HOST_NOT_ATTESTED: ${url} is not on ${row.officialHost}`;
    }
  }
  return null;
}
