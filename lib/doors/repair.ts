/**
 * A door is repaired by editing its record, for both the `door.update` gateway
 * action and a detective. Changes only the fields named and sets `readNow`. It
 * never reopens a shut door by itself: a shut door reopens when a read of the
 * new record succeeds. The previous record is returned so Undo can restore it.
 */

import { startFixItem } from "../control-plane/fix-list.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { applyManualEdit, checkDoorDraft, editableFieldsOf, isDoorRecord, type DoorDraft, type DoorRecord } from "./registry.ts";
import { shutDoorFixWords } from "./shut-repair.ts";
import { fixSubjectId } from "../control-plane/fix-queue.ts";

type Repos = Pick<ControlPlaneRepositories, "doors" | "adminConfig">;

export type DoorRepair =
  | { readonly ok: true; readonly previous: DoorRecord; readonly next: DoorRecord; readonly changed: readonly string[] }
  | { readonly ok: false; readonly says: string };

const FIELDS = ["kind", "ocdId", "bodyIds", "hosts", "config", "holds", "checkEveryMinutes", "notes", "meeting", "status"] as const;

/** Which of the draft's fields differ from the record, in plain field names. */
function changedFields(before: Required<DoorDraft>, after: Required<DoorDraft>): string[] {
  return FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
}

/** Apply `changes` over the stored door. Only the fields supplied are changed. No such door: nothing is invented. */
export async function repairDoor(repos: Repos, doorId: string, changes: Partial<DoorDraft>, at: string): Promise<DoorRepair> {
  const row = await repos.doors.read(doorId);
  if (row === null) return { ok: false, says: `There is no door ${doorId}, so nothing was changed.` };
  if (!isDoorRecord(row.value)) return { ok: false, says: `The stored record for ${doorId} could not be read, so nothing was changed.` };
  const previous = row.value;
  const before = editableFieldsOf(previous);
  const checked = checkDoorDraft({ ...before, ...changes, doorId, readNow: true });
  if (!checked.ok) return { ok: false, says: `Nothing was saved: ${checked.why}.` };
  const next = applyManualEdit(previous, checked.value, at);
  await repos.doors.compareAndSet(doorId, row.revision, next, at);
  if (previous.status === "SHUT") {
    const { where, says } = shutDoorFixWords(previous);
    await startFixItem(repos, fixSubjectId(where, says), at).catch(() => undefined);
  }
  return { ok: true, previous, next, changed: changedFields(before, editableFieldsOf(next)) };
}
