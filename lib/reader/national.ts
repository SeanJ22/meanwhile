import { AsyncLocalStorage } from "node:async_hooks";
import { readPromotedCivicDataBatch, CivicDataStoreUnavailableError, type CivicDataReadStore } from "../civic-data/read-model.ts";
import { readCanonicalShelf } from "./canonical.ts";
import { peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { readPeopleSourceProjection } from "../civic-data/people-source-read.ts";
import { federalDirectoryScope, federalDirectoryProjectionIssues, type FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { readerMemory, serverReaderValue } from "./memory.ts";
import { whiteHouseOffice } from "../officials/white-house-offices.ts";
export { readerMemory } from "./memory.ts";

export interface NationalShelf {
  readonly congress: FederalDirectoryReadModel;
  readonly federalByState: ReadonlyMap<string, FederalDirectoryReadModel>;
  readonly president: OfficeholderSet | null;
  readonly version: string;
}

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

/** The national roster is deliberately resident in each server, independent of runner publication copies. */
const national = serverReaderValue("national-current", () => ({ value: null as NationalShelf | null }));

/** States read the national executives independently of Congress's national directory load. */
const presidentSources = ["statewide-executive-sources", "wikidata-people"];
export const nationalPresidentPointers = () => presidentSources.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope("US", source) }));
const presidentContext = serverReaderValue("national-president-context", () => new AsyncLocalStorage<() => Promise<CivicDataReadStore>>());
const residentPresident = serverReaderValue("national-president", () => readerMemory(async (): Promise<OfficeholderSet | null> => {
  const supplied = presidentContext.getStore();
  const canonical = await (supplied ? supplied() : readCanonicalShelf(nationalPresidentPointers()));
  const reads = await Promise.all(presidentSources.map(source => readPeopleSourceProjection("US", source, { store: canonical })));
  const president = reads.flatMap(read => {
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return [];
    const roster = currentPresidentRoster(read.value.roster);
    return roster ? [roster] : [];
  })[0] ?? null;
  if (national.value) national.value = { ...national.value, president };
  return president;
}));

/** A state's existing batch can supply the national executives without opening another connection. */
export function readNationalPresident(store?: () => Promise<CivicDataReadStore>): Promise<OfficeholderSet | null> {
  return store ? presidentContext.run(store,residentPresident) : residentPresident();
}

export const readNationalShelf = serverReaderValue("national", () => readerMemory(async (): Promise<NationalShelf> => {
  const [canonical, president] = await Promise.all([
    readCanonicalShelf(REGISTRY_STATES.map(state => ({ recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) }))),
    readNationalPresident(),
  ]);
  const reads = await readPromotedCivicDataBatch<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", REGISTRY_STATES.map(federalDirectoryScope), { store: canonical });
  const federalByState = new Map<string, FederalDirectoryReadModel>(), versions: string[] = [];
  for (let index = 0; index < reads.length; index++) {
    const read = reads[index];
    if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") continue;
    const issues = federalDirectoryProjectionIssues(read.value);
    if (issues.length) throw new Error(`FEDERAL_SHELF_INVALID:${REGISTRY_STATES[index]}:${issues.join(",")}`);
    federalByState.set(REGISTRY_STATES[index], read.value); versions.push(read.metadata.versionId ?? read.kind);
  }
  const values = [...federalByState.values()], first = values[0];
  if (!first) throw new Error("FEDERAL_SHELF_NOT_RECORDED");
  const congress: FederalDirectoryReadModel = { ...first,
    vacancies: values.flatMap(value => value.vacancies ?? []),
    currentMembershipComplete: values.every(value => value.currentMembershipComplete === true),
    roster: { ...first.roster, scope: "us", officeholders: values.flatMap(value => value.roster.officeholders), divisions: values.flatMap(value => value.roster.divisions), unmatched: values.flatMap(value => value.roster.unmatched) },
    directory: { ...first.directory, counts: {}, byMember: Object.assign({}, ...values.map(value => value.directory.byMember)), committees: Object.assign({}, ...values.map(value => value.directory.committees)) },
  };
  return national.value = { congress, federalByState, president, version: versions.join("|") };
}));
