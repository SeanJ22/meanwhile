/**
 * One state's registration, read from its promoted pointer. The promotion engine's verifier and the
 * reader composition both read through it. There is no bootstrap: a state with no promoted registration
 * answers NOT_RECORDED, named as not registered yet, never as a state with no governments.
 */
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import { REGISTRATION_RECORD_CLASS, registrationTarget } from "./publication.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { currentRegistrationsEdge, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";
import type { Division } from "../registry/types.ts";
import { withPeopleSourceChecks } from "../civic-data/people-source-checks.ts";
import { federalGovernmentNameSql } from "../federal-money/recipient.ts";

export type DivisionMetadata = Pick<Division, "ocdId" | "label" | "divisionType" | "tier">;

/** An exact label lookup must not walk governments, linked records or geometry. */
export async function readRegistrationDivision(state: string, ocdId: string): Promise<DivisionMetadata | undefined> {
  const served = await currentRegistrationsEdge()?.load(state.toLowerCase()).catch(() => null);
  if (served) return served.value?.divisions.find(row => row.ocdId === ocdId);
  refuseDatabaseInEdgeOnlyContext(`The ${state} registration`);
  const query = readerDatabaseQuery(1800);
  if (!query) return undefined;
  const [[row]] = await query([{ text: `WITH pointer AS MATERIALIZED (
    SELECT p.key,p.current_version_id,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
       AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
       AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
  ) SELECT published, CASE WHEN published THEN (
    SELECT jsonb_build_object('ocdId',r.value->'ocdId','label',reader_payload_value(r.value->'label'),
      'divisionType',r.value->'divisionType','tier',r.value->'tier')
    FROM civic_data_rows r WHERE r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id
      AND r.collection='registration.divisions' AND r.row_id=$2 ORDER BY r.ordinal LIMIT 1
  ) END AS division FROM pointer`, params: [`REGISTRATION:${registrationTarget(state).scope}`, ocdId] }]);
  if (!row) return undefined;
  if (row.published !== true) throw new Error("READER_PUBLISHED_POINTER_INVALID");
  return row.division as DivisionMetadata | undefined ?? undefined;
}

/** Registration is reference data on a Census vintage: a promoted state never goes stale on a clock. */
const REGISTRATION_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export async function readRegistrationProjection(
  state: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistrationReadModel>> {
  const target = registrationTarget(state);
  const read=await readPromotedCivicData<RegistrationReadModel>(REGISTRATION_RECORD_CLASS, target.scope, {
    ...options,
    maxAgeMs: options.maxAgeMs ?? REGISTRATION_MAX_AGE_MS,
  });
  return read.kind==="PROMOTED"&&options.edge===undefined?
    {...read,value:await withPeopleSourceChecks(read.value,REGISTRATION_RECORD_CLASS,target.scope,options.store)}:read;
}

/** A government's name as one form, so "City of X", "X, City of" and "X city" are one. */
const normalizedGovernment = (value: string) => {
  const flat = `btrim(regexp_replace(regexp_replace(replace(upper(${value}),'&',' AND '),'[^A-Z0-9, ]',' ','g'),'\\s+',' ','g'))`;
  return `btrim(regexp_replace(replace(regexp_replace(${flat},'^(.+?),\\s*(CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|COUNTY)\\s+OF$','\\2 OF \\1'),',',''),'\\s+',' ','g'))`;
};

/** The registered governments of each division's state that name any of these divisions, each with its place in its state's list ordered by the name it is paid under, its .gov domains and whether its name is its own alone, and those divisions' registration rows. `$1` and `$2` are parallel lists of each division's state and id. */
export const PLACE_REGISTRATION_SQL = `SELECT r.kind,r.value,r.ordinal FROM (SELECT s.state,array_agg(s.id) AS ids FROM unnest($1::text[],$2::text[]) s(state,id) GROUP BY s.state) w,
  LATERAL (WITH registration AS MATERIALIZED (
  SELECT reader_payload_node(payload) AS payload FROM civic_data_promotions WHERE key='REGISTRATION:US-'||w.state||':registration:v1' AND record_class='REGISTRATION'
), identities AS MATERIALIZED (
  SELECT g,row_number() OVER (ORDER BY upper(g->>'state'),recipient_identity,g->>'id') AS ord,identity,count(*) OVER (PARTITION BY upper(g->>'state'),identity) AS identities,
    count(*) OVER (PARTITION BY upper(g->>'state'),recipient_identity) AS recipient_names
  FROM (SELECT named.g,${normalizedGovernment("named.g->>'name'")} AS identity,${federalGovernmentNameSql("named.g->>'name'")} AS recipient_identity
    FROM registration,LATERAL reader_payload_members(payload->'governments') member,
      LATERAL (SELECT reader_payload_node(member.item) AS original) header,
      LATERAL (SELECT original || jsonb_build_object('name',reader_payload_value(original->'name')) AS g) named) inventory
), domains AS MATERIALIZED (
  SELECT d,${normalizedGovernment("d->>'organization'")} AS identity,dotgov.source FROM (
    SELECT payload->'domains' AS domains,payload->'source' AS source FROM civic_data_promotions WHERE key='DOTGOV_REFERENCE:US:current-full:domains' AND record_class='DOTGOV_REFERENCE') dotgov,
    LATERAL jsonb_array_elements(coalesce(domains,'[]'::jsonb)) d WHERE upper(d->>'state')=w.state
)
SELECT 'government' AS kind,reader_payload_value(g.g) || jsonb_build_object('recipientNameUnique',g.recipient_names=1,'govDomains',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'domain',d.d->>'domain','website','https://'||(d.d->>'domain'),'sourceUrl',d.source->>'url','checkedAt',d.source->>'readAt'))
    FROM domains d WHERE d.identity=g.identity AND g.identities=1 AND g.identity<>''),'[]'::jsonb)) AS value,g.ord AS ordinal
  FROM identities g WHERE EXISTS (SELECT 1 FROM reader_payload_members(g.g->'associations') member,LATERAL (SELECT reader_payload_node(member.item) AS a) association
    WHERE a->>'divisionId'=ANY(w.ids))
UNION ALL
SELECT 'division',reader_payload_value(member.item),NULL::bigint FROM registration,LATERAL reader_payload_members(payload->'divisions') member,
  LATERAL (SELECT reader_payload_node(member.item) AS d) division WHERE d->>'ocdId'=ANY(w.ids)) r`;
