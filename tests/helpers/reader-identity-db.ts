import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";

const directory = join(import.meta.dirname, "../../lib/db/migrations");
export const readerIdentityMigration = () => readFileSync(join(directory,
  readdirSync(directory).find(name => name.endsWith("0051_rb_a1_shared.sql"))!), "utf8");

export async function identitySourceTables(pg: PGlite): Promise<void> {
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
  const functions = readFileSync(join(directory, "0036_ne01.sql"), "utf8").split("--> statement-breakpoint")
    .filter(statement => /CREATE FUNCTION reader_payload_(node|members|value)\(/.test(statement));
  for (const statement of functions) await pg.exec(statement);
}

export async function identityEventTables(pg: PGlite): Promise<void> {
  await pg.exec(`CREATE TABLE reactions(target_id text,target_type text);
    CREATE TABLE speak_your_mind(subject_id text,subject_type text);
    CREATE TABLE demand_signals(subject_id text,subject_type text);
    CREATE TABLE ask_interactions(subject_ids jsonb)`);
}
