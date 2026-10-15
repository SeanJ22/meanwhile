import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { SPEND_HOLDS_TABLE_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { SPEND_LINE_TOTALS_DDL } from "../lib/control-plane/repository/spend-line-totals.ts";

const NOW = "2026-10-15T18:00:00.000000Z";
const at = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
async function hold(pg: PGlite, id: string, held: string, settled: string | null, life = false) {
  await pg.query(`INSERT INTO cp_spend_holds (hold_id,job_id,obligation_id,keys,lifetime_keys,usd,held_at,what,settled_usd,cost_recorded_at)
    VALUES ($1,$1,'place',ARRAY['send:all','area:one','send:all'],$4::text[],2,$2,'fixture',0.5,$3)`,
  [id, held, settled, life ? ["send:all"] : []]);
}
const expected = `SELECT round((($1::jsonb->>'budgetUsd')::numeric-($1::jsonb->>'historicalUsd')::numeric-
  coalesce(sum(CASE WHEN cost_recorded_at IS NULL THEN usd WHEN cost_recorded_at>($1::jsonb->>'historyReadAt')::timestamptz
  THEN settled_usd ELSE 0 END),0))*1000000000)/1000000000 value FROM cp_spend_holds
  WHERE keys @> ARRAY[$1::jsonb->>'key'] AND
  (cardinality(lifetime_keys)>0 OR held_at >= $2::timestamptz) AND
  CASE WHEN cost_recorded_at IS NULL THEN held_at >= $3::timestamptz ELSE cost_recorded_at >= $4::timestamptz END
  AND (coalesce(($1::jsonb->>'lifetime')::boolean,false) OR held_at >= $2::timestamptz)`;
async function compare(pg: PGlite, now = NOW) {
  const time = Date.parse(now), instant = (hours: number) => new Date(time - hours * 3_600_000).toISOString();
  for (const key of ["send:all", "area:one", "absent"]) for (const lifetime of [false, true]) {
    for (const historyReadAt of [instant(24), instant(6), instant(1), now, instant(-1)]) {
      const line = { key, lifetime, budgetUsd: 100, historicalUsd: 3, historyReadAt };
      const params = [JSON.stringify(line), instant(24), instant(2), instant(6)];
      const want = (await pg.query<{ value: string }>(expected, params)).rows[0].value;
      const got = (await pg.query<{ value: string }>("SELECT cp_spend_line_left($1,$2,$3,$4) value", params)).rows[0].value;
      assert.equal(Number(got), Number(want), `${key}/${lifetime}/${historyReadAt}`);
    }
  }
}

test("line prefixes preserve both exact clocks, lifetime scope and native microsecond boundaries", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(SPEND_HOLDS_TABLE_DDL);
    await hold(pg, "open-equal", at(2), null);
    await hold(pg, "open-expired", "2026-10-15T15:59:59.999999Z", null, true);
    await hold(pg, "held-equal", at(24), at(1));
    await hold(pg, "held-expired", "2026-10-14T17:59:59.999999Z", at(1));
    await hold(pg, "cost-equal", at(7), at(6));
    await hold(pg, "cost-expired", at(7), "2026-10-15T11:59:59.999999Z");
    await hold(pg, "history-after", at(2), "2026-10-15T17:00:00.000001Z");
    await hold(pg, "lifetime-old", at(80), at(1), true);
    await hold(pg, "future", at(-20), at(-18), true);
    for (const sql of SPEND_LINE_TOTALS_DDL) await pg.exec(sql);
    await compare(pg);
    for (const sql of SPEND_LINE_TOTALS_DDL) await pg.exec(sql);
    await compare(pg);
    await hold(pg, "live-insert", at(0), null);
    await compare(pg);
    await pg.query("UPDATE cp_spend_holds SET settled_usd=0.75,cost_recorded_at=$1 WHERE hold_id='live-insert'", [NOW]);
    await compare(pg);
    await pg.exec("DELETE FROM cp_spend_holds WHERE hold_id IN ('held-equal','lifetime-old','live-insert')");
    await compare(pg);
  } finally { await pg.close(); }
});

test("negative clocks and changes to line membership replace their exact contribution", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(SPEND_HOLDS_TABLE_DDL);
    for (const sql of SPEND_LINE_TOTALS_DDL) await pg.exec(sql);
    await hold(pg, "negative", "1969-12-31T17:59:59.999999Z", "1969-12-31T23:59:59.999999Z", true);
    await compare(pg, "1970-01-01T00:00:00.000000Z");
    await pg.exec("UPDATE cp_spend_holds SET keys=ARRAY['area:one'],lifetime_keys=ARRAY[]::text[],settled_usd=1 WHERE hold_id='negative'");
    await compare(pg, "1970-01-01T00:00:00.000000Z");
    await pg.exec("DELETE FROM cp_spend_holds WHERE hold_id='negative'");
    await compare(pg, "1970-01-01T00:00:00.000000Z");
  } finally { await pg.close(); }
});

test("failed prefix updates roll back the hold and a retry counts the reservation once", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(SPEND_HOLDS_TABLE_DDL);
    for (const sql of SPEND_LINE_TOTALS_DDL) await pg.exec(sql);
    await pg.exec(`CREATE FUNCTION reject_prefix() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.held_level=7 THEN RAISE EXCEPTION 'prefix unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_prefix BEFORE INSERT OR UPDATE ON cp_spend_line_totals FOR EACH ROW EXECUTE FUNCTION reject_prefix()`);
    await assert.rejects(hold(pg, "failed", at(0), null), /prefix unavailable/);
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::integer count FROM cp_spend_holds")).rows[0].count, 0);
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::integer count FROM cp_spend_line_totals")).rows[0].count, 0);
    await pg.exec("DROP TRIGGER reject_prefix ON cp_spend_line_totals");
    await hold(pg, "failed", at(0), null);
    await compare(pg);
  } finally { await pg.close(); }
});
