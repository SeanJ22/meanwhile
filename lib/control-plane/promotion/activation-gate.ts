/**
 * THE ACTIVATION GATE — what a research finding may be promoted as. (RULING 242,
 * as amended below.)
 *
 *   promotionEnabled   true for exactly the classes in openRecordClasses, and
 *                      within a class for exactly the fields in openFields
 *   openRecordClasses  `candidate-enrichment`, campaign sites only. Every other
 *                      class stays closed until the owner opens it by name
 *
 * **WHY CANDIDATE ENRICHMENT IS OPEN, AND ONLY FOR CAMPAIGN SITES.** Sean,
 * 2026-09-21: "You may enable automatic promotion for qualifying results. Fix
 * the gap, recover value already paid for." — and RULING 292, the same day:
 * information that passes the existing verification and publication checks
 * publishes automatically through the production data plane. The largest held
 * class of paid research is campaign-site findings for 2026 candidates. A
 * campaign-site item qualifies only by the complete chain in
 * `campaign-site-chain.ts`: a robots-first re-read by our own deterministic
 * Attempt, the five measured checks, an audit with measured controls and an
 * independent second signal, and the deterministic approval burdens. It then
 * publishes automatically through the civic-data door the standing runner may
 * use — the DERIVED routine contract `candidate-campaign-sites-derived`, its
 * validator and typed Reader verification — beside the owner's
 * `candidate-profiles` door, which stays the only writer of profiles. Photos,
 * contact, positions and bios stay closed: no field outside `openFields` is
 * approvable, whatever its chain says.
 *
 * **OPENING A CLASS DOES NOT OPEN THE PAID LANE WHILE THE OWNER'S PAUSE STANDS.**
 * `model-lane.ts` reads this gate as a delivery path, and its ordered closure
 * checks the owner's PAUSE after the delivery path: gate open + pause = PAUSED,
 * no paid model call (tests/campaign-site-gate.test.ts pins it). The campaign-site
 * path itself is plain code and needs no model at all.
 *
 * PDC makes local freshness-shadow run files diagnostic history only. They
 * cannot activate promotion or supply live operational truth: this decision is
 * code, and no file on disk changes it.
 */
import type { ActivationGateReading } from "./types.ts";
import { ACTIVATION_GATE, classFieldOpen } from "./activation-policy.ts";

/* The decision itself is data in `activation-policy.ts`, which imports nothing, so the runner's publication child may read it. */
export { ACTIVATION_GATE, classFieldOpen };

/** Candidates for the FIRST classes to open, for a later decision. Not open. */
export const LOW_RISK_CANDIDATE_CLASSES: readonly string[] = [
  "published-minutes",
  "routine-filings",
  // Reviewed facts enter only the registered permanent meeting partition.
  // This does not open the retired SHADOW writer or any other civic class.
  "meeting-times",
  "agendas",
];

/** Classes that stay closed until the owner approves each one by name. `candidate-enrichment` is approved for campaign sites (above). */
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
      `CLASS-SCOPED — ${ACTIVATION_GATE.openRecordClasses.length} record class(es) open: ${open}, on the owner's ` +
      "2026-09-21 authorization for automatic promotion of qualifying results (RULING 292). An open item still " +
      "passes its complete chain and publishes only through the derived candidate-campaign-sites civic-data door; every other " +
      "class stays closed. The nightly window itself promotes nothing (SHADOW), and local freshness-shadow run " +
      "records are non-authoritative diagnostics after PDC",
  };
}
