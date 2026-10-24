"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoveredBody } from "@/lib/registry/coverage";
import type { Meeting } from "@/lib/sources/types";
import { meetingPinAddresses, type MeetingPinAddress, type MeetingPinLocation } from "@/lib/meetings/pin-location";

import { officePointFor as pointFor } from "@/lib/map/office-geocode";
import { censusAddressQuery } from "@/lib/geo/address-query";

export function useMeetingPinLocations(bodies: readonly CoveredBody[], meetings: readonly Meeting[]): readonly MeetingPinLocation[] {
  const requested = useMemo(() => {
    const byId = new Map(bodies.map(body => [body.bodyId, body]));
    return meetings.filter(meeting => !meeting.location).map(meeting => meetingPinAddresses(meeting, byId.get(meeting.bodyId ?? ""))).filter(addresses => addresses.length);
  }, [bodies, meetings]);
  const key = JSON.stringify(requested);
  const [resolved, setResolved] = useState<{ key: string; locations: MeetingPinLocation[] }>({ key: "", locations: [] });
  useEffect(() => {
    let active = true;
    const requested = JSON.parse(key) as MeetingPinAddress[][];
    if (requested.length === 0) return;
    void Promise.all(requested.map(async addresses => {
      for (const address of addresses) {
        const query = censusAddressQuery(address.address);
        if (query.length < 3 || query.length > 200) continue;
        const point = await pointFor(query);
        if (point) return { ...address, ...point };
      }
      return null;
    })).then(locations => { if (active) setResolved({ key, locations: locations.filter((value): value is MeetingPinLocation => value !== null) }); });
    return () => { active = false; };
  }, [key]);
  return resolved.key === key ? resolved.locations : EMPTY;
}

const EMPTY: readonly MeetingPinLocation[] = [];
