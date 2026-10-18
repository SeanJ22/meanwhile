import { isWellFormedZip, type ZctaCentroid, type ZipResolution } from "../geo/zcta-core.ts";

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

/** Typed and restored ZIPs use the server's resident national shelf. */
export function resolveReaderZip(input: string): Promise<ZipResolution> {
  if (!isWellFormedZip(input)) return Promise.resolve({ ok: false, reason: "malformed" });
  const zip = input.trim();
  const held = locations.get(zip);
  if (held && held.expires > Date.now()) return held.promise;
  const promise = (async (): Promise<ZipResolution> => {
    const response = await fetch(`/api/location/zip?zip=${zip}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`ZIP lookup failed: ${response.status}`);
    const payload = await response.json() as { resolution?: ZipResolution; location?: unknown };
    const resolution = payload.resolution;
    if (resolution?.ok === false && resolution.reason === "uncovered") return resolution;
    if (resolution?.ok === true && validLocation(resolution.centroid, zip)) return resolution;
    // A browser and its function can straddle a deploy; the former route sent
    // the same sourced place under location without the additive resolution.
    if (resolution === undefined && Object.hasOwn(payload, "location")) {
      if (payload.location === null) return { ok: false, reason: "uncovered" };
      if (validLocation(payload.location, zip)) return { ok: true, centroid: payload.location };
    }
    throw new Error("Invalid ZIP location response");
  })().then(result => {
    if (locations.get(zip)?.promise === promise) {
      if (result.ok) locations.set(zip, { promise, expires: Date.now() + CACHE_MS });
      else locations.delete(zip);
    }
    return result;
  }).catch(error => {
    if (locations.get(zip)?.promise === promise) locations.delete(zip);
    throw error;
  });
  locations.set(zip, { promise, expires: Infinity });
  return promise;
}

export async function lookupReaderZip(input: string): Promise<ZctaCentroid | null> {
  const result = await resolveReaderZip(input);
  return result.ok ? result.centroid : null;
}
