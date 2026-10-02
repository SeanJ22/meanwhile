import { readerQuery } from "./promoted-reader-query.ts";
import type { CivicDataReadResult, CivicDataReadMetadata } from "./read-model.ts";
import { readPlacePayloadParts } from "./place-payload-slices.ts";

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
const objectMap = (path: string) => `(SELECT COALESCE(jsonb_object_agg(k,v), '{}'::jsonb) FROM jsonb_each(
  CASE WHEN jsonb_typeof(${path})='object' THEN ${path} ELSE '{}'::jsonb END) e(k,v) WHERE k=ANY($5::text[]))`;

/** Only the selected divisions and their bodies cross the wire. All filters
 * run against the existing canonical pointer in the existing read-only store. */
export async function readPlacePointerSlice<T>(recordClass: CivicDataReadMetadata["recordClass"], scope: string,
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = []): Promise<PlaceCaptureRead<T>> {
  return (await readPlacePointerSlices<T>(recordClass, [scope], ids, bodies, targets))[0];
}

/** Multiple existing partitions share one read-only connection. */
export async function readPlacePointerSlices<T>(recordClass: CivicDataReadMetadata["recordClass"], scopes: readonly string[],
  ids: readonly string[], bodies: readonly string[] = [], targets: readonly string[] = []): Promise<PlaceCaptureRead<T>[]> {
  if (!scopes.length) return [];
  const query = readerQuery();
  if (!query) throw new Error(`HELD_PLACE_READ_FAILED:${recordClass}:${scopes.join(",")}:STORE_UNCONFIGURED`);
  let value: string;
  if (recordClass === "REGISTRY_RUNTIME_BINDING") {
    value = `jsonb_build_object('registry', jsonb_build_object('divisions', ${array("payload->'registry'->'divisions'", division)},
      'bodies', ${array("payload->'registry'->'bodies'", serves)}),
      'bodyRosters', ${array("payload->'bodyRosters'", "x->>'bodyId' IN (SELECT b->>'id' FROM jsonb_array_elements(payload->'registry'->'bodies') b WHERE b->>'ocdId'=ANY($3::text[]) OR b->'alsoServesOcdIds' ?| $3::text[])")},
      'statewideExecutives', ${array("payload->'statewideExecutives'", "x->>'stateOcdId'=ANY($3::text[])")},
      'officialCandidacies', jsonb_build_object('rows', ${array("payload->'officialCandidacies'->'rows'", "x->'holder'->'divisions' ?| $3::text[]")}))`;
  } else if (recordClass === "MEETING") {
    value = `jsonb_build_object('meetings', ${array("payload->'meetings'", `${division} OR x->>'bodyId'=ANY($4::text[])`)})`;
  } else if (recordClass === "MEETING_OUTCOME") {
    value = `jsonb_build_object('sittings', ${array("payload->'sittings'", `${division} OR x->>'bodyId'=ANY($4::text[])`)})`;
  } else if (recordClass === "FEDERAL_DIRECTORY" || recordClass === "STATE_LEGISLATOR") {
    const members = array("payload->'roster'->'divisions'", division);
    value = `jsonb_build_object('roster', ((payload->'roster') - 'divisions' - 'officeholders' - 'unmatched') || jsonb_build_object(
      'divisions', ${members}, 'unmatched', '[]'::jsonb,
      'officeholders', ${array("payload->'roster'->'officeholders'", `x->>'id' IN (SELECT m->>'officeholderId' FROM jsonb_array_elements(${members}) m)`)}))`;
  } else if (recordClass === "BALLOT_CANDIDACY" || recordClass === "BALLOT_FILING") {
    const contests = array("payload->'ballot'->'contests'", division);
    const inContest = `x->>'contestId' IN (SELECT c->>'id' FROM jsonb_array_elements(${contests}) c)`;
    value = `jsonb_build_object('ballot', ((payload->'ballot') - 'contests' - 'candidacies' - 'measures') || jsonb_build_object(
      'contests', ${contests}, 'candidacies', ${array("payload->'ballot'->'candidacies'", inContest)},
      'measures', ${array("payload->'ballot'->'measures'", inContest)}),
      'generalLineup', jsonb_build_object('contests', ${array("payload->'generalLineup'->'contests'", `x->>'contestId' IN (SELECT c->>'id' FROM jsonb_array_elements(${contests}) c)`)}))`;
  } else if (recordClass === "CANDIDATE_PROFILE") {
    value = `jsonb_build_object('cards', jsonb_build_object('cards', ${objectMap("payload->'cards'->'cards'")}),
      'links', jsonb_build_object('links', ${objectMap("payload->'links'->'links'")}))`;
  } else if (recordClass === "CANDIDATE_PUBLICATION") {
    value = `jsonb_build_object('documents', ${array("payload->'documents'", "x->>'candidateKey'=ANY($5::text[])")})`;
  } else if (recordClass === "CURATED_READER_RECORD" && scopes.every(scope => scope === "US:candidate-campaign-sites-derived")) {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", "x->>'id'=ANY($5::text[]) OR x->>'candidacyId'=ANY($5::text[])")})`;
  } else if (recordClass === "FEC_FUNDING") {
    value = `(payload - 'candidates') || jsonb_build_object('candidates', ${array("payload->'candidates'", "x->'targetKeys' ?| $5::text[]")})`;
  } else if (recordClass === "STATE_CAMPAIGN_FINANCE") {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", "x->'targetKeys' ?| $5::text[]")})`;
  } else if (recordClass === "VOTING_SITE") {
    value = `(payload - 'jurisdictions') || jsonb_build_object('jurisdictions', ${array("payload->'jurisdictions'", division)})`;
  } else {
    value = `(payload - 'records') || jsonb_build_object('records', ${array("payload->'records'", `${division} OR x->>'stateOcdId'=ANY($3::text[])`)})`;
  }
  const [rows] = await query([{ text: `WITH selected AS (SELECT $3::text[] ids, $4::text[] bodies, $5::text[] targets)
    SELECT scope, current_version_id, ${value} AS value, jsonb_path_exists(payload, '$.**."$civicPayloadPart"') AS encoded
      FROM civic_data_promotions WHERE record_class=$1 AND scope=ANY($2::text[])`,
    params: [recordClass, [...new Set(scopes)], [...ids], [...bodies], [...targets]] }]);
  const byScope = new Map(rows?.map(row => [row.scope, row]));
  const encoded = rows.filter(row => row.encoded).map(row => row.scope as string);
  const decoded = encoded.length ? await readPlacePayloadParts(query, recordClass, encoded, ids, bodies, targets,
    new Map(rows.map(row => [row.scope as string, row.current_version_id as string]))) : new Map();
  return scopes.map(scope => {
    const row = byScope.get(scope);
    return { kind: row ? "PROMOTED" : "NOT_RECORDED", value: (decoded.get(scope) ?? row?.value) as T ?? null,
      metadata: { recordClass, scope, ...(row ? { versionId: row.current_version_id as string } : {}) } };
  });
}
