/** How long a proven absence stands before the record is re-walked. */
export const ABSENCE_EXPIRY_DAYS = 30;

/** What would reopen an absence: text for Admin plus typed triggers a later capability can match. */
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

export function absenceExpiry(now: string): string {
  return new Date(Date.parse(now) + ABSENCE_EXPIRY_DAYS * 86_400_000).toISOString();
}

/**
 * Whether a finished scout result is an argued absence: no refusal, outcome NO_PROGRESS (BLOCKED is a
 * wall, not an absence), ended by judgment or at the bound, a DETECTIVE walk, and past the
 * distinct-evidence-rung floor.
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
