import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { FactDb, Query } from "../../lib/facts/publish.ts";
import { partitionCivicPayload } from "../../lib/civic-data/payload-codec.ts";
import type { RoutineRecordClass } from "../../lib/civic-data/types.ts";
import { provenEdgeEntry } from "./promoted-edge-entry.ts";
import { BOOTSTRAP_DDL, CP_MIGRATIONS_DDL } from "../../lib/control-plane/repository/pg-schema.ts";
import { expandControlReads } from "../../lib/control-plane/repository/migrations/CP-01.ts";

type MigrationDb = FactDb & { readonly pg: PGlite; readonly query: Query; readonly sql: { readonly query: Query } };
const fixtureVersions = new WeakMap<object, number>();

function database(pg: PGlite): MigrationDb {
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  return { pg, query, sql: { query }, transaction: work => pg.transaction(tx => work(async (text, params = []) =>
    (await tx.query<Record<string, unknown>>(text, [...params])).rows)) };
}

/** The complete committed reader schema, without fixture-owned tables or substituted SQL. */
export async function readerMigrationDb(): Promise<MigrationDb> {
  const db = database(new PGlite());
  const directory = new URL("../../lib/db/migrations/", import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8")) as {
    readonly entries: readonly { readonly idx: number; readonly tag: string }[];
  };
  try {
    for (const entry of journal.entries) {
      const sql = readFileSync(new URL(`${entry.tag}.sql`, directory), "utf8");
      try { await db.pg.exec(sql); }
      catch (cause) { throw new Error(`DG reader migration ${entry.idx}:${entry.tag} failed`, { cause }); }
    }
    return db;
  } catch (error) { await db.pg.close(); throw error; }
}

/** Insert exact candidate proof and its real append-only history beside a fixture pointer. */
export async function savePromotedFixture(db: FactDb, input: {
  readonly recordClass: RoutineRecordClass; readonly scope: string; readonly sourceId: string;
  readonly value: unknown; readonly at?: string;
}) {
  const encoded = partitionCivicPayload(input.value), at = input.at ?? "2026-09-25T12:00:00.000Z";
  const sequence = (fixtureVersions.get(db) ?? 0) + 1;
  fixtureVersions.set(db, sequence);
  const hash = createHash("sha256").update(JSON.stringify(encoded.value)).digest("hex");
  const versionId = `dg-fixture:${input.recordClass}:${input.scope}:${sequence}:${hash}`;
  const { projection } = provenEdgeEntry({ ...input, value: encoded.value, versionId, retrievedAt: at, promotedAt: at });
  const envelope = { id: versionId, sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope,
    retrieval: { succeeded: true, retrievedAt: at, rawHash: hash },
    normalization: { normalizedHash: hash, parserVersion: "dg-migrated-fixture" },
    temporal: { sourceThrough: at.slice(0, 10) }, identities: [], readModel: encoded.value };
  await db.transaction(async query => {
    for (const part of encoded.parts) await query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,
      normalized_hash,retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      VALUES($1,$2,$3,$4,'PROMOTED',true,$5,$5,$6,$7,'dg-migrated-fixture','[]',$8,$9,$1,$1)`,
      [versionId, input.sourceId, input.recordClass, input.scope, hash, at, at.slice(0, 10), JSON.stringify(envelope), JSON.stringify(projection.receipt)]);
    for (const [index, state] of ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].entries()) await query(`INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail)
      VALUES($1,$2,$3,$4,'DG migration-backed fixture proof')`, [versionId, index + 1, state, at]);
    await query(`INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8) ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,
        last_known_good_version_id=excluded.last_known_good_version_id,promoted_at=excluded.promoted_at,payload=excluded.payload,validation_receipt=excluded.validation_receipt`,
      [projection.key, input.sourceId, input.recordClass, input.scope, versionId, at, JSON.stringify(encoded.value), JSON.stringify(projection.receipt)]);
  });
  return encoded;
}

/** Real CP declarations; PGlite cannot model online index construction, so only its concurrency modifier is omitted. */
export async function controlPlaneMigrationDb(): Promise<MigrationDb> {
  const db = database(new PGlite());
  try {
    for (const [index, ddl] of BOOTSTRAP_DDL.entries()) {
      try { await db.pg.exec(ddl.replace(/\bCREATE (UNIQUE )?INDEX CONCURRENTLY\b/g, "CREATE $1INDEX")); }
      catch (cause) { throw new Error(`DG control-plane bootstrap declaration ${index} failed`, { cause }); }
    }
    await expandControlReads(db.sql);
    await db.pg.exec(CP_MIGRATIONS_DDL);
    const journal = JSON.parse(readFileSync(new URL("../../lib/control-plane/repository/migrations/meta/_journal.json", import.meta.url), "utf8")) as {
      readonly entries: readonly { readonly id: string; readonly hash: string }[];
    };
    for (const entry of journal.entries) await db.query("INSERT INTO cp_migrations(id,hash,completed_at) VALUES($1,$2,now())", [entry.id, entry.hash]);
    return db;
  } catch (error) { await db.pg.close(); throw error; }
}
