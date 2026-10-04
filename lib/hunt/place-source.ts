import { readFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { divisionsForZip, type GeographyReadOptions, type PlaceDivision } from "../control-plane/expansion/national-geography.ts";
import { readHeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { collectNationalPlaceSources, openNationalFamilies, type HeldSourcePage, type NationalPlaceSources, type NationalSourceFamilies } from "../sources/plural/place.ts";
import { planPlaceHunt, type PlaceCapture } from "./place-plan.ts";
import type { publishElectionFields } from "../civic-data/election-field-publication.ts";
import { section3Record } from "../control-plane/promotion/section3.ts";

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
  readonly clock?: () => string;
  readonly readSource: (url: string, knowledge: Awaited<ReturnType<typeof readFieldManual>>) => Promise<HeldSourcePage>;
  readonly knowledge?: Awaited<ReturnType<typeof readFieldManual>>;
  readonly publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  /** Worker brokers serialize shared-pointer writes while acquisition runs in parallel. */
  readonly publishElection?: (fields: NationalPlaceSources["electionFields"], now: string) => ReturnType<typeof publishElectionFields>;
  readonly geography?: GeographyReadOptions;
  readonly geographyCaptures: readonly WorkerPublicationCapture[];
  readonly divisions?: readonly PlaceDivision[];
  readonly readHeld?: (divisionIds: readonly string[]) => Promise<PlaceCapture>;
}) {
  if (!/^\d{5}$/.test(input.zip)) throw new Error("A five-digit ZIP is required");
  // This is before even national geography, so every acquisition inherits the
  // same bank. A failed bank read remains visible without holding verified facts.
  const knowledge = input.knowledge ?? await readFieldManual(input.repos);
  const divisions = input.divisions ?? await divisionsForZip(input.zip, input.geography);
  const ids = divisions.map(division => division.id);
  const readHeld = input.readHeld ?? (divisionIds => readHeldPlaceCapture(divisionIds,
    { store: input.store, now: input.clock?.() ?? input.now, bypassCache: true }));
  let sources: NationalPlaceSources | null = null;
  let publication: unknown = null;
  const publications: unknown[] = [];
  const electionPublications: (Awaited<ReturnType<typeof publishElectionFields>> | { error: string })[] = [];
  let families = null as NationalSourceFamilies | null;
  const plan = await planPlaceHunt({ repos: input.repos, divisions, now: input.now, clock: input.clock, knowledge, readHeld,
    acquireNational: async blanks => {
      // Read only the families that still have an open blank; a second pass on a place with nothing open reads nothing.
      families = openNationalFamilies(blanks);
      // One pointer is updated serially, while source reads remain parallel.
      // A ready official never waits behind the state's election-page walk.
      let publicationQueue = Promise.resolve();
      let publishedBatches = 0;
      const publish = (ready: NationalPlaceSources) => {
        publicationQueue = publicationQueue.then(async () => {
          try {
            publication = await input.publish({ store: input.store, now: input.clock?.() ?? input.now, divisions,
              geographyCaptures: input.geographyCaptures, sources: ready });
          } catch (error) {
            publication = { error: error instanceof Error ? error.message : String(error) };
          }
          publications.push(publication);
          if (ready.electionFields.length) {
            try {
              const now = input.clock?.() ?? input.now;
              electionPublications.push(await (input.publishElection
                ? input.publishElection(ready.electionFields, now)
                : (await import("../civic-data/election-field-publication.ts")).publishElectionFields({
                  store: input.store, now, fields: ready.electionFields, verify: section3Record })));
            }
            catch (error) { electionPublications.push({ error: error instanceof Error ? error.message : String(error) }); }
          }
          publishedBatches++;
        });
        return publicationQueue;
      };
      sources = await collectNationalPlaceSources({ divisions, now: input.now, knowledge,
        read: url => input.readSource(url, knowledge), onSources: publish, families });
      if (!publishedBatches) await publish(sources);
      await publicationQueue;
      // Re-read the canonical pointer after publication. Do not substitute a
      // successful function return or a collected field for a published value.
      return { ...await readHeld(ids), replacesHeld: true };
    } });
  // Acquisition never ran when nothing was open, so every family was skipped.
  return { ...plan, zip: input.zip, families: families ?? { officials: false, elections: false }, divisions, sources: sources as NationalPlaceSources | null, publication, publications, electionPublications };
}
