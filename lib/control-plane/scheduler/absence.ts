/**
 * **A RECORDED, EXPIRING ABSENCE FOR THE SCOUT LANE.** (RULING 52/53, 2026-09-19.)
 *
 * RULING 52: an empty branch is one measurement on one date, never a verdict.
 * RULING 53: a recorded absence expires on a clock, so an exhausted field is
 * re-walked later rather than either re-walked forever or dropped for good.
 *
 * The law already exists for coverage (`lib/hunt` ARGUED_ABSENT, RULING 94/144);
 * this enforces it for the control-plane scout scheduler, which did not. ~83% of
 * `candidate-authored-awaits-site` walks are correct negatives — a New Jersey
 * township candidate usually has no site. Re-walking that proven negative every
 * cycle at model cost is the waste this ends: a scout that argues the record
 * absent records it (`recordArguedAbsence` in durable.ts), and the obligation is
 * not re-walked until the absence expires (`scheduleObligation` honours it).
 *
 * This is NOT a debt. Debt is a reading that FAILED and retries fast; an absence
 * is a reading that SUCCEEDED at establishing nothing is there and rechecks
 * slowly. It is visible as an ordinary scheduled row, never an incident.
 */

/** How long a proven absence stands before the record is re-walked. RULING 53. */
export const ABSENCE_EXPIRY_DAYS = 30;

/** What would reopen an absence, as text for Admin plus typed triggers a later capability can match (DP-06, DP-10). */
export interface AbsenceUnlock {
  readonly text: string;
  readonly triggers: readonly AbsenceUnlockTrigger[];
  /** When the absence was argued; only a capability that appears after it reopens it. Absent on older rows. */
  readonly recordedAt?: string;
}
export type AbsenceUnlockTrigger =
  | { readonly kind: "ADAPTER"; readonly platform: string }
  | { readonly kind: "TOOL"; readonly tool: string }
  | { readonly kind: "ROUTE"; readonly recordClass: string; readonly platform?: string }
  | { readonly kind: "DATE"; readonly at: string };

/**
 * The unlock condition stored with an absence, built from the detective's own next steps and
 * dead-end narrative. A new route for the record class and the recheck date always reopen it.
 */
export function absenceUnlockFrom(
  result: { readonly nextRungs: readonly string[]; readonly narrative: string; readonly recordClass?: string | null; readonly platform?: string | null },
  absentUntil: string,
): AbsenceUnlock {
  const steps = result.nextRungs.map((r) => r.trim()).filter((r) => r !== "");
  const text = steps.length > 0
    ? `${steps.slice(0, 4).join("; ")}${steps.length > 4 ? `; and ${steps.length - 4} more` : ""}`
    : result.narrative.trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 300) ?? "";
  return {
    text,
    triggers: [
      ...(result.recordClass ? [{ kind: "ROUTE", recordClass: result.recordClass, ...(result.platform ? { platform: result.platform } : {}) } as const] : []),
      { kind: "DATE", at: absentUntil },
    ],
  };
}

/** The instant an absence recorded `now` expires and the record is owed again. */
export function absenceExpiry(now: string): string {
  return new Date(Date.parse(now) + ABSENCE_EXPIRY_DAYS * 86_400_000).toISOString();
}

/**
 * Whether a finished scout result is an ARGUED absence — a correct negative that
 * should hold the obligation on the absence clock rather than re-walk it.
 *
 * All four must hold:
 *  - it FINISHED (no refusal): a transport failure or a no-finish is debt/retry,
 *    never a recorded absence;
 *  - the outcome is NO_PROGRESS — the ladder was walked and nothing is there.
 *    Only NO_PROGRESS: it alone writes a NULL disposition and so keeps the
 *    obligation owed with debt (dispositionForScout), which is the re-walk this
 *    ends. BLOCKED is deliberately EXCLUDED — a wall is an obstruction, not an
 *    absence (RULING 250), it already writes BLOCKED_CURRENTLY and reschedules
 *    on the ordinary cadence, and a wall can lift long before an absence would
 *    expire; holding it silent for the absence window would hide a record that
 *    became reachable. An empty branch is the correct negative (RULING 52); a
 *    wall is a fact about the route, retried, never a recorded absence.
 *  - it ended by the model's own judgment or at the bound, not mid-flight;
 *  - it was a DETECTIVE walk (DP-04): a Scout walk that hits its limit records nothing, so the
 *    next walk goes to a detective (the existing NO_PROGRESS trigger) and only an empty
 *    detective walk records the absence;
 *  - it cleared the distinct-evidence-rung floor — RULING 52's "argued, never
 *    asserted": the floor is what makes an absence argued rather than assumed.
 */
export function isArguedAbsence(
  result: {
    readonly outcome: string;
    readonly stoppedBy: string;
    readonly distinctEvidenceRungs: number;
    readonly refusal: unknown;
    readonly researchRole?: "SCOUT" | "DETECTIVE";
  },
  minRungs: number,
): boolean {
  if (result.refusal !== null && result.refusal !== undefined) return false;
  if (result.researchRole !== "DETECTIVE") return false;
  if (result.outcome !== "NO_PROGRESS") return false;
  if (result.stoppedBy !== "MODEL" && result.stoppedBy !== "BOUND") return false;
  return result.distinctEvidenceRungs >= minRungs;
}
