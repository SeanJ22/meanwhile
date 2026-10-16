import { withReaderRoute, withReaderSelection, type ReaderSelection } from "../db/reader-route.ts";
import type { AuthorityFamily } from "../meetings/edge-artifacts.ts";

export function readerRoute<A extends unknown[], R>(path: string, read: (...args: A) => Promise<R>,
  families: readonly AuthorityFamily[] = []): (...args: A) => Promise<R> {
  return (...args) => withReaderRoute(path, async () => {
    const selection = await selectionForReader(args);
    return withReaderSelection(selection, async () => {
      if (!families.length) return read(...args);
      const { readReaderManifest, ensureReaderAuthorityEdge } = await import("../meetings/edge-serving.ts");
      const { withReaderAuthorityEdge } = await import("../registry/runtime-edge.ts");
      const manifest = await readReaderManifest();
      const edge = manifest ? await ensureReaderAuthorityEdge(manifest, undefined, families) : null;
      return withReaderAuthorityEdge(edge, () => read(...args));
    });
  });
}
async function selectionForReader(args: readonly unknown[]): Promise<ReaderSelection | undefined> {
  const keys = new Set<string>();
  let lat: number | undefined, lng: number | undefined, zip: string | undefined;
  let governmentWindow: readonly [number, number] | undefined;
  const collect = (value: unknown, field = "") => {
    if (typeof value === "string") {
      if (/^(?:ocd-|congress:|statewide:|roster:|fec:|ballot-|legiscan:|plural:)/.test(value) ||
        ["subject", "target", "member", "meetingId", "candidate"].includes(field)) keys.add(value);
      if (field === "zip" && /^\d{5}$/.test(value)) { zip = value; keys.add(value); }
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
  if (zip && (lat === undefined || lng === undefined)) {
    const { resolveZip } = await import("../geo/zcta.ts");
    const resolved = resolveZip(zip);
    if (resolved.ok) { lat = resolved.centroid.lat; lng = resolved.centroid.lng; }
  }
  let point: readonly [number, number] | undefined, divisions: readonly string[] | undefined;
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180) {
    point = [lng!, lat!];
    const { readerDivisionIdsAt } = await import("../registry/server.ts");
    divisions = await readerDivisionIdsAt(lat!, lng!);
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
  return keys.size || point || governmentWindow
    ? { keys, ...(point ? { point, divisions } : {}), ...(governmentWindow ? { governmentWindow } : {}) } : undefined;
}
