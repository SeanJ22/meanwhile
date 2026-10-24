export type OfficePoint = { lat: number; lng: number };

const MAILBOX_ONLY = /^\s*(?:p[\s.]*o[\s.]*box|post\s+office\s+box)(?=\s|#|\d)/i;
export const isOfficeStreetAddress = (address: string) => !MAILBOX_ONLY.test(address);

/** One slow Census request must not hold up an otherwise complete office map. */
function locateOffice(address: string, fetchImpl: typeof fetch): Promise<OfficePoint | null> {
  return new Promise(resolve => {
    const controllers = [new AbortController(), new AbortController()];
    let finished = false, started = 1, settled = 0;
    const finish = (point: OfficePoint | null, winner: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(retry);
      controllers.forEach((controller,index) => { if (index !== winner) controller.abort(); });
      resolve(point);
    };
    const read = async (index: number) => {
      let point: OfficePoint | null = null;
      try {
        const response = await fetchImpl("/api/geocode", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ address }), signal: controllers[index].signal });
        if (response.ok) {
          const value = await response.json() as { match?: boolean; lat?: number; lng?: number };
          if (value.match && Number.isFinite(value.lat) && Number.isFinite(value.lng)
            && Math.abs(value.lat!) <= 90 && Math.abs(value.lng!) <= 180) point = { lat: value.lat!, lng: value.lng! };
        }
      } catch { /* Another in-flight read can still return the sourced point. */ }
      settled++;
      if (point || settled === started) finish(point,index);
    };
    const retry = setTimeout(() => { started = 2; void read(1); }, 500);
    void read(0);
  });
}

/** Concurrent readers and the arriving ZIP share only a short, bounded public-address lookup. */
export function createOfficeLocator(fetchImpl: typeof fetch = (...args) => fetch(...args), now = Date.now) {
  const points = new Map<string, { promise: Promise<OfficePoint | null>; expires: number }>();
  const locate = (address: string): Promise<OfficePoint | null> => {
    // A postal box remains a contact address, but cannot locate a public office.
    if (!isOfficeStreetAddress(address)) return Promise.resolve(null);
    const held = points.get(address);
    if (held && held.expires > now()) return held.promise;
    const promise = locateOffice(address, fetchImpl).then(point => {
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
  return locate;
}
