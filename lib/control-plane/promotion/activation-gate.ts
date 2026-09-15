/**
 * THE ACTIVATION GATE — what the nightly window may promote. (RULING 242.)
 *
 *   promotionEnabled   false, and stays false until READER, TRUTH and
 *                      FRESHNESS are GREEN and INDEPENDENTLY_REPRODUCED
 *   openRecordClasses  EMPTY. Opening a class is a later owner decision;
 *                      the low-risk candidates are named here so the
 *                      decision has a list to choose from, never a blank
 *
 * PDC makes local freshness-shadow run files diagnostic history only. They
 * cannot activate promotion or supply live operational truth. Until a later,
 * separately governed research activation is backed by a canonical runtime
 * receipt, every contract is UNREAD and the gate stays closed.
 */
import type { ActivationGateReading } from "./types.ts";

export const ACTIVATION_GATE = {
  promotionEnabled: false,
  openRecordClasses: [] as readonly string[],
} as const;

/** Candidates for the FIRST classes to open, for a later decision. Not open. */
export const LOW_RISK_CANDIDATE_CLASSES: readonly string[] = [
  "published-minutes",
  "routine-filings",
  // Reviewed facts enter only the registered permanent meeting partition.
  // This does not open the retired SHADOW writer or any other civic class.
  "meeting-times",
  "agendas",
];

/** Classes that stay closed until the owner approves each one by name. */
export const OWNER_APPROVED_CLASSES: readonly string[] = [
  "candidate-positions",
  "campaign-finance",
  "candidate-enrichment",
  "ballot",
  "votes",
];

/**
 * Read the fail-closed software policy. `root` is retained for API stability,
 * but no mutable local run record is read or treated as activation authority.
 */
export function readActivationGate(root: string): ActivationGateReading {
  void root;
  const contracts: Record<"READER" | "TRUTH" | "FRESHNESS", string> = {
    READER: "UNREAD",
    TRUTH: "UNREAD",
    FRESHNESS: "UNREAD",
  };
  return {
    promotionEnabled: ACTIVATION_GATE.promotionEnabled,
    mode: "SHADOW",
    openRecordClasses: ACTIVATION_GATE.openRecordClasses,
    contracts,
    independentlyReproduced: false,
    readFrom: null,
    reason:
      "SHADOW — local freshness-shadow run records are non-authoritative diagnostics after PDC; " +
      "no canonical research activation receipt is installed; READER UNREAD, TRUTH UNREAD, " +
      `FRESHNESS UNREAD; promotion OFF; ${ACTIVATION_GATE.openRecordClasses.length} record class(es) open`,
  };
}
