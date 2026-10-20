import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { CampaignSourceCapture } from "./state-source-records.ts";

export interface CampaignMoneyCycle {
  readonly id: string;
  readonly person: { readonly id: string; readonly name: string; readonly seat: string };
  readonly committee: string;
  readonly cycle: number;
  readonly totals: readonly { readonly label: string; readonly amount: number }[];
  readonly sources: readonly (CampaignSourceCapture & { readonly publisher: string; readonly filingUrl: string })[];
}
export interface CampaignFinancePlaceRead {
  readonly division: string;
  readonly state: string;
  readonly status: "HELD" | "NOT_HELD" | "UNAVAILABLE";
  readonly checkedAt: string | null;
  readonly records: readonly CampaignMoneyCycle[];
  readonly count: number | null;
  readonly nextCursor: string | null;
}
interface Options { readonly query?: Query | null; readonly cursor?: string | null; readonly personId?: string }

export async function readCampaignFinanceForPlace(division: string, options: Options = {}): Promise<CampaignFinancePlaceRead> {
  const identity = jurisdictionFromOcdId(division);
  if (!identity) throw new Error("Campaign records require a state or local division.");
  const state = identity.usps;
  let cursor = "";
  if (options.cursor) {
    if (options.cursor.length > 4096) throw new Error("The campaign records page is invalid.");
    const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
    if (value.division !== division || !new RegExp(`^campaign-committee:${state}:[a-f0-9]{64}$`).test(value.entity)) throw new Error("The campaign records page is invalid.");
    cursor = value.entity;
  }
  const query = options.query === undefined ? factReader() : options.query;
  const empty = (status: CampaignFinancePlaceRead["status"]): CampaignFinancePlaceRead => ({ division, state, status, checkedAt: null, records: [], count: null, nextCursor: null });
  if (!query) return empty("UNAVAILABLE");
  const statewide = division === `ocd-division/country:us/${identity.prefix}:${identity.slug}`;
  const committees = await query(`SELECT e.id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id
    JOIN entity p ON p.id=e.parent_id AND p.kind='person' AND p.state=$2
    WHERE ep.place_id=$1 AND e.state=$2 AND e.kind='committee' AND e.id LIKE $3 AND e.id>$4
      AND ($5::text IS NULL OR p.id=$5) ORDER BY e.id LIMIT 2`, [division, state, `campaign-committee:${state}:%`, cursor, options.personId ?? null]);
  const committee = committees[0];
  if (!committee) return empty("NOT_HELD");
  const rows = await query(`WITH eligible AS MATERIALIZED (
    SELECT f.field,f.value,f.checked_at,CASE WHEN (f.value->>'transactionDate') ~ '^\\d{4}-' THEN substr(f.value->>'transactionDate',1,4)::int
      WHEN (f.value->>'transactionDate') ~ '^\\d{1,2}/\\d{1,2}/\\d{4}' THEN right(left(f.value->>'transactionDate',10),4)::int
      WHEN nullif(f.value->>'transactionDate','') IS NULL THEN substring(f.value->>'period' from '(20[0-9]{2})')::int END AS year
    FROM fact f JOIN entity e ON e.id=f.entity_id
    WHERE f.entity_id=$1 AND f.status='live' AND f.field LIKE 'campaign-money:%'
      AND f.value#>>'{person,id}'=e.parent_id AND nullif(f.value#>>'{person,seat}','') IS NOT NULL
      AND f.value->>'filerName'=e.name AND f.value->>'filingState'='FILED'
      AND ($2::boolean OR f.value->>'governmentOcdId'=$3)
  ), amounts AS (
    SELECT year+(year%2) AS cycle,a.amount->>'label' AS label,
      CASE WHEN a.amount->>'label' IN ('Contribution','Expenditure') THEN sum((a.amount->>'amount')::numeric)
        ELSE (array_agg((a.amount->>'amount')::numeric ORDER BY value->>'transactionDate' DESC NULLS LAST,field DESC))[1] END AS amount
    FROM eligible,LATERAL jsonb_array_elements(value->'amounts') a(amount) WHERE year>=2020 GROUP BY cycle,a.amount->>'label'
  ) SELECT cycle,jsonb_agg(jsonb_build_object('label',label,'amount',amount) ORDER BY label) AS totals,
    (SELECT value->'person' FROM eligible WHERE year>=2020 LIMIT 1) AS person,
    (SELECT value->>'filerName' FROM eligible WHERE year>=2020 LIMIT 1) AS committee,
    (SELECT jsonb_agg(DISTINCT (value->'provenance')||jsonb_build_object('filingUrl',value->>'filingUrl')) FROM eligible WHERE year+(year%2)=a.cycle) AS sources,
    (SELECT max(checked_at) FROM eligible WHERE year+(year%2)=a.cycle) AS checked_at
    FROM amounts a GROUP BY cycle ORDER BY cycle DESC`, [committee.id, statewide, division]);
  const records = rows.map(row => ({ id: `${committee.id}:${row.cycle}`, person: row.person, committee: row.committee, cycle: row.cycle, totals: row.totals, sources: row.sources })) as CampaignMoneyCycle[];
  const checkedAt = rows.map(row => new Date(row.checked_at as string).toISOString()).sort().at(-1) ?? null;
  return { division, state, status: records.length ? "HELD" : "NOT_HELD", checkedAt, records, count: null,
    nextCursor: committees.length > 1 ? Buffer.from(JSON.stringify({ division, entity: committee.id })).toString("base64url") : null };
}
