import { readFileSync } from "node:fs";
import type { Sql } from "../pg-store.ts";
export const LEGISTAR_WORK_MIGRATION_SOURCE="lib/control-plane/repository/migrations/RB-A9.sql";
export const legistarWorkMigrationDefinition=()=>readFileSync(new URL("./RB-A9.sql",import.meta.url),"utf8");
export async function expandLegistarWork(sql:Sql):Promise<string>{
  await sql.query("BEGIN");
  try{for(const statement of legistarWorkMigrationDefinition().split("--> statement-breakpoint"))await sql.query(statement);await sql.query("COMMIT");}
  catch(error){await sql.query("ROLLBACK");throw error;}
  return "Legistar member work counts";
}
