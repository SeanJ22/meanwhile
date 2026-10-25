import { factDb } from "../tests/helpers/fact-db.ts";
import { door } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { FieldKind, Provenance } from "../lib/facts/check.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COUNT_SCHEMA_SOURCE } from "../lib/control-plane/repository/migrations/RB-A8.ts";
import { readerIdentityMigration } from "../tests/helpers/reader-identity-db.ts";

type Row = Record<string, unknown>;
export interface FactSnapshot {
  readonly state: string;
  readonly capturedAt: string;
  readonly facts: readonly Row[] | null;
  readonly entities: readonly Row[] | null;
  readonly sourceCopies: readonly Row[] | null;
  readonly hosts: readonly Row[] | null;
  readonly externalIds: readonly Row[] | null;
  readonly places: readonly Row[] | null;
  readonly texts?: Readonly<Record<string, string>>;
}

/** Open only a fresh local database; restore permanent ids before their relationships. */
export async function openFactCopy(snapshot: FactSnapshot) {
  const db = await factDb({ withResolver: false });
  try {
    for (const statement of readerIdentityMigration().split("--> statement-breakpoint"))
      if (!/SELECT reader_sync_ids\(\)/.test(statement)) await db.pg.exec(statement);
    const entities = JSON.stringify(snapshot.entities ?? []);
    await db.query(`INSERT INTO entity(id,kind,name,state,created_at)
      SELECT id,kind,name,state,created_at FROM jsonb_populate_recordset(NULL::entity,$1::jsonb)`, [entities]);
    await db.query(`UPDATE entity e SET parent_id=p.parent_id
      FROM jsonb_populate_recordset(NULL::entity,$1::jsonb) p WHERE e.id=p.id`, [entities]);
    await db.query("INSERT INTO source_copy SELECT * FROM jsonb_populate_recordset(NULL::source_copy,$1::jsonb)", [JSON.stringify(snapshot.sourceCopies ?? [])]);
    for (const [table, rows] of [["entity_host", snapshot.hosts], ["entity_external_id", snapshot.externalIds], ["entity_place", snapshot.places]] as const)
      await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,
        [JSON.stringify(table === "entity_place" ? (rows ?? []).map(row => ({ ...row, boundary_year: row.boundary_year ?? 0 })) : rows ?? [])]);
    await db.query("INSERT INTO fact SELECT * FROM jsonb_populate_recordset(NULL::fact,$1::jsonb)", [JSON.stringify(snapshot.facts ?? [])]);
    for (const table of ["source_copy", "fact"])
      await db.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),greatest(coalesce(max(id),0),1),count(*)>0) FROM ${table}`);
    await db.pg.exec("CREATE TABLE civic_data_promotions(scope text,record_class text,current_version_id text)");
    await db.pg.exec(readFileSync(COUNT_SCHEMA_SOURCE,"utf8").replaceAll("--> statement-breakpoint",""));
    return db;
  } catch (error) {
    await db.pg.close();
    throw error;
  }
}

/** Replay actual live fact rows against the restored copy, preserving their permanent ids. */
export async function replayCopiedFacts(db: FactDb & { query: Query }, snapshot: FactSnapshot, limit = Infinity) {
  const sources = new Map((snapshot.sourceCopies ?? []).map(copy => [Number(copy.id), copy]));
  let unchanged = 0, unavailable = 0;
  const kindOf = (field: string): FieldKind => /^member:|^name$|^office:/.test(field) ? "officeholder"
    : /money|contribution|expenditure|receipt|funding/.test(field) ? "money"
    : /agenda/.test(field) ? "agenda" : /meeting|sitting/.test(field) ? "meeting" : /vote/.test(field) ? "vote"
    : /portrait|photo/.test(field) ? "portrait" : /statement/.test(field) ? "statement" : /comment:/.test(field) ? "comment_rule" : "contact";
  const saved = (copy: Row) => ({ id: Number(copy.id), finalUrl: String(copy.final_url), text: snapshot.texts?.[String(copy.id)] ?? "",
    fetchedAt: new Date(String(copy.fetched_at)), isArchive: copy.is_archive === true });
  for (const fact of (snapshot.facts ?? []).slice(0, limit)) {
    const copy = sources.get(Number(fact.source_copy_id));
    if (!copy) { unavailable++; continue; }
    const second = sources.get(Number(fact.second_copy_id));
    const input = { subjectId: String(fact.entity_id), field: String(fact.field), fieldKind: kindOf(String(fact.field)), value: fact.value,
      valueText: String(fact.value_text), quote: String(fact.quote), provenance: fact.provenance_kind as Provenance,
      producedBy: String(fact.produced_by), costUsd: Number(fact.cost_usd), copy: saved(copy),
      ...(second ? { second: { copy: saved(second), quote: String(fact.quote) } } : {}) };
    const outcome = await door(db, input, factClocks(null), new Date(snapshot.capturedAt), { purge: async () => ({ purged: true }) });
    assert.equal("decision" in outcome && outcome.decision, "CONFIRM", `${snapshot.state} fact ${fact.id}: ${JSON.stringify(outcome)}`);
    const [after] = await db.query("SELECT id,value FROM fact WHERE entity_id=$1 AND field=$2 AND status='live'", [fact.entity_id, fact.field]);
    assert.equal(Number(after!.id), Number(fact.id)); assert.deepEqual(after!.value, fact.value); unchanged++;
  }
  return { replayed: unchanged, unchanged, unavailable };
}
