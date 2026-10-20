import { ADMIN_CONFIG_ID, type AdminConfig } from "./gateway/admin-config.ts";
import type { ControlPlaneRepositories, Persisted } from "./repository/types.ts";

export const RUNTIME_ADMIN_CONFIG_FIELDS = ["formatVersion", "apiFallback", "settings", "fleetSpendCeiling", "expansionScopes",
  "discoverySearch", "placeTargets", "dataSwitches", "updatedAt"] as const satisfies readonly (keyof AdminConfig)[];
export type RuntimeAdminConfigField = typeof RUNTIME_ADMIN_CONFIG_FIELDS[number];
export type RuntimeAdminConfig = Pick<AdminConfig, RuntimeAdminConfigField>;

/** Runtime policy reads never transfer retained country fix lists, briefs or
 * histories. A caller that writes the full config must use its full CAS read. */
export async function readRuntimeAdminConfig(
  repos: Pick<ControlPlaneRepositories, "adminConfig">,
  fields: readonly RuntimeAdminConfigField[] = RUNTIME_ADMIN_CONFIG_FIELDS,
): Promise<Persisted<RuntimeAdminConfig> | null> {
  const projection = Object.fromEntries(["formatVersion", "apiFallback", "updatedAt", ...fields].map(field => [field, true] as const));
  return await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, projection) as Persisted<RuntimeAdminConfig> | null;
}
