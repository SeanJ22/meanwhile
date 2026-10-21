import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStatePackage, readStateDistricts, primeStateDistrictPointers, primeStateReaderPointers } from "../reader/state.ts";
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
import {selectedPointerSql,selectedMetadataSql,selectedStateEntry} from "../reader/selected-entry.ts";
import {readerDatabaseQuery} from "../reader/database.ts";

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
  // Reserve these promises now: the ballot's early incumbent and portrait reads
  // consume the state query's verified ZIP slices instead of opening another read.
  if (zip) for (const {state,read} of packages) void primeStateReaderPointers(state,read).catch(()=>undefined);
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
    ...(["ballot-contests"] as const).flatMap(family =>
      stateAuthorityPointers(family, state)),
    ...(state === "NH" && !zip ? [requiredRoutineContract("nh-members")] : []),
  ]);
  for (const id of ["ballot-navigation", "official-filings"] as const) entries.push(requiredManualProductionContract(id));
  for (const division of divisions) {
    if (!jurisdictionFromOcdId(division)) continue;
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) });
    entries.push({ recordClass: "CURATED_READER_RECORD", scope: campaignFinanceStateScope(division) });
  }
  const unique = [...new Map(entries.map(entry => [`${entry.recordClass}:${entry.scope}`, entry])).values()];
  const ballots = unique.filter(entry => entry.recordClass === "BALLOT_CANDIDACY");
  const other = unique.filter(entry => !ballots.includes(entry));
  const baseRead = primeReaderCanonicalStore(unique, readCanonicalPackages([ballots, other]));
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
    const pointersRead = Promise.all(packages.map(async ({ read }) => primeStateDistrictPointers(await read)));
    const extra = (value?.ids ?? []).filter(id => !divisions.includes(id) && jurisdictionFromOcdId(id)).flatMap(id => [
      { recordClass: "CURATED_READER_RECORD" as const, scope: translationScope(id) },
      { recordClass: "CURATED_READER_RECORD" as const, scope: campaignFinanceStateScope(id) },
    ]);
    const missing = extra.filter(entry => !readerCanonicalEntry(entry.recordClass, entry.scope));
    await Promise.all([pointersRead, missing.length ? primeReaderCanonicalStore(missing, readCanonicalShelf(missing)) : Promise.resolve()]);
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

/** Full facts for the ballot's candidates; other contests' records stay in the store. */
export function ballotCandidateDetailsStatement(state: string, keys: readonly string[]) {
  const pointers = (["candidate-profiles","candidate-publications","candidate-campaign-sites-derived"] as const)
    .flatMap(family => stateAuthorityPointers(family,state));
  const selectedArray = (value: string, field: string) => `coalesce((SELECT jsonb_agg(reader_payload_value(r.item) ORDER BY r.ordinal_index)
    FROM reader_payload_members(${value}->'${field}') r WHERE reader_payload_node(r.item)->>'candidateKey'=ANY($2::text[])
      OR reader_payload_node(r.item)->>'candidacyId'=ANY($2::text[])), '[]'::jsonb)`;
  const selectedObject = (value: string) => `coalesce((SELECT jsonb_object_agg(r.key,reader_payload_value(object.value->r.key))
    FROM (SELECT reader_payload_node(${value}) AS value) object,
      (SELECT DISTINCT unnest($2::text[]) AS key) r WHERE object.value ? r.key), '{}'::jsonb)`;
  return {pointers,params:[pointers.map(pointer=>`${pointer.recordClass}:${pointer.scope}`),keys],text:`WITH pointer AS MATERIALIZED (
    ${selectedPointerSql.replace('p.key=$1','p.key=ANY($1::text[])')}
  ), roots AS MATERIALIZED (SELECT key,reader_payload_node(payload) AS value FROM pointer WHERE published)
  SELECT ${selectedMetadataSql}, CASE WHEN published THEN CASE pointer.record_class
    WHEN 'CANDIDATE_PROFILE' THEN reader_payload_value(roots.value-'cards'-'links') || jsonb_build_object(
      'cards',reader_payload_value(reader_payload_node(roots.value->'cards')-'cards') || jsonb_build_object('cards',${selectedObject("reader_payload_node(roots.value->'cards')->'cards'")}),
      'links',reader_payload_value(reader_payload_node(roots.value->'links')-'links') || jsonb_build_object('links',${selectedObject("reader_payload_node(roots.value->'links')->'links'")}))
    WHEN 'CANDIDATE_PUBLICATION' THEN reader_payload_value(roots.value-'documents'-'failures') || jsonb_build_object(
      'documents',${selectedArray('roots.value','documents')},'failures',${selectedArray('roots.value','failures')})
    ELSE reader_payload_value(roots.value-'records'-'portraits') || jsonb_build_object('records',${selectedArray('roots.value','records')})
      || CASE WHEN roots.value ? 'portraits' THEN jsonb_build_object('portraits',${selectedArray('roots.value','portraits')}) ELSE '{}'::jsonb END
    END END AS payload FROM pointer LEFT JOIN roots USING(key)`};
}

export async function primeBallotCandidateDetails(set: BallotSet, contests: readonly Contest[]): Promise<void> {
  if (!currentReaderSelection() || currentReaderAuthorityEdge()) return;
  const statement = ballotCandidateDetailsStatement(set.election.state,ballotCandidateKeys(set,contests));
  const query = readerDatabaseQuery();
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  const [rows] = await query([statement]);
  const entries = new Map(statement.pointers.map(pointer => {
    const key = `${pointer.recordClass}:${pointer.scope}`;
    return [key,selectedStateEntry(pointer.recordClass,pointer.scope,rows.find(row=>row.key===key))];
  }));
  await primeReaderCanonicalStore(statement.pointers,{
    async readPromotion() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readCandidate() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readPromotedEntry(recordClass,scope) {
      const entry = entries.get(`${recordClass}:${scope}`);
      if (!entry) throw new Error("READER_SCOPE_NOT_SELECTED");
      return entry;
    },
  });
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
