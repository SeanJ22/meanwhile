/**
 * **PROVIDER THREE — THE TRACKER INTAKE PATH.** (Session C, PART D3, 2026-08-31.)
 *
 * ## What this is for, in one sentence
 *
 * So that *"the owner reported it"* and *"a machine owes it"* stop being two
 * records. A tracker row that LANE TRACKER's triage converts becomes a
 * scheduled obligation through THE SAME REGISTRY the meetings corpus and the
 * campaign-finance portfolios go through — same occurrence, same RouteTask,
 * same Attempt, same disposition, same debt, same persisted next-due. There is
 * no second control plane for owner-reported work.
 *
 * ## THE CONTRACT IS A TYPE, AND IT IS NOT IN THIS FILE (RULING 228)
 *
 * `lib/contracts/tracker-handoff.ts` holds the shape, the path, the states and
 * the validator. This module IMPORTS it; so does the producer,
 * `lib/tracker/obligation-handoff.ts`. Neither side restates it.
 *
 * That is a repair of a defect this seam already shipped. The two halves were
 * built in parallel from one paragraph and diverged on the path, the envelope
 * key and three field names, and the consequence was this provider reporting
 * **ABSENT** — *"the converting lane has not shipped one"* — over a file
 * sitting in the repository carrying seven named rows. A false ABSENT about a
 * colleague's work is the same defect class as a false absence about a
 * government.
 *
 * `tests/tracker-handoff-contract.test.ts` runs the REAL producer's output into
 * the REAL consumer, which is the only evidence RULING 228 accepts. A fixture
 * is a third reading of the paragraph and agrees with whoever wrote it — this
 * seam HAD a fixture, the fixture matched the consumer, the consumer passed its
 * tests, and the seam was still broken.
 *
 * ## Six outcomes, and the middle ones are what got collapsed
 *
 * ```
 *   ABSENT                 no artifact. NEVER printable when a file is present
 *   UNREADABLE             a file that exists and does not parse or validate
 *   PRESENT_EMPTY          parses, zero rows. A zero-row extraction is a
 *                          FAILED extraction — a defect in the producer, and
 *                          not "the owner reported nothing"
 *   PRESENT_UNSCHEDULABLE  rows exist, NONE qualifies. Work in progress, and
 *                          not a failure of either side
 *   PARTIALLY_REGISTERED   some qualify, some do not
 *   REGISTERED             every qualifying row registered
 * ```
 *
 * The state is DERIVED from the counts (`intakeStateFor`), never asserted, so
 * no caller can name a state its own numbers contradict. That is exactly how
 * `INGESTED` came to be printed over zero usable rows.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HANDOFF_PATH,
  intakeStateFor,
  intakeSummaryLine,
  isSchedulable,
  validateHandoff,
  type DeferredRow,
  type HandoffRow,
  type IntakeState,
  type TrackerHandoffArtifact,
} from "../../../contracts/tracker-handoff.ts";
import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
} from "../registry.ts";

export const TRACKER_PROVIDER_ID = "tracker-intake";

export { HANDOFF_PATH };
export type { HandoffRow, IntakeState };

export interface IntakeResult {
  readonly state: IntakeState;
  /** The rows that qualified and will be registered. */
  readonly rows: readonly HandoffRow[];
  /** Rows the artifact carried that do not yet qualify, each with the reason. */
  readonly deferred: readonly DeferredRow[];
  readonly inputRows: number;
  readonly detail: string;
  readonly path: string;
}

/**
 * Read one handoff artifact and say EXACTLY what came back.
 *
 * Exported and tested directly, because the zero-shaped outcomes are the whole
 * of the honesty here and a reader that collapsed them would report a broken
 * lane as a quiet one.
 */
export function readTrackerHandoff(path: string): IntakeResult {
  if (!existsSync(path)) {
    return {
      state: "ABSENT",
      rows: [],
      deferred: [],
      inputRows: 0,
      path,
      detail:
        "no tracker handoff artifact is present. The converting lane has shipped nothing, which " +
        "is an ABSENCE of input and not a statement that no owner-reported work exists.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      state: "UNREADABLE",
      rows: [],
      deferred: [],
      inputRows: 0,
      path,
      detail:
        `the handoff artifact exists and did not parse (${
          error instanceof Error ? error.message : String(error)
        }). This is a FAILED read of a file that IS there, and no obligation may be dropped on it.`,
    };
  }

  const problems = validateHandoff(parsed);
  if (problems.length > 0) {
    return {
      state: "UNREADABLE",
      rows: [],
      deferred: [],
      inputRows: 0,
      path,
      detail:
        `the handoff artifact parsed and does NOT satisfy the contract: ${problems.join("; ")}. ` +
        "Reported as a failed read against the contract, never as a zero.",
    };
  }

  const artifact = parsed as TrackerHandoffArtifact;
  const rows: HandoffRow[] = [];
  const deferred: DeferredRow[] = [];

  for (const row of artifact.rows) {
    if (isSchedulable(row)) {
      rows.push(row);
      continue;
    }
    /*
     * QUOTE THE PRODUCER'S OWN REASON.
     *
     * The converting lane states, per row, what is missing before the row can
     * carry a next-due. Replacing that with a generic "no routes" throws away
     * the only analysis anyone has done of why this row is not ready, and makes
     * the next session rediscover it.
     */
    const stated = row.needsBeforeItCanCarryANextDue;
    deferred.push({
      trackerId: row.trackerId,
      why:
        Array.isArray(stated) && stated.length > 0
          ? `not yet schedulable, and the converting lane says why: ${stated.join("; ")}`
          : "no routes, and the producer stated no reason. A converted row with no representation " +
            "to open would schedule an obligation whose only possible outcome is NO_ROUTE_TASK",
    });
  }

  const state = intakeStateFor({
    present: true,
    readable: true,
    inputRows: artifact.rows.length,
    registered: rows.length,
  });

  return {
    state,
    rows,
    deferred,
    inputRows: artifact.rows.length,
    path,
    detail:
      `${intakeSummaryLine({
        state,
        inputRows: artifact.rows.length,
        registered: rows.length,
        deferred: deferred.length,
      })}${artifact.generatedBy ? ` · generated by ${artifact.generatedBy}` : ""}` +
      `${artifact.generatedAt ? ` on ${artifact.generatedAt}` : ""}` +
      (state === "PRESENT_EMPTY"
        ? ". A zero-row extraction is a FAILED extraction, never an empty document — reported as " +
          "a defect in the PRODUCING lane rather than as 'the owner reported nothing'."
        : "") +
      (state === "PRESENT_UNSCHEDULABLE"
        ? ". Every row states what it needs first — this is the converting lane's work in " +
          "progress, and NOT an absence of owner-reported work."
        : ""),
  };
}

export function trackerHandoffPath(root: string): string {
  return join(root, ...HANDOFF_PATH);
}

/** The digest lines for one read. Counts first, because counts are checkable. */
export function intakeDigestLines(read: IntakeResult): readonly string[] {
  const lines = [`tracker-intake — ${read.detail}`];
  for (const d of read.deferred) lines.push(`  DEFERRED ${d.trackerId} — ${d.why}`);
  return lines;
}

/**
 * The provider.
 *
 * `pathOverride` exists solely so a test can point it at another artifact.
 * Nothing in production passes it, and the default is the contract path.
 */
export function trackerIntakeProvider(pathOverride?: string): ObligationProvider {
  return {
    id: TRACKER_PROVIDER_ID,
    describe:
      "tracker rows the owner reported and a lane converted, scheduled through this same registry " +
      "so 'the owner reported it' and 'a machine owes it' are one record",

    scheduledId: (record, route) => `freshness:tracker:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const path = pathOverride ?? trackerHandoffPath(ctx.root);
      const read = readTrackerHandoff(path);

      /*
       * A read FAILURE and an empty-of-usable-rows are different, and only the
       * first is a failure. PRESENT_UNSCHEDULABLE is the honest state of a
       * conversion in progress and must not be reported as a broken lane — but
       * it must also never print as an absence, because the artifact is there.
       */
      if (read.state === "ABSENT") {
        return { obligations: [], readFailure: null, emptyReason: read.detail };
      }
      if (read.state === "UNREADABLE" || read.state === "PRESENT_EMPTY") {
        return { obligations: [], readFailure: read.detail, emptyReason: null };
      }
      if (read.state === "PRESENT_UNSCHEDULABLE") {
        return {
          obligations: [],
          readFailure: null,
          emptyReason: intakeDigestLines(read).join(" | "),
        };
      }

      const obligations: ProvidedObligation[] = read.rows.map((row) => ({
        recordClass: row.recordClass || "tracker",
        subjectId: row.subjectId,
        readerImpactAt: row.readerImpactAt ?? null,
        observedChangeRateHours: row.observedChangeRateHours ?? null,
        ...(row.declaredCycleHours !== undefined && row.declaredCycleHours !== null
          ? { declaredCycleHours: row.declaredCycleHours }
          : {}),
        lastWorkedAt: row.lastWorkedAt ?? null,
        routes: row.routes,
      }));

      return {
        obligations,
        readFailure: null,
        /*
         * PARTIALLY_REGISTERED still carries deferrals, reported as a reason
         * rather than a failure: some rows registering does not make the others
         * broken.
         */
        emptyReason: read.deferred.length === 0 ? null : intakeDigestLines(read).join(" | "),
      };
    },
  };
}
