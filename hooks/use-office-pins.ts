"use client";
import { useEffect, useMemo, useState } from "react";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { loadMemberDirectory } from "./use-member-directory";
import { officePointFor } from "@/lib/map/office-geocode";
import {
  directoryOffices, officeOwners, officePinSet,
  type MapBounds, type NamedOffice, type OfficePin, type OfficePinSet, type VenuePoint,
} from "@/lib/map/office-pins";

/**
 * The reader's own representatives' district offices, independent of meeting filters. Each owner's offices
 * publish as soon as that owner's directory resolves; the view and the venues only decide which are drawn.
 */
export function useOfficePins(
  coverage: CoverageSummary | null,
  { bounds, venues }: { bounds: MapBounds | null; venues: readonly VenuePoint[] },
): OfficePinSet {
  const owners = useMemo(
    () => officeOwners(coverage).filter(owner => memberDirectoryReaches(owner.holder.id, "offices", owner.holder.state)),
    [coverage],
  );
  // State and place responses may describe the same owners with new objects.
  // Only a changed owner record should restart directory and location work.
  const key = JSON.stringify(owners);
  const [resolved, setResolved] = useState<{ key: string; pins: OfficePin[] }>({ key: "", pins: [] });
  useEffect(() => {
    let active = true;
    const owners = JSON.parse(key) as ReturnType<typeof officeOwners>;
    const locate = async (offices: readonly NamedOffice[]) => {
      const rows = await Promise.all(offices.map(async office => {
        const point = office.point ?? await officePointFor(office.address);
        return point ? { ...office, ...point } : null;
      }));
      return rows.filter((row): row is OfficePin => row !== null);
    };
    const byId = new Map<string, OfficePin>();
    const publish = (pins: OfficePin[]) => {
      if (!active || pins.length === 0) return;
      for (const pin of pins) byId.set(pin.id, pin);
      setResolved({ key, pins: [...byId.values()] });
    };
    for (const owner of owners) {
      void loadMemberDirectory(owner.holder.id, owner.holder.state).then(directory => locate(directoryOffices(owner, directory)))
        .then(publish).catch(() => { /* Failed directory reads are retried on the next open, never counted as no offices. */ });
    }
    return () => { active = false; };
  }, [key]);
  const pins = resolved.key === key ? resolved.pins : EMPTY;
  return useMemo(() => officePinSet(pins, { bounds, venues }), [pins, bounds, venues]);
}

const EMPTY: OfficePin[] = [];
