import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStatePackage, readStateAuthorities, primeStateDistrictPointers, primeStateReaderPointers } from "../reader/state.ts";
import { readPlacePackage } from "../reader/place.ts";
import { readZipPlace } from "../place-map/reader.ts";
import { readerTerritory, territoryBodies } from "../reader/location.ts";
import { readCanonicalShelf, readCanonicalPackages } from "../reader/canonical.ts";
import { primeReaderCanonicalStore, readerCanonicalEntry } from "../reader/canonical-context.ts";
import { primeReaderProjection } from "../civic-data/read-model.ts";
import { stateAuthorityPointers } from "../civic-data/state-reader.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { requiredRoutineContract } from "../civic-data/contracts.ts";
import { translationScope } from "../translate/records.ts";
import { withStateRegistryFacts, combineStateRegistries } from "../registry/state-composition.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { GeographySelection } from "../census-geography/selection.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import type { BallotPlace } from "./reader-place.ts";
import type { BallotSet, Contest } from "./types.ts";
import {ballotCandidateKeys} from "./candidate-keys.ts";
import { settleFederalDirectoryRead } from "../registry/server.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";

/** The ballot shares the map's state and indexed local records; its own records use canonical batches. */
export async function readBallotReaderData(place: BallotPlace, readTerritory = readerTerritory) {
  const selection = currentReaderSelection();
  if (!place.centroid || !selection || currentReaderAuthorityEdge()) return null;
  const rawEntry = place.zip ? await readZipPlace(place.zip) : null;
  const states = place.state ? [place.state.code] : [...new Set([...rawEntry?.states ?? [], ...selection.states ?? []])];
  if (!states.length) return null;
  const point = place.centroid;
  const zip = place.zip ?? undefined;
  const packages = states.map(state => ({ state, read: readStatePackage(state, [], zip, {earlyDistricts:true}) }));
  // Reserve these promises now: the ballot's early incumbent and portrait reads
  // consume the state query's verified ZIP slices instead of opening another read.
  if (zip) for (const {state,read} of packages) void primeStateReaderPointers(state,read).catch(()=>undefined);
  const territories = await Promise.allSettled(states.map(readTerritory));
  const places = packages.map(async ({ state, read }, index) => {
    const territory = territories[index];
    if (territory.status === "rejected") throw territory.reason;
    const local = readPlacePackage({ state, divisionIds: rawEntry ? [...rawEntry.ids, ...rawEntry.fringe ?? []] : selection.divisions ?? [], bodyFactsOnly: true,
      bodyIds: territoryBodies(point.lat, point.lng, territory.value) });
    const [held, facts] = await Promise.all([readStateAuthorities(read), local]);
    if (held.registryRead.kind !== "PROMOTED" && held.registryRead.kind !== "BOOTSTRAP") throw new Error(`STATE_PACKAGE_NOT_RECORDED:${state}`);
    return withStateRegistryFacts(held.registryRead.value, facts.bodies);
  });
  const divisions = [...new Set([...rawEntry?.ids ?? [], ...rawEntry?.fringe ?? [], ...selection.divisions ?? [],
    ...states.map(state => `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`)])];
  const entries: { recordClass: RoutineRecordClass; scope: string }[] = states.flatMap(state => [
    ...(zip ? ["ballot-navigation"] as const : ["ballot-contests", "ballot-navigation"] as const).flatMap(family =>
      stateAuthorityPointers(family, state)),
    ...(state === "NH" && !zip ? [requiredRoutineContract("nh-members")] : []),
  ]);
  entries.push(requiredManualProductionContract("official-filings"));
  for (const division of divisions) {
    if (!jurisdictionFromOcdId(division)) continue;
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) });
  }
  const unique = [...new Map(entries.map(entry => [`${entry.recordClass}:${entry.scope}`, entry])).values()];
  const ballots = unique.filter(entry => entry.recordClass === "BALLOT_CANDIDACY");
  const other = unique.filter(entry => !ballots.includes(entry));
  const baseRead = primeReaderCanonicalStore(unique, readCanonicalPackages([ballots, other]));
  const entry = async (geography?: GeographySelection) => {
    if (!place.zip) return rawEntry;
    return geography ? readZipPlace(place.zip, geography) : rawEntry;
  };
  const districtRead = entry().then(async value => {
    // Finish registering the pointers carried by the geography query before
    // deciding which ones are missing, including its confirmed absences.
    await Promise.all(packages.map(({ read }) => primeStateDistrictPointers(read)));
    const extra = [...value?.ids ?? [], ...value?.fringe ?? []].filter(id => !divisions.includes(id) && jurisdictionFromOcdId(id)).flatMap(id => [
      { recordClass: "CURATED_READER_RECORD" as const, scope: translationScope(id) },
    ]);
    const missing = extra.filter(entry => !readerCanonicalEntry(entry.recordClass, entry.scope));
    if (missing.length) await primeReaderCanonicalStore(missing, readCanonicalShelf(missing));
  });
  const canonicalRead = Promise.all([baseRead, districtRead]).then(() => undefined);
  const registryRead = Promise.all(places).then(values => {
    const value = values.length === 1 ? values[0] : combineStateRegistries(values);
    withRegistryRuntimeProjection(value, states, () => undefined);
  });
  // Early failures remain available to the owning ballot section without unhandled rejections.
  void canonicalRead.catch(() => undefined);
  void registryRead.catch(() => undefined);
  return { registryRead, districtRead, entry };
}

/** A ballot store primed from canonical entries; it never reads a promotion or a candidate body. */
const CANONICAL_ENTRY_ONLY = {
  async readPromotion(): Promise<never> { throw new Error("READER_USES_CANONICAL_ENTRY"); },
  async readCandidate(): Promise<never> { throw new Error("READER_USES_CANONICAL_ENTRY"); },
};

export async function primeBallotCandidateDetails(set: BallotSet, contests: readonly Contest[]): Promise<void> {
  if (!currentReaderSelection() || currentReaderAuthorityEdge()) return;
  const pointers=(["candidate-profiles","candidate-publications","candidate-campaign-sites-derived"] as const)
    .flatMap(family=>stateAuthorityPointers(family,set.election.state));
  await primeReaderCanonicalStore(pointers,readCanonicalShelf(pointers));
}

/** Read money for the exact displayed contests, retaining candidates and earlier filings. */
export async function primeBallotFundingRead(set: BallotSet, contests: readonly Contest[]): Promise<void> {
  if (!currentReaderSelection() || currentReaderAuthorityEdge()) return;
  const keys = new Set(ballotCandidateKeys(set,contests));
  // A registration may be held under the official's native id alone. Finish
  // the shared directory read before pinning this request's FEC slice.
  try {
    await settleFederalDirectoryRead();
    const roster = getFederalOfficeholderSet();
    const divisions = new Set(contests.map(contest => contest.ocdId));
    const holders = new Set(roster.divisions.filter(row => divisions.has(row.ocdId)).map(row => row.officeholderId));
    for (const person of roster.officeholders) if (holders.has(person.id))
      for (const key of personIdentityKeys(person)) keys.add(key);
  } catch { /* Ballot-bound FEC records remain readable if the directory is unavailable. */ }
  if (keys.size) {
    const pointer = requiredRoutineContract("fec-funding");
    const entry = await primeReaderProjection("FEC_FUNDING", pointer.scope,
      [...currentReaderSelection()!.keys,...keys],{exactKeys:true});
    await primeReaderCanonicalStore([{ recordClass: "FEC_FUNDING", scope: pointer.scope }], {
      ...CANONICAL_ENTRY_ONLY,
      async readPromotedEntry() { return entry; },
    });
  }
}
