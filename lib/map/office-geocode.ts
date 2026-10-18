// Concurrent requests for the same public office share one lookup.
const points = new Map<string, Promise<{ lat: number; lng: number } | null>>();
export function officePointFor(address: string): Promise<{ lat: number; lng: number } | null> {
  const held = points.get(address);
  if (held) return held;
  const pending = fetch("/api/geocode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) })
    .then(async response => {
      if (!response.ok) return null;
      const value = await response.json() as { match?: boolean; lat?: number; lng?: number };
      return value.match && Number.isFinite(value.lat) && Number.isFinite(value.lng)
        && Math.abs(value.lat!) <= 90 && Math.abs(value.lng!) <= 180
        ? { lat: value.lat!, lng: value.lng! } : null;
    }).catch(() => null).finally(() => { if (points.get(address) === pending) points.delete(address); });
  points.set(address, pending);
  return pending;
}
