import { COLLISION_RADIUS, findCollisionGroups, type ScreenPoint } from "./spiderfy.ts";
import type { OfficePin, OfficeSite, OfficeTier } from "./office-pins.ts";
import type { Tier } from "../ocd/tiers.ts";

/** Offices whose pins would overlap on screen, drawn as one count pin. A lone office is a cluster of one. */
export interface OfficeCluster {
  readonly key: string;
  readonly lat: number;
  readonly lng: number;
  /** State offices first, then federal, each by owner name: the order of the ring and the fan. */
  readonly offices: readonly OfficePin[];
  readonly tiers: readonly OfficeTier[];
}

const TIER_ORDER: readonly OfficeTier[] = ["state", "national"];

/** Sites closer than the meeting pins' collision radius on screen merge into one cluster. */
export function clusterOfficeSites(
  sites: readonly OfficeSite[],
  project: (site: OfficeSite) => { x: number; y: number },
  radius: number = COLLISION_RADIUS,
): OfficeCluster[] {
  const points: ScreenPoint[] = sites.map(site => ({ key: site.id, ...project(site) }));
  const byId = new Map(sites.map(site => [site.id, site]));
  const grouped = findCollisionGroups(points, radius);
  const inGroup = new Set(grouped.flat());
  const groups = [...grouped, ...sites.filter(site => !inGroup.has(site.id)).map(site => [site.id])];
  return groups.map(ids => {
    const members = ids.map(id => byId.get(id)!);
    const offices = [...new Map(members.flatMap(site => site.offices).map(office => [office.id, office])).values()]
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      key: offices.map(office => office.id).join("|"),
      lat: members.reduce((sum, site) => sum + site.lat, 0) / members.length,
      lng: members.reduce((sum, site) => sum + site.lng, 0) / members.length,
      offices,
      tiers: TIER_ORDER.filter(tier => offices.some(office => office.tier === tier)),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

/** The split ring: one equal arc per tier present, left to right. One tier is a solid ring. */
export function ringSegments(tiers: readonly Tier[]): { tier: Tier; from: number; to: number }[] {
  return tiers.map((tier, i) => ({ tier, from: round((100 * i) / tiers.length), to: round((100 * (i + 1)) / tiers.length) }));
}

export function ringBackground(tiers: readonly Tier[]): string {
  const segments = ringSegments(tiers);
  if (segments.length === 1) return `var(--accent-${segments[0].tier})`;
  return `linear-gradient(90deg, ${segments.map(s => `var(--accent-${s.tier}) ${s.from}% ${s.to}%`).join(", ")})`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
