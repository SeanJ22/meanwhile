import { rosterForBody } from "../registry/body-rosters.ts";

/** A body's office phone: the base number its roster members share, cited to the roster page. Never minted. */

export interface OfficePhone {
  phone: string;
  sourceUrl: string;
  sourceOrg: string;
}

function baseNumber(phone: string): string {
  // "555-555-0100 x12" → "555-555-0100"
  return phone.replace(/\s*(x|ext\.?)\s*\d+\s*$/i, "").trim();
}

export function officePhoneForBody(bodyId: string | null): OfficePhone | null {
  const roster = rosterForBody(bodyId);
  if (!roster) return null;
  const bases = roster.members
    .map((m) => (m.phone ? baseNumber(m.phone) : null))
    .filter((p): p is string => p !== null);
  if (bases.length === 0) return null;
  // Shared = a majority of members with phones publish the same base line.
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  const [top, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  if (topCount * 2 <= bases.length) return null;
  return {
    phone: top,
    sourceUrl: roster.sourceUrl,
    sourceOrg: roster.sourceOrg,
  };
}
