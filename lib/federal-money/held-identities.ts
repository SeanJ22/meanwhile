import type { ReadOnlyQuery, Row } from "../control-plane/admin-view/promoted-slices.ts";
import { districtIdentity } from "../ocd/fips.ts";
import { registrationTarget } from "../registration/publication.ts";
import { federalMoneyRecipientIds, type FederalMoneyHeldAudit, type FederalMoneyHeldRecipient, type FederalMoneyJoinInput } from "./join.ts";
import type { FederalMoneyFact } from "./model.ts";
import { federalMoneyLookupPath } from "./lookups.ts";

const unique = (values: readonly string[]) => [...new Set(values)].sort();
const canonicalNamespace = "CASE n.key WHEN 'entity_uei' THEN 'uei' WHEN 'nces_id' THEN 'nces_leaid' WHEN 'leaid' THEN 'nces_leaid' WHEN 'census_id' THEN 'census_pid6' ELSE n.key END";
const recipientMatch = `EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(g->'nativeIds', '{}'::jsonb)) n JOIN jsonb_to_recordset($3::jsonb) wanted(namespace text, value text) ON ${canonicalNamespace} = wanted.namespace AND n.value = wanted.value)`;

function recipient(row: Row): FederalMoneyHeldRecipient {
  return { uei: typeof row.uei === "string" ? row.uei : null,
    identifiers: row.identifiers as FederalMoneyHeldRecipient["identifiers"] ?? {},
    bodyIds: row.body_ids as FederalMoneyHeldRecipient["bodyIds"] ?? [] };
}

// Match native keys before source filters so cold statistics cannot select the broad record-class index.
async function heldRecipients(state: string, facts: readonly FederalMoneyFact[], query: ReadOnlyQuery) {
  const reportIds = unique(facts.flatMap(fact => fact.source === "federal-audit-clearinghouse" && fact.identifiers.reportId ? [fact.identifiers.reportId] : []));
  let auditReports: FederalMoneyHeldAudit[] = [];
  if (reportIds.length) {
    const [rows] = await query([{
      text: "WITH matched AS MATERIALIZED (SELECT p.key FROM civic_data_promotions p WHERE p.payload ? 'lookupKeys'" +
        " AND (p.payload->'lookupKeys') @? $3::jsonpath)" +
        " SELECT f->'identifiers'->>'reportId' AS report_id, f->>'uei' AS uei, f->'identifiers' AS identifiers, f->'bodyIds' AS body_ids, f->'divisionIds' AS division_ids" +
        " FROM matched CROSS JOIN LATERAL (SELECT record_class, payload FROM civic_data_promotions WHERE key = matched.key OFFSET 0) p" +
        " CROSS JOIN LATERAL jsonb_array_elements(p.payload->'records') f" +
        " WHERE p.record_class = 'FEDERAL_MONEY' AND p.payload->>'formatVersion' = '2'" +
        " AND p.payload->>'source' = 'federal-audit-clearinghouse' AND p.payload->>'state' = $1" +
        " AND f->'identifiers'->>'reportId' = ANY($2::text[]) AND f->'details'->>'table' = 'general'",
      params: [state, reportIds, federalMoneyLookupPath("report", reportIds)],
    }]);
    auditReports = (rows ?? []).map(row => ({ ...recipient(row), reportId: String(row.report_id), divisionIds: row.division_ids as readonly string[] ?? [] }));
  }
  const ueis = unique([...facts.flatMap(fact => fact.uei ? [fact.uei] : []), ...auditReports.flatMap(report => report.uei ? [report.uei] : [])]);
  let entities: FederalMoneyHeldRecipient[] = [];
  if (ueis.length) {
    const [rows] = await query([{
      text: "WITH matched AS MATERIALIZED (SELECT p.key FROM civic_data_promotions p WHERE p.payload ? 'lookupKeys'" +
        " AND (p.payload->'lookupKeys') @? $3::jsonpath)" +
        " SELECT f->>'uei' AS uei, f->'identifiers' AS identifiers, f->'bodyIds' AS body_ids" +
        " FROM matched CROSS JOIN LATERAL (SELECT record_class, payload FROM civic_data_promotions WHERE key = matched.key OFFSET 0) p" +
        " CROSS JOIN LATERAL jsonb_array_elements(p.payload->'records') f" +
        " WHERE p.record_class = 'FEDERAL_MONEY' AND p.payload->>'formatVersion' = '2'" +
        " AND p.payload->>'source' = 'sam-gov-entities' AND p.payload->>'state' = $1" +
        " AND f->>'uei' = ANY($2::text[]) AND f->>'kind' = 'ENTITY'",
      params: [state, ueis, federalMoneyLookupPath("uei", ueis)],
    }]);
    entities = (rows ?? []).map(recipient);
  }
  return { entities, auditReports };
}

export async function readFederalMoneyJoinInput(state: string, facts: readonly FederalMoneyFact[], query: ReadOnlyQuery | null): Promise<FederalMoneyJoinInput> {
  const postal = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(postal) || facts.some(fact => fact.state.toUpperCase() !== postal)) throw new Error("Federal money identity lookup requires one state");
  const districts = facts.flatMap(fact => fact.geography.flatMap(geo => {
    if (geo.type !== "congressional" || !/^\d{4}$/.test(geo.geoid)) return [];
    const district = districtIdentity(geo.geoid.slice(0, 2), geo.geoid.slice(2));
    return district?.state === postal ? [{ ocdId: district.ocdId, geoid: geo.geoid, divisionType: "congressional_district" }] : [];
  }));
  if (!facts.length || postal === "ZZ") return { divisions: districts, bodies: [], governments: [] };
  if (!query) throw new Error("The federal recipient identity index is unavailable.");
  const held = await heldRecipients(postal, facts, query);
  const recipients = [...facts, ...held.entities, ...held.auditReports];
  const native = recipients.flatMap(row => federalMoneyRecipientIds({ ...row.identifiers, ...(row.uei ? { uei: row.uei } : {}) }));
  const recipientBodyIds = unique(recipients.flatMap(row => [...row.bodyIds]));
  const geographies = facts.flatMap(fact => fact.geography.map(geo => ({ type: geo.type, geoid: geo.geoid })));
  const ocdIds = unique([...native.filter(id => id.namespace === "ocd_id").map(id => id.value), ...held.auditReports.flatMap(report => [...report.divisionIds])]);
  const [governmentRows] = await query([{
    text: "SELECT g->>'id' AS id, g->'nativeIds' AS native_ids, g->'associations' AS associations, g->'bodyIds' AS body_ids" +
      " FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'governments') g" +
      ` WHERE p.record_class = 'REGISTRATION' AND p.scope = $2 AND upper(g->>'state') = $1 AND (${recipientMatch}` +
      " OR g->>'id' = ANY($4::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g->'bodyIds') b WHERE b = ANY($4::text[])))",
    params: [postal, registrationTarget(postal).scope, JSON.stringify(native), recipientBodyIds],
  }]);
  const governments: FederalMoneyJoinInput["governments"] = (governmentRows ?? []).map(row => ({
    id: String(row.id), nativeIds: row.native_ids as Readonly<Record<string, string>> ?? {},
    associations: row.associations as FederalMoneyJoinInput["governments"][number]["associations"] ?? [],
    bodyIds: row.body_ids as readonly string[] ?? [],
  }));
  const bodyIds = unique([...recipientBodyIds, ...governments.flatMap(government => [...government.bodyIds])]);
  const censusIds = unique([...native.filter(id => id.namespace === "census_pid6").map(id => id.value), ...governments.flatMap(government => government.nativeIds.census_pid6 ? [government.nativeIds.census_pid6] : [])]);
  const divisionIds = unique([...ocdIds, ...governments.flatMap(government => government.associations.map(link => link.divisionId))]);
  const geography = JSON.stringify(geographies);
  const [bodyRows, divisionRows] = await query([{
    text: "WITH bodies AS (SELECT b FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'bodies') b WHERE p.record_class = 'REGISTRATION' AND p.scope = $2)" +
      " SELECT b->>'id' AS id, b->>'ocdId' AS ocd_id, b->>'censusId' AS census_id FROM bodies" +
      " WHERE b->>'id' = ANY($3::text[]) OR ((b->>'censusId' = ANY($4::text[]) OR b->>'ocdId' = ANY($5::text[]))" +
      " AND (upper(b->>'state') = $1 OR b->>'ocdId' ~ ('/(state|district|territory):' || lower($1) || '(/|$)') OR b->>'id' ~ ('/(state|district|territory):' || lower($1) || '(/|#|$)')))",
    params: [postal, registrationTarget(postal).scope, bodyIds, censusIds, divisionIds],
  }, {
    text: "WITH divisions AS (SELECT d FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'divisions') d WHERE p.record_class = 'REGISTRATION' AND p.scope = $2)" +
      " SELECT d->>'ocdId' AS ocd_id, d->>'geoid' AS geoid, d->>'divisionType' AS division_type FROM divisions" +
      " WHERE (upper(d->>'state') = $1 OR d->>'ocdId' ~ ('/(state|district|territory):' || lower($1) || '(/|$)'))" +
      " AND (d->>'ocdId' = ANY($3::text[]) OR EXISTS (SELECT 1 FROM jsonb_to_recordset($4::jsonb) geo(type text, geoid text)" +
      " WHERE geo.geoid = d->>'geoid' AND geo.type = CASE WHEN d->>'divisionType' = 'school_district' THEN 'school' WHEN d->>'divisionType' ~ 'congress|^cd$' THEN 'congressional' ELSE d->>'divisionType' END))",
    params: [postal, registrationTarget(postal).scope, divisionIds, geography],
  }]);
  const bodies: FederalMoneyJoinInput["bodies"] = (bodyRows ?? []).map(row => ({ id: String(row.id), ocdId: typeof row.ocd_id === "string" ? row.ocd_id : null, censusId: typeof row.census_id === "string" ? row.census_id : undefined }));
  const divisions = (divisionRows ?? []).map(row => ({ ocdId: String(row.ocd_id), geoid: String(row.geoid), divisionType: row.division_type as FederalMoneyJoinInput["divisions"][number]["divisionType"] }));
  return { divisions: [...divisions, ...districts], bodies, governments, ...held };
}
