import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import { withStateRegistryFacts } from "../registry/state-composition.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { membersOfBody, earlierMembersOfBody } from "../registry/body-membership.ts";
import { rosterGapForBody } from "../registry/body-rosters.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import type { CoveredBody } from "../registry/coverage.ts";
import type { PlacePackage } from "./place-types.ts";
import type { Query } from "../facts/publish.ts";
import { shareReaderValues, expandReaderValues } from "./shared.ts";
import { topOfficesFor } from "../officials/top-offices.ts";
import type { SeatHolder } from "../officials/lookup.ts";

export type ReaderBodyRoster = NonNullable<CoveredBody["readerRoster"]>;
export type ReaderRosterRefs = Readonly<Record<string, string>>;
export type ReaderRosterPreviews = Readonly<Record<string, SeatHolder[]>>;
export const readerRosterKey = (roster: ReaderBodyRoster): string => canonicalCivicDataHash(roster, { durable: true });

/** One composed roster, including portraits and prior memberships, independent of the list. */
export function placeBodyRoster(place: PlacePackage, bodyId: string): ReaderBodyRoster {
  if (!place.registry) throw new Error("PLACE_REGISTRY_MISSING");
  const runtime = withStateRegistryFacts(place.registry, place.bodies);
  return withRegistryRuntimeProjection(runtime, [], () => projectRoster(bodyId));
}

function projectRoster(bodyId: string): ReaderBodyRoster {
  const earlierMembers = earlierMembersOfBody(bodyId), gap = rosterGapForBody(bodyId);
  return { members: membersOfBody(bodyId).members, ...(earlierMembers.length ? { earlierMembers } : {}),
    gaps: gap ? [gap] : [], officePhone: officePhoneForBody(bodyId) };
}

/** Keep only list data in ready pages. Immutable roster resources are shared across places and bodies. */
export function preparePlaceRosters(place: PlacePackage): { place: PlacePackage; rosters: Map<string, ReaderBodyRoster> } {
  if (!place.registry) return { place, rosters: new Map() };
  const rosters = new Map<string, ReaderBodyRoster>(), refs: Record<string, string> = {}, previews: Record<string, SeatHolder[]> = {};
  const runtime = withStateRegistryFacts(place.registry, place.bodies);
  withRegistryRuntimeProjection(runtime, [], () => { for (const bodyId of new Set([...runtime.registry.bodies.map(body => body.id), ...place.bodies.map(body => body.id)])) {
    const roster = projectRoster(bodyId);
    // Ask names the appointed executive; the coverage list names a town's Select Board.
    const shown = [...topOfficesFor(roster.members).filter(office => office.role === "Runs it day to day").map(office => office.holder),
      ...roster.members.filter(holder => /select\s?board/i.test(holder.officeTitle))];
    if (shown.length) previews[bodyId] = [...new Map(shown.map(holder => [holder.id, holder])).values()];
    if (place.rosterRefs) continue;
    if (!roster.members.length && !roster.earlierMembers?.length && !roster.gaps.length && !roster.officePhone) continue;
    const hash = readerRosterKey(roster);
    refs[bodyId] = hash; rosters.set(hash, roster);
  } });
  return { rosters, place: { ...place, rosterRefs: place.rosterRefs ?? refs, rosterPreviews: place.rosterPreviews ?? previews,
    registry: { ...place.registry, bodyRosters: place.registry.bodyRosters.map(roster => ({ ...roster, members: [], membershipHistory: [] })),
      rosterReaderDispositions: [], rosterPhotos: {}, officialPhotos: { photos: [] },
      officialCandidacies: { ...place.registry.officialCandidacies, rows: [] } },
    bodies: place.bodies.map(body => ({ ...body, roster: null, dispositions: [] })) } };
}

export async function savePlaceRosters(query: Query, pages: readonly PlacePackage[]): Promise<void> {
  const rosters = new Map(pages.flatMap(page => [...preparePlaceRosters(page).rosters]));
  for (const [hash, roster] of rosters) await query(`INSERT INTO reader_body_roster(hash,payload) VALUES($1,$2::jsonb)
    ON CONFLICT(hash) DO NOTHING`, [hash, JSON.stringify(shareReaderValues(roster))]);
}

export async function readBodyRoster(query: Query, hash: string): Promise<ReaderBodyRoster | null> {
  const [row] = await query("SELECT payload FROM reader_body_roster WHERE hash=$1", [hash]);
  return row ? expandReaderValues(row.payload as ReaderBodyRoster) : null;
}
