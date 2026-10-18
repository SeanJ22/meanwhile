import { withReaderRoute, withReaderSelection, type ReaderSelection } from "../db/reader-route.ts";
import type { AuthorityFamily } from "../meetings/edge-artifacts.ts";

export function readerRoute<A extends unknown[], R>(path: string, read: (...args: A) => Promise<R>,
  families: readonly AuthorityFamily[] = []): (...args: A) => Promise<R> {
  return (...args) => withReaderRoute(path, async () => {
    const { selection, geographyEdge } = await selectionForReader(args);
    const { withReaderAuthorityEdge } = await import("../registry/runtime-edge.ts");
    return withReaderSelection(selection, () => withReaderAuthorityEdge(geographyEdge, async () => {
      if (!families.length) return read(...args);
      const { readReaderManifest, ensureReaderAuthorityEdge } = await import("../meetings/edge-serving.ts");
      const edge = await ensureReaderAuthorityEdge(await readReaderManifest(), undefined, families);
      return withReaderAuthorityEdge(edge, () => read(...args));
    }));
  });
}
async function selectionForReader(args: readonly unknown[]): Promise<{
  selection: ReaderSelection | undefined;
  geographyEdge: import("../registry/runtime-edge.ts").ReaderAuthorityEdgeBundle | null;
}> {
  let geographyEdge: import("../registry/runtime-edge.ts").ReaderAuthorityEdgeBundle | null = null;
  const keys = new Set<string>();
  let lat: number | undefined, lng: number | undefined, zip: string | undefined;
  let question: string | undefined;
  let governmentWindow: readonly [number, number] | undefined;
  const collect = (value: unknown, field = "") => {
    if (typeof value === "string") {
      if (field === "question") question = value;
      if (/^(?:ocd-|congress:|statewide:|roster:|fec:|ballot-|legiscan:|plural:)/.test(value) ||
        ["subject", "target", "member", "meetingId", "candidate"].includes(field)) keys.add(value);
      if ((field === "zip" || field === "approximateLocation" || field === "address") && /^\d{5}$/.test(value)) { zip = value; keys.add(value); }
      const fecState = /^(?:fec:)?[HS]\d([A-Z]{2})\d{5}$/.exec(value)?.[1];
      if (fecState) keys.add(`state:${fecState}`);
      if (field === "state" && /^[A-Za-z]{2}$/.test(value)) keys.add(`state:${value.toUpperCase()}`);
    } else if (typeof value === "number") {
      if (field === "lat") lat = value;
      if (field === "lng" || field === "lon") lng = value;
    } else if (Array.isArray(value)) {
      if (field === "division") keys.add(value.join("/"));
      else for (const row of value) collect(row, field);
    } else if (value && typeof value === "object") {
      for (const [key, row] of Object.entries(value)) collect(row, key);
    }
  };
  for (const arg of args) {
    if (arg instanceof Request) {
      const url = new URL(arg.url);
      if (url.pathname === "/api/public-records" && url.searchParams.get("kind") === "governments") {
        governmentWindow = [Number(url.searchParams.get("offset") ?? 0), 50];
      }
      for (const [field, value] of url.searchParams) collect(["lat", "lng", "lon"].includes(field) ? Number(value) : value, field);
      for (const part of url.pathname.split("/")) {
        try { collect(decodeURIComponent(part)); } catch { /* The route rejects malformed paths. */ }
      }
      if (arg.method === "POST") try { collect(await arg.clone().json()); } catch { /* Invalid input is answered by the route. */ }
    } else if (arg && typeof arg === "object") {
      for (const [key, value] of Object.entries(arg)) collect(await value, key);
    }
  }
  const namedStates = question ? (await import("../ask/reader-officials.ts")).statesNamedInQuestion(question) : [];
  if (namedStates.length) {
    zip = undefined; lat = undefined; lng = undefined;
    const { registryJurisdictions } = await import("../civic-data/state-scopes.ts");
    for (const key of keys) {
      const placeState = /^state:([a-z]{2})$/i.exec(key)?.[1]?.toUpperCase();
      if (/^\d{5}$/.test(key) || (placeState && !namedStates.includes(placeState)) ||
        (key.startsWith("ocd-") && !registryJurisdictions(key).some(state => namedStates.includes(state)))) keys.delete(key);
    }
    for (const state of namedStates) keys.add(`ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`);
  }
  if (zip && (lat === undefined || lng === undefined)) {
    const { resolveZip } = await import("../geo/zcta.ts");
    const resolved = resolveZip(zip);
    if (resolved.ok) { lat = resolved.centroid.lat; lng = resolved.centroid.lng; }
  }
  let point: readonly [number, number] | undefined, divisions: readonly string[] | undefined;
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180) {
    point = [lng!, lat!];
    const { currentReaderAuthorityEdge, withReaderAuthorityEdge } = await import("../registry/runtime-edge.ts");
    geographyEdge = currentReaderAuthorityEdge();
    if (!geographyEdge) {
      const { ensureReaderAuthorityEdge } = await import("../meetings/edge-serving.ts");
      geographyEdge = await ensureReaderAuthorityEdge(null, undefined, ["census-districts"]);
    }
    divisions = await withReaderAuthorityEdge(geographyEdge, async () => {
      const { readerDivisionIdsAt } = await import("../registry/server.ts");
      return readerDivisionIdsAt(lat!, lng!);
    });
    for (const id of divisions) keys.add(id);
  }
  for (const id of [...keys]) {
    if (id.startsWith("congress:")) keys.add(id.slice(9));
    if (/^[HS]\d[A-Z]{2}\d{5}$/.test(id)) keys.add(`fec:${id}`);
    if (id.startsWith("ocd-division/")) {
      const parts = id.split("/");
      while (parts.length > 2) { parts.pop(); keys.add(parts.join("/")); }
    }
  }
  const { registryJurisdictions } = await import("../civic-data/state-scopes.ts");
  const { governmentStateOf } = await import("../registration/listings.ts");
  const states = namedStates.length ? namedStates : [...new Set([...keys].flatMap(key => {
    const explicit = /^(?:state:|statewide:)([a-z]{2})(?:\/|$)/i.exec(key)?.[1];
    return explicit ? [explicit.toUpperCase()] : registryJurisdictions(key).length ? registryJurisdictions(key) : governmentStateOf(key) ? [governmentStateOf(key)!] : [];
  }))];
  const selection = keys.size || point || governmentWindow || states.length
    ? { keys, states, ...(point ? { point } : {}), ...(divisions ? { divisions } : {}), ...(governmentWindow ? { governmentWindow } : {}) } : undefined;
  return { selection, geographyEdge };
}
