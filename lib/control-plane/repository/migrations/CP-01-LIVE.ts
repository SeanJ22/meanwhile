import { OWNER_LEASE_RENEWAL_DDL } from "../owner-lease-changes.ts";
import type { Sql } from "../pg-store.ts";

export const ownerLiveMigrationDefinition = (): string => OWNER_LEASE_RENEWAL_DDL;
export async function expandOwnerLive(sql: Sql): Promise<string> {
  await sql.query(OWNER_LEASE_RENEWAL_DDL);
  return "live lease renewals keep their small deadline checks";
}
