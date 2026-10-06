/**
 * The pointers the Reader combines beside Pima's and Mesa's (DB-22): one per door that collects outcomes.
 *
 * A leaf on purpose. The Reader's outcome store is bundled into request routes with a tight trace ceiling, so it must
 * not import the modules that build door contracts; the runner side (`lib/civic-data/outcome-partitions.ts`) fills this
 * list when a pass reads the registry's doors, and the store reads it. Empty until then, so a process that never read
 * the doors combines Pima and Mesa exactly as before.
 */
export interface DoorOutcomePointer {
  readonly contractId: string;
  readonly scope: string;
  readonly recordClass: "MEETING_OUTCOME";
  /** The Legistar client name every sitting of this pointer carries. */
  readonly slug: string;
  /** `legistar` sittings are `legistar:<slug>:<id>`; `legistar-insite` sittings are `legistar-insite:<slug>:<id>`. */
  readonly kind: "legistar" | "legistar-insite";
}

export const DOOR_OUTCOME_POINTERS: DoorOutcomePointer[] = [];

export function setDoorOutcomePointers(pointers: readonly DoorOutcomePointer[]): void {
  DOOR_OUTCOME_POINTERS.splice(0, DOOR_OUTCOME_POINTERS.length, ...pointers);
}

/** The meeting-id prefix a pointer's sittings carry. */
export function doorOutcomeMeetingPrefix(pointer: Pick<DoorOutcomePointer, "kind" | "slug">): string {
  return `${pointer.kind}:${pointer.slug}:`;
}

/** A pointer's identity check: its own slug and its own meeting-id namespace, nothing else. */
export function doorOutcomeScopeIssue(
  pointer: Pick<DoorOutcomePointer, "kind" | "slug" | "contractId">,
  value: { readonly tenants: readonly string[]; readonly sittings: readonly { readonly slug: string; readonly meetingId: string }[] },
): string | null {
  const prefix = doorOutcomeMeetingPrefix(pointer);
  if (value.tenants.some((tenant) => tenant !== pointer.slug)) return `${pointer.contractId} names a different tenant.`;
  const stray = value.sittings.find((sitting) => sitting.slug !== pointer.slug || !sitting.meetingId.startsWith(prefix));
  return stray ? `${stray.meetingId} crosses ${pointer.contractId}'s tenant or meeting-id scope.` : null;
}
