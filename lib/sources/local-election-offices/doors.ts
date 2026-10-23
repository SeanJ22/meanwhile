import { sha256 } from "../../civic-data/candidate-builders.ts";
import { cadenceMsAt } from "../../civic-data/contracts.ts";
import { isDoorRecord, upsertDerivedDoor, type DoorDraft, type DoorRepository } from "../../doors/registry.ts";
import { LOCAL_ELECTION_OFFICES_CADENCE, localElectionOfficesContractId, requireLocalElectionOfficeState } from "./targets.ts";
import type { LocalElectionOfficeRoute } from "./routes.ts";

export const localElectionOfficeRouteIndexId = (state: string) => `local-election-offices:routes:${state.toLowerCase()}`;
export const localElectionOfficeRouteDoorId = (state: string, route: string) => `local-election-offices:route:${state.toLowerCase()}:${sha256(route).slice(0, 24)}`;

export function localElectionOfficeRouteDoor(route: LocalElectionOfficeRoute, at: string): DoorDraft {
  const state = requireLocalElectionOfficeState(route.state);
  return { doorId: localElectionOfficeRouteDoorId(state, route.id), kind: "local-election-office", ocdId: route.scope?.divisionId ?? `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`,
    hosts: [...new Set([new URL(route.url).hostname, new URL(route.directoryUrl).hostname])], holds: ["local-election-offices"],
    config: { state, contractId: localElectionOfficesContractId(state), sourceId: "local-election-offices", route: JSON.stringify(route) },
    checkEveryMinutes: cadenceMsAt({ cadence: LOCAL_ELECTION_OFFICES_CADENCE }, Date.parse(at)) / 60_000,
    notes: `${route.publisher}: local election-office contacts and office hours from ${route.url}.` };
}

/** Route settings live in the existing editable Door Registry, with one bounded index per state. */
export async function saveLocalElectionOfficeRoutes(doors: DoorRepository, state: string, routes: readonly LocalElectionOfficeRoute[], at: string): Promise<void> {
  const upper = requireLocalElectionOfficeState(state);
  const ids: string[] = [];
  for (const route of routes) {
    if (route.state !== upper) throw new Error("A local election-office route belongs to another state.");
    const draft = localElectionOfficeRouteDoor(route, at);
    await upsertDerivedDoor(doors, draft, at, at); ids.push(draft.doorId);
  }
  const config: Record<string, string | readonly string[]> = { state: upper };
  for (let at = 0; at < ids.length; at += 100) config[`routeIds${at / 100}`] = ids.slice(at, at + 100);
  await upsertDerivedDoor(doors, { doorId: localElectionOfficeRouteIndexId(upper), kind: "local-election-office-index", config, holds: ["local-election-offices"], notes: `${upper} local election-office acquisition routes.` }, at, at);
}

/** No national door scan: the child loads its one state index and named routes. */
export async function readLocalElectionOfficeRoutes(doors: DoorRepository, state: string): Promise<LocalElectionOfficeRoute[]> {
  const upper = requireLocalElectionOfficeState(state), index = await doors.read(localElectionOfficeRouteIndexId(upper));
  if (!index || !isDoorRecord(index.value) || index.value.status === "SUSPENDED") return [];
  const ids = Object.entries(index.value.config).filter(([key]) => /^routeIds\d+$/.test(key)).flatMap(([, value]) => Array.isArray(value) ? value : []);
  const result: LocalElectionOfficeRoute[] = [];
  for (const id of ids) {
    const row = await doors.read(id);
    if (!row || !isDoorRecord(row.value)) throw new Error(`Local election-office route is missing: ${id}.`);
    if (row.value.status === "SUSPENDED") continue;
    const raw = row.value.config.route;
    if (typeof raw !== "string") throw new Error(`Local election-office route settings are invalid: ${id}.`);
    const route = JSON.parse(raw) as LocalElectionOfficeRoute;
    if (route.state !== upper || !route.id || !route.url || !route.extraction?.fields) throw new Error(`Local election-office route belongs to another state or lacks extraction settings: ${id}.`);
    result.push(route);
  }
  return result;
}
