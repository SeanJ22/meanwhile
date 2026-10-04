import { buildPlaceOwedList, missingPlaceWork, openPlaceWork, type HeldPlaceField, type PlaceSubject, type PlaceOwedItem } from "../coverage/place-owed.ts";
import { openBlanksOf } from "../coverage/open-blanks.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { readHeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

export interface PlaceCapture {
  readonly subjects: readonly PlaceSubject[];
  readonly held: readonly HeldPlaceField[];
  /** A canonical read after publication replaces the earlier snapshot. */
  readonly replacesHeld?: boolean;
}

/** The same rows drive dispatch, the Admin place view and reader gap labels.
 * Readers of held data are deliberately scoped by divisions, never Send or job.
 * A failed read propagates; it cannot create duplicate work for an empty place. */
export async function planPlaceHunt(input: {
  readonly repos: ControlPlaneRepositories;
  readonly divisions: readonly { readonly id: string; readonly label: string }[];
  /** The ZIPs in the place, so ZIP-scope items are owed once per ZIP. */
  readonly zips?: readonly string[];
  readonly now: string;
  readonly clock?: () => string;
  readonly knowledge?: Awaited<ReturnType<typeof readFieldManual>>;
  readonly readHeld?: (divisionIds: readonly string[]) => Promise<PlaceCapture>;
  readonly readOptions?: PromotedCivicDataReadOptions;
  readonly acquireNational: (missing: readonly PlaceOwedItem[], knowledge: Awaited<ReturnType<typeof readFieldManual>>) => Promise<PlaceCapture>;
}) {
  const knowledge = input.knowledge ?? await readFieldManual(input.repos);
  const held = await (input.readHeld ?? (ids => readHeldPlaceCapture(ids, { ...input.readOptions, now: input.now })))(input.divisions.map(d => d.id));
  const before = buildPlaceOwedList({ ...input, ...held });
  // Only blanks that apply, are due, are unsatisfied and are not already being worked go to acquisition.
  const blanks = openBlanksOf(before).all;
  const national = blanks.length ? await input.acquireNational(blanks, knowledge) : { subjects: [], held: [] };
  const observedAt = input.clock?.() ?? input.now;
  const items = buildPlaceOwedList({ ...input, now: observedAt,
    subjects: national.replacesHeld ? national.subjects : [...held.subjects, ...national.subjects],
    held: national.replacesHeld ? national.held : [...held.held, ...national.held] });
  return { items, work: missingPlaceWork(items), open: openPlaceWork(items), blanks, knowledge,
    inherited: { subjects: held.subjects.length, fields: held.held.length,
      publishedFields: before.filter(item => item.state === "published").length, knowledgeEntries: knowledge.store.entries.length },
    conditions: knowledge.error ? [`Shared knowledge could not be read: ${knowledge.error}`] : [] };
}
