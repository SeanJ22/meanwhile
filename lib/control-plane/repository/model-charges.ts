import type { CostEntry } from "../cost.ts";
import { aggregatePricedSpend, pricedModelCharge, type PricedCharge, type PricedSpendTotals } from "../fleet-safety.ts";
import { costRecordId } from "../spend-window.ts";
import type { AppendOnlyRepository } from "./types.ts";
import { withControlPlaneConnectRetry } from "./connect-retry.ts";

export interface ModelSpendQuery { readonly since: string; readonly until: string }
export interface ModelChargeRepository {
  record(entry: CostEntry): Promise<void>;
  readSince(since: string): Promise<readonly PricedCharge[]>;
  totals(query: ModelSpendQuery): Promise<PricedSpendTotals>;
}
export interface ModelChargeRecord { readonly id: string; readonly at: string; readonly charge: PricedCharge | null }

export function costRepositoryWithCharges(costs: AppendOnlyRepository<CostEntry>, charges: ModelChargeRepository): AppendOnlyRepository<CostEntry> {
  return { ...costs, async append(key, id, entry, now) {
    const saved = await costs.append(key, id, entry, now);
    await charges.record(saved.record);
    return saved;
  } };
}

export function logModelCharges(log: AppendOnlyRepository<ModelChargeRecord>): ModelChargeRepository {
  const read = async (since: string) => (await log.readSince(since)).flatMap(row => row.charge ?? []);
  return {
    async record(entry) {
      const id = costRecordId(entry);
      if ((await log.read(id)).length) return;
      await log.append(id, id, { id, at: entry.recordedAt, charge: pricedModelCharge(entry, id) }, entry.recordedAt);
    },
    readSince: read,
    async totals(query) { return aggregatePricedSpend(await read(query.since), query.since, query.until); },
  };
}

export const MODEL_CHARGES_DDL = [
  `CREATE OR REPLACE FUNCTION cp_cost_recorded_at(entry jsonb) RETURNS timestamptz
    LANGUAGE sql IMMUTABLE SET timezone='UTC' AS $$ SELECT (entry->>'recordedAt')::timestamptz $$`,
  `CREATE OR REPLACE FUNCTION cp_cost_record_id(entry jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT 'ce-' || substr(encode(sha256(convert_to(entry->>'attemptId','UTF8') || decode('1f','hex') ||
      coalesce(convert_to(entry->>'routeTaskId','UTF8'),decode('00','hex')) || decode('1f','hex') ||
      convert_to(entry->>'recordedAt','UTF8') || decode('1f','hex')), 'hex'),1,24) $$`,
  `CREATE TABLE IF NOT EXISTS cp_model_charges (id text PRIMARY KEY, recorded_at timestamptz NOT NULL, charge jsonb)`,
  `CREATE INDEX IF NOT EXISTS cp_model_charges_recorded_at ON cp_model_charges (recorded_at)`,
  `CREATE TABLE IF NOT EXISTS cp_model_charge_pending (id text PRIMARY KEY, recorded_at timestamptz NOT NULL,
    log_key text NOT NULL, position bigint NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS cp_model_charge_pending_at ON cp_model_charge_pending (recorded_at,id)`,
  `CREATE TABLE IF NOT EXISTS cp_model_spend_totals (level smallint NOT NULL, bucket bigint NOT NULL,
    usd numeric NOT NULL, known_usd numeric NOT NULL, measured bigint NOT NULL, unmeasured bigint NOT NULL,
    worst_case bigint NOT NULL, pending bigint NOT NULL DEFAULT 0, PRIMARY KEY (level,bucket))`,
  `CREATE OR REPLACE FUNCTION cp_count_pending_model_charge() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE clock timestamptz; delta bigint;
    BEGIN
      IF TG_OP='INSERT' THEN clock := NEW.recorded_at; delta := 1;
      ELSE clock := OLD.recorded_at; delta := -1; END IF;
      INSERT INTO cp_model_spend_totals (level,bucket,usd,known_usd,measured,unmeasured,worst_case,pending)
        SELECT level,(floor(extract(epoch FROM clock)*1000)::bigint + 9007199254740992::bigint) >> (level*8),
          0,0,0,0,0,delta FROM generate_series(0,6) level
        ON CONFLICT (level,bucket) DO UPDATE SET pending=cp_model_spend_totals.pending+excluded.pending;
      RETURN NULL;
    END $$`,
  `CREATE OR REPLACE FUNCTION cp_queue_model_charge() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE charge_id text := cp_cost_record_id(NEW.record);
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM cp_model_charges WHERE id=charge_id) THEN
        INSERT INTO cp_model_charge_pending (id,recorded_at,log_key,position)
          VALUES (charge_id,cp_cost_recorded_at(NEW.record),NEW.log_key,NEW.position) ON CONFLICT (id) DO NOTHING;
      END IF;
      RETURN NEW;
    END $$`,
  `CREATE OR REPLACE FUNCTION cp_add_model_charge_totals() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.charge IS NOT NULL THEN
      INSERT INTO cp_model_spend_totals (level,bucket,usd,known_usd,measured,unmeasured,worst_case)
        SELECT level, (floor(extract(epoch FROM NEW.recorded_at)*1000)::bigint + 9007199254740992::bigint) >> (level*8),
          (NEW.charge->>'usd')::numeric, (NEW.charge->>'knownUsd')::numeric,
          CASE WHEN (NEW.charge->>'measured')::boolean THEN 1 ELSE 0 END,
          CASE WHEN (NEW.charge->>'measured')::boolean THEN 0 ELSE 1 END,
          CASE WHEN (NEW.charge->>'bounded')::boolean THEN 1 ELSE 0 END
        FROM generate_series(0,6) level
        ON CONFLICT (level,bucket) DO UPDATE SET usd=cp_model_spend_totals.usd+excluded.usd,
          known_usd=cp_model_spend_totals.known_usd+excluded.known_usd,
          measured=cp_model_spend_totals.measured+excluded.measured,
          unmeasured=cp_model_spend_totals.unmeasured+excluded.unmeasured,
          worst_case=cp_model_spend_totals.worst_case+excluded.worst_case;
    END IF;
    DELETE FROM cp_model_charge_pending WHERE id=NEW.id;
    RETURN NEW;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_model_charge_pending_totals' AND tgrelid='cp_model_charge_pending'::regclass) THEN
      LOCK TABLE cp_model_charges,cp_model_charge_pending IN SHARE ROW EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_model_charge_pending_totals' AND tgrelid='cp_model_charge_pending'::regclass) THEN
        ALTER TABLE cp_model_spend_totals ADD COLUMN IF NOT EXISTS pending bigint NOT NULL DEFAULT 0;
        INSERT INTO cp_model_spend_totals (level,bucket,usd,known_usd,measured,unmeasured,worst_case,pending)
          SELECT level,(floor(extract(epoch FROM recorded_at)*1000)::bigint + 9007199254740992::bigint) >> (level*8) bucket,
            0,0,0,0,0,count(*) FROM cp_model_charge_pending CROSS JOIN generate_series(0,6) level GROUP BY level,bucket
          ON CONFLICT (level,bucket) DO UPDATE SET pending=cp_model_spend_totals.pending+excluded.pending;
        CREATE TRIGGER cp_model_charge_pending_totals AFTER INSERT OR DELETE ON cp_model_charge_pending
          FOR EACH ROW EXECUTE FUNCTION cp_count_pending_model_charge();
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_model_charges_totals' AND tgrelid='cp_model_charges'::regclass) THEN
      BEGIN
        CREATE TRIGGER cp_model_charges_totals AFTER INSERT ON cp_model_charges FOR EACH ROW EXECUTE FUNCTION cp_add_model_charge_totals();
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_log_costs_price_pending' AND tgrelid='cp_log_costs'::regclass) THEN
      BEGIN
        CREATE TRIGGER cp_log_costs_price_pending AFTER INSERT ON cp_log_costs FOR EACH ROW EXECUTE FUNCTION cp_queue_model_charge();
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    END IF;
  END $$`,
] as const;

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
// Seven radix-256 ranges cover an exact millisecond prefix; country size changes neither the range count nor each range width.
function prefixRanges(boundary: bigint, sign: number) {
  return Array.from({ length: 7 }, (_, level) => {
    const upper = boundary >> BigInt(level * 8), width = upper & BigInt(255);
    return { level, lower: String(upper - width), upper: String(upper), sign };
  }).filter(range => range.lower !== range.upper);
}
function rangeBounds(input: ModelSpendQuery) {
  const since = Date.parse(input.since), until = Date.parse(input.until);
  if (!Number.isFinite(since) || !Number.isFinite(until) || since > until) throw new Error("Model spend window is invalid.");
  return { ranges: [...prefixRanges(BigInt(until) + BigInt("9007199254740993"), 1), ...prefixRanges(BigInt(since) + BigInt("9007199254740992"), -1)] };
}
const INCOMPLETE = "Model spend pricing is incomplete; paid work waits for ledger replay.";
async function recordModelCharges(query: Query, entries: readonly CostEntry[]) {
  if (entries.length === 0) return;
  const rows = entries.map(entry => {
    const id = costRecordId(entry);
    return { id, at: entry.recordedAt, charge: pricedModelCharge(entry, id) };
  });
  await withControlPlaneConnectRetry(() => query(`WITH incoming AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,at timestamptz,charge jsonb)
  ), inserted AS (INSERT INTO cp_model_charges (id,recorded_at,charge)
    SELECT id,at,charge FROM incoming ORDER BY at,id ON CONFLICT (id) DO NOTHING RETURNING id)
    DELETE FROM cp_model_charge_pending p USING incoming i WHERE p.id=i.id AND
      (EXISTS (SELECT 1 FROM inserted WHERE id=i.id) OR EXISTS (SELECT 1 FROM cp_model_charges WHERE id=i.id))`,
  [JSON.stringify(rows)]), {
    maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 50,
    isRetryable: error => !!error && typeof error === "object" && "code" in error && error.code === "40P01",
  });
}
export function pgModelCharges(query: Query): ModelChargeRepository {
  return {
    record: entry => recordModelCharges(query, [entry]),
    async readSince(since) {
      const missing = await query(`SELECT EXISTS (SELECT 1 FROM cp_model_charge_pending WHERE recorded_at >= $1::timestamptz) missing`, [since]);
      if (missing[0]?.missing !== false) throw new Error(INCOMPLETE);
      const rows = await query(`SELECT charge FROM cp_model_charges WHERE recorded_at >= $1::timestamptz AND charge IS NOT NULL ORDER BY recorded_at,id`, [since]);
      return rows.map(row => row.charge as PricedCharge);
    },
    async totals(input) {
      const bounds = rangeBounds(input);
      const rows = await query(`WITH ranges AS (SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS r(level smallint,lower bigint,upper bigint,sign integer))
        SELECT coalesce(sum(t.usd*r.sign),0) usd, coalesce(sum(t.known_usd*r.sign),0) "knownUsd",
          coalesce(sum(t.measured*r.sign),0) measured, coalesce(sum(t.unmeasured*r.sign),0) unmeasured,
          coalesce(sum(t.worst_case*r.sign),0) "worstCaseCharges",
          coalesce(sum(t.pending*r.sign),0) <> 0 missing
        FROM ranges r CROSS JOIN LATERAL (SELECT * FROM cp_model_spend_totals
          WHERE level=r.level AND bucket >= r.lower AND bucket < r.upper OFFSET 0) t`,
      [JSON.stringify(bounds.ranges)]);
      if (rows.length !== 1 || rows[0].missing !== false) throw new Error(INCOMPLETE);
      return Object.fromEntries(["usd", "knownUsd", "measured", "unmeasured", "worstCaseCharges"].map(key => {
        const value = Number(rows[0][key]);
        if (!Number.isFinite(value) || value < 0) throw new Error("Model spend totals are unreadable.");
        return [key, value];
      })) as unknown as PricedSpendTotals;
    },
  };
}

export async function backfillModelCharges(query: Query, now: string): Promise<number> {
  const since = new Date(Date.parse(now) - 30 * 3_600_000).toISOString();
  const bounds = rangeBounds({ since, until: new Date(8_640_000_000_000_000).toISOString() });
  const rows = await query(`WITH ranges AS (SELECT * FROM jsonb_to_recordset($2::jsonb)
    AS r(level smallint,lower bigint,upper bigint,sign integer)), pending AS MATERIALIZED (
    SELECT coalesce(sum(t.pending*r.sign),0) amount FROM ranges r CROSS JOIN LATERAL (
      SELECT pending FROM cp_model_spend_totals WHERE level=r.level AND bucket>=r.lower AND bucket<r.upper OFFSET 0) t)
    SELECT l.record FROM pending CROSS JOIN LATERAL (
      SELECT p.log_key,p.position FROM cp_model_charge_pending p WHERE pending.amount>0 AND p.recorded_at >= $1::timestamptz
      ORDER BY p.recorded_at,p.id LIMIT 100 OFFSET 0) p
    CROSS JOIN LATERAL (SELECT record FROM cp_log_costs WHERE log_key=p.log_key AND position=p.position OFFSET 0) l`,
  [since, JSON.stringify(bounds.ranges)]);
  await recordModelCharges(query, rows.map(row => row.record as CostEntry));
  return rows.length;
}
