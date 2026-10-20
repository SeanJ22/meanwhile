"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoveredBody } from "@/lib/registry/coverage";
import type { Meeting } from "@/lib/sources/types";
import { isOnlineOnly } from "@/lib/meetings/online";
import type { BodyOfficeLocation } from "@/lib/meetings/venues";

import { officePointFor as pointFor } from "@/lib/map/office-geocode";

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
    const requested = JSON.parse(key) as Omit<BodyOfficeLocation, "lat" | "lng">[];
    if (requested.length === 0) return;
    void Promise.all(requested.map(async office => {
      const point = await pointFor(office.address);
      return point ? { ...office, ...point } : null;
    })).then(locations => { if (active) setResolved({ key, locations: locations.filter((value): value is BodyOfficeLocation => value !== null) }); });
    return () => { active = false; };
  }, [key]);
  return resolved.key === key ? resolved.locations : EMPTY;
}

const EMPTY: readonly BodyOfficeLocation[] = [];
