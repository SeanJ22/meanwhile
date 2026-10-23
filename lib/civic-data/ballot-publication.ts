import type { RoutineTaskClock } from "./runner.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { OWNER_SURFACE_FORMAT_VERSION } from "../control-plane/owner-surface.ts";
import { parseStateBallotContractId, requireBallotState, type BallotState } from "./state-scopes.ts";
import { ballotNavigationTaskState } from "./ballot-navigation-scope.ts";

export type BallotPublicationFamily = "ballot-contests" | "ballot-navigation";

export interface BallotPublicationResult {
  readonly kind: "BALLOT_PUBLICATION";
  readonly family?: "ballot-navigation";
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

export type BallotPublicationSummary = Pick<BallotPublicationResult,
  "kind" | "family" | "state" | "inputHash" | "inputStamp" | "at" | "status" | "versionId" | "reason"> & { readonly heldContestCount: number };
export type BallotPublicationSummaries = Partial<Record<BallotState, BallotPublicationSummary>>;

const SUMMARY_FIELDS = ["kind", "family", "state", "inputHash", "inputStamp", "at", "status", "versionId", "reason", "heldContestCount"] as const;
const publicationLogKey = (state: BallotState, family: BallotPublicationFamily = "ballot-contests") =>
  family === "ballot-navigation" ? `ballot-navigation-publication:${requireBallotState(state)}` : `ballot-publication:${requireBallotState(state)}`;

/** Due state files already hold source evidence; publish them before network work spends the pass's budget. */
export function ballotPublicationLaunchOrder<T extends { readonly task: { readonly id: string } }>(jobs: readonly T[]): T[] {
  const publication = (job: T) => parseStateBallotContractId(job.task.id)?.family === "ballot-contests";
  return [...jobs.filter(publication), ...jobs.filter(job => !publication(job))];
}

export function ballotPublicationHasNoInput(report: BallotPublicationResult): boolean {
  return report.status === "HELD" && report.versionId === null && report.merged.length === 0 &&
    report.skipped.length === 1 && report.skipped[0].reason === report.reason &&
    report.reason?.startsWith(`BALLOT_INPUT_MISSING_NO_HELD_STATE:${report.state}:`) === true;
}

export function ballotPublicationSummary(report: BallotPublicationResult): BallotPublicationSummary {
  return { kind: report.kind, ...(report.family ? { family: report.family } : {}), state: report.state, inputHash: report.inputHash,
    ...(report.inputStamp === undefined ? {} : { inputStamp: report.inputStamp }),
    at: report.at, status: report.status, versionId: report.versionId, reason: report.reason,
    heldContestCount: report.heldContests?.length ?? 0 };
}

export async function recordBallotPublication(repos: ControlPlaneRepositories, report: BallotPublicationResult,
  context: { readonly cycleId: string; readonly testedSha: string | null }): Promise<void> {
  const digestId = `${context.cycleId}:${report.family ?? "ballot"}-publication:${report.state}`;
  await repos.ownerDigests.append(publicationLogKey(report.state, report.family ?? "ballot-contests"), digestId, {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId, writtenAt: report.at,
    headline: `${report.state} ${report.family === "ballot-navigation" ? "voting information" : "ballot"} publication ${report.status.toLowerCase()}`, lines: [],
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
    if (row.kind !== "BALLOT_PUBLICATION" || row.state !== state || !(row.family === undefined || row.family === "ballot-navigation") || !/^[a-f0-9]{64}$/.test(row.inputHash) || !Number.isFinite(Date.parse(row.at)) ||
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

export async function readLatestBallotPublication(repos: ControlPlaneRepositories, state: BallotState,
  family: BallotPublicationFamily = "ballot-contests"): Promise<BallotPublicationResult | null> {
  const key = publicationLogKey(state, family);
  const rows = await repos.ownerDigests.readLatest([key], { ballotPublication: true });
  const report = (rows.get(key) as { ballotPublication?: BallotPublicationResult } | undefined)?.ballotPublication;
  return report?.state === state && (report.family ?? "ballot-contests") === family
    ? parseBallotPublicationResult("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(report)) : null;
}

export async function readLatestBallotPublicationSummary(repos: ControlPlaneRepositories, state: BallotState,
  family: BallotPublicationFamily = "ballot-contests"): Promise<BallotPublicationSummary | null> {
  const key = publicationLogKey(state, family);
  const rows = await repos.ownerDigests.readLatest([key], { ballotPublication: SUMMARY_FIELDS });
  const report = (rows.get(key) as { ballotPublication?: BallotPublicationSummary } | undefined)?.ballotPublication;
  return report?.kind === "BALLOT_PUBLICATION" && report.state === state && (report.family ?? "ballot-contests") === family &&
    Number.isSafeInteger(report.heldContestCount) && report.heldContestCount >= 0 &&
    /^[a-f0-9]{64}$/.test(report.inputHash) && Number.isFinite(Date.parse(report.at)) &&
    ["PUBLISHED", "HELD"].includes(report.status) && (report.versionId === null || typeof report.versionId === "string") &&
    (report.reason === null || typeof report.reason === "string") ? report : null;
}

export function ballotPublicationDue(taskId: string, inputStamp: string | null,
  prior: Pick<BallotPublicationResult, "state" | "inputStamp" | "status"> | null,
  clock: Pick<RoutineTaskClock, "lastSucceededAt"> | undefined): boolean {
  const task = parseStateBallotContractId(taskId);
  const state = task?.family === "ballot-contests" ? task.state : ballotNavigationTaskState(taskId);
  return state !== null && inputStamp !== null &&
    (prior?.state !== state || inputStamp !== prior.inputStamp || prior.status === "PUBLISHED" && !clock?.lastSucceededAt);
}
