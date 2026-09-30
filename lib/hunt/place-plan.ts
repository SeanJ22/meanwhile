import { buildPlaceOwedList, missingPlaceWork, openPlaceWork, type HeldPlaceField, type PlaceSubject, type PlaceOwedItem } from "../coverage/place-owed.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

export interface PlaceCapture {
  readonly subjects: readonly PlaceSubject[];
  readonly held: readonly HeldPlaceField[];
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
  const held = await input.readHeld(input.divisions.map(d => d.id));
  const before = buildPlaceOwedList({ ...input, ...held });
  const blanks = missingPlaceWork(before);
  const national = blanks.length ? await input.acquireNational(blanks, knowledge) : { subjects: [], held: [] };
  const items = buildPlaceOwedList({ ...input, subjects: [...held.subjects, ...national.subjects], held: [...held.held, ...national.held] });
  return { items, work: missingPlaceWork(items), open: openPlaceWork(items), knowledge };
}
