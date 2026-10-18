import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStatePackage, readStateDistricts } from "../reader/state.ts";
import { readPlacePackage } from "../reader/place.ts";
import { readZipPlaces, stateForZip } from "../reader/national.ts";
import { readerTerritory, territoryBodies } from "../reader/location.ts";
import { readCanonicalShelf, readCanonicalPackages } from "../reader/canonical.ts";
import { primeReaderCanonicalStore, readerCanonicalEntry } from "../reader/canonical-context.ts";
import { primeReaderProjection } from "../civic-data/read-model.ts";
import { stateAuthorityPointers } from "../civic-data/state-reader.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { requiredRoutineContract } from "../civic-data/contracts.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../funding/data-plane.ts";
import { translationScope } from "../translate/records.ts";
import { campaignFinanceScope } from "../funding/campaign-finance-reader.ts";
import { withStateRegistryFacts, combineStateRegistries } from "../registry/state-composition.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { withCensusDistricts } from "../geo/zip-census-districts.ts";
import { postalArea } from "../geo/postal.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { GeographySelection } from "../census-geography/selection.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import type { BallotPlace } from "./reader-place.ts";
import type { GenericBallotProjection } from "./generic-projection.ts";
import { officeIdentity } from "../officials/office-identity.ts";

/** The ballot shares the map's state and indexed local records; its own records use canonical batches. */
export async function readBallotReaderData(place: BallotPlace) {
  const selection = currentReaderSelection();
  if (!place.centroid || !selection || currentReaderAuthorityEdge()) return null;
  const states = place.state ? [place.state.code] : place.zip && stateForZip(place.zip)
    ? [...new Set([stateForZip(place.zip)!, ...selection.states ?? []])] : [...selection.states ?? []];
  if (!states.length) return null;
  const point = place.centroid;
  const packages = states.map(state => ({ state, read: readStatePackage(state), districts: readStateDistricts(state) }));
  const rawEntry = place.zip ? (await readZipPlaces()).get(postalArea(place.zip)?.zcta ?? place.zip) ?? null : null;
  const divisions = [...new Set([...rawEntry?.ids ?? [], ...selection.divisions ?? [],
    ...states.map(state => `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`)])];
  const entries: { recordClass: RoutineRecordClass; scope: string }[] = states.flatMap(state => [
    ...(["ballot-contests", "candidate-profiles", "candidate-publications", "candidate-campaign-sites-derived"] as const).flatMap(family =>
      stateAuthorityPointers(family, state)),
    ...(Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, state) ? [{ recordClass: "STATE_CAMPAIGN_FINANCE" as const,
      scope: STATE_CAMPAIGN_FINANCE_SOURCES[state as StateCampaignFinanceJurisdiction].scope }] : []),
    ...(state === "NH" ? [requiredRoutineContract("nh-members")] : []),
  ]);
  for (const id of ["ballot-navigation", "official-filings"] as const) entries.push(requiredManualProductionContract(id));
  for (const division of divisions) {
    if (!jurisdictionFromOcdId(division)) continue;
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) });
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: campaignFinanceScope(division) });
  }
  const unique = [...new Map(entries.map(entry => [`${entry.recordClass}:${entry.scope}`, entry])).values()];
  const ballots = unique.filter(entry => entry.recordClass === "BALLOT_CANDIDACY");
  const candidates = unique.filter(entry => ["CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION"].includes(entry.recordClass));
  const other = unique.filter(entry => !ballots.includes(entry) && !candidates.includes(entry));
  const baseRead = primeReaderCanonicalStore(unique, readCanonicalPackages([ballots, candidates, other]));
  const fundingRead = (async () => {
    const keys: string[] = [];
    for (const state of states) for (const pointer of stateAuthorityPointers("ballot-contests", state)) {
      const held = await readerCanonicalEntry(pointer.recordClass, pointer.scope);
      if (held?.kind !== "PROMOTED") continue;
      for (const ballot of Object.values((held.projection.payload as GenericBallotProjection).ballots)) {
        const contests = new Set(ballot.contests.filter(contest => ["us_senator", "us_representative"].includes(officeIdentity(contest.title) ?? "")).map(contest => contest.id));
        keys.push(...[...ballot.candidacies, ...ballot.filingCandidacies ?? []].filter(candidate => contests.has(candidate.contestId)).map(candidate => candidate.id));
        for (const lineup of ballot.generalLineup?.contests ?? []) if (contests.has(lineup.contestId)) {
          keys.push(...lineup.nominees.map(nominee => `${lineup.contestId}|${nominee.name}`));
        }
      }
    }
    if (keys.length) await primeReaderProjection("FEC_FUNDING", requiredRoutineContract("fec-funding").scope, keys);
  })();
  const entry = async (geography?: GeographySelection) => {
    if (!place.zip || !rawEntry) return rawEntry;
    let value = rawEntry;
    for (const { districts } of packages) {
      const held = await districts;
      if (held.kind === "HELD") value = withCensusDistricts(value,
        { ...held, value: { ...held.value, known: true } }, place.zip, geography);
    }
    return value;
  };
  const districtRead = entry().then(async value => {
    const extra = (value?.ids ?? []).filter(id => !divisions.includes(id) && jurisdictionFromOcdId(id)).flatMap(id => [
      { recordClass: "CURATED_READER_RECORD" as const, scope: translationScope(id) },
      { recordClass: "CURATED_READER_RECORD" as const, scope: campaignFinanceScope(id) },
    ]);
    if (extra.length) await primeReaderCanonicalStore(extra, readCanonicalShelf(extra));
  });
  const canonicalRead = Promise.all([baseRead, districtRead]).then(() => undefined);
  const places = packages.map(async ({ state, read }) => {
    const local = readPlacePackage({ state, divisionIds: rawEntry?.ids ?? selection.divisions ?? [],
      bodyIds: territoryBodies(point.lat, point.lng, await readerTerritory(state)) });
    const [held, facts] = await Promise.all([read, local]);
    return withStateRegistryFacts(held.registry, facts.bodies);
  });
  const registryRead = Promise.all(places).then(values => {
    const value = values.length === 1 ? values[0] : combineStateRegistries(values);
    withRegistryRuntimeProjection(value, states, () => undefined);
  });
  // Early failures remain available to the owning ballot section without unhandled rejections.
  void canonicalRead.catch(() => undefined);
  void registryRead.catch(() => undefined);
  void fundingRead.catch(() => undefined);
  return { registryRead, fundingRead, districtRead, entry };
}
