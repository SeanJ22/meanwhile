/**
 * What one hunter or detective job leaves behind: the steps the machine saw it take, the facts it put into the Box,
 * its one-line summary, the blanks it could not fill, and what it cost. Nothing here judges a fact; checking happens
 * once, on the Slide.
 */

import type { PermissionState } from "../../workstate/types.ts";
import type { ModelClass, ModelEffort } from "./model-routing.ts";

/** How a job ended for the record: facts found, or none. Older rows carry the earlier outcome names. */
export type ScoutOutcome = "EVIDENCE_FOUND" | "NO_PROGRESS" | "ROUTE_CANDIDATE" | "NEEDS_ADAPTER" | "BLOCKED" | "HUMAN_REQUIRED";

/** Who ended the job: the model's finish, the bound, or the time limit. */
export type ScoutStop = "MODEL" | "BOUND" | "TIMEOUT";

/** One tool call that acted on a public source, as the machine recorded it. `rung` is the tool's name. */
export interface ScoutRung {
  readonly transport?: import("../../workstate/types.ts").TransportState | "NOT_ATTEMPTED";
  readonly httpStatus?: number | null;
  readonly returnedCount?: number | null;
  readonly nextHopUrls?: readonly string[];
  readonly index: number;
  readonly rung: string;
  readonly tool: string;
  /** The URL, host or query the tool acted on. */
  readonly target: string;
  readonly observed: string;
  readonly artifactIds: readonly string[];
  readonly note: string | null;
  readonly at: string;
  readonly ok?: boolean;
  readonly permission?: PermissionState;
  /** The stated reason for the step, on older rows. */
  readonly applicableBecause?: string;
}

/** A route an older job proposed. New jobs propose none. */
export interface ScoutCandidate {
  readonly routeId: string;
  readonly title: string;
  readonly url: string;
  readonly procedure: string;
  readonly relevance: string;
  readonly permission: PermissionState;
  readonly permissionReading: string;
  readonly evidenceArtifactIds: readonly string[];
  readonly observedOn: string;
  readonly recordClass: string;
  readonly deterministic: boolean;
  readonly unverified: readonly string[];
  readonly contractRepair?: unknown;
}

/** A fact the job reported: the subject, field, value, cited page and the sentence that states it. */
export interface ScoutFinding {
  readonly subjectId?: string;
  readonly missionPart?: string;
  readonly field?: string;
  readonly value?: string | number | boolean | null;
  readonly exactQuote?: string;
  readonly sourceUrl?: string;
  readonly summary: string;
  readonly artifactIds: readonly string[];
  readonly kind: "RECORD" | "POINTER";
}

/** A blank the job could not fill: what it tried and what would unlock it. The blank stays open. */
export interface UnfilledBlank {
  readonly subjectId: string;
  readonly field: string;
  readonly tried: string;
  readonly unlock: string;
}

/** Provider-reported usage, summed over the job's model turns. Null where unreported. `inputTokens` is the UNCACHED remainder. */
export interface ScoutUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly turns: number;
  readonly toolCalls: number;
  readonly cacheCreation5mInputTokens?: number | null;
  readonly cacheCreation1hInputTokens?: number | null;
}

/** Token counts by category for one step. */
export interface StepTokens {
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly uncachedInput: number;
  readonly output: number;
}

/** One instrumented step: a MODEL step is one provider turn; a DETERMINISTIC step is aggregated. */
export interface ScoutStep {
  readonly step: string;
  readonly kind: "MODEL" | "DETERMINISTIC";
  readonly turn: number | null;
  readonly model: string | null;
  readonly effort: ModelEffort | null;
  readonly tokens: StepTokens;
  readonly usd: number | null;
  readonly representationBytes: number;
  readonly count: number;
  readonly cacheWriteSplit?: { readonly ephemeral5m: number | null; readonly ephemeral1h: number | null };
  readonly cacheWritePricedFrom?: "SPLIT" | "AGGREGATE" | "NONE";
}

/** A cache defect on a turn after the first: a stationary breakpoint or a zero read (`cache-defects.ts`). */
export interface ScoutCacheDefect {
  readonly turns: readonly number[];
  readonly detail: string;
  readonly stationaryTurns?: readonly number[];
  readonly zeroReadTurns?: readonly number[];
}

/** A tool result larger than its step's representation budget, truncated with a stated notice. */
export interface ScoutRepresentationOverrun {
  readonly tool: string;
  readonly target: string;
  readonly bytes: number;
  readonly budget: number;
  readonly artifactIds: readonly string[];
}

/** One `input_transformations` entry, with the turn and model it came back on. */
export interface ScoutInputTransformation {
  readonly turn: number;
  readonly model: string;
  readonly type: string;
  readonly path: string | null;
  readonly reason: string | null;
}

/** Why a job produced nothing usable: the AI service did not answer, or Admin's limits refused the request. */
export interface ScoutIssue {
  readonly code: "SCOUT_TRANSPORT_FAILED" | "SCOUT_POLICY_DENIED";
  readonly detail: string;
}

/** One job's record, as persisted. */
export interface ScoutResult {
  readonly instructions?: { readonly role: "HUNTER" | "DETECTIVE"; readonly version: string; readonly entryIds: readonly string[]; readonly systemPrompt: string };
  readonly researchRole?: "SCOUT" | "DETECTIVE";
  readonly formatVersion: 1;
  readonly attemptId: string;
  readonly obligationId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly subjectId: string;
  readonly routeId: string | null;
  readonly recordClass: string;
  readonly providerId: string | null;
  readonly reason: string;
  readonly outcome: ScoutOutcome;
  readonly stoppedBy: ScoutStop;
  readonly rungs: readonly ScoutRung[];
  readonly distinctEvidenceRungs: number;
  readonly candidates: readonly ScoutCandidate[];
  readonly findings: readonly ScoutFinding[];
  readonly nextRungs: readonly string[];
  readonly unverified: readonly string[];
  /** The job's one-line summary. */
  readonly narrative: string;
  readonly worker: { readonly provider: string; readonly model: string; readonly modelReported: string | null };
  readonly usage: ScoutUsage;
  readonly usd: number | null;
  readonly elapsedMs: number;
  readonly spendHoldJobId?: string;
  readonly artifactIds: readonly string[];
  readonly methodCandidateIds: readonly string[];
  readonly refusal: readonly ScoutIssue[] | null;
  readonly startedAt: string;
  readonly recordedAt: string;
  /** How many blanks the job was sent for, their fingerprint and digests, and the ones it could not fill. */
  readonly blanks?: number;
  readonly blankFingerprint?: string;
  readonly blankDigests?: readonly string[];
  readonly unfilled?: readonly UnfilledBlank[];
  /** What the job's searches cost, recorded beside its model cost. */
  readonly searchUsd?: number;
  readonly effort?: ModelEffort | null;
  readonly steps?: readonly ScoutStep[];
  readonly cacheDefect?: ScoutCacheDefect | null;
  readonly representationOverruns?: readonly ScoutRepresentationOverrun[];
  readonly modelClass?: ModelClass;
  readonly modelClassWhy?: string;
  readonly inputTransformations?: readonly ScoutInputTransformation[];
  readonly contextRestarts?: number;
}

/** Steps that saved something, counted once per (tool, target). */
export function distinctEvidenceRungs(rungs: readonly ScoutRung[]): number {
  const seen = new Set<string>();
  for (const r of rungs) {
    if (r.artifactIds.length === 0) continue;
    seen.add(`${r.rung} | ${r.target}`);
  }
  return seen.size;
}
