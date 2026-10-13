import { normalizedHash } from "../civic-data/candidate-builders.ts";
import { candidateHasIntrinsicHorizonRefusal } from "../civic-data/candidate-integrity.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import type { NhMemberReadModel, OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { StateVotesSnapshot } from "../sources/legiscan/types.ts";
import { officialStateLegislatorTargetByScope } from "./authority.ts";

function rosterOfficeholderIds(payload: unknown): readonly string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Partial<OfficialStateLegislatorReadModel & NhMemberReadModel>;
  if (Array.isArray(value.roster?.officeholders)) {
    return value.roster.officeholders.map((row) => row.id);
  }
  if (Array.isArray(value.identities)) {
    return value.identities.map((row) => row.officeholderId);
  }
  return null;
}

/**
 * Cross-pointer admission for an official roll candidate. The candidate may
 * not self-certify its person join: its exact cited roster version and sorted
 * ID-set digest must equal the canonical STATE_LEGISLATOR pointer in the same
 * scope. No tracked or vendor roster is inspected.
 */
export async function officialStateRollIdentityAuthorityIssue(
  store: Pick<RoutineDataStore, "readPromotion" | "readCandidate">,
  candidate: RoutineCandidate,
): Promise<string | null> {
  if (candidate.recordClass !== "STATE_ROLL_CALL") return null;
  if (candidate.sourceId === "plural-openstates-votes") {
    // This separately attributed source retains native IDs. Its typed reader
    // validates every fact; it never claims an official-roster crosswalk.
    const { pluralVotesScope, pluralVotesProjectionIssue } = await import("../sources/plural/votes.ts");
    const projection = candidate.readModel as import("../sources/plural/votes.ts").PluralVotesProjection;
    return !pluralVotesProjectionIssue(projection) && candidate.scope === pluralVotesScope(projection.state)
      ? null
      : "The native vote source has an invalid state projection or scope.";
  }
  if (candidate.sourceId === "legiscan") {
    const { legiscanVotesScope, legiscanVotesProjectionIssue, legiscanVoteIdentityAuthorityIssue } = await import("../sources/legiscan/votes.ts");
    const projection = candidate.readModel as import("../sources/legiscan/votes.ts").LegiscanVotesProjection;
    return !legiscanVotesProjectionIssue(projection) && candidate.scope === legiscanVotesScope(projection.state)
      ? await legiscanVoteIdentityAuthorityIssue(store, candidate) : "The LegiScan vote source has an invalid state projection or scope.";
  }
  // A candidate already refused by its own completeness contract keeps that disposition.
  if (candidateHasIntrinsicHorizonRefusal(candidate)) return null;
  const target = officialStateLegislatorTargetByScope(candidate.scope);
  if (!target) return `No official state-legislator authority is registered for ${candidate.scope}.`;
  const readModel = candidate.readModel as StateVotesSnapshot | undefined;
  const cited = readModel?.officialIdentityAuthority;
  if (!cited) return "The roll candidate does not cite an exact official state-legislator pointer.";
  if (
    cited.contractId !== target.contractId ||
    cited.sourceId !== target.sourceId ||
    cited.scope !== target.jurisdiction
  ) return "The roll candidate cites a different official state-legislator authority.";

  const pointer = await store.readPromotion("STATE_LEGISLATOR", target.jurisdiction);
  if (!pointer) return `No canonical ${target.contractId} pointer exists for the member join.`;
  if (pointer.sourceId !== target.sourceId) return `The canonical roster pointer is owned by ${pointer.sourceId}, not ${target.sourceId}.`;
  if (
    target.contractId === "nh-members" &&
    !(pointer.payload as Partial<NhMemberReadModel>).officialIdentityAuthority
  ) {
    return "The canonical NH roster is an import-only identity projection, not a source-authenticated official PersonID authority.";
  }
  if (pointer.versionId !== cited.versionId || pointer.lastKnownGoodVersionId !== cited.versionId) {
    return `The roll candidate cites roster ${cited.versionId}, but canonical pointer/LKG is ${pointer.versionId}/${pointer.lastKnownGoodVersionId}.`;
  }
  const ids = rosterOfficeholderIds(pointer.payload);
  if (!ids) return "The canonical roster pointer does not expose an exact official officeholder set.";
  if (new Set(ids).size !== ids.length) return "The canonical roster pointer repeats an officeholder identifier.";
  const digest = normalizedHash([...ids].sort());
  if (digest !== cited.currentOfficeholderIdsSha256) {
    return `The roll candidate's roster ID-set digest does not equal canonical ${target.contractId} ${pointer.versionId}.`;
  }
  return null;
}
