import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { expansionScopesOf } from "../control-plane/expansion/scopes.ts";
import { resolveScopes } from "../control-plane/expansion/runner-load.ts";
import { loadPublishedLookupState } from "../census-geography/reader.ts";
import { admittedHuntSourceScopes } from "../civic-data/hunt-source-tasks.ts";
import { nationalPlaceSendRequests } from "../hunt/place-source-task.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../control-plane/scheduler/research-policy.ts";
import type { FecDistrict } from "./fec-targets.ts";

/** The same saved Send resolution/admission used by place-source-admission; no new Send or hunt is started. */
export async function readFecSendDistricts(now: string): Promise<readonly FecDistrict[]> {
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("FEC_SEND_SCOPE_STORE_UNAVAILABLE");
  const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
  const intents = readIntents([...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))]);
  if (intents.runnerPause.paused) return [];
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (!row) return [];
  if (!isAdminConfig(row.value)) throw new Error("FEC_SEND_SCOPE_CONFIG_UNREADABLE");
  const saved = expansionScopesOf(row.value);
  if (saved.malformed) throw new Error("FEC_SEND_SCOPE_DECISIONS_UNREADABLE");
  const sends = saved.scopes.filter(scope => scope.sourceWorkVersion === 1);
  if (!sends.length) return [];
  const published = await loadPublishedLookupState({ bypassCache: true });
  const resolved = admittedHuntSourceScopes((await resolveScopes(sends, published, null)).scopes, now);
  const zips = resolved.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.zctas] : []);
  const admitted = nationalPlaceSendRequests(resolved, zips, now);
  const districts = new Map<string, FecDistrict>();
  for (const zip of admitted.keys()) {
    const membership = await published.lookup.groupingsForZcta(zip);
    if (membership.status.kind !== "OK") throw new Error("FEC_SENT_DISTRICTS_UNRESOLVED");
    for (const { geography } of membership.memberships) {
      if (geography.type !== "congressional_district") continue;
      const district = /\/cd:([^/]+)$/.exec(geography.ocdId ?? "")?.[1];
      if (!geography.stateAbbr || !district) throw new Error("FEC_SENT_DISTRICT_IDENTITY_UNRESOLVED");
      const value = { state: geography.stateAbbr, district: district === "at-large" ? "00" : district.padStart(2, "0") };
      districts.set(`${value.state}:${value.district}`, value);
    }
  }
  return [...districts.values()];
}
