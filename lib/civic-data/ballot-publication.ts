import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { OWNER_SURFACE_FORMAT_VERSION } from "../control-plane/owner-surface.ts";
import { parseStateBallotContractId, requireBallotState, type BallotState } from "../ballot/state-scopes.ts";

export interface BallotPublicationResult {
  readonly kind: "BALLOT_PUBLICATION";
  readonly state: BallotState;
  readonly inputHash: string;
  readonly inputStamp?: string;
  readonly at: string;
  readonly status: "PUBLISHED" | "HELD";
  readonly versionId: string | null;
  readonly merged: readonly string[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  readonly heldContests?: readonly BallotContestHold[];
  readonly reason: string | null;
}

export interface BallotContestHold {
  readonly state: string;
  readonly contestId: string;
  readonly title: string;
  readonly reason: string;
}

export type BallotPublicationResults = Partial<Record<BallotState, BallotPublicationResult>>;
export type BallotPublicationSummary = Pick<BallotPublicationResult,
  "kind" | "state" | "inputHash" | "inputStamp" | "at" | "status" | "versionId" | "reason"> & { readonly heldContestCount: number };
export type BallotPublicationSummaries = Partial<Record<BallotState, BallotPublicationSummary>>;

const SUMMARY_FIELDS = ["kind", "state", "inputHash", "inputStamp", "at", "status", "versionId", "reason", "heldContestCount"] as const;
const publicationLogKey = (state: BallotState) => `ballot-publication:${requireBallotState(state)}`;

export function ballotPublicationSummary(report: BallotPublicationResult): BallotPublicationSummary {
  return { kind: report.kind, state: report.state, inputHash: report.inputHash,
    ...(report.inputStamp === undefined ? {} : { inputStamp: report.inputStamp }),
    at: report.at, status: report.status, versionId: report.versionId, reason: report.reason,
    heldContestCount: report.heldContests?.length ?? 0 };
}

export async function recordBallotPublication(repos: ControlPlaneRepositories, report: BallotPublicationResult,
  context: { readonly cycleId: string; readonly testedSha: string | null }): Promise<void> {
  const digestId = `${context.cycleId}:ballot-publication:${report.state}`;
  await repos.ownerDigests.append(publicationLogKey(report.state), digestId, {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId, writtenAt: report.at,
    headline: `${report.state} ballot publication ${report.status.toLowerCase()}`, lines: [],
    cycleOk: report.status === "PUBLISHED", testedSha: context.testedSha,
    ballotPublication: { ...report, heldContestCount: report.heldContests?.length ?? 0 },
  }, report.at);
}

export function parseBallotPublicationResult(output: string): BallotPublicationResult | null {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith("BALLOT_PUBLICATION_RESULT="));
  if (lines.length !== 1) return null;
  try {
    const row = JSON.parse(lines[0].slice("BALLOT_PUBLICATION_RESULT=".length)) as BallotPublicationResult;
    const state = requireBallotState(row.state);
    const file = `${state.toLowerCase()}.json`;
    if (row.kind !== "BALLOT_PUBLICATION" || row.state !== state || !/^[a-f0-9]{64}$/.test(row.inputHash) || !Number.isFinite(Date.parse(row.at)) ||
      !["PUBLISHED", "HELD"].includes(row.status) || !(row.versionId === null || typeof row.versionId === "string") ||
      !(row.reason === null || typeof row.reason === "string") || !Array.isArray(row.merged) ||
      row.merged.length > 1 || !row.merged.every(value => value === file) || !Array.isArray(row.skipped) ||
      row.skipped.length > 1 || !row.skipped.every(item => item && item.file === file && !row.merged.includes(item.file) &&
        typeof item.reason === "string" && item.reason.length > 0) ||
      row.heldContests !== undefined && (!Array.isArray(row.heldContests) || !row.heldContests.every(item => item &&
        item.state === state && typeof item.contestId === "string" && item.contestId.length > 0 &&
        typeof item.title === "string" && item.title.length > 0 && typeof item.reason === "string" && item.reason.length > 0))) return null;
    return row;
  } catch { return null; }
}

export async function readLatestBallotPublication(repos: ControlPlaneRepositories, state: BallotState): Promise<BallotPublicationResult | null> {
  const key = publicationLogKey(state);
  const rows = await repos.ownerDigests.readLatest([key], { ballotPublication: true });
  const report = (rows.get(key) as { ballotPublication?: BallotPublicationResult } | undefined)?.ballotPublication;
  return report?.state === state ? parseBallotPublicationResult("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(report)) : null;
}

export async function readLatestBallotPublicationSummary(repos: ControlPlaneRepositories, state: BallotState): Promise<BallotPublicationSummary | null> {
  const key = publicationLogKey(state);
  const rows = await repos.ownerDigests.readLatest([key], { ballotPublication: SUMMARY_FIELDS });
  const report = (rows.get(key) as { ballotPublication?: BallotPublicationSummary } | undefined)?.ballotPublication;
  return report?.kind === "BALLOT_PUBLICATION" && report.state === state &&
    Number.isSafeInteger(report.heldContestCount) && report.heldContestCount >= 0 &&
    /^[a-f0-9]{64}$/.test(report.inputHash) && Number.isFinite(Date.parse(report.at)) &&
    ["PUBLISHED", "HELD"].includes(report.status) && (report.versionId === null || typeof report.versionId === "string") &&
    (report.reason === null || typeof report.reason === "string") ? report : null;
}

export function ballotPublicationDue(taskId: string, inputStamp: string | null, prior: Pick<BallotPublicationResult, "state" | "inputStamp"> | null): boolean {
  const task = parseStateBallotContractId(taskId);
  return task?.family === "ballot-contests" && inputStamp !== null &&
    (prior?.state !== task.state || inputStamp !== prior.inputStamp);
}
