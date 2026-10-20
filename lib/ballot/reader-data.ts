import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStatePackage, readStateDistricts, primeStateDistrictPointers } from "../reader/state.ts";
import { readPlacePackage } from "../reader/place.ts";
import { readZipPlace, stateForZip } from "../reader/national.ts";
import { readerTerritory, territoryBodies } from "../reader/location.ts";
import { readCanonicalShelf, readCanonicalPackages } from "../reader/canonical.ts";
import { primeReaderCanonicalStore, readerCanonicalEntry } from "../reader/canonical-context.ts";
import { primeReaderProjection } from "../civic-data/read-model.ts";
import { stateAuthorityPointers } from "../civic-data/state-reader.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { requiredRoutineContract } from "../civic-data/contracts.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../funding/data-plane.ts";
import { translationScope } from "../translate/records.ts";
import { campaignFinanceStateScope } from "../funding/state-sources.ts";
import { withStateRegistryFacts, combineStateRegistries } from "../registry/state-composition.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { withCensusDistricts } from "../geo/zip-census-districts.ts";
import { postalArea } from "../geo/postal.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { GeographySelection } from "../census-geography/selection.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import type { BallotPlace } from "./reader-place.ts";
import type { BallotSet, Contest } from "./types.ts";
import {lineupForContest} from "./general-lineup.ts";
import {reconciledCandidacyIdForCard} from "../identity/az-2026.ts";

/** The ballot shares the map's state and indexed local records; its own records use canonical batches. */
export async function readBallotReaderData(place: BallotPlace, readTerritory = readerTerritory) {
  const selection = currentReaderSelection();
  if (!place.centroid || !selection || currentReaderAuthorityEdge()) return null;
  const states = place.state ? [place.state.code] : place.zip && stateForZip(place.zip)
    ? [...new Set([stateForZip(place.zip)!, ...selection.states ?? []])] : [...selection.states ?? []];
  if (!states.length) return null;
  const point = place.centroid;
  const zip = place.zip ? postalArea(place.zip)?.zcta ?? place.zip : undefined;
  const packages = states.map(state => ({ state, read: readStatePackage(state, [], zip), districts: readStateDistricts(state) }));
  const [rawEntry, territories] = await Promise.all([
    place.zip ? readZipPlace(postalArea(place.zip)?.zcta ?? place.zip) : Promise.resolve(null),
    Promise.allSettled(states.map(readTerritory)),
  ]);
  const places = packages.map(async ({ state, read }, index) => {
    const territory = territories[index];
    if (territory.status === "rejected") throw territory.reason;
    const local = readPlacePackage({ state, divisionIds: rawEntry?.ids ?? selection.divisions ?? [],
      bodyIds: territoryBodies(point.lat, point.lng, territory.value) });
    const [held, facts] = await Promise.all([read, local]);
    return withStateRegistryFacts(held.registry, facts.bodies);
  });
  const divisions = [...new Set([...rawEntry?.ids ?? [], ...selection.divisions ?? [],
    ...states.map(state => `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`)])];
  const entries: { recordClass: RoutineRecordClass; scope: string }[] = states.flatMap(state => [
    ...(["ballot-contests", "candidate-profiles", "candidate-publications", "candidate-campaign-sites-derived"] as const).flatMap(family =>
      stateAuthorityPointers(family, state)),
    ...(state === "NH" ? [requiredRoutineContract("nh-members")] : []),
  ]);
  for (const id of ["ballot-navigation", "official-filings"] as const) entries.push(requiredManualProductionContract(id));
  for (const division of divisions) {
    if (!jurisdictionFromOcdId(division)) continue;
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) });
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: campaignFinanceStateScope(division) });
  }
  const unique = [...new Map(entries.map(entry => [`${entry.recordClass}:${entry.scope}`, entry])).values()];
  const ballots = unique.filter(entry => entry.recordClass === "BALLOT_CANDIDACY");
  const candidates = unique.filter(entry => ["CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION"].includes(entry.recordClass));
  const campaignKeys = new Set(states.flatMap(state => stateAuthorityPointers("candidate-campaign-sites-derived", state))
    .map(entry => `${entry.recordClass}:${entry.scope}`));
  const campaigns = unique.filter(entry => campaignKeys.has(`${entry.recordClass}:${entry.scope}`));
  const other = unique.filter(entry => !ballots.includes(entry) && !candidates.includes(entry) && !campaigns.includes(entry));
  const baseRead = primeReaderCanonicalStore(unique, readCanonicalPackages([ballots, candidates, campaigns, other]));
  const entry = async (geography?: GeographySelection) => {
    if (!place.zip) return rawEntry;
    let value = rawEntry ?? { ids: [], partial: [], samples: 0 };
    for (const { districts } of packages) {
      const held = await districts;
      if (held.kind === "HELD") value = withCensusDistricts(value,
        { ...held, value: { ...held.value, known: true } }, place.zip, geography);
    }
    return value;
  };
  const districtRead = entry().then(async value => {
    await Promise.all(packages.map(async ({ read }) => primeStateDistrictPointers(await read)));
    const extra = (value?.ids ?? []).filter(id => !divisions.includes(id) && jurisdictionFromOcdId(id)).flatMap(id => [
      { recordClass: "CURATED_READER_RECORD" as const, scope: translationScope(id) },
      { recordClass: "CURATED_READER_RECORD" as const, scope: campaignFinanceStateScope(id) },
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

/** Every card key and its held Arizona alias, including earlier filing candidacies. */
function ballotCandidateKeys(set: BallotSet, contests: readonly Contest[]): string[] {
  const ids = new Set(contests.map(contest=>contest.id));
  const keys = new Set([...set.candidacies,...set.filingCandidacies ?? []].filter(candidate=>ids.has(candidate.contestId)).map(candidate=>candidate.id));
  for (const contest of contests) {
    const lineup = lineupForContest(set.election.state,contest.id) ?? set.generalLineup?.contests.find(row=>row.contestId===contest.id);
    for (const nominee of lineup?.nominees ?? []) {
      const key = `${contest.id}|${nominee.name}`;
      keys.add(key);
      if (set.election.state === "AZ") {
        const canonical = reconciledCandidacyIdForCard(key);
        if (canonical) keys.add(canonical);
      }
    }
  }
  return [...keys];
}

/** The ballot reads state money only for its displayed candidate cards. */
export async function primeBallotStateMoneyRead(state: StateCampaignFinanceJurisdiction, set: BallotSet, contests: readonly Contest[]): Promise<void> {
  if (!currentReaderSelection() || currentReaderAuthorityEdge()) return;
  await primeReaderProjection("STATE_CAMPAIGN_FINANCE",STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,ballotCandidateKeys(set,contests),{exactKeys:true});
}

/** Read money for the exact displayed contests, retaining candidates and earlier filings. */
export async function primeBallotFundingRead(set: BallotSet, contests: readonly Contest[]): Promise<void> {
  if (!currentReaderSelection() || currentReaderAuthorityEdge()) return;
  const keys = ballotCandidateKeys(set,contests);
  if (keys.length) await primeReaderProjection("FEC_FUNDING",requiredRoutineContract("fec-funding").scope,keys);
}
