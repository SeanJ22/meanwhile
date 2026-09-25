/**
 * The activation gate's decision, as data, with no import at all
 * (`activation-gate.ts` says why it is what it is, and re-exports this). A
 * routine civic-data child may read it: the firewall follows every import,
 * type-only ones too, and the gate's reading type reaches the scheduler.
 */

export const ACTIVATION_GATE = {
  promotionEnabled: true,
  openRecordClasses: ["candidate-enrichment"] as readonly string[],
  /** Within an open class, the only fields that may be approved. A class absent here has no field restriction. */
  openFields: { "candidate-enrichment": ["campaignSite"] } as Readonly<Record<string, readonly string[]>>,
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
