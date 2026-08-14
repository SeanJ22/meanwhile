import { rosterForBody } from "../registry/body-rosters.ts";

/**
 * The body's office phone (6a): derived mechanically from the curated
 * roster — when the roster's members share one published base number (the
 * board or clerk office line, sometimes with per-member extensions), that
 * base number IS the office's published phone, cited to the same page the
 * roster cites. No number is ever minted; a body without a shared roster
 * number returns null and the card renders no phone.
 */

export interface OfficePhone {
  phone: string;
  sourceUrl: string;
  sourceOrg: string;
}

function baseNumber(phone: string): string {
  // "973-627-7200 x2081" → "973-627-7200"
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
