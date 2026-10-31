import { readPromotedCivicDataBatch, CivicDataStoreUnavailableError, type CivicDataReadStore } from "../civic-data/read-model.ts";
import { publicationVersion, readCanonicalShelf } from "./canonical.ts";
import { shelfPart } from "./shelf.ts";
import { peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { readPeopleSourceProjection } from "../civic-data/people-source-read.ts";
import { federalDirectoryScope, federalDirectoryProjectionIssues, type FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { whiteHouseOffice } from "../officials/white-house-offices.ts";
import { readStateFederalDirectory, withFederalPortraits } from "../officials/federal-directory-read-model.ts";
import { EVERYDAY_ROUTING_POINTER, readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";

/** Current national executive memberships (the President, the Vice President and the Cabinet); historical holders remain retrievable separately. */
export function currentPresidentRoster(roster: OfficeholderSet): OfficeholderSet | null {
  const byId = new Map(roster.officeholders.map(person => [person.id, person]));
  const links = roster.divisions.filter(link => {
    const holder = link.ocdId === "ocd-division/country:us" ? byId.get(link.officeholderId) : undefined;
    const membership = link.membershipId ? holder?.memberships?.find(row => row.id === link.membershipId) : undefined;
    return holder && membership?.current !== false && whiteHouseOffice(membership?.officeTitle ?? holder.officeTitle) !== null;
  });
  const ids = new Set(links.map(link => link.officeholderId));
  if (!ids.size) return null;
  return { ...roster, officeholders: roster.officeholders.filter(holder => ids.has(holder.id)), divisions: links, unmatched: roster.unmatched.filter(row => ids.has(row.officeholderId)) };
}

/** §3: a national executive is live with the seat, the holder's name and the page it came from; every other fact attaches as it is verified. */
export function liveNationalExecutiveRoster(roster: OfficeholderSet | null): OfficeholderSet | null {
  if (!roster) return null;
  const current = currentPresidentRoster(roster);
  if (!current) return null;
  const sourcePage = (url: string | null | undefined) => { try { return new URL(url ?? "").protocol === "https:"; } catch { return false; } };
  const officeholders = current.officeholders.filter(person => person.name.trim() !== "" && sourcePage(person.provenance?.sourceUrl));
  const ids = new Set(officeholders.map(person => person.id));
  return { ...current, officeholders, divisions: current.divisions.filter(link => ids.has(link.officeholderId)),
    unmatched: current.unmatched.filter(row => ids.has(row.officeholderId)) };
}

/** The President, Vice President and Cabinet are read from these sources, with their portraits. */
const presidentSources = ["statewide-executive-sources", "wikidata-people"];
const nationalPresidentPointers = () => [...presidentSources,"people-portraits"].map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope("US", source) }));

/** Reads the stored rows once, from the store given or the current one. */
export async function loadNationalPresident(store?: () => Promise<CivicDataReadStore>): Promise<OfficeholderSet | null> {
  const canonical = await Promise.resolve().then(() => store ? store() : readCanonicalShelf(nationalPresidentPointers()));
  const reads = await Promise.all([...presidentSources,"people-portraits"].map(source => readPeopleSourceProjection("US", source, { store: canonical })));
  const portraits=reads.at(-1);
  const president = reads.flatMap(read => {
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return [];
    const roster = currentPresidentRoster(portraits?.kind === "PROMOTED" ? withFederalPortraits(read.value.roster,portraits.value.roster) : read.value.roster);
    return roster ? [roster] : [];
  })[0] ?? null;
  return president;
}

/** Congress, whole and by state, as it was published. */
export interface CongressShelf {
  readonly congress: FederalDirectoryReadModel;
  readonly federalByState: ReadonlyMap<string, FederalDirectoryReadModel>;
}

/** Reads every state's stored delegation once and joins them into Congress. */
async function loadNationalCongress(): Promise<CongressShelf> {
  const canonical = await readCanonicalShelf(REGISTRY_STATES.map(state => ({ recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) })));
  const reads = await readPromotedCivicDataBatch<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", REGISTRY_STATES.map(federalDirectoryScope), { store: canonical });
  const federalByState = new Map<string, FederalDirectoryReadModel>();
  for (let index = 0; index < reads.length; index++) {
    const read = reads[index];
    if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") continue;
    const issues = federalDirectoryProjectionIssues(read.value);
    if (issues.length) throw new Error(`FEDERAL_SHELF_INVALID:${REGISTRY_STATES[index]}:${issues.join(",")}`);
    federalByState.set(REGISTRY_STATES[index], read.value);
  }
  const values = [...federalByState.values()], first = values[0];
  if (!first) throw new Error("FEDERAL_SHELF_NOT_RECORDED");
  const congress: FederalDirectoryReadModel = { ...first,
    vacancies: values.flatMap(value => value.vacancies ?? []),
    currentMembershipComplete: values.every(value => value.currentMembershipComplete === true),
    roster: { ...first.roster, scope: "us", officeholders: values.flatMap(value => value.roster.officeholders), divisions: values.flatMap(value => value.roster.divisions), unmatched: values.flatMap(value => value.roster.unmatched) },
    directory: { ...first.directory, counts: {}, byMember: Object.assign({}, ...values.map(value => value.directory.byMember)), committees: Object.assign({}, ...values.map(value => value.directory.committees)) },
  };
  return { congress, federalByState };
}

/** One state's delegation as published, or null when none is. */
async function loadFederalState(state: string): Promise<FederalDirectoryReadModel | null> {
  const store = await readCanonicalShelf([{ recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(state) }]);
  const read = await readStateFederalDirectory(state, { store });
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  return read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value : null;
}

/** The one national routing record every place shows, as published, or null when none is. */
async function loadEverydayRouting(): Promise<EverydayRoutingProjection | null> {
  const read = await readEverydayRoutingProjection({ store: await readCanonicalShelf([EVERYDAY_ROUTING_POINTER]) });
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  return read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value : null;
}

const pointerKey = (pointer: { recordClass: string; scope: string }) => `${pointer.recordClass}:${pointer.scope}`;
const president = shelfPart("president", () => publicationVersion(nationalPresidentPointers().map(pointerKey)), loadNationalPresident);
const routing = shelfPart("everyday-routing", () => publicationVersion([pointerKey(EVERYDAY_ROUTING_POINTER)]), loadEverydayRouting);
const congress = shelfPart("congress", () => publicationVersion(REGISTRY_STATES.map(state => pointerKey({ recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(state) }))), loadNationalCongress);

/** The President, Vice President and Cabinet, held in this server's memory and read again only when they are published again. */
export const nationalPresident = president.read;
const states = new Map<string, ReturnType<typeof shelfPart<FederalDirectoryReadModel | null>>>();
/** One state's House delegation and Senators, held the same way, so a card for one member never reads the whole of Congress. */
export function nationalFederalState(state: string): Promise<FederalDirectoryReadModel | null> {
  let part = states.get(state);
  if (!part) states.set(state, part = shelfPart(`federal:${state}`, () => publicationVersion([pointerKey({ recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(state) })]), () => loadFederalState(state)));
  return part.read();
}
/** The national everyday routing, held in this server's memory the same way, so no saved page carries its own copy. */
export const nationalEverydayRouting = routing.read;
/** Congress, whole and by state, held in this server's memory the same way. */
export const nationalCongress = congress.read;
