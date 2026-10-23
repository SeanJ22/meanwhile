import type { VotingSourceDoor } from "./voting-source-types.ts";

export const VOTING_SOURCE_REPLACEMENT_VERIFIER = "lib/ballot/voting-source-replacement.ts#verifyVotingSourceReplacement";

export interface VotingSourceReplacement {
  readonly jurisdictionId: string;
  readonly electionDate: string;
  readonly doors: readonly VotingSourceDoor[];
  readonly replaceSourceUrls: readonly string[];
}

export function votingSourceReplacement(value: unknown): VotingSourceReplacement | null {
  if (!value || typeof value !== "object") return null;
  const proof = (value as { sourceReplacement?: unknown }).sourceReplacement;
  if (!proof || typeof proof !== "object") return null;
  const row = proof as Partial<VotingSourceReplacement>;
  if (typeof row.jurisdictionId !== "string" || !row.jurisdictionId.startsWith("ocd-division/") ||
      typeof row.electionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.electionDate) ||
      !Array.isArray(row.doors) || !row.doors.length || !Array.isArray(row.replaceSourceUrls) || !row.replaceSourceUrls.length ||
      row.replaceSourceUrls.some(url => typeof url !== "string") || new Set(row.replaceSourceUrls).size !== row.replaceSourceUrls.length) return null;
  if (row.doors.some(door => !door || typeof door !== "object" || typeof door.id !== "string" || typeof door.url !== "string" ||
      !door.scope || door.scope.ocdId !== row.jurisdictionId || door.electionDate !== row.electionDate ||
      !Array.isArray(door.covers) || !door.covers.length || !door.covers.some((kind: string) => !["CANDIDATE_LIST", "BALLOT_MEASURES"].includes(kind)))) return null;
  const declared = new Set(row.doors.flatMap(door => [door.url, ...(door.supersedes ?? [])]));
  if (declared.size !== row.replaceSourceUrls.length || row.replaceSourceUrls.some(url => !declared.has(url))) return null;
  return row as VotingSourceReplacement;
}
