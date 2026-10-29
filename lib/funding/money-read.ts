import { resolveId } from "../core/resolve.ts";
import type { Query } from "../facts/publish.ts";
import { CAMPAIGN_FIELD_PREFIX, FEDERAL_FIELD_PREFIX } from "./money-records.ts";
import {
  campaignMoneyView, federalAwardsView, FEDERAL_AWARD_ROWS, FEDERAL_MONEY_SINCE_YEAR,
  type AwardYearSum, type CampaignMoneyView, type FederalAwardsView, type MoneyFactRow,
} from "./money-card-view.ts";

/** One person's or committee's rebuilt campaign money; null until the Slide has filed any. */
export async function readCampaignMoneyView(query: Query, personId: string): Promise<CampaignMoneyView | null> {
  const subject = await resolveId(personId, query);
  if (!subject) return null;
  const rows = await query(`SELECT entity_id,field,value,quote,checked_at FROM checked_fact
    WHERE entity_id=$1 AND status='live' AND field LIKE $2 LIMIT 5000`, [subject, `${CAMPAIGN_FIELD_PREFIX}%`]);
  return campaignMoneyView(subject, rows.map(factRow));
}

const factRow = (row: Record<string, unknown>): MoneyFactRow => ({ entityId: String(row.entity_id), field: String(row.field), value: row.value,
  quote: String(row.quote ?? ""), checkedAt: new Date(row.checked_at as string).toISOString() });

const WANTED = `WITH wanted AS (SELECT unnest($1::text[]) AS id UNION SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=ANY($1::text[]))`;
const LIVE_AWARD = `f.entity_id IN (SELECT id FROM wanted) AND f.status='live' AND f.field LIKE $2
  AND CASE WHEN jsonb_typeof(f.value->'amount')='number' THEN (f.value->>'amount')::numeric END > 0`;

/** A body's or government's awards: totals by year and agency, and the newest rows. */
export async function readFederalAwardsView(query: Query, bodyIds: readonly string[], now: Date): Promise<FederalAwardsView | null> {
  if (!bodyIds.length) return null;
  const like = `${FEDERAL_FIELD_PREFIX}%`;
  const [sums, rows] = await Promise.all([
    query(`${WANTED} SELECT left(f.value->>'date',4) AS year,f.value->>'agency' AS agency,sum((f.value->>'amount')::numeric) AS amount
      FROM checked_fact f WHERE ${LIVE_AWARD} AND left(f.value->>'date',4)>=$3 GROUP BY 1,2`, [bodyIds, like, String(FEDERAL_MONEY_SINCE_YEAR)]),
    query(`${WANTED} SELECT f.entity_id,f.field,f.value,f.quote,f.checked_at FROM checked_fact f WHERE ${LIVE_AWARD}
      ORDER BY f.value->>'date' DESC,f.field LIMIT ${FEDERAL_AWARD_ROWS}`, [bodyIds, like]),
  ]);
  const totals: AwardYearSum[] = sums.map(row => ({ year: String(row.year), agency: String(row.agency ?? ""), amount: Number(row.amount) }));
  return federalAwardsView(totals, rows.map(factRow), now);
}
