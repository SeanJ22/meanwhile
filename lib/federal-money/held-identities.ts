import type { ReadOnlyQuery, Row } from "../control-plane/admin-view/promoted-slices.ts";
import { districtIdentity } from "../ocd/fips.ts";
import { registrationTarget } from "../registration/publication.ts";
import { federalMoneyRecipientIds, type FederalMoneyHeldAudit, type FederalMoneyHeldRecipient, type FederalMoneyJoinInput } from "./join.ts";
import type { FederalMoneyFact } from "./model.ts";
import { federalGovernmentNameForms, federalMoneyRecipientName } from "./recipient.ts";
import { sha256 } from "../civic-data/candidate-builders.ts";

const unique = (values: readonly string[]) => [...new Set(values)].sort();
const canonicalNamespace = "CASE n.key WHEN 'entity_uei' THEN 'uei' WHEN 'nces_id' THEN 'nces_leaid' WHEN 'leaid' THEN 'nces_leaid' WHEN 'census_id' THEN 'census_pid6' ELSE n.key END";
const recipientMatch = `EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(reader_payload_value(g->'nativeIds'), '{}'::jsonb)) n JOIN jsonb_to_recordset($3::jsonb) wanted(namespace text, value text) ON ${canonicalNamespace} = wanted.namespace AND n.value = wanted.value)`;

/** Only a digest leaves Neon while an unchanged provider page checks its current recipient dependencies. */
export async function readFederalMoneyJoinInputHash(state:string,facts:readonly FederalMoneyFact[],query:ReadOnlyQuery|null):Promise<string> {
  const postal=state.toUpperCase();
  if(!/^[A-Z]{2}$/.test(postal)||facts.some(fact=>fact.state.toUpperCase()!==postal))throw new Error("Federal money identity lookup requires one state");
  if(!facts.length||postal==="ZZ")return sha256("NO_FEDERAL_RECIPIENT_INPUTS");
  if(!query)throw new Error("The federal recipient identity index is unavailable.");
  const [rows]=await query([{text:`WITH native AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset($2::jsonb) n(source text,uei text,identifiers jsonb)
  ), reports AS MATERIALIZED (
    SELECT r.collection,r.scope,r.row_id,r.content_hash,r.value->>'uei' AS uei FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE r.record_class='FEDERAL_MONEY' AND r.collection='federalMoney' AND r.state=$1
      AND reader_payload_node(p.payload)->>'source'='federal-audit-clearinghouse'
      AND r.aliases&&ARRAY(SELECT 'report:'||(identifiers->>'reportId') FROM native WHERE source='federal-audit-clearinghouse' AND identifiers->>'reportId' IS NOT NULL)
      AND reader_payload_node(r.value->'details')->>'table'='general'
  ), entities AS MATERIALIZED (
    SELECT r.collection,r.scope,r.row_id,r.content_hash FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE r.record_class='FEDERAL_MONEY' AND r.collection='federalMoney' AND r.state=$1
      AND reader_payload_node(p.payload)->>'source'='sam-gov-entities' AND r.value->>'kind'='ENTITY'
      AND r.aliases&&ARRAY(SELECT 'uei:'||uei FROM native WHERE uei IS NOT NULL UNION SELECT 'uei:'||uei FROM reports WHERE uei IS NOT NULL)
  ), dependencies AS (
    SELECT jsonb_build_array(r.collection,r.scope,r.row_id,r.content_hash) AS identity FROM civic_data_rows r
      JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
      WHERE r.record_class='REGISTRATION' AND r.scope=$3 AND r.collection IN ('governments','registration.bodies','registration.divisions')
    UNION ALL SELECT jsonb_build_array(collection,scope,row_id,content_hash) FROM reports
    UNION ALL SELECT jsonb_build_array(collection,scope,row_id,content_hash) FROM entities
  ) SELECT encode(sha256(convert_to(coalesce(jsonb_agg(identity ORDER BY identity::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM dependencies`,
    params:[postal,JSON.stringify(facts.map(fact=>({source:fact.source,uei:fact.uei,identifiers:fact.identifiers}))),registrationTarget(postal).scope]}]);
  const hash=rows?.[0]?.hash;
  if(typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash))throw new Error("The federal recipient identity hash is unavailable.");
  return hash;
}

function recipient(row: Row): FederalMoneyHeldRecipient {
  return { uei: typeof row.uei === "string" ? row.uei : null,
    identifiers: row.identifiers as FederalMoneyHeldRecipient["identifiers"] ?? {},
    bodyIds: row.body_ids as FederalMoneyHeldRecipient["bodyIds"] ?? [],
    recipient: typeof row.recipient === "string" ? row.recipient : null,
    recipientState: typeof row.recipient_state === "string" ? row.recipient_state : null };
}

// Match native keys before source filters so cold statistics cannot select the broad record-class index.
async function heldRecipients(state: string, facts: readonly FederalMoneyFact[], query: ReadOnlyQuery) {
  const reportIds = unique(facts.flatMap(fact => fact.source === "federal-audit-clearinghouse" && fact.identifiers.reportId ? [fact.identifiers.reportId] : []));
  let auditReports: FederalMoneyHeldAudit[] = [];
  if (reportIds.length) {
    const [rows] = await query([{
      text: "SELECT reader_payload_node(r.value->'identifiers')->>'reportId' AS report_id,r.value->>'uei' AS uei," +
        " reader_payload_value(r.value->'identifiers') AS identifiers,reader_payload_value(r.value->'bodyIds') AS body_ids," +
        " reader_payload_value(r.value->'divisionIds') AS division_ids,reader_payload_value(r.value->'recipient')#>>'{}' AS recipient,reader_payload_node(r.value->'details')->>'reportedState' AS recipient_state FROM civic_data_rows r" +
        " JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id" +
        " WHERE r.record_class='FEDERAL_MONEY' AND r.collection='federalMoney' AND r.state=$1 AND r.aliases&&$2::text[]" +
        " AND reader_payload_node(p.payload)->>'source'='federal-audit-clearinghouse'" +
        " AND reader_payload_node(r.value->'details')->>'table'='general'",
      params: [state, reportIds.map(id=>`report:${id}`)],
    }]);
    auditReports = (rows ?? []).map(row => ({ ...recipient(row), reportId: String(row.report_id), divisionIds: row.division_ids as readonly string[] ?? [] }));
  }
  const ueis = unique([...facts.flatMap(fact => fact.uei ? [fact.uei] : []), ...auditReports.flatMap(report => report.uei ? [report.uei] : [])]);
  let entities: FederalMoneyHeldRecipient[] = [];
  if (ueis.length) {
    const [rows] = await query([{
      text: "SELECT r.value->>'uei' AS uei,reader_payload_value(r.value->'identifiers') AS identifiers," +
        " reader_payload_value(r.value->'bodyIds') AS body_ids,reader_payload_value(r.value->'recipient')#>>'{}' AS recipient,reader_payload_node(r.value->'details')->>'state' AS recipient_state FROM civic_data_rows r" +
        " JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id" +
        " WHERE r.record_class='FEDERAL_MONEY' AND r.collection='federalMoney' AND r.state=$1 AND r.aliases&&$2::text[]" +
        " AND reader_payload_node(p.payload)->>'source'='sam-gov-entities' AND r.value->>'kind'='ENTITY'",
      params: [state, ueis.map(uei=>`uei:${uei}`)],
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
  const names = unique([...facts.flatMap(fact => federalMoneyRecipientName(fact) && fact.recipient ? federalGovernmentNameForms(fact.recipient) : []), ...[...held.entities, ...held.auditReports].flatMap(row => row.recipientState === postal && row.recipient ? federalGovernmentNameForms(row.recipient) : [])]);
  const [governmentRows] = await query([{
    text: "SELECT g->>'id' AS id,g->>'name' AS name,g->>'state' AS state,reader_payload_value(g->'aliases') AS aliases,reader_payload_value(g->'nativeIds') AS native_ids,reader_payload_value(g->'associations') AS associations,reader_payload_value(g->'bodyIds') AS body_ids" +
      " FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id" +
      " CROSS JOIN LATERAL (SELECT r.value AS g) picked" +
      ` WHERE r.record_class='REGISTRATION' AND r.collection='governments' AND r.scope=$2 AND r.state=$1 AND (${recipientMatch}` +
      " OR g->>'id' = ANY($4::text[]) OR EXISTS (SELECT 1 FROM reader_payload_members(g->'bodyIds') b WHERE b.item#>>'{}' = ANY($4::text[]))" +
      " OR EXISTS (SELECT 1 FROM reader_payload_members(g->'aliases') a WHERE a.item#>>'{}' = ANY($4::text[]))" +
      " OR trim(regexp_replace(upper(g->>'name'), '[^A-Z0-9]+', ' ', 'g')) = ANY($5::text[]))",
    params: [postal, registrationTarget(postal).scope, JSON.stringify(native), recipientBodyIds, names],
  }]);
  const governments: FederalMoneyJoinInput["governments"] = (governmentRows ?? []).map(row => ({
    id: String(row.id), nativeIds: row.native_ids as Readonly<Record<string, string>> ?? {},
    associations: row.associations as FederalMoneyJoinInput["governments"][number]["associations"] ?? [],
    bodyIds: row.body_ids as readonly string[] ?? [],
    aliases: row.aliases as readonly string[] ?? [],
    name: typeof row.name === "string" ? row.name : undefined,
    state: typeof row.state === "string" ? row.state : undefined,
  }));
  const bodyIds = unique([...recipientBodyIds, ...governments.flatMap(government => [...government.bodyIds])]);
  const censusIds = unique([...native.filter(id => id.namespace === "census_pid6").map(id => id.value), ...governments.flatMap(government => government.nativeIds.census_pid6 ? [government.nativeIds.census_pid6] : [])]);
  const divisionIds = unique([...ocdIds, ...governments.flatMap(government => government.associations.map(link => link.divisionId))]);
  const geography = JSON.stringify(geographies);
  const [bodyRows, divisionRows] = await query([{
    text: "WITH bodies AS (SELECT r.value AS b FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id" +
      " WHERE r.record_class='REGISTRATION' AND r.collection='registration.bodies' AND r.scope=$2)" +
      " SELECT b->>'id' AS id, b->>'ocdId' AS ocd_id, b->>'censusId' AS census_id FROM bodies" +
      " WHERE b->>'id' = ANY($3::text[]) OR ((b->>'censusId' = ANY($4::text[]) OR b->>'ocdId' = ANY($5::text[]))" +
      " AND (upper(b->>'state') = $1 OR b->>'ocdId' ~ ('/(state|district|territory):' || lower($1) || '(/|$)') OR b->>'id' ~ ('/(state|district|territory):' || lower($1) || '(/|#|$)')))",
    params: [postal, registrationTarget(postal).scope, bodyIds, censusIds, divisionIds],
  }, {
    text: "WITH divisions AS (SELECT r.value AS d FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id" +
      " WHERE r.record_class='REGISTRATION' AND r.collection='registration.divisions' AND r.scope=$2)" +
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
