import { stateFromBallotScope } from "./state-scopes.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import { factReader, statementQuery } from "../facts/db.ts";
import { withFactRegistry } from "../facts/registry-overlay.ts";
import type { RegistryRuntimeCarton } from "../registry/runtime-data-plane.ts";
import type { CivicDataReadResult, CivicDataReadMetadata } from "./read-model.ts";
import { placeProjectionSourceSql, readPlacePayloadParts } from "./place-payload-slices.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

const slices = new Map<string, Map<string, { version: string; value: unknown }>>();
const queryIds = new WeakMap<ReadOnlyQuery, number>();
let nextQueryId = 0;

/** A view of an already promoted pointer, like Admin's promoted slices. It
 * carries pointer metadata; it is not a newly validated candidate or receipt. */
export type PlaceCaptureRead<T> = {
  readonly kind: CivicDataReadResult<T>["kind"];
  readonly value: T | null;
  readonly metadata: Pick<CivicDataReadMetadata, "recordClass" | "scope"> & { readonly versionId?: string | null };
};

const array = (path: string, where: string) => `(SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${path})='array' THEN ${path} ELSE '[]'::jsonb END) x WHERE ${where})`;
const division = "x->>'ocdId'=ANY($3::text[]) OR x->>'divisionId'=ANY($3::text[])";
const serves = `${division} OR x->'alsoServesOcdIds' ?| $3::text[] OR x->>'id'=ANY($4::text[])`;
const objectMap = (path: string, where = "k=ANY($5::text[])") => `(SELECT COALESCE(jsonb_object_agg(k,v), '{}'::jsonb) FROM jsonb_each(
  CASE WHEN jsonb_typeof(${path})='object' THEN ${path} ELSE '{}'::jsonb END) e(k,v) WHERE ${where})`;

/** Only the selected divisions and their bodies cross the wire. All filters
 * run against the existing canonical pointer in the existing read-only store. */
export async function readPlacePointerSlice<T>(recordClass: CivicDataReadMetadata["recordClass"], scope: string,
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = []): Promise<PlaceCaptureRead<T>> {
  return (await readPlacePointerSlices<T>(recordClass, [scope], ids, bodies, targets))[0];
}

/** Read only requested facts from the exact promoted version already accepted
 * by the serving manifest, even while the latest pointer moves independently. */
export async function readPlaceVersionSlice<T>(recordClass: CivicDataReadMetadata["recordClass"], scope: string,
  versionId: string, ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = [],
  injected?: ReadOnlyQuery): Promise<PlaceCaptureRead<T>> {
  return (await readPlacePointerSlices<T>(recordClass, [scope], ids, bodies, targets, injected, new Map([[scope, versionId]])))[0];
}

export async function readPlacePointerSlices<T>(recordClass: CivicDataReadMetadata["recordClass"], scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = [], injected?: ReadOnlyQuery,
  acceptedVersions?: ReadonlyMap<string, string>): Promise<PlaceCaptureRead<T>[]> {
  if (!scopes.length) return [];
  const query = injected ?? readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:${recordClass}:${scopes.join(",")}:STORE_UNCONFIGURED`);
  if (injected && !queryIds.has(injected)) queryIds.set(injected, ++nextQueryId);
  const cacheKey = JSON.stringify([injected ? queryIds.get(injected) : process.env.DATABASE_URL, recordClass,
    [...new Set(ids)].sort(), [...new Set(bodies)].sort(), [...new Set(targets)].sort(),
    acceptedVersions === undefined ? null : [...acceptedVersions].sort(([a], [b]) => a.localeCompare(b))]);
  const cached = slices.get(cacheKey) ?? new Map<string, { version: string; value: unknown }>();
  // Pin this call's carried values before any concurrent read can move the cache.
  const carried = new Map(cached);
  const versions = JSON.stringify(Object.fromEntries(scopes.flatMap(scope => carried.has(scope) ? [[scope, carried.get(scope)!.version]] : [])));
  let value: string;
  if (recordClass === "REGISTRY_RUNTIME_BINDING") {
    const executives = array("payload->'statewideExecutives'", "x->>'stateOcdId'=ANY($3::text[]) OR x->'holder'->>'id'=ANY($5::text[])");
    const candidacies = array("payload->'officialCandidacies'->'rows'", "x->'holder'->'divisions' ?| $3::text[] OR x->'holder'->>'id'=ANY($5::text[])");
    const holders = `SELECT x->'holder'->>'id' FROM jsonb_array_elements(${executives} || ${candidacies}) x`;
    value = `jsonb_build_object('registry', jsonb_build_object('divisions', ${array("payload->'registry'->'divisions'", division)},
      'bodies', ${array("payload->'registry'->'bodies'", serves)}),
      'statewideExecutives', ${executives}, 'officialCandidacies', jsonb_build_object('rows', ${candidacies}),
      'officialPhotos', jsonb_build_object('photos', ${array("payload->'officialPhotos'->'photos'", `x->>'officeholderId'=ANY($5::text[]) OR x->>'officeholderId' IN (${holders})`)}),
      'rosterPhotos', ${objectMap("payload->'rosterPhotos'", `k=ANY($5::text[]) OR k IN (${holders})`)})`;
  } else if (recordClass === "MEETING") {
    value = `jsonb_build_object('meetings', ${array("payload->'meetings'", `${division} OR x->>'bodyId'=ANY($4::text[])`)})`;
  } else if (recordClass === "MEETING_OUTCOME") {
    value = `jsonb_build_object('sittings', ${array("payload->'sittings'", `${division} OR x->>'bodyId'=ANY($4::text[])`)})`;
  } else if (recordClass === "FEDERAL_DIRECTORY" || recordClass === "STATE_LEGISLATOR") {
    const members = array("payload->'roster'->'divisions'", division);
    value = `jsonb_build_object('roster', ((payload->'roster') - 'divisions' - 'officeholders' - 'unmatched') || jsonb_build_object(
      'divisions', ${members}, 'unmatched', '[]'::jsonb,
      'officeholders', ${array("payload->'roster'->'officeholders'", `x->>'id' IN (SELECT m->>'officeholderId' FROM jsonb_array_elements(${members}) m)`)}))`;
  } else if (recordClass === "BALLOT_CANDIDACY") {
    const contests = array("ballot->'contests'", division);
    const inContest = `x->>'contestId' IN (SELECT c->>'id' FROM jsonb_array_elements(${contests}) c)`;
    const byContest = ["candidacies", "filingCandidacies", "measures", "measureRecords", "removals"]
      .map(field => `'${field}', ${array(`ballot->'${field}'`, inContest)}`).join(",");
    const candidateIds = `SELECT c->>'id' FROM jsonb_array_elements(${array("ballot->'candidacies'", inContest)}) c`;
    value = `jsonb_build_object('kind', 'ballot-contests', 'ballots', (SELECT COALESCE(jsonb_object_agg(ballot_key,
      jsonb_build_object('election', ballot->'election', 'contests', ${contests}, ${byContest},
        'absences', ${array("ballot->'absences'", division)}, 'heldContests', ${array("ballot->'heldContests'", division)},
        'contacts', ${array("ballot->'contacts'", `x->>'candidacyId' IN (${candidateIds})`)},
        'coverageNotes', COALESCE(ballot->'coverageNotes','[]'::jsonb),
        'scopedCoverageNotes', COALESCE(ballot->'scopedCoverageNotes','[]'::jsonb),
        'generalLineup', (COALESCE(ballot->'generalLineup','{}'::jsonb)-'contests') || jsonb_build_object('contests', ${array("ballot->'generalLineup'->'contests'", inContest)}),
        'measureAnalyses', (COALESCE(ballot->'measureAnalyses','{}'::jsonb)-'analyses') || jsonb_build_object('analyses', ${array("ballot->'measureAnalyses'->'analyses'", inContest)}),
        'lineupReconciliation', (COALESCE(ballot->'lineupReconciliation','{}'::jsonb)-'rows') || jsonb_build_object('rows', ${array("ballot->'lineupReconciliation'->'rows'", inContest)}))), '{}'::jsonb)
      FROM jsonb_each(CASE WHEN jsonb_typeof(payload->'ballots')='object' AND NOT (payload->'ballots') ? '$civicPayloadPart'
        THEN payload->'ballots' ELSE '{}'::jsonb END) b(ballot_key,ballot)
      WHERE EXISTS (SELECT 1 FROM unnest($3::text[]) d(id)
        WHERE lower(split_part(ballot_key, ':', 1))=substring(d.id from '/(?:state|district):([a-z]{2})(?:/|$)'))))`;
  } else if (recordClass === "CANDIDATE_PROFILE") {
    value = `jsonb_build_object('cards', jsonb_build_object('cards', ${objectMap("payload->'cards'->'cards'")},
        'hunts', ${array("payload->'cards'->'hunts'", "x->>'key'=ANY($5::text[])")}),
      'links', jsonb_build_object('links', ${objectMap("payload->'links'->'links'")},
        'hunts', ${array("payload->'links'->'hunts'", "x->>'key'=ANY($5::text[])")}))`;
  } else if (recordClass === "CANDIDATE_PUBLICATION") {
    value = `jsonb_build_object('documents', ${array("payload->'documents'", "x->>'candidateKey'=ANY($5::text[])")})`;
  } else if (recordClass === "CURATED_READER_RECORD" && scopes.every(scope => stateFromBallotScope(scope, "candidate-campaign-sites-derived") !== null)) {
    value = `(payload - 'records' - 'portraits') || jsonb_build_object('records', ${array("payload->'records'", "x->>'id'=ANY($5::text[]) OR x->>'candidacyId'=ANY($5::text[])" )}, 'portraits', ${array("payload->'portraits'", "x->>'id'=ANY($5::text[]) OR x->>'candidacyId'=ANY($5::text[])")})`;
  } else if (recordClass === "FEC_FUNDING") {
    value = `(payload - 'candidates') || jsonb_build_object('candidates', ${array("payload->'candidates'", "x->'targetKeys' ?| $5::text[]")})`;
  } else if (recordClass === "STATE_CAMPAIGN_FINANCE") {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", "x->'targetKeys' ?| $5::text[]")})`;
  } else if (recordClass === "VOTING_SITE") {
    value = `(payload - 'jurisdictions') || jsonb_build_object('jurisdictions', ${array("payload->'jurisdictions'", division)})`;
  } else {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", `${division} OR x->>'stateOcdId'=ANY($3::text[])`)})`;
  }
  const [rows] = await query([{ text: `WITH selected AS (SELECT $3::text[] ids, $4::text[] bodies, $5::text[] targets),
    projections AS (${placeProjectionSourceSql(acceptedVersions === undefined ? undefined : 7)})
    SELECT scope, current_version_id, CASE WHEN ($6::jsonb->>scope)=current_version_id THEN NULL ELSE ${value} END AS value,
      CASE WHEN ($6::jsonb->>scope)=current_version_id THEN false ELSE jsonb_path_exists(payload, '$.**."$civicPayloadPart"') END AS encoded
      FROM projections WHERE record_class=$1 AND scope=ANY($2::text[])`,
    params: [recordClass, [...new Set(scopes)], [...ids], [...bodies], [...targets], versions,
      ...(acceptedVersions === undefined ? [] : [JSON.stringify(Object.fromEntries(acceptedVersions))])] }]);
  const byScope = new Map(rows?.map(row => [row.scope, row]));
  const encoded = rows.filter(row => row.encoded).map(row => row.scope as string);
  const decoded = encoded.length ? await readPlacePayloadParts(query, recordClass, encoded, ids, bodies, targets,
    new Map(rows.map(row => [row.scope as string, row.current_version_id as string])), acceptedVersions) : new Map();
  const result = scopes.map(scope => {
    const row = byScope.get(scope);
    const value = row ? carried.get(scope)?.version === row.current_version_id
      ? carried.get(scope)!.value : decoded.get(scope) ?? row.value : null;
    if (row) cached.set(scope, { version: row.current_version_id as string, value });
    else cached.delete(scope);
    return { kind: row ? "PROMOTED" as const : "NOT_RECORDED" as const, value: value as T ?? null,
      metadata: { recordClass, scope, ...(row ? { versionId: row.current_version_id as string } : {}) } };
  });
  if (!slices.has(cacheKey) && slices.size >= 64) slices.delete(slices.keys().next().value!);
  slices.set(cacheKey, cached);
  if (recordClass !== "REGISTRY_RUNTIME_BINDING") return result;
  const facts = injected ? statementQuery(injected) : factReader();
  return Promise.all(result.map(async read => read.value === null ? read
    : { ...read, value: await withFactRegistry(read.value as unknown as RegistryRuntimeCarton, facts) as T }));
}
