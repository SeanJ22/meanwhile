import { readFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { divisionsForZip, type GeographyReadOptions, type PlaceDivision } from "../control-plane/expansion/national-geography.ts";
import { readHeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { collectNationalPlaceSources, type HeldSourcePage, type NationalPlaceSources } from "../sources/plural/place.ts";
import { planPlaceHunt, type PlaceCapture } from "./place-plan.ts";

export interface NationalPlacePublicationInput {
  readonly store: RoutineDataStore;
  readonly now: string;
  readonly divisions: readonly PlaceDivision[];
  readonly geographyCaptures: readonly WorkerPublicationCapture[];
  readonly sources: NationalPlaceSources;
}

/** Shared composition for the ordinary source worker. The existing worker
 * supplies its saved-page reader, Census vault callback and §3 publisher.
 * Only the published read model fills capture rows; a discovery lead cannot
 * close work or make an Admin/reader label claim that a fact is live. */
export async function runPlaceSource(input: {
  readonly repos: ControlPlaneRepositories;
  readonly store: RoutineDataStore;
  readonly zip: string;
  readonly now: string;
  readonly readSource: (url: string, knowledge: Awaited<ReturnType<typeof readFieldManual>>) => Promise<HeldSourcePage>;
  readonly publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  readonly geography?: GeographyReadOptions;
  readonly geographyCaptures: readonly WorkerPublicationCapture[];
  readonly divisions?: readonly PlaceDivision[];
  readonly readHeld?: (divisionIds: readonly string[]) => Promise<PlaceCapture>;
}) {
  if (!/^\d{5}$/.test(input.zip)) throw new Error("A five-digit ZIP is required");
  // This is before even national geography, so every acquisition inherits the
  // same bank. A failed bank read remains visible without holding verified facts.
  const knowledge = await readFieldManual(input.repos);
  const divisions = input.divisions ?? await divisionsForZip(input.zip, input.geography);
  const ids = divisions.map(division => division.id);
  const readHeld = input.readHeld ?? (divisionIds => readHeldPlaceCapture(divisionIds,
    { store: input.store, now: input.now, bypassCache: true }));
  let sources: NationalPlaceSources | null = null;
  let publication: unknown = null;
  const plan = await planPlaceHunt({ repos: input.repos, divisions, now: input.now, knowledge, readHeld,
    acquireNational: async () => {
      sources = await collectNationalPlaceSources({ divisions, now: input.now, read: url => input.readSource(url, knowledge) });
      publication = await input.publish({ store: input.store, now: input.now, divisions,
        geographyCaptures: input.geographyCaptures, sources });
      // Re-read the canonical pointer after publication. Do not substitute a
      // successful function return or a collected field for a published value.
      return { ...await readHeld(ids), replacesHeld: true };
    } });
  return { ...plan, zip: input.zip, divisions, sources, publication };
}
