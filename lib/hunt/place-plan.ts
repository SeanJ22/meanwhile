import { buildPlaceOwedList, missingPlaceWork, openPlaceWork, type HeldPlaceField, type PlaceSubject, type PlaceOwedItem } from "../coverage/place-owed.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";
import { transitionWorkItem } from "../control-plane/repository/coordinator.ts";
import { readHeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

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
  // Read only these subjects once, rather than querying every checklist blank
  // (or scanning the complete work history) on every hunt.
  const existing = new Map((await Promise.all([...new Set(items.map(item => item.subject.id))]
    .map(subject => repos.workItems.listWhere(["subject"], subject)))).flat().map(row => [row.id, row]));
  for (const item of items) {
    const id = placeFieldWork(item, now).id;
    const current = existing.get(id);
    if (!current) continue;
    if (item.state !== "published" && item.state !== "unpublished") {
      if (current.value.state === "VERIFIED_COMPLETE" || current.value.state === "NOT_YET_PUBLISHED") {
        await transitionWorkItem(repos, { workItemId: id, to: "REOPENED", now, by: "place-capture",
          why: `${item.requirement}: the current shared read model no longer has a fresh published field or a fresh official unpublished finding` });
      }
      continue;
    }
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
  readonly readHeld?: (divisionIds: readonly string[]) => Promise<PlaceCapture>;
  readonly readOptions?: PromotedCivicDataReadOptions;
  readonly acquireNational: (missing: readonly PlaceOwedItem[], knowledge: Awaited<ReturnType<typeof readFieldManual>>) => Promise<PlaceCapture>;
}) {
  const knowledge = input.knowledge ?? await readFieldManual(input.repos);
  const held = await (input.readHeld ?? (ids => readHeldPlaceCapture(ids, { ...input.readOptions, now: input.now })))(input.divisions.map(d => d.id));
  const before = buildPlaceOwedList({ ...input, ...held });
  const blanks = missingPlaceWork(before);
  const national = blanks.length ? await input.acquireNational(blanks, knowledge) : { subjects: [], held: [] };
  const items = buildPlaceOwedList({ ...input, subjects: [...held.subjects, ...national.subjects], held: [...held.held, ...national.held] });
  const closed = await closePublishedPlaceWork(input.repos, items, input.now);
  return { items, work: missingPlaceWork(items), open: openPlaceWork(items), closed, knowledge,
    conditions: knowledge.error ? [`Shared knowledge could not be read: ${knowledge.error}`] : [] };
}
