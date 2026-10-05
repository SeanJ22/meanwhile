/**
 * The activation gate's decision, as data, with no import at all
 * (`activation-gate.ts` says why it is what it is, and re-exports this). A
 * routine civic-data child may read it: the firewall follows every import,
 * type-only ones too, and the gate's reading type reaches the scheduler.
 */

/**
 * Open by §3 (docs/rulings.md §3, §9; Sean, 2026-09-29): officials and rosters,
 * bodies, meetings, election contacts and candidate bios, plus the other
 * worker reader classes. A fact in an open class publishes as soon as it
 * passes §3; a class with no implemented reader door is an engineering gap,
 * never a closed gate.
 */
export const ACTIVATION_GATE = {
  promotionEnabled: true,
  openRecordClasses: [
    "candidate-enrichment",
    "meeting-times", "agendas", "published-minutes",
    "OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY",
    "VOTER_ACCESS_ROUTE", "PUBLIC_COMMENT_RULE", "SERVICE_CONTACT",
    "CANDIDATE_FILING_DOCUMENT", "CAMPAIGN_FINANCE_FILING",
  ] as readonly string[],
  /** Within an open class, the only fields that may be approved. A class absent here has no field restriction. */
  openFields: {} as Readonly<Record<string, readonly string[]>>,
} as const;

/** What `classFieldOpen` reads of a gate reading. */
export interface ActivationGatePolicy {
  readonly promotionEnabled: boolean;
  readonly openRecordClasses: readonly string[];
  readonly openFields?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Whether one field of one class is open. A class that is open with no field
 * list is open for every field; a class with a field list is open for those
 * fields only; a closed class is open for nothing.
 */
export function classFieldOpen(
  gate: ActivationGatePolicy,
  recordClass: string,
  field: string,
): boolean {
  if (!gate.promotionEnabled || !gate.openRecordClasses.includes(recordClass)) return false;
  const fields = gate.openFields?.[recordClass];
  return fields === undefined || fields.includes(field);
}
