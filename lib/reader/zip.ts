import { isWellFormedZip, type ZctaCentroid, type ZipResolution } from "../geo/zcta-core.ts";
import { beginReaderZip, discardReaderZipStart } from "./bootstrap.ts";

export { isWellFormedZip };

const CACHE_MS = 30_000;
const locations = new Map<string, { promise: Promise<ZipResolution>; expires: number }>();

function validLocation(value: unknown, zip: string): value is ZctaCentroid {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<ZctaCentroid>;
  return point.zip === zip && typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lng === "number" && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
    && (point.postal === undefined || point.postal !== null && typeof point.postal === "object"
      && typeof point.postal.state === "string" && /^[A-Z]{2}$/.test(point.postal.state)
      && typeof point.postal.place === "string" && typeof point.postal.county === "string");
}

/** The arriving HTML can finish this exact lookup before the reader hydrates. */
export function readyReaderZip(zip: string): ZctaCentroid | undefined {
  const early = typeof window === "undefined" ? undefined : window.__readerStart;
  return early?.zip === zip && early.expires > Date.now() && validLocation(early.value, zip) ? early.value : undefined;
}

/** Typed and restored ZIPs read the imported place map. */
export function resolveReaderZip(input: string): Promise<ZipResolution> {
  if (!isWellFormedZip(input)) return Promise.resolve({ ok: false, reason: "malformed" });
  const zip = input.trim();
  const held = locations.get(zip);
  if (held && held.expires > Date.now()) return held.promise;
  let started: Promise<ZctaCentroid | null> | null = null;
  const promise = (async (): Promise<ZipResolution> => {
    started = beginReaderZip(zip);
    if (started) {
      const location = await started;
      if (location === null) return { ok:false,reason:"uncovered" };
      if (validLocation(location, zip)) return { ok:true,centroid:location };
      throw new Error("Invalid ZIP location response");
    }
    const response = await fetch(`/api/location/zip?zip=${zip}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`ZIP lookup failed: ${response.status}`);
    const payload = await response.json() as { location?: unknown };
    if (!("location" in payload)) throw new Error("Invalid ZIP location response");
    const point = payload.location;
    if (point === undefined || point === null) return { ok: false, reason: "uncovered" };
    if (validLocation(point, zip)) return { ok: true, centroid: point };
    throw new Error("Invalid ZIP location response");
  })().then(result => {
    if (locations.get(zip)?.promise === promise) {
      if (result.ok) locations.set(zip, { promise, expires: Date.now() + CACHE_MS });
      else { locations.delete(zip); discardReaderZipStart(zip,started); }
    }
    return result;
  }).catch(error => {
    if (locations.get(zip)?.promise === promise) locations.delete(zip);
    discardReaderZipStart(zip,started);
    throw error;
  });
  locations.set(zip, { promise, expires: Infinity });
  return promise;
}

export async function lookupReaderZip(input: string): Promise<ZctaCentroid | null> {
  const result = await resolveReaderZip(input);
  return result.ok ? result.centroid : null;
}
