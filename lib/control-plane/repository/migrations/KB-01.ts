import { KEYS_DDL } from "../../../core/keys-store.ts";
import type { Sql } from "../pg-store.ts";

export const keysMigrationDefinition = (): string => KEYS_DDL;
export async function installKeys(sql: Sql): Promise<string> {
  await sql.query(KEYS_DDL);
  return "encrypted keys storage";
}
