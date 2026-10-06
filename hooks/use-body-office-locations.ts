"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoveredBody } from "@/lib/registry/coverage";
import type { Meeting } from "@/lib/sources/types";
import { isOnlineOnly } from "@/lib/meetings/online";
import type { BodyOfficeLocation } from "@/lib/meetings/venues";

// Public office addresses use the existing free Census geocoder. Each address
// is read once per reader session; a failed lookup never invents a coordinate.
const points = new Map<string, Promise<{ lat: number; lng: number } | null>>();
function pointFor(address: string) {
  let pending = points.get(address);
  if (!pending) {
    pending = fetch("/api/geocode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) })
      .then(async response => {
        if (!response.ok) return null;
        const value = await response.json() as { match?: boolean; lat?: number; lng?: number };
        return value.match && Number.isFinite(value.lat) && Number.isFinite(value.lng)
          ? { lat: value.lat!, lng: value.lng! } : null;
      }).catch(() => null);
    points.set(address, pending);
  }
  return pending;
}

export function useBodyOfficeLocations(bodies: readonly CoveredBody[], meetings: readonly Meeting[]): readonly BodyOfficeLocation[] {
  const requested = useMemo(() => {
    const onlineBodies = new Set(meetings.filter(isOnlineOnly).map(meeting => meeting.bodyId));
    return bodies.filter(body => onlineBodies.has(body.bodyId) && body.officeContact?.address)
      .map(body => ({ bodyId: body.bodyId, name: body.name, address: body.officeContact!.address!, provenance: body.officeContact!.provenance }));
  }, [bodies, meetings]);
  const key = JSON.stringify(requested);
  const [resolved, setResolved] = useState<{ key: string; locations: BodyOfficeLocation[] }>({ key: "", locations: [] });
  useEffect(() => {
    let active = true;
    void Promise.all(requested.map(async office => {
      const point = await pointFor(office.address);
      return point ? { ...office, ...point } : null;
    })).then(locations => { if (active) setResolved({ key, locations: locations.filter((value): value is BodyOfficeLocation => value !== null) }); });
    return () => { active = false; };
  }, [key, requested]);
  return resolved.key === key ? resolved.locations : [];
}
