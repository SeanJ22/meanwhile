import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StateVotesSnapshot } from "./types.ts";
import {
  OFFICIAL_STATE_ROLL_CALL_TARGETS,
  officialStateOfficeholderId,
  officialStateLegislatorTargetByScope,
  officialStateRollCallTargetByScope,
  type OfficialStateVoteScope,
} from "../../state-rollcalls/authority.ts";
import {
  CivicDataStoreUnavailableError,
  mayUseTestFixture,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../../civic-data/read-model.ts";

/**
 * State-legislature roll calls, read once per process.
 *
 * Reader requests never fetch a publisher. Only proof-validated promotions
 * from official state publishers enter the runtime cache. The old committed
 * LegiScan projection is research/test evidence and is never a production
 * bootstrap or fallback.
 */

const cacheByScope = new Map<OfficialStateVoteScope, StateVotesSnapshot>();

type PromotedStateVotesRead = Extract<
  CivicDataReadResult<StateVotesSnapshot>,
  { readonly kind: "PROMOTED" }
>;

export const OFFICIAL_STATE_VOTE_SCOPES = OFFICIAL_STATE_ROLL_CALL_TARGETS.map(
  ({ jurisdiction }) => jurisdiction,
);
export type { OfficialStateVoteScope } from "../../state-rollcalls/authority.ts";

function stateForScope(scope: OfficialStateVoteScope): string {
  const target = officialStateRollCallTargetByScope(scope);
  if (!target) throw new Error(`OFFICIAL_STATE_VOTE_SCOPE_INVALID:${scope}`);
  return target.state;
}

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
  const result = await readPromotedCivicData<StateVotesSnapshot>("STATE_ROLL_CALL", scope, options);
  if (result.kind === "PROMOTED") validateOfficialStateVoteProjection(scope, result);
  return result;
}

function researchFixture(scope: OfficialStateVoteScope): StateVotesSnapshot {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "data", "votes", "state-votes-snapshot.json"), "utf8"),
  ) as StateVotesSnapshot;
  const state = stateForScope(scope);
  const rollCalls = fixture.rollCalls.filter((roll) => roll.state === state);
  const rollIds = new Set(rollCalls.map((roll) => roll.id));
  const positions = fixture.positions.filter((position) => rollIds.has(position.rollCallId));
  const byState = fixture.identifierMatch.byState[state];
  return {
    generatedAt: fixture.generatedAt,
    datasets: fixture.datasets.filter((dataset) => dataset.state === state),
    identifierMatch: {
      peopleSeen: byState?.peopleSeen ?? 0,
      peopleMatched: byState?.peopleMatched ?? 0,
      distinctOfficeholders: new Set(positions.map((position) => position.officeholderId)).size,
      byState: byState ? { [state]: structuredClone(byState) } : {},
    },
    rollCalls: structuredClone(rollCalls),
    positions: structuredClone(positions),
  };
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

/**
 * Current official projection, or an explicit test-only research fixture.
 * Production never reads `data/votes/state-votes-snapshot.json`.
 */
export function getStateVotesSnapshot(scope: OfficialStateVoteScope): StateVotesSnapshot {
  const held = cacheByScope.get(scope);
  if (held) return held;
  if (mayUseTestFixture()) return researchFixture(scope);
  throw new Error(`No proof-validated official state roll-call projection is loaded for ${scope}.`);
}

/** Test seam for proving the production no-fallback boundary. */
export function clearStateVotesProjectionCacheForTest(): void {
  if (!mayUseTestFixture()) throw new Error("test-only state-vote cache reset refused outside node:test");
  cacheByScope.clear();
}
