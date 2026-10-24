import { withPlaceMapReads } from "../place-map/reader.ts";
import { withReaderRoute, withReaderSelection, type ReaderSelection } from "../db/reader-route.ts";

export function readerRoute<A extends unknown[], R>(path: string, read: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => withReaderRoute(path, () => withPlaceMapReads(async () => {
    const { selection } = await selectionForReader(args);
    return withReaderSelection(selection, () => read(...args));
  }));
}
async function selectionForReader(args: readonly unknown[]): Promise<{
  selection: ReaderSelection | undefined;
}> {
  const keys = new Set<string>();
  let lat: number | undefined, lng: number | undefined, zip: string | undefined;
  let question: string | undefined;
  let governmentWindow: readonly [number, number] | undefined;
  const collect = (value: unknown, field = "") => {
    if (typeof value === "string") {
      if (field === "question") question = value;
      if (field === "lat" && value.trim()) lat = Number(value);
      if ((field === "lng" || field === "lon") && value.trim()) lng = Number(value);
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
  let zipPlace: import("../place-map/reader.ts").PlaceEntry | null | undefined;
  let exactPoint: import("../place-map/reader.ts").PlaceEntry | undefined;
  if (zip) {
    const { readZipPlace, readPointPlace } = await import("../place-map/reader.ts");
    zipPlace = await readZipPlace(zip);
    if ([...keys].some(key => /^state:[A-Z]{2}$/.test(key)) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!)<=90 && Math.abs(lng!)<=180) {
      exactPoint = await readPointPlace(lat!,lng!);
      if (!exactPoint.states?.some(state => zipPlace?.states?.includes(state))) { keys.delete(zip); zip = undefined; }
    }
    if (zip) for (const state of zipPlace?.states ?? []) keys.add(`state:${state}`);
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
    const { resolveZipLocation } = await import("../place-map/locations.ts");
    const resolved = await resolveZipLocation(zip);
    if (resolved.ok) { lat = resolved.centroid.lat; lng = resolved.centroid.lng; }
  }
  let point: readonly [number, number] | undefined, divisions: readonly string[] | undefined;
  let place: import("../place-map/reader.ts").PlaceEntry | undefined;
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180) {
    point = [lng!, lat!];
    if (zip) {
      const { readZipPlace } = await import("../place-map/reader.ts");
      place = zipPlace ?? await readZipPlace(zip) ?? undefined;
      divisions = place?.ids ?? [];
    } else {
      const { readPointPlace } = await import("../place-map/reader.ts");
      place = exactPoint ?? await readPointPlace(lat!, lng!);
      divisions = place.ids;
    }
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
    ? { keys, states: place?.states?.length ? place.states : states, ...(place ? { place } : {}), ...(zip ? { zip } : {}), ...(point ? { point } : {}), ...(divisions ? { divisions } : {}), ...(governmentWindow ? { governmentWindow } : {}) } : undefined;
  return { selection };
}
