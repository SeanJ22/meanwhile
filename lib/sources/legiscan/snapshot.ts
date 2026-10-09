import type { StateVotesSnapshot } from "./types.ts";
import {
  OFFICIAL_STATE_ROLL_CALL_TARGETS,
  officialStateOfficeholderId,
  officialStateLegislatorTargetByScope,
  officialStateRollCallTargetByScope,
  type OfficialStateVoteScope,
} from "../../state-rollcalls/authority.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../../civic-data/contracts.ts";
import {
  CivicDataStoreUnavailableError,
  mayUseTestFixture,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../../civic-data/read-model.ts";

/**
 * State-legislature roll calls, read once per process. Reader requests never fetch a publisher; only
 * proof-validated promotions from official state publishers enter the runtime cache.
 */

const cacheByScope = new Map<OfficialStateVoteScope, StateVotesSnapshot>();

type PromotedStateVotesRead = Extract<
  CivicDataReadResult<StateVotesSnapshot>,
  { readonly kind: "PROMOTED" }
>;

/**
 * Only a scope something still writes is read: the official state scopes whose registered routine
 * contract promotes a `STATE_ROLL_CALL` projection, derived from `ROUTINE_SOURCE_CONTRACTS`, so a state
 * migrated off the per-jurisdiction pointer leaves this list with its contract.
 */
export const OFFICIAL_STATE_VOTE_SCOPES: readonly OfficialStateVoteScope[] = OFFICIAL_STATE_ROLL_CALL_TARGETS
  .filter((target) => ROUTINE_SOURCE_CONTRACTS.some((contract) =>
    contract.id === target.contractId &&
    contract.recordClass === "STATE_ROLL_CALL" &&
    contract.scope === target.jurisdiction
  ))
  .map(({ jurisdiction }) => jurisdiction);

/**
 * Official state scopes whose `STATE_ROLL_CALL` pointer is retired, by name. The pointer and its versions
 * stay in the store as written; nothing reads them. `tests/vote-source-isolation.test.ts` holds this list
 * equal to the official targets the contracts no longer promote per jurisdiction.
 */
export const RETIRED_STATE_ROLL_CALL_SCOPES: readonly {
  readonly scope: OfficialStateVoteScope;
  readonly movedTo: string;
}[] = [
  { scope: "US-AZ", movedTo: "az-openstates-votes native API facts (STATE_ROLL_CALL US-AZ:openstates-votes:v1)" },
  { scope: "US-NH", movedTo: "nh-state-rollcalls per-legislator fan-out (STATE_LEGISLATOR_VOTES)" },
];

export function isRetiredStateRollCallScope(scope: OfficialStateVoteScope): boolean {
  return !OFFICIAL_STATE_VOTE_SCOPES.includes(scope);
}
export type { OfficialStateVoteScope } from "../../state-rollcalls/authority.ts";

export function officialStateVoteProjectionIssue(
  scope: OfficialStateVoteScope,
  sourceId: string | null,
  next: StateVotesSnapshot,
): string | null {
  const target = officialStateRollCallTargetByScope(scope);
  if (!target) return `OFFICIAL_STATE_VOTE_SCOPE_INVALID:${scope}`;
  const expectedSource = target.sourceId;
  const rosterTarget = officialStateLegislatorTargetByScope(scope);
  const state = target.state;
  if (sourceId !== expectedSource) return `SOURCE_AUTHORITY_MISMATCH:${sourceId ?? "NONE"}:${expectedSource}`;
  if (!Array.isArray(next.rollCalls) || !Array.isArray(next.positions) || !Array.isArray(next.datasets)) {
    return "SNAPSHOT_SHAPE_INVALID";
  }
  if (
    !rosterTarget ||
    next.officialIdentityAuthority?.contractId !== rosterTarget.contractId ||
    next.officialIdentityAuthority.sourceId !== expectedSource ||
    next.officialIdentityAuthority.scope !== scope ||
    !next.officialIdentityAuthority.versionId ||
    !/^[a-f0-9]{64}$/.test(next.officialIdentityAuthority.currentOfficeholderIdsSha256) ||
    next.officialIdentityAuthority.sessionParticipantSet.term.trim() === "" ||
    next.officialIdentityAuthority.sessionParticipantSet.session.trim() === "" ||
    next.officialIdentityAuthority.sessionParticipantSet.sourceVersion.trim() === "" ||
    next.officialIdentityAuthority.sessionParticipantSet.count <= 0 ||
    !/^[a-f0-9]{64}$/.test(next.officialIdentityAuthority.sessionParticipantSet.officeholderIdsSha256)
  ) {
    return "OFFICIAL_IDENTITY_AUTHORITY_INVALID";
  }
  if (next.rollCalls.some((roll) =>
    roll.state !== state ||
    roll.sourceId !== expectedSource ||
    !roll.officialRollCallId
  )) {
    return "ROLL_SCOPE_OR_AUTHORITY_INVALID";
  }
  if (next.datasets.some((dataset) => dataset.state !== state)) {
    return "DATASET_SCOPE_INVALID";
  }
  const horizonAudit = next.officialHorizonAudit;
  if (expectedSource === "nj-legislature" && (
    !horizonAudit ||
    horizonAudit.authorityMode !== "API_ARCHIVE_EXACT_RECONCILIATION" ||
    horizonAudit.expectedParticipantRequests !== horizonAudit.completedParticipantRequests ||
    horizonAudit.apiRollCalls !== next.rollCalls.length ||
    horizonAudit.apiPositions !== next.positions.length ||
    horizonAudit.reconciledArchivePositions !== next.positions.length ||
    horizonAudit.archives.length !== 4 ||
    new Set(horizonAudit.archives.map((row) => row.kind)).size !== 4 ||
    horizonAudit.archives.some((row) => !/^[a-f0-9]{64}$/.test(row.sha256) || row.rollCalls <= 0 || row.positions <= 0) ||
    horizonAudit.archives.reduce((sum, row) => sum + row.rollCalls, 0) !== next.rollCalls.length ||
    horizonAudit.archives.reduce((sum, row) => sum + row.positions, 0) !== next.positions.length
  )) {
    return "OFFICIAL_HORIZON_AUDIT_INVALID";
  }
  const rollIds = new Set(next.rollCalls.map((roll) => roll.id));
  if (rollIds.size !== next.rollCalls.length) {
    return "DUPLICATE_ROLL_CALL_ID";
  }
  if (next.positions.some((position) =>
    !rollIds.has(position.rollCallId) ||
    !position.officialPersonId ||
    position.publisherPosition === undefined ||
    (position.publisherPosition === "" && position.position !== "UNKNOWN")
  )) {
    return "POSITION_ROLL_OR_OFFICIAL_ID_INVALID";
  }
  if (next.positions.some((position) =>
    position.officeholderId !== officialStateOfficeholderId(expectedSource, position.officialPersonId!)
  )) {
    return "POSITION_OFFICEHOLDER_AUTHORITY_INVALID";
  }
  const positionKeys = new Set(next.positions.map((position) => `${position.officeholderId}\u0000${position.rollCallId}`));
  if (positionKeys.size !== next.positions.length) {
    return "DUPLICATE_MEMBER_POSITION";
  }
  const identityKeys = Object.keys(next.identifierMatch.byState);
  const stateMatch = next.identifierMatch.byState[state];
  const distinctOfficeholders = new Set(next.positions.map((position) => position.officeholderId)).size;
  if (
    identityKeys.length !== 1 ||
    identityKeys[0] !== state ||
    !stateMatch ||
    stateMatch.rollCalls !== next.rollCalls.length ||
    next.identifierMatch.peopleSeen !== stateMatch.peopleSeen ||
    next.identifierMatch.peopleMatched !== stateMatch.peopleMatched ||
    next.identifierMatch.distinctOfficeholders !== distinctOfficeholders ||
    next.identifierMatch.peopleSeen > next.officialIdentityAuthority.sessionParticipantSet.count ||
    next.identifierMatch.peopleMatched !== next.identifierMatch.peopleSeen
  ) {
    return "IDENTITY_SCOPE_OR_DENOMINATOR_INVALID";
  }
  return null;
}

function validateOfficialStateVoteProjection(
  scope: OfficialStateVoteScope,
  promoted: PromotedStateVotesRead,
): void {
  const issue = officialStateVoteProjectionIssue(scope, promoted.metadata.sourceId, promoted.value);
  if (issue !== null) {
    throw new Error(`Promoted state-vote projection ${promoted.metadata.versionId} for ${scope} is invalid (${issue}).`);
  }
}

/**
 * Read exactly one permanent official-state authority. The requested state is
 * fixed before the store is opened, and the retired all-state aggregate is
 * never probed as a fallback.
 */
export async function readOfficialStateVotesProjection(
  scope: OfficialStateVoteScope,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<StateVotesSnapshot>> {
  // A retired scope's pointer is a stale version nothing writes (R9): refused
  // before the store opens, never served as current votes.
  if (isRetiredStateRollCallScope(scope)) throw new Error(`STATE_ROLL_CALL_SCOPE_RETIRED:${scope}`);
  const result = await readPromotedCivicData<StateVotesSnapshot>("STATE_ROLL_CALL", scope, options);
  if (result.kind === "PROMOTED") validateOfficialStateVoteProjection(scope, result);
  return result;
}

export interface AvailableOfficialStateVotes {
  readonly promoted: readonly {
    readonly scope: OfficialStateVoteScope;
    readonly versionId: string;
    readonly snapshot: StateVotesSnapshot;
  }[];
  readonly readbacks: readonly {
    readonly scope: OfficialStateVoteScope;
    readonly kind: "PROMOTED" | "NOT_RECORDED";
    readonly versionId: string | null;
  }[];
}

/**
 * Enumerate official state-roll authorities. An answered-but-empty canonical scope is an explicit current
 * absence; an unreadable store or invalid promoted projection is a failed proof run.
 */
export async function readAvailableOfficialStateVotes(
  options: PromotedCivicDataReadOptions = {},
  read: (
    scope: OfficialStateVoteScope,
    options: PromotedCivicDataReadOptions,
  ) => Promise<CivicDataReadResult<StateVotesSnapshot>> = readOfficialStateVotesProjection,
): Promise<AvailableOfficialStateVotes> {
  const results = await Promise.all(
    OFFICIAL_STATE_VOTE_SCOPES.map(async (scope) => ({
      scope,
      result: await read(scope, options),
    })),
  );
  const promoted: AvailableOfficialStateVotes["promoted"][number][] = [];
  const readbacks: AvailableOfficialStateVotes["readbacks"][number][] = [];
  for (const { scope, result } of results) {
    if (result.kind === "PROMOTED") {
      if (!result.metadata.versionId) {
        throw new Error(`Official state-roll pointer for ${scope} has no version identity.`);
      }
      promoted.push({ scope, versionId: result.metadata.versionId, snapshot: result.value });
      readbacks.push({ scope, kind: "PROMOTED", versionId: result.metadata.versionId });
      continue;
    }
    if (result.kind === "NOT_RECORDED") {
      readbacks.push({ scope, kind: "NOT_RECORDED", versionId: null });
      continue;
    }
    throw new Error(`Official state-roll read for ${scope} is ${result.kind}: ${result.detail}`);
  }
  return { promoted, readbacks };
}

/**
 * Preload exactly one permanent authority. The scope is required before this
 * function can open a store, so one state's request never probes or mutates a
 * sibling state's Reader cache.
 */
export async function refreshStateVotesFromPromoted(
  scope: OfficialStateVoteScope,
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  try {
    const result = await readOfficialStateVotesProjection(scope, options);
    if (result.kind === "PROMOTED") {
      cacheByScope.set(scope, structuredClone(result.value));
      return result.metadata.versionId;
    }
    cacheByScope.delete(scope);
    if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
    throw new Error(result.detail);
  } catch (error) {
    cacheByScope.delete(scope);
    throw error;
  }
}

/** Current official projection. */
export function getStateVotesSnapshot(scope: OfficialStateVoteScope): StateVotesSnapshot {
  const held = cacheByScope.get(scope);
  if (held) return held;
  throw new Error(`No proof-validated official state roll-call projection is loaded for ${scope}.`);
}

/** Test seam for proving the production no-fallback boundary. */
export function clearStateVotesProjectionCacheForTest(): void {
  if (!mayUseTestFixture()) throw new Error("test-only state-vote cache reset refused outside node:test");
  cacheByScope.clear();
}
