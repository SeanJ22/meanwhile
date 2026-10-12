import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { StandingObligation } from "../scheduler/durable.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type {
  RoutineContractObservation,
  RoutineObservabilityRead,
} from "../../civic-data/observability.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  meetingPartitionForRow,
} from "../../civic-data/meeting-partitions.ts";
import { isMeetingFactClass, type MeetingFactClass } from "./meeting-facts.ts";
import type { PipelineItemState } from "./types.ts";

/** A fact is stale once this many derived cadences have passed since its last successful acquisition. */
export const FACT_FRESHNESS_STALE_CYCLES = 2;

export function factObligationId(recordClass: MeetingFactClass, subjectId: string): string {
  return `freshness:${recordClass}:${subjectId}`;
}

export interface FactSubject {
  readonly recordClass: MeetingFactClass;
  readonly subjectId: string;
  readonly sourceKey: string;
  readonly canonicalUrl: string;
  readonly lastAcquiredAt: string | null;
  /** The next future sitting among the subject's facts — the reader deadline. */
  readonly nextApplicableAt: string | null;
  readonly facts: number;
}

export function factSubjectsFromStates(states: readonly PipelineItemState[], nowIso: string): FactSubject[] {
  const nowMs = Date.parse(nowIso);
  const bySubject = new Map<string, { recordClass: MeetingFactClass; subjectId: string; sourceKey: string; canonicalUrl: string; lastAcquiredAt: string | null; nextApplicableAt: string | null; facts: number }>();
  for (const state of states) {
    const scouted = state.byStage.SCOUTED;
    if (!scouted || scouted.source.kind !== "FLEET_EXTRACTION" || !isMeetingFactClass(scouted.recordClass) || scouted.canonicalUrl === null) continue;
    const key = `${scouted.recordClass}|${scouted.subjectId}`;
    const row = bySubject.get(key) ?? { recordClass: scouted.recordClass, subjectId: scouted.subjectId, sourceKey: scouted.source.sourceKey, canonicalUrl: scouted.canonicalUrl, lastAcquiredAt: null, nextApplicableAt: null, facts: 0 };
    row.facts += 1;
    for (const at of [scouted.at, state.byStage.CONFIRMED?.at ?? null]) {
      if (at !== null && (row.lastAcquiredAt === null || at > row.lastAcquiredAt)) row.lastAcquiredAt = at;
    }
    const applicable = Date.parse(scouted.source.applicableAt);
    if (Number.isFinite(applicable) && applicable > nowMs && (row.nextApplicableAt === null || scouted.source.applicableAt < row.nextApplicableAt)) {
      row.nextApplicableAt = scouted.source.applicableAt;
    }
    bySubject.set(key, row);
  }
  return [...bySubject.keys()].sort().map((key) => bySubject.get(key)!);
}

export type FactFreshnessState = "FRESH" | "DUE" | "STALE" | "SOURCE_FAILING" | "UNKNOWN" | "NOT_SCHEDULED" | "NEVER_ACQUIRED";

export interface FactFreshnessReading {
  readonly recordClass: MeetingFactClass;
  readonly subjectId: string;
  readonly obligationId: string;
  readonly state: FactFreshnessState;
  /** True when the reading blocks approval and promotion. Never deletes a fact. */
  readonly hold: boolean;
  readonly reason: string;
  readonly obligation: StandingObligation | null;
  readonly cadenceHours: number | null;
  readonly cadenceBasis: string | null;
  readonly lastSuccessfulAcquisitionAt: string | null;
  readonly nextDueAt: string | null;
  readonly staleAfter: string | null;
  readonly debt: FreshnessDebt | null;
  readonly retryAt: string | null;
  /** True when the route is failing while the facts stand — no false empty is produced. */
  readonly sourceFailureWithoutFalseEmpty: boolean;
}

export type PermanentMeetingsContractReceipt = Pick<
  RoutineContractObservation,
  | "contractId"
  | "sourceId"
  | "recordClass"
  | "scope"
  | "currentState"
  | "canonicalPromotion"
  | "readerVisible"
  | "cadence"
  | "lkg"
>;

export type PermanentMeetingsReceipt =
  | { readonly kind: "HELD"; readonly value: readonly PermanentMeetingsContractReceipt[] }
  | { readonly kind: "UNAVAILABLE"; readonly detail: string };

export function permanentMeetingsReceiptId(contractId: string, scope: string): string {
  return `routine-civic-data:${contractId}/MEETING/${scope}`;
}

/** Exact identity, membership and uniqueness are required: a similarly named or aggregate row never becomes an authority. */
export function permanentMeetingsReceipt(
  read: RoutineObservabilityRead,
): PermanentMeetingsReceipt {
  if (read.kind !== "HELD") {
    return {
      kind: "UNAVAILABLE",
      detail: `the canonical routine-data projection is ${read.kind}: ${read.detail}`,
    };
  }
  const expected = new Map(MEETING_PARTITION_CONTRACTS.map((partition) => [partition.id, partition]));
  const matches = read.value.contracts.filter((row) => expected.has(row.contractId));
  const ids = new Set(matches.map((row) => row.contractId));
  const malformed = matches.find((row) => {
    const partition = expected.get(row.contractId)!;
    return row.sourceId !== partition.sourceId || row.recordClass !== partition.recordClass || row.scope !== partition.scope;
  });
  if (malformed || matches.length !== expected.size || ids.size !== expected.size) {
    return {
      kind: "UNAVAILABLE",
      detail:
        `the canonical projection held ${ids.size}/${expected.size} exact source/body meetings contract rows` +
        (malformed ? `; ${malformed.contractId} did not match its registered identity` : ""),
    };
  }
  return { kind: "HELD", value: matches };
}

type PermanentMeetingsFreshnessInput = {
  readonly recordClass: MeetingFactClass;
  readonly subjectId: string;
  readonly meetingSource?: string | null;
  readonly lastSuccessfulAcquisitionAt?: string | null;
};

function unavailablePermanentReading(
  input: PermanentMeetingsFreshnessInput,
  detail: string,
  obligationId = `meeting-partition-unresolved:${input.subjectId}`,
): FactFreshnessReading {
  return {
    recordClass: input.recordClass,
    subjectId: input.subjectId,
    obligationId,
    state: "UNKNOWN",
    hold: true,
    reason: `permanent meetings receipt unavailable: ${detail}`,
    obligation: null,
    cadenceHours: null,
    cadenceBasis: null,
    lastSuccessfulAcquisitionAt: null,
    nextDueAt: null,
    staleAfter: null,
    debt: null,
    retryAt: null,
    sourceFailureWithoutFalseEmpty: false,
  };
}

/** Never schedules or opens a source; it only consumes the projection Admin already reads. */
export function factFreshnessFromPermanentMeetings(
  receipt: PermanentMeetingsReceipt,
  input: PermanentMeetingsFreshnessInput,
): FactFreshnessReading {
  if (receipt.kind === "UNAVAILABLE") return unavailablePermanentReading(input, receipt.detail);
  if (!input.meetingSource) {
    return unavailablePermanentReading(input, "immutable fact evidence does not name its source partition");
  }
  let partition;
  try {
    partition = meetingPartitionForRow(input.meetingSource, input.subjectId);
  } catch {
    return unavailablePermanentReading(
      input,
      `no registered source/body partition exists for ${input.meetingSource}/${input.subjectId}`,
    );
  }
  const obligationId = permanentMeetingsReceiptId(partition.id, partition.scope);
  const rows = receipt.value.filter((candidate) => candidate.contractId === partition.id);
  if (rows.length !== 1) {
    return unavailablePermanentReading(
      input,
      `the canonical projection held ${rows.length} exact rows for ${partition.id}; one is required`,
      obligationId,
    );
  }
  const row = rows[0]!;
  if (row.canonicalPromotion.kind !== "MEASURED") {
    return unavailablePermanentReading(input, `canonical promotion is ${row.canonicalPromotion.kind}: ${row.canonicalPromotion.detail}`, obligationId);
  }
  if (row.readerVisible.kind !== "MEASURED") {
    return unavailablePermanentReading(input, `Reader projection is ${row.readerVisible.kind}: ${row.readerVisible.detail}`, obligationId);
  }
  if (row.readerVisible.value.versionId !== row.canonicalPromotion.value.versionId) {
    return unavailablePermanentReading(input, "canonical promotion and Reader projection name different versions", obligationId);
  }
  if (row.currentState.kind !== "MEASURED") {
    return unavailablePermanentReading(input, `latest attempt state is ${row.currentState.kind}: ${row.currentState.detail}`, obligationId);
  }
  if (row.cadence.nextDue.kind !== "MEASURED") {
    return unavailablePermanentReading(input, `next-due receipt is ${row.cadence.nextDue.kind}: ${row.cadence.nextDue.detail}`, obligationId);
  }
  const promotedAt = row.canonicalPromotion.value.promotedAt;
  const promotedMs = Date.parse(promotedAt);
  const nextDueAt = row.cadence.nextDue.value;
  if (!Number.isFinite(promotedMs) || !Number.isFinite(Date.parse(nextDueAt)) || !(row.cadence.activeEveryMs > 0)) {
    return unavailablePermanentReading(input, "the canonical promotion, cadence, or next-due timestamp is unreadable", obligationId);
  }
  const sourceFailing = row.currentState.value !== "PROMOTED";
  if (sourceFailing && (row.lkg.kind !== "MEASURED" || !row.lkg.value.currentlyServing)) {
    const detail = row.lkg.kind === "MEASURED"
      ? "the latest attempt did not promote and the receipt does not prove LKG is serving"
      : `the latest attempt did not promote and LKG is ${row.lkg.kind}: ${row.lkg.detail}`;
    return unavailablePermanentReading(input, detail, obligationId);
  }
  const factAt = input.lastSuccessfulAcquisitionAt ?? null;
  const factMs = factAt === null ? Number.NaN : Date.parse(factAt);
  const cadenceHours = row.cadence.activeEveryMs / 3_600_000;
  const staleAfter = new Date(promotedMs + FACT_FRESHNESS_STALE_CYCLES * row.cadence.activeEveryMs).toISOString();
  const base = {
    recordClass: input.recordClass,
    subjectId: input.subjectId,
    obligationId,
    obligation: null,
    cadenceHours,
    cadenceBasis: `permanent source/body meetings contract ${partition.id}: ${row.cadence.description}`,
    lastSuccessfulAcquisitionAt: promotedAt,
    nextDueAt,
    staleAfter,
    debt: null,
    retryAt: sourceFailing ? nextDueAt : null,
    sourceFailureWithoutFalseEmpty: sourceFailing,
  };
  if (!Number.isFinite(factMs)) {
    return {
      ...base,
      state: "NEVER_ACQUIRED",
      hold: true,
      reason: "the immutable fact projection carries no readable acquisition time; the permanent receipt cannot make that fact current",
    };
  }
  if (factMs < promotedMs) {
    return {
      ...base,
      state: "STALE",
      hold: true,
      reason:
        `the fact evidence at ${factAt} predates canonical Reader version ` +
        `${row.canonicalPromotion.value.versionId} promoted ${promotedAt}; no old fact is refreshed by association`,
    };
  }
  if (row.cadence.freshness === "UNKNOWN") {
    return { ...base, state: "UNKNOWN", hold: true, reason: row.cadence.freshnessDetail };
  }
  if (row.cadence.freshness === "STALE") {
    return { ...base, state: "STALE", hold: true, reason: row.cadence.freshnessDetail };
  }
  if (row.cadence.freshness === "MANUAL") {
    return {
      ...base,
      state: "UNKNOWN",
      hold: true,
      reason: "a manually invoked contract cannot satisfy this standing meetings-fact freshness obligation",
    };
  }
  if (sourceFailing) {
    return {
      ...base,
      state: "SOURCE_FAILING",
      hold: false,
      reason:
        `the latest attempt is ${row.currentState.value}; canonical version ${row.canonicalPromotion.value.versionId} ` +
        `remains Reader-visible as LKG and retry is due ${nextDueAt}`,
    };
  }
  return {
    ...base,
    state: row.cadence.freshness,
    hold: false,
    reason:
      `canonical version ${row.canonicalPromotion.value.versionId} is Reader-visible; ` +
      `${row.cadence.freshnessDetail}`,
  };
}

export async function readFactFreshness(
  repos: ControlPlaneRepositories,
  input: PermanentMeetingsFreshnessInput & { readonly now: string },
): Promise<FactFreshnessReading> {
  void repos;
  const obligationId = factObligationId(input.recordClass, input.subjectId);
  return {
    recordClass: input.recordClass,
    subjectId: input.subjectId,
    obligationId,
    state: "NOT_SCHEDULED",
    hold: true,
    reason:
      `legacy per-fact acquisition clock ${obligationId} is retired by PDC; the permanent ` +
      "source/body meeting-partition receipt must be injected before this evidence projection can make a freshness claim",
    obligation: null,
    cadenceHours: null,
    cadenceBasis: null,
    lastSuccessfulAcquisitionAt: input.lastSuccessfulAcquisitionAt ?? null,
    nextDueAt: null,
    staleAfter: null,
    debt: null,
    retryAt: null,
    sourceFailureWithoutFalseEmpty: false,
  };
}
