import { campaignFinanceSource } from "./state-sources.ts";
import type { Query } from "../facts/publish.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";

export interface CampaignMoneyPerson {
  readonly id: string;
  readonly name: string;
  readonly seat: string;
  readonly office: string;
  readonly division: string;
  readonly incumbent: boolean;
  readonly sourceUrl: string;
}

export const CAMPAIGN_PEOPLE_SQL = `WITH roots AS MATERIALIZED (
  SELECT record_class,reader_payload_node(payload) AS value FROM civic_data_promotions
  WHERE (scope=$1 OR scope LIKE $1||':%') AND record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY','REGISTRY_RUNTIME_BINDING','BALLOT_CANDIDACY')
), holders AS (
  SELECT reader_payload_node(p.item) AS value FROM roots r,LATERAL reader_payload_members(reader_payload_node(r.value->'roster')->'officeholders') p
  WHERE r.record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY')
), memberships AS (
  SELECT h.value AS person,reader_payload_node(m.item) AS seat FROM holders h,LATERAL reader_payload_members(h.value->'memberships') m
  WHERE reader_payload_value(reader_payload_node(m.item)->'current')='true'::jsonb
), ballots AS (
  SELECT reader_payload_node(b.value) AS value FROM roots r,LATERAL jsonb_each(reader_payload_node(r.value->'ballots')) b
  WHERE r.record_class='BALLOT_CANDIDACY'
), candidates AS (
  SELECT reader_payload_node(c.item) AS person,reader_payload_node(t.item) AS seat FROM ballots b,
    LATERAL reader_payload_members(b.value->'candidacies') c,LATERAL reader_payload_members(b.value->'contests') t
  WHERE reader_payload_node(reader_payload_node(b.value->'election')->'date')#>>'{}'='2026-11-03'
    AND reader_payload_node(c.item)->>'contestId'=reader_payload_node(t.item)->>'id'
), local_members AS (
  SELECT reader_payload_node(m.item) AS person,reader_payload_node(b.item) AS body FROM roots r,
    LATERAL reader_payload_members(r.value->'bodyRosters') b,
    LATERAL reader_payload_members(reader_payload_node(b.item)->'members') m WHERE r.record_class='REGISTRY_RUNTIME_BINDING'
), people AS (
  SELECT coalesce(person->>'personId',person->>'id') AS id,person->>'name' AS name,seat->>'officeId' AS seat,
    seat->>'officeTitle' AS office,seat->>'divisionId' AS division,true AS incumbent,
    coalesce(seat->>'sourceUrl',reader_payload_node(person->'provenance')->>'sourceUrl') AS source_url FROM memberships
  UNION SELECT person->>'id',concat_ws(' ',person->>'givenName',person->>'familyName'),seat->>'id',seat->>'title',seat->>'ocdId',false,
    reader_payload_node(person->'provenance')->>'sourceUrl' FROM candidates
  UNION SELECT coalesce(person->>'personId',person->>'id'),person->>'name',body->>'bodyId',person->>'officeTitle',split_part(body->>'bodyId','#',1),true,
    coalesce(reader_payload_node(person->'membershipSource')->>'sourceUrl',body->>'sourceUrl') FROM local_members
  UNION SELECT substr(f.field,8),coalesce(f.value->>'name',p.name),f.entity_id,f.value->>'office',
    coalesce((SELECT place_id FROM entity_place WHERE entity_id=f.entity_id LIMIT 1),b.parent_id),true,s.url
    FROM entity b JOIN fact f ON f.entity_id=b.id AND f.field LIKE 'member:%' AND f.status='live'
    JOIN entity p ON p.id=substr(f.field,8) LEFT JOIN source_copy s ON s.id=f.source_copy_id
    WHERE b.state=$2 AND b.kind='body'
) SELECT DISTINCT id,name,seat,office,division,incumbent,source_url FROM people
  WHERE id IS NOT NULL AND name IS NOT NULL AND seat IS NOT NULL AND division IS NOT NULL AND source_url IS NOT NULL
  ORDER BY incumbent DESC,id,seat`;

export async function readCampaignMoneyPeople(query: Query, state: string): Promise<readonly CampaignMoneyPerson[]> {
  const rows = await query(CAMPAIGN_PEOPLE_SQL, [`US-${state}`, state]);
  return rows.map(row => ({ id: String(row.id), name: String(row.name), seat: String(row.seat), office: String(row.office ?? ""),
    division: String(row.division), incumbent: row.incumbent === true, sourceUrl: String(row.source_url) }));
}

export function campaignRecordYear(row: CampaignSourceRecord): number | null {
  if (row.transactionDate) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(row.transactionDate);
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(row.transactionDate);
    if (!iso && !local) return null;
    const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(local![3]), Number(local![1]), Number(local![2])];
    const at = new Date(Date.UTC(year, month - 1, day));
    return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? year : null;
  }
  const years = row.period?.match(/\b(?:19|20)\d{2}\b/g)?.map(Number);
  if (!years?.length || new Set(years.map(year => year + year % 2)).size !== 1) return null;
  return Math.min(...years);
}

const normalized = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function bindCampaignMoney(row: CampaignSourceRecord, people: readonly CampaignMoneyPerson[]): CampaignSourceRecord | null {
  const year = campaignRecordYear(row);
  if (year === null || year < campaignFinanceSource(row.state).minimumYear || row.filingState !== "FILED" || !row.filerName || !row.candidateName || !row.office || row.issues.some(issue => /conflict|disagree/i.test(issue))) return null;
  const name = normalized(row.candidateName), office = normalized(row.office);
  const matches = people.filter(person => normalized(person.name) === name && normalized(person.office) === office &&
    (!row.governmentOcdId || person.division === row.governmentOcdId));
  const unique = new Map(matches.map(person => [`${person.id}:${person.seat}`, person]));
  if (unique.size !== 1) return null;
  const person = [...unique.values()][0];
  return { ...row, governmentOcdId: person.division, unjoinedReason: null,
    person: { id: person.id, name: person.name, seat: person.seat, sourceUrl: person.sourceUrl } };
}
