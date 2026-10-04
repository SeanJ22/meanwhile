/** A system-owned door record written whole by a plain-code job (the link sweep), never by a person. */

import { checkDoorDraft, isDoorRecord, type DoorConfigValue, type DoorRecord, type DoorRepository } from "./registry.ts";

export async function upsertSystemDoor(
  repo: DoorRepository,
  draft: { readonly doorId: string; readonly kind: string; readonly holds: readonly string[]; readonly config: Readonly<Record<string, DoorConfigValue>>; readonly notes: string },
  at: string,
): Promise<void> {
  const checked = checkDoorDraft({ ...draft, status: "OPEN" });
  if (!checked.ok) throw new Error(`DOOR_DRAFT_INVALID: ${checked.why}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await repo.read(draft.doorId);
    const previous = existing !== null && isDoorRecord(existing.value) ? existing.value : null;
    const next: DoorRecord = {
      formatVersion: 1,
      ...checked.value,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastFailureAt: previous?.lastFailureAt ?? null,
      validators: previous?.validators ?? null,
      shutSince: null,
      origin: "DERIVED",
      editedAt: previous?.editedAt ?? null,
      updatedAt: at,
    };
    try {
      if (existing === null) await repo.put(draft.doorId, next, at);
      else await repo.compareAndSet(draft.doorId, existing.revision, next, at);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}
