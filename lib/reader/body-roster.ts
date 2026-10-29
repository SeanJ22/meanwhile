import type {RegistryRuntimeReadModel} from "../registry/runtime-data-plane.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import { withStateRegistryFacts } from "../registry/state-composition.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { membersOfBody, earlierMembersOfBody } from "../registry/body-membership.ts";
import { rosterGapForBody } from "../registry/body-rosters.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import type { CoveredBody } from "../registry/coverage.ts";
import type { PlacePackage } from "./place-types.ts";
import { topOfficesFor } from "../officials/top-offices.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import type {Query} from "../facts/publish.ts";

export type ReaderBodyRoster = NonNullable<CoveredBody["readerRoster"]>;
export type ReaderRosterRefs = Readonly<Record<string, string>>;
export type ReaderRosterPreviews = Readonly<Record<string, SeatHolder[]>>;
export type ReaderRosterIds = Readonly<Record<string, readonly string[]>>;
export const readerRosterKey = (roster: ReaderBodyRoster): string => canonicalCivicDataHash(roster, { durable: true });

const EMPTY_REGISTRY:RegistryRuntimeReadModel={formatVersion:1,registry:{generatedAt:'',bodies:[],divisions:[]},bodyRosters:[],
  rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{formatVersion:1,rule:'EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE',rows:[]},
  officialPhotos:{photos:[]},rosterPhotos:{}};

/** One composed roster, including portraits and prior memberships, independent of the list. */
export function placeBodyRoster(place: PlacePackage, bodyId: string): ReaderBodyRoster {
  const runtime = withStateRegistryFacts(place.registry??EMPTY_REGISTRY, place.bodies);
  return withRegistryRuntimeProjection(runtime, [], () => projectRoster(bodyId));
}

function projectRoster(bodyId: string): ReaderBodyRoster {
  const earlierMembers = earlierMembersOfBody(bodyId), gap = rosterGapForBody(bodyId);
  return { members: membersOfBody(bodyId).members, ...(earlierMembers.length ? { earlierMembers } : {}),
    gaps: gap ? [gap] : [], officePhone: officePhoneForBody(bodyId) };
}

/** Keep only list data in ready pages. Immutable roster resources are shared across places and bodies. */
export function preparePlaceRosters(place: PlacePackage): { place: PlacePackage; rosters: Map<string, ReaderBodyRoster> } {
  const rosters = new Map<string, ReaderBodyRoster>(), refs: Record<string, string> = {}, previews: Record<string, SeatHolder[]> = {},ids:Record<string,string[]>={};
  const runtime = withStateRegistryFacts(place.registry??EMPTY_REGISTRY, place.bodies);
  withRegistryRuntimeProjection(runtime, [], () => { for (const bodyId of new Set([...runtime.registry.bodies.map(body => body.id),...runtime.bodyRosters.map(roster=>roster.bodyId), ...place.bodies.map(body => body.id)])) {
    const roster = projectRoster(bodyId);
    ids[bodyId]=roster.members.map(member=>member.id);
    // Ask names the appointed executive; the coverage list names a town's Select Board.
    const shown = [...topOfficesFor(roster.members).filter(office => office.role === "Runs it day to day").map(office => office.holder),
      ...roster.members.filter(holder => /select\s?board/i.test(holder.officeTitle))];
    if (shown.length) previews[bodyId] = [...new Map(shown.map(holder => [holder.id, holder])).values()];
    if (!roster.members.length && !roster.earlierMembers?.length && !roster.gaps.length && !roster.officePhone) continue;
    const hash = readerRosterKey(roster);
    refs[bodyId] = hash; rosters.set(hash, roster);
  } });
  return { rosters, place: { ...place, rosterRefs: refs, rosterPreviews: previews,rosterIds:ids,
    registry: place.registry?{ ...place.registry, bodyRosters: place.registry.bodyRosters.map(roster => ({ ...roster, members: [], membershipHistory: [] })),
      rosterReaderDispositions: [], rosterPhotos: {}, officialPhotos: { photos: [] },
      officialCandidacies: { ...place.registry.officialCandidacies, rows: [] } }:null,
    bodies: place.bodies.map(body => ({ ...body, roster: null, dispositions: [] })) } };
}

/** One saved body answer, shared by the body card and its governing-division lookup. */
export async function readSavedBodyRoster(query:Query,bodyId:string):Promise<{id:string;roster:ReaderBodyRoster}|null> {
  const [entity]=await query(`SELECT e.id,e.state,p.context->'bodyRoster' AS roster FROM entity e
    LEFT JOIN place_page p ON p.place_id=e.id
    WHERE e.id=coalesce((SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=$1),$1) AND e.kind='body'`,[bodyId]);
  if(!entity)return null;
  let roster=entity.roster as ReaderBodyRoster|undefined;
  if(!roster){
    const {buildMissingPlacePages}=await import('./place-builder.ts');
    await buildMissingPlacePages([{id:String(entity.id),kind:'body',state:String(entity.state),roster:true}]);
    const [page]=await query("SELECT context->'bodyRoster' AS roster FROM place_page WHERE place_id=$1",[entity.id]);
    roster=page?.roster as ReaderBodyRoster|undefined;
  }
  if(!roster)throw new Error('PLACE_ROSTER_BUILD_NOT_SAVED');
  return {id:String(entity.id),roster};
}

