"use client";
import { useEffect, useMemo, useState } from "react";
import type { CoverageSummary } from "@/lib/registry/coverage";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { loadMemberDirectory } from "./use-member-directory";
import { officePointFor } from "@/lib/map/office-geocode";
import { bodyOffice, directoryOffices, type NamedOffice, type OfficePin } from "@/lib/map/office-pins";

/** Held public offices belong to the held coverage, independent of meeting filters. */
export function useOfficePins(coverage: CoverageSummary | null): readonly OfficePin[] {
  const requested = useMemo(() => {
    const bodies = (coverage?.bodies ?? []).flatMap(body => { const office = bodyOffice(body); return office ? [office] : []; });
    const holders = [...new Map([
      ...(coverage?.seats ?? []).flatMap(seat => seat.representatives),
      ...(coverage?.senators ?? []),
      ...(coverage?.bodies ?? []).flatMap(body => body.readerRoster?.members ?? []),
    ].filter(holder => memberDirectoryReaches(holder.id, "offices")).map(holder => [holder.id, { id: holder.id, name: holder.name }])).values()];
    return { bodies, holders };
  }, [coverage]);
  const key = JSON.stringify(requested);
  const [resolved, setResolved] = useState<{ key: string; pins: OfficePin[] }>({ key: "", pins: [] });
  useEffect(() => {
    let active = true;
    const locate = async (offices: readonly NamedOffice[]) => {
      const rows = await Promise.all(offices.map(async office => {
        const point = await officePointFor(office.address);
        return point ? { ...office, ...point } : null;
      }));
      return rows.filter((row): row is OfficePin => row !== null);
    };
    // Body pins do not wait on other owners' directory requests.
    const byId = new Map<string, OfficePin>();
    const publish = (pins: OfficePin[]) => {
      if (!active) return;
      for (const pin of pins) byId.set(pin.id, pin);
      setResolved({ key, pins: [...byId.values()] });
    };
    void locate(requested.bodies).then(publish);
    for (const holder of requested.holders) {
      void loadMemberDirectory(holder.id).then(directory => locate(directoryOffices(holder.id, holder.name, directory)))
        .then(publish).catch(() => { /* Failed directory reads are retried on the next open, never counted as no offices. */ });
    }
    return () => { active = false; };
  }, [key, requested]);
  return resolved.key === key ? resolved.pins : [];
}
