import { buildPlaceOwedList, missingPlaceWork, openPlaceWork, type HeldPlaceField, type PlaceSubject, type PlaceOwedItem } from "../coverage/place-owed.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";
import { transitionWorkItem } from "../control-plane/repository/coordinator.ts";

export interface PlaceCapture {
  readonly subjects: readonly PlaceSubject[];
  readonly held: readonly HeldPlaceField[];
}

/** One existing WorkItem per canonical field, shared by every applicable ZIP.
 * Schedulers use this identity; a body's other blanks are separate work. */
export function placeFieldWork(item: PlaceOwedItem, now: string): WorkItem {
  return createWorkItem({ project: "freshness", subject: item.subject.id,
    obligation: `Place capture ${item.checklistId}`, why: item.requirement, now });
}

/** Reconcile only these exact field items against the published read model.
 * Acquisition alone never closes work, and a broad worker id is not a field id. */
export async function closePublishedPlaceWork(repos: ControlPlaneRepositories, items: readonly PlaceOwedItem[], now: string): Promise<string[]> {
  const closed: string[] = [];
  for (const item of items) {
    if (item.state !== "published" && item.state !== "unpublished") continue;
    const id = placeFieldWork(item, now).id;
    const current = await repos.workItems.read(id);
    if (!current) continue;
    const to = item.state === "published" ? "VERIFIED_COMPLETE" : "NOT_YET_PUBLISHED";
    if (current.value.state === to) continue;
    await transitionWorkItem(repos, { workItemId: id, to, now, by: "place-capture",
      why: `${item.requirement}: ${item.state === "published" ? "field published" : "official source records it as unpublished"}; ${item.held.filter(f => f.state === item.state).map(f => f.sourceUrl).join(", ")}` });
    closed.push(id);
  }
  return closed;
}

/** The same rows drive dispatch, the Admin place view and reader gap labels.
 * Readers of held data are deliberately scoped by divisions, never Send or job.
 * A failed read propagates; it cannot create duplicate work for an empty place. */
export async function planPlaceHunt(input: {
  readonly repos: ControlPlaneRepositories;
  readonly divisions: readonly { readonly id: string; readonly label: string }[];
  readonly now: string;
  readonly knowledge?: Awaited<ReturnType<typeof readFieldManual>>;
  readonly readHeld: (divisionIds: readonly string[]) => Promise<PlaceCapture>;
  readonly acquireNational: (missing: readonly PlaceOwedItem[], knowledge: Awaited<ReturnType<typeof readFieldManual>>) => Promise<PlaceCapture>;
}) {
  const knowledge = input.knowledge ?? await readFieldManual(input.repos);
  if (knowledge.error) throw new Error(`Shared knowledge could not be read: ${knowledge.error}`);
  const held = await input.readHeld(input.divisions.map(d => d.id));
  const before = buildPlaceOwedList({ ...input, ...held });
  const blanks = missingPlaceWork(before);
  const national = blanks.length ? await input.acquireNational(blanks, knowledge) : { subjects: [], held: [] };
  const items = buildPlaceOwedList({ ...input, subjects: [...held.subjects, ...national.subjects], held: [...held.held, ...national.held] });
  const closed = await closePublishedPlaceWork(input.repos, items, input.now);
  return { items, work: missingPlaceWork(items), open: openPlaceWork(items), closed, knowledge };
}
