/** Execute the phase's real spend-hold SQL locally; hydrate only the rows its operation needs. */
import type { PGlite } from "@electric-sql/pglite";
import { projectedRead, type SqlShadow } from "./rh01-sql.mts";

type Rows = Record<string, unknown>[];
type Remote = (text: string, params: readonly unknown[]) => Promise<Rows>;
interface NativeSchema { SPEND_HOLDS_TABLE_DDL: string; ADMIT_SPEND_HOLD_FUNCTION_DDL: string; spendHoldLiveSql(alias: string, window: string, stale: string, retained: string): string; spendHoldDeadSql(alias: string, window: string, stale: string, retained: string): string }
const columns = ["job_id", "obligation_id", "keys", "lifetime_keys", "usd", "held_at", "what", "settled_usd", "cost_recorded_at", "changed_at"];

export class ReadonlySpendHoldOverlay {
  private initialized = false;
  private db: PGlite;
  private remote: Remote;
  private native: NativeSchema;
  constructor(db: PGlite, remote: Remote, native: NativeSchema) { this.db = db; this.remote = remote; this.native = native; }
  private async ready(): Promise<void> {
    if (this.initialized) return;
    await this.db.exec(this.native.SPEND_HOLDS_TABLE_DDL);
    await this.db.exec(this.native.ADMIT_SPEND_HOLD_FUNCTION_DDL);
    await this.db.exec("CREATE TABLE rh01_touched_holds(hold_id text PRIMARY KEY)");
    this.initialized = true;
  }
  private async hydrate(text: string, params: readonly unknown[]): Promise<void> {
    for (const row of await this.remote(text, params)) await this.db.query(`INSERT INTO cp_spend_holds
      SELECT r.* FROM jsonb_populate_record(NULL::cp_spend_holds,$1::jsonb) r
      WHERE NOT EXISTS(SELECT 1 FROM rh01_touched_holds t WHERE t.hold_id=r.hold_id)
      ON CONFLICT(hold_id) DO UPDATE SET ${columns.map(column => `"${column}"=EXCLUDED."${column}"`).join(",")}`,
    [JSON.stringify(row)]);
  }
  async shadow(): Promise<SqlShadow> {
    await this.ready();
    return { table: "cp_spend_holds", keys: ["hold_id"],
      rows: (await this.db.query("SELECT * FROM cp_spend_holds")).rows as Rows,
      deletedKeys: (await this.db.query("SELECT t.hold_id FROM rh01_touched_holds t WHERE NOT EXISTS(SELECT 1 FROM cp_spend_holds h WHERE h.hold_id=t.hold_id)")).rows as Rows };
  }
  async execute(text: string, params: readonly unknown[]): Promise<Rows> {
    await this.ready();
    const live = this.native.spendHoldLiveSql("h", "$1::timestamptz", "$2::timestamptz", "$3::timestamptz");
    let mutation = false;
    if (/^\s*SELECT\s+cp_admit_spend_hold\s*\(/i.test(text)) {
      const hold = JSON.parse(String(params[0])), lines = JSON.parse(String(params[1]));
      const keys = [...new Set([...lines.sends, ...lines.areas].map((line: { key: string }) => line.key))];
      const now = Date.parse(String(params[2]));
      const clocks = [params[3], params[4], params[5]].map(ms => new Date(now - Number(ms)).toISOString());
      const onLines = this.native.spendHoldLiveSql("h", "$3::timestamptz", "$4::timestamptz", "$5::timestamptz");
      await this.hydrate(`SELECT h.* FROM cp_spend_holds h WHERE h.hold_id=$1 OR (h.keys && $2::text[] AND ${onLines})`, [hold.holdId, keys, ...clocks]);
      mutation = true;
    } else if (/^\s*WITH\s+mine\s+AS\s*\(/i.test(text) && /\bUPDATE\s+cp_spend_holds\b/i.test(text)) {
      await this.hydrate(`SELECT h.* FROM cp_spend_holds h WHERE h.job_id=$4 AND h.cost_recorded_at IS NULL AND ${live}`, params.slice(0, 4)); mutation = true;
    } else if (/^\s*DELETE\s+FROM\s+cp_spend_holds\s+WHERE\s+hold_id\s*=\s*\$1/i.test(text)) {
      await this.hydrate("SELECT h.* FROM cp_spend_holds h WHERE h.hold_id=$1", [params[0]]); mutation = true;
    } else if (/^\s*DELETE\s+FROM\s+cp_spend_holds\s+x\s+WHERE\s+x.hold_id\s+IN/i.test(text)) {
      await this.hydrate(`SELECT h.* FROM cp_spend_holds h WHERE ${this.native.spendHoldDeadSql("h", "$1::timestamptz", "$2::timestamptz", "$3::timestamptz")} LIMIT $4::integer`, params); mutation = true;
    } else {
      const predecessor = projectedRead(text, "h.*");
      if (!predecessor || !/\bFROM\s+cp_spend_holds\s+h\b/i.test(predecessor)) throw Error("RH01_UNSUPPORTED_SPEND_HOLD_SQL");
      await this.hydrate(predecessor, params);
    }
    // Only actually changed/deleted identities shadow later production state. Comparisons stay inside SQL.
    if (mutation) return this.db.transaction(async transaction => {
      await transaction.exec("CREATE TEMP TABLE rh01_hold_before ON COMMIT DROP AS TABLE cp_spend_holds");
      const result = await transaction.query(text, [...params]);
      await transaction.exec(`INSERT INTO rh01_touched_holds SELECT coalesce(b.hold_id,a.hold_id)
        FROM rh01_hold_before b FULL JOIN cp_spend_holds a USING(hold_id)
        WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(a) ON CONFLICT DO NOTHING`);
      return result.rows as Rows;
    });
    return (await this.db.query(text, [...params])).rows as Rows;
  }
}
