import { readFieldManual,readFieldManualSourceHints } from "../control-plane/field-manual.ts";
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

export async function runPlaceSource(input: {
  readonly repos: ControlPlaneRepositories;
  readonly store: RoutineDataStore;
  readonly zip: string;
  readonly now: string;
  readonly clock?: () => string;
  readonly readSource: (url: string, knowledge: Awaited<ReturnType<typeof readFieldManual>>) => Promise<HeldSourcePage>;
  readonly knowledge?: Awaited<ReturnType<typeof readFieldManual>>;
  readonly publish: (input: NationalPlacePublicationInput) => Promise<unknown>;

  readonly publishElection?: (fields: NationalPlaceSources["electionFields"], now: string) => ReturnType<typeof publishElectionFields>;
  readonly geography?: GeographyReadOptions;
  readonly geographyCaptures: readonly WorkerPublicationCapture[];
  readonly divisions?: readonly PlaceDivision[];
  readonly readHeld?: (divisionIds: readonly string[]) => Promise<PlaceCapture>;
}) {
  if (!/^\d{5}$/.test(input.zip)) throw new Error("A five-digit ZIP is required");
  const divisions = input.divisions ?? await divisionsForZip(input.zip, input.geography);

  const knowledge = input.knowledge ?? await readFieldManual(input.repos, { ocdIds: divisions.map(division => division.id),limit:40 });
  const ids = divisions.map(division => division.id);
  const readHeld = input.readHeld ?? (divisionIds => readHeldPlaceCapture(divisionIds,
    { store: input.store, now: input.clock?.() ?? input.now, bypassCache: true }));
  let sources: NationalPlaceSources | null = null;
  let publication: unknown = null;
  const publications: unknown[] = [];
  const electionPublications: (Awaited<ReturnType<typeof publishElectionFields>> | { error: string })[] = [];
  let families = null as NationalSourceFamilies | null;
  const plan = await planPlaceHunt({ repos: input.repos, divisions, zips: [input.zip], now: input.now, clock: input.clock, knowledge, readHeld,
    acquireNational: async blanks => {

      families = openNationalFamilies(blanks);

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
      sources = await collectNationalPlaceSources({ divisions, now: input.now,sourceHints:url=>readFieldManualSourceHints(input.repos,{ocdIds:ids},url),
        read: url => input.readSource(url, knowledge), onSources: publish, families });
      if (!publishedBatches) await publish(sources);
      await publicationQueue;

      return { ...await readHeld(ids), replacesHeld: true };
    } });

  return { ...plan, zip: input.zip, families: families ?? { officials: false, elections: false }, divisions, sources: sources as NationalPlaceSources | null, publication, publications, electionPublications };
}
