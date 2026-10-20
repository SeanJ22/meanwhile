export type OfficePoint = { lat: number; lng: number };

/** Concurrent readers and the arriving ZIP share only a short, bounded public-address lookup. */
export function createOfficeLocator(fetchImpl: typeof fetch = (...args) => fetch(...args), now = Date.now) {
  const points = new Map<string, { promise: Promise<OfficePoint | null>; expires: number }>();
  return (address: string): Promise<OfficePoint | null> => {
    const held = points.get(address);
    if (held && held.expires > now()) return held.promise;
    const promise = fetchImpl("/api/geocode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) })
      .then(async response => {
        if (!response.ok) return null;
        const value = await response.json() as { match?: boolean; lat?: number; lng?: number };
        return value.match && Number.isFinite(value.lat) && Number.isFinite(value.lng)
          && Math.abs(value.lat!) <= 90 && Math.abs(value.lng!) <= 180
          ? { lat: value.lat!, lng: value.lng! } : null;
      }).catch(() => null).then(point => {
        if (points.get(address)?.promise === promise) {
          if (point) points.set(address, { promise, expires: now() + 30_000 });
          else points.delete(address);
        }
        return point;
      });
    if (points.size >= 256) points.delete(points.keys().next().value!);
    points.set(address, { promise, expires: Infinity });
    return promise;
  };
}
