/** Parses the Census-to-NCES crosswalk CSV into a map of Census id to 7-digit NCES LEAID. */
export function censusSchoolLeaIds(csv: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of csv.split(/\r?\n/).slice(1).filter(Boolean)) {
    const fields = line.split(",");
    const kind = fields.findIndex(value => value === "INDEPENDENT" || value === "DEPENDENT");
    const leaid = kind >= 0 ? fields[kind + 1] : undefined;
    if (fields[0] && leaid && /^\d{7}$/.test(leaid)) out.set(fields[0], leaid);
  }
  return out;
}

export function censusSchoolTerritory(leaid: string | undefined, territories: ReadonlyMap<string, readonly string[]>): { zips: readonly string[]; method: string } {
  if (!leaid) return { zips: [], method: "no NCES match in the crosswalk — UNRESOLVED, a work item" };
  for (const layer of ["unsd", "elsd", "scsd"]) {
    const zips = territories.get(`${layer}:${leaid}`);
    if (zips?.length) return { zips, method: `${layer} GEOID ${leaid} via the NCES crosswalk` };
  }
  return { zips: [], method: `crosswalk gave LEAID ${leaid} but TIGER publishes no boundary for it` };
}
