import type { JurisdictionRouteHints, OfficialSiteHint, RouteHint } from "../hunt/meetings-route-hints.ts";
import { isDoorRecord, normalizeHost, upsertDerivedDoor, type DoorDraft, type DoorRecord, type DoorRepository } from "./registry.ts";

export const ROUTE_HINTS_KIND = "route-hints";
export const routeHintsDoorId = (jurisdictionId: string): string => `route-hints:${jurisdictionId}`;

const routeKey = (index: number): string => `route:${String(index).padStart(2, "0")}`;

export function routeHintDoorDraft(hints: JurisdictionRouteHints): DoorDraft {
  const urls = [hints.officialSite?.origin, ...hints.routes.map((route) => route.url)].filter((url): url is string => typeof url === "string");
  const hosts = [...new Set(urls.flatMap((url) => normalizeHost(url) ?? []))].sort();
  return {
    doorId: routeHintsDoorId(hints.jurisdictionId),
    kind: ROUTE_HINTS_KIND,
    ocdId: null,
    bodyIds: [],
    hosts,
    config: {
      jurisdictionId: hints.jurisdictionId,
      ...(hints.officialSite === null ? {} : { officialSite: JSON.stringify(hints.officialSite) }),
      ...Object.fromEntries(hints.routes.map((route, index) => [routeKey(index), JSON.stringify(route)])),
    },
    holds: ["route-hints"],
    checkEveryMinutes: null,
    notes: "Where this government's meetings are already known to be. The discovery walk tries these first; being listed never makes a route a find.",
    status: "OPEN",
    readNow: false,
  };
}

function parse<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function routeHintsFromDoor(door: DoorRecord): JurisdictionRouteHints | null {
  if (door.kind !== ROUTE_HINTS_KIND || door.status !== "OPEN") return null;
  const jurisdictionId = door.config.jurisdictionId;
  if (typeof jurisdictionId !== "string") return null;
  const officialSite = door.config.officialSite === undefined ? null : parse<OfficialSiteHint>(door.config.officialSite);
  if (door.config.officialSite !== undefined && officialSite === null) return null;
  const routes: RouteHint[] = [];
  for (const key of Object.keys(door.config).filter((k) => k.startsWith("route:")).sort()) {
    const route = parse<RouteHint>(door.config[key]);
    if (route === null) return null;
    routes.push(route);
  }
  return { jurisdictionId, officialSite, routes };
}

export async function seedRouteHintDoors(input: {
  readonly repo: DoorRepository;
  readonly hints: readonly JurisdictionRouteHints[];
  readonly deriveInputAt: string;
  readonly at: string;
}): Promise<{ created: number; updated: number; unchanged: number; keptManualEdit: number; refused: readonly string[] }> {
  const counts = { created: 0, updated: 0, unchanged: 0, keptManualEdit: 0 };
  const refused: string[] = [];
  for (const hints of input.hints) {
    const draft = routeHintDoorDraft(hints);
    try {
      const result = await upsertDerivedDoor(input.repo, draft, input.deriveInputAt, input.at);
      if (result === "kept-manual-edit") counts.keptManualEdit += 1;
      else counts[result] += 1;
    } catch (error) {
      refused.push(`${draft.doorId}: ${(error as Error).message}`);
    }
  }
  return { ...counts, refused };
}

export async function readRouteHints(repo: DoorRepository, jurisdictionId: string,
  learned: readonly RouteHint[] = []): Promise<readonly JurisdictionRouteHints[]> {
  const row = await repo.read(routeHintsDoorId(jurisdictionId));
  if (row && (!isDoorRecord(row.value) || row.value.kind !== ROUTE_HINTS_KIND)) throw new Error(`Unreadable route hints for ${jurisdictionId}`);
  if (row && row.value.status !== "OPEN") return [];
  const stored = row ? routeHintsFromDoor(row.value) : null;
  if (row && (!stored || stored.jurisdictionId !== jurisdictionId)) throw new Error(`Unreadable route hints for ${jurisdictionId}`);
  const routes = [...(stored?.routes ?? [])];
  for (const route of learned) if (!routes.some(existing => existing.url === route.url)) routes.push(route);
  return stored || routes.length ? [{ jurisdictionId, officialSite: stored?.officialSite ?? null, routes }] : [];
}
