/**
 * **FRESHNESS OF A FACT CLASS, READ FROM THE SCHEDULER IT ALREADY HAS.**
 * (Fleet Promotion Readiness, PRDY-5, 2026-09-06.)
 *
 * ## What was missing (ACT-5)
 *
 * The scheduler carried 78 `meetings` obligations — one per body in the
 * committed snapshot — and a `local-jurisdictions` route obligation per
 * subject. Neither is the freshness of a meeting-time or an agenda FACT: the
 * first is the Reader's own corpus refreshing itself, the second is a route
 * that may be an upstream dependency. A fact bridged from the worker fleet had
 * no obligation of its own, so nothing could say when it was last acquired,
 * when it is next due, or that it had gone stale.
 *
 * ## The obligation, and where it lives
 *
 * One obligation per (record class, canonical body): `freshness:meeting-times:<bodyId>`
 * and `freshness:agendas:<bodyId>`, provided to the canonical registry by
 * `providers/promoted-facts.ts` and enumerated from the pipeline's own
 * FLEET_EXTRACTION records — the durable evidence, not a file the runner keeps
 * beside it. The route is the feed the facts were acquired from. Cadence,
 * next-due, occurrences, debt and backoff are the scheduler's existing ones
 * (`obligation.ts`, `debt.ts`, `durable.ts`); this module derives nothing of
 * its own but the STALE threshold.
 *
 * ## The reading
 *
 * ```
 *   NOT_SCHEDULED    no obligation row yet — the registry registers it next cycle   HOLD
 *   NEVER_ACQUIRED   an obligation with no successful acquisition on record          HOLD
 *   STALE            the last successful acquisition is older than
 *                    FACT_FRESHNESS_STALE_CYCLES × the derived cadence                HOLD
 *   SOURCE_FAILING   within threshold, but the route carries debt; the facts stand,
 *                    nothing is emptied, the retry clock is quoted                    healthy
 *   DUE              within threshold and past next-due — owed, not stale             healthy
 *   FRESH            within threshold and not yet due                                 healthy
 * ```
 *
 * A HOLD is an approval burden failure and a promoter refusal; it never
 * deletes a fact or renders an absence. A legitimately NOT_DUE source is
 * healthy — being owed nothing is not being late.
 */
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { StandingObligation } from "../scheduler/durable.ts";
import { DEFAULT_CADENCE_HOURS, scheduleObligation } from "../scheduler/obligation.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { isMeetingFactClass, type MeetingFactClass } from "./meeting-facts.ts";
import type { PipelineItemState } from "./types.ts";

export const PROMOTED_FACTS_PROVIDER_ID = "promoted-facts";

/** A fact is stale once this many derived cadences have passed since its last successful acquisition. */
export const FACT_FRESHNESS_STALE_CYCLES = 2;

export function factObligationId(recordClass: MeetingFactClass, subjectId: string): string {
  return `freshness:${recordClass}:${subjectId}`;
}

/** One (record class, body) the pipeline holds facts for, as the provider enumerates it. */
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

/** Enumerate fact subjects from the pipeline's own records. Pure. */
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

export type FactFreshnessState = "FRESH" | "DUE" | "STALE" | "SOURCE_FAILING" | "NOT_SCHEDULED" | "NEVER_ACQUIRED";

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
  /** The instant the fact class becomes stale, given the last success and the cadence. */
  readonly staleAfter: string | null;
  readonly debt: FreshnessDebt | null;
  readonly retryAt: string | null;
  /** True when the route is failing while the facts stand — no false empty is produced. */
  readonly sourceFailureWithoutFalseEmpty: boolean;
}

/**
 * Read one fact class's freshness for one body. The last successful
 * acquisition is the FACT's evidence (the newest immutable artifact that
 * states it), passed by the chain; the obligation supplies cadence, next-due
 * and debt.
 */
export async function readFactFreshness(
  repos: ControlPlaneRepositories,
  input: { readonly recordClass: MeetingFactClass; readonly subjectId: string; readonly now: string; readonly lastSuccessfulAcquisitionAt?: string | null },
): Promise<FactFreshnessReading> {
  const obligationId = factObligationId(input.recordClass, input.subjectId);
  const row = await repos.obligations.read(obligationId);
  const obligation = row?.value ?? null;
  const debt = (await repos.debts.read(obligationId))?.value ?? null;
  const lastSuccess = input.lastSuccessfulAcquisitionAt ?? obligation?.lastWorkedAt ?? null;
  const base = { recordClass: input.recordClass, subjectId: input.subjectId, obligationId, obligation, debt, retryAt: debt?.retryAt ?? null, sourceFailureWithoutFalseEmpty: debt !== null, lastSuccessfulAcquisitionAt: lastSuccess };
  if (obligation === null) {
    return { ...base, state: "NOT_SCHEDULED", hold: true, cadenceHours: null, cadenceBasis: null, nextDueAt: null, staleAfter: null,
      reason: `no governed obligation ${obligationId} exists yet; the scheduler registers it from the pipeline's fact records on its next cycle, and until then the fact class has no freshness` };
  }
  if (lastSuccess === null) {
    return { ...base, state: "NEVER_ACQUIRED", hold: true, cadenceHours: null, cadenceBasis: null, nextDueAt: obligation.nextDueAt, staleAfter: null,
      reason: `obligation ${obligationId} records no successful acquisition; a fact with no acquisition on record has no freshness` };
  }
  const scheduled = scheduleObligation({ ...obligation, lastWorkedAt: lastSuccess }, Date.parse(input.now));
  const cadenceHours = "cadenceHours" in scheduled ? scheduled.cadenceHours : DEFAULT_CADENCE_HOURS;
  const cadenceBasis = "cadenceHours" in scheduled ? scheduled.basis : scheduled.reason;
  const nextDueAt = obligation.nextDueAt ?? ("nextDueAt" in scheduled ? scheduled.nextDueAt : null);
  const staleAfter = new Date(Date.parse(lastSuccess) + cadenceHours * FACT_FRESHNESS_STALE_CYCLES * 3_600_000).toISOString();
  const shared = { ...base, cadenceHours, cadenceBasis, nextDueAt, staleAfter };
  if (input.now > staleAfter) {
    return { ...shared, state: "STALE", hold: true,
      reason: `the last successful acquisition ${lastSuccess} is older than ${FACT_FRESHNESS_STALE_CYCLES} cadences of ${cadenceHours.toFixed(2)}h (stale after ${staleAfter}); the fact holds and nothing is emptied` };
  }
  if (debt !== null) {
    return { ...shared, state: "SOURCE_FAILING", hold: false,
      reason: `the route carries ${debt.cause} debt since ${debt.firstFailedAt} (${debt.consecutiveFailures} consecutive failure(s), retry at ${debt.retryAt}); the facts acquired ${lastSuccess} stand within threshold and no absence is produced` };
  }
  if (nextDueAt !== null && input.now >= nextDueAt) {
    return { ...shared, state: "DUE", hold: false, reason: `owed since ${nextDueAt} and within the stale threshold ${staleAfter}; owed is not stale` };
  }
  return { ...shared, state: "FRESH", hold: false, reason: `acquired ${lastSuccess}; next due ${nextDueAt ?? "not yet recorded"}; stale after ${staleAfter}` };
}
