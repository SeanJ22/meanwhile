/**
 * DB-34: a shut door is put at the top of the stuck list, and its repair is recorded.
 *
 * When a door goes shut, one fix-list item opens (lib/control-plane/fix-list.ts,
 * the one repair log; nothing separate is kept). When it reopens, that item is
 * completed with what broke, what changed (the door record's own edit when one
 * was made, otherwise "nothing on our side"), who, when it shut and when it
 * reopened. Time to repair and the share of repairs that needed no code come
 * from these items. Nothing here names a place.
 */

import { addFixItem, completeFixItem } from "../control-plane/fix-list.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { DoorRecord } from "./registry.ts";

export type FixRepos = Pick<ControlPlaneRepositories, "adminConfig">;

export const SHUT_DOOR_FIX_BY = "The shut-door check";

/** Stable per shut spell: the door and why it shut, so the reopening finds the same item. */
export function shutDoorFixWords(door: Pick<DoorRecord, "doorId" | "kind" | "shutReason">): { where: string; says: string } {
  return { where: `Door ${door.doorId}`, says: `The ${door.kind} door is shut: ${door.shutReason?.trim() || "it stopped working"}.` };
}

export function hoursBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round(((b - a) / 3_600_000) * 10) / 10 : null;
}

/** Open the fix item for a door that just shut. `door` is the record as written (status SHUT). */
export async function openShutDoorFix(repos: FixRepos, door: DoorRecord, at: string): Promise<string> {
  return addFixItem(repos, { ...shutDoorFixWords(door), by: SHUT_DOOR_FIX_BY, at });
}

/** What changed between the shut record and the reopened one, in a sentence. */
export function describeDoorRepair(shut: DoorRecord, reopened: DoorRecord): { whatChanged: string; changedBy: string; before: string; after: string } {
  const edited = reopened.editedAt !== null && shut.shutSince !== null && reopened.editedAt >= shut.shutSince;
  const hosts = (d: DoorRecord) => (d.hosts.length === 0 ? "no host" : d.hosts.join(", "));
  const before = `Shut${shut.shutSince ? ` since ${shut.shutSince}` : ""}: ${shut.shutReason?.trim() || "it stopped working"}; read ${hosts(shut)}.`;
  const after = `Reading again${reopened.reopenedAt ? ` since ${reopened.reopenedAt}` : ""}; reads ${hosts(reopened)}.`;
  return edited
    ? { whatChanged: `The door's record was edited${hosts(shut) !== hosts(reopened) ? ` to read ${hosts(reopened)}` : ""}, and it read well again with no release.`, changedBy: "A change to the door's record", before, after }
    : { whatChanged: "Nothing on our side changed; the source answered again.", changedBy: "The source itself", before, after };
}

/** Complete the item a shut spell opened. `shut` is the record before it reopened; `reopened` after. */
export async function completeReopenedDoorFix(repos: FixRepos, shut: DoorRecord, reopened: DoorRecord, at: string): Promise<void> {
  const { where, says } = shutDoorFixWords(shut);
  const shutFor = shut.shutSince === null ? null : hoursBetween(shut.shutSince, at);
  const done = describeDoorRepair(shut, reopened);
  const record = await addFixItem(repos, { where, says, by: SHUT_DOOR_FIX_BY, at: shut.shutSince ?? at }); // idempotent: finds the item, or opens one if the shut was never recorded
  await completeFixItem(repos, record, { ...done, whatChanged: shutFor === null ? done.whatChanged : `${done.whatChanged} Shut for ${shutFor} hours.` }, at);
}
