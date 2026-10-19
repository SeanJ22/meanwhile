import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";
import { campaignFinancePublicationIssue } from "./state-sources.ts";

export interface CampaignFinancePlaceRead {
  readonly division: string;
  readonly state: string;
  readonly status: "HELD" | "NOT_HELD" | "UNAVAILABLE";
  readonly checkedAt: string | null;
  readonly records: readonly CampaignSourceRecord[];
  readonly count: number | null;
  readonly nextCursor: string | null;
}
interface Cursor { readonly division: string; readonly entity: string; readonly field: string }
interface Options { readonly query?: Query | null; readonly cursor?: string | null }
function cursorOf(encoded: string | undefined | null, division: string, state: string): Cursor | null {
  if (!encoded) return null;
  if (encoded.length > 4096) throw new Error("The campaign records page is invalid.");
  let value: Cursor;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("The campaign records page is invalid."); }
  if (value?.division !== division || !new RegExp(`^campaign-committee:${state}:[a-f0-9]{64}$`).test(value.entity) ||
      typeof value.field !== "string" || value.field !== "" && !value.field.startsWith(`campaign-money:${state}:`)) throw new Error("The campaign records page is invalid.");
  return value;
}

const COMMITTEE = `SELECT e.id FROM entity_place p JOIN entity e ON e.id=p.entity_id
  WHERE p.place_id=$1 AND e.state=$2 AND e.kind='committee' AND e.id LIKE $3
    AND (e.id>$4 OR e.id=$4 AND NOT $5::boolean)
    AND EXISTS (SELECT 1 FROM fact f WHERE f.entity_id=e.id AND f.status='live' AND f.field LIKE 'campaign-money:%'
      AND ($7::boolean OR f.value->>'governmentOcdId'=$1) AND (e.id<>$4 OR f.field>$6)) ORDER BY e.id LIMIT 1`;

export async function readCampaignFinanceForPlace(division: string, options: Options = {}): Promise<CampaignFinancePlaceRead> {
  const identity = jurisdictionFromOcdId(division);
  if (!identity) throw new Error("Campaign records require a state or local division.");
  const state = identity.usps, cursor = cursorOf(options.cursor, division, state);
  const statewide = division === `ocd-division/country:us/${identity.prefix}:${identity.slug}`;
  const query = options.query === undefined ? factReader() : options.query;
  const empty = (status: CampaignFinancePlaceRead["status"]): CampaignFinancePlaceRead => ({ division, state, status, checkedAt: null, records: [], count: null, nextCursor: null });
  if (!query) return empty("UNAVAILABLE");
  const committee = async (entity: string, exclusive: boolean, field: string) =>
    (await query!(COMMITTEE, [division, state, `campaign-committee:${state}:%`, entity, exclusive, field, statewide]))[0]?.id as string | undefined;
  const entity = await committee(cursor?.entity ?? "", false, cursor?.field ?? "");
  if (!entity) return empty("NOT_HELD");
  const held = await query(`SELECT field,value,checked_at FROM fact WHERE entity_id=$1 AND status='live'
    AND field LIKE 'campaign-money:%' AND field>$2 AND ($3::boolean OR value->>'governmentOcdId'=$4)
    ORDER BY field LIMIT 101`, [entity, entity === cursor?.entity ? cursor.field : "", statewide, division]);
  const page = held.slice(0, 100), records = page.map(row => row.value as CampaignSourceRecord);
  for (const row of records) if (campaignFinancePublicationIssue({ kind: "campaign-finance-source-rows", state, resource: row.resource, records: [row] }, state) ||
      division !== `ocd-division/country:us/${identity.prefix}:${identity.slug}` && row.governmentOcdId !== division) throw new Error("Campaign facts cross the requested place or saved source.");
  const next = held.length > 100 ? { entity, field: String(page.at(-1)!.field) } : await committee(entity, true, "").then(id => id ? { entity: id, field: "" } : null);
  const checkedAt = page.map(row => new Date(row.checked_at as string).toISOString()).sort().at(-1) ?? null;
  return { division, state, status: records.length ? "HELD" : "NOT_HELD", checkedAt, records, count: null,
    nextCursor: next ? Buffer.from(JSON.stringify({ division, ...next })).toString("base64url") : null };
}
