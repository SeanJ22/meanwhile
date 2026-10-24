import { factDb } from "../tests/helpers/fact-db.ts";

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
  const db = await factDb();
  try {
    const entities = JSON.stringify(snapshot.entities ?? []);
    await db.query(`INSERT INTO entity(id,kind,name,state,created_at)
      SELECT id,kind,name,state,created_at FROM jsonb_populate_recordset(NULL::entity,$1::jsonb)`, [entities]);
    await db.query(`UPDATE entity e SET parent_id=p.parent_id
      FROM jsonb_populate_recordset(NULL::entity,$1::jsonb) p WHERE e.id=p.id`, [entities]);
    await db.query("INSERT INTO source_copy SELECT * FROM jsonb_populate_recordset(NULL::source_copy,$1::jsonb)", [JSON.stringify(snapshot.sourceCopies ?? [])]);
    for (const [table, rows] of [["entity_host", snapshot.hosts], ["entity_external_id", snapshot.externalIds], ["entity_place", snapshot.places]] as const)
      await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(rows ?? [])]);
    await db.query("INSERT INTO fact SELECT * FROM jsonb_populate_recordset(NULL::fact,$1::jsonb)", [JSON.stringify(snapshot.facts ?? [])]);
    for (const table of ["source_copy", "fact"])
      await db.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),greatest(coalesce(max(id),0),1),count(*)>0) FROM ${table}`);
    return db;
  } catch (error) {
    await db.pg.close();
    throw error;
  }
}
