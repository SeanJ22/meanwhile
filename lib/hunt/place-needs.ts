import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { readPlaceNeeds } from "../coverage/owed-read.ts";

/** One hunter call, with a fresh Admin setting on every pass. The map owns place identity. */
export async function placeNeeds(repos: Pick<ControlPlaneRepositories, "adminConfig">, placeId: string,
  now = new Date().toISOString(), query: Query | null = factReader()) {
  if (!query) throw new Error("What we hold for this place could not be read");
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (row && !isAdminConfig(row.value)) throw new Error("What this place is owed could not be read");
  return readPlaceNeeds(query, row?.value ?? null, placeId, now);
}
