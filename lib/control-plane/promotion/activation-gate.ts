/**
 * Implemented research-finding publication routes. Standing rulings §3
 * authorize automatic publication after all required checks; no separate
 * owner decision or per-record approval is needed.
 * Historical authorization retained: Sean,
 * 2026-09-21: "You may enable automatic promotion for qualifying results. Fix
 * the gap, recover value already paid for."
 *
 * Campaign sites currently have the complete deterministic chain and derived
 * Reader connection here. Other fields still need their missing class-specific
 * checks/projection connections; their closed state is an implementation gap,
 * never a policy restriction. Dedicated routine meeting/data contracts have
 * their own verification and publication doors and are not disabled here.
 *
 * Opening a publication route does not resume the owner's paused paid lane.
 * Local diagnostic run files cannot change production authority.
 */
import type { ActivationGateReading } from "./types.ts";
import { ACTIVATION_GATE, classFieldOpen } from "./activation-policy.ts";

/* The decision itself is data in `activation-policy.ts`, which imports nothing, so the runner's publication child may read it. */
export { ACTIVATION_GATE, classFieldOpen };

/** Classes considered by the measured fact chain; its supported-type check still applies. */
export const LOW_RISK_CANDIDATE_CLASSES: readonly string[] = [
  "published-minutes",
  "routine-filings",
  // Reviewed facts enter only the registered permanent meeting partition.
  // This does not open the retired SHADOW writer or any other civic class.
  "meeting-times",
  "agendas",
];

/** Historical API name: these families require implemented checks and Reader connections, not new owner approval. */
export const OWNER_APPROVED_CLASSES: readonly string[] = [
  "candidate-positions",
  "campaign-finance",
  "candidate-enrichment",
  "ballot",
  "votes",
];

/**
 * Read the software policy. `root` is retained for API stability, but no
 * mutable local run record is read or treated as activation authority.
 */
export function readActivationGate(root: string): ActivationGateReading {
  void root;
  const contracts: Record<"READER" | "TRUTH" | "FRESHNESS", string> = {
    READER: "UNREAD",
    TRUTH: "UNREAD",
    FRESHNESS: "UNREAD",
  };
  const open = ACTIVATION_GATE.openRecordClasses
    .map((recordClass) => `${recordClass} (${ACTIVATION_GATE.openFields[recordClass]?.join(", ") ?? "every field"} only)`)
    .join(", ");
  return {
    promotionEnabled: ACTIVATION_GATE.promotionEnabled,
    mode: "SHADOW",
    openRecordClasses: ACTIVATION_GATE.openRecordClasses,
    openFields: ACTIVATION_GATE.openFields,
    contracts,
    independentlyReproduced: false,
    readFrom: null,
    reason:
      `IMPLEMENTED RESEARCH ROUTES — ${ACTIVATION_GATE.openRecordClasses.length} record class(es): ${open}. ` +
      "Standing rulings §3 authorize automatic publication after the complete verification chain. " +
      "Campaign sites publish through their derived civic-data contract. Other generic research fields still " +
      "require class-specific verification and Reader connections; this is an implementation gap, not an owner approval wait. " +
      "Dedicated routine data contracts keep their existing automatic publication paths. Paid acquisition remains subject to its own pause and budget.",
  };
}
