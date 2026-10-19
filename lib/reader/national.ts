import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToReaders } from "node:timers/promises";
import { readPromotedCivicDataBatch, CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { readCanonicalShelf } from "./canonical.ts";
import { peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { REGISTRY_STATES, requireRegistryState } from "../civic-data/state-scopes.ts";
import { readPeopleSourceProjection } from "../civic-data/people-source-read.ts";
import { federalDirectoryScope, federalDirectoryProjectionIssues, type FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { ZipDivisionEntry } from "../geo/zip-division-index.ts";
import { postalArea, postalTable } from "../geo/postal.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";
import { readerMemory, serverReaderValue } from "./memory.ts";
import { indexedZipDivisionEntry } from "../geo/zip-division-index.ts";
export { readerMemory } from "./memory.ts";

export interface NationalShelf {
  readonly congress: FederalDirectoryReadModel;
  readonly federalByState: ReadonlyMap<string, FederalDirectoryReadModel>;
  readonly president: OfficeholderSet | null;
  readonly zipPlaces: ReadonlyMap<string, ZipDivisionEntry>;
  readonly version: string;
}

type ZipShard = { divisions: string[]; zips: Record<string, number[]>; partial: Record<string, number[]>; zipSamples: Record<string, number> };
const stateZipPlaces = serverReaderValue("state-zip-places", () => ({ value: new Map<string, ReadonlyMap<string, ZipDivisionEntry>>() }));

/** A place lookup reads its ZIP shard and postal alias, without opening the national index. */
export async function readZipPlace(zip: string): Promise<ZipDivisionEntry | null> {
  const own = await indexedZipDivisionEntry(zip), area = postalArea(zip);
  if (own && (!area || area.type === "standard")) return own;
  const baseZip = area?.zcta ?? zip;
  // Match the national reader's postal pass: an earlier alias already has its postal restrictions.
  const order = serverReaderValue("postal-order", () => new Map(Object.keys(postalTable()).map((value, index) => [value, index])));
  const earlier = (order.get(baseZip) ?? Infinity) < (order.get(zip) ?? Infinity);
  const entry = baseZip === zip ? own : earlier ? await readZipPlace(baseZip) : await indexedZipDivisionEntry(baseZip);
  if (!entry) return own;
  if (area && area.type !== "standard") {
    const ids = entry.ids.filter(isTownOrCountyDivision);
    return { ids, partial: ids.filter(id => id.split("/").length > 3), samples: 0 };
  }
  return own ?? entry;
}

export const readZipPlaces = serverReaderValue("zip-places", () => readerMemory(async (): Promise<ReadonlyMap<string, ZipDivisionEntry>> => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", "index.json"), "utf8")) as { statesToShards: Record<string, string[]> };
  const names = [...new Set(Object.values(manifest.statesToShards).flat())].sort();
  const shards = await Promise.all(names.map(async name => {
    if (!/^\d{2}$/.test(name)) throw new Error("ZIP_PLACE_SHARD_INVALID");
    return JSON.parse(await readFile(join(process.cwd(), "data", "derived", "zip-divisions", `${name}.json`), "utf8")) as ZipShard;
  }));
  const out = new Map<string, ZipDivisionEntry>();
  const byState = new Map<string, Map<string, ZipDivisionEntry>>();
  const divisionState = (id: string) => /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1].toUpperCase() ?? "";
  const touchedStates = (ids: readonly string[]) => [...new Set(ids.map(divisionState).filter(Boolean))];
  const put = (zip: string, entry: ZipDivisionEntry, states: readonly string[]) => {
    const prior = out.get(zip);
    if (prior) for (const previous of touchedStates(prior.ids)) if (!states.includes(previous)) byState.get(previous)?.delete(zip);
    out.set(zip, entry);
    for (const state of states) {
      let entries = byState.get(state);
      if (!entries) { entries = new Map(); byState.set(state, entries); }
      entries.set(zip, entry);
    }
  };
  for (const shard of shards) {
    const partialDivision = shard.divisions.map(id => !/^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?$/.test(id));
    const divisionStates = shard.divisions.map(divisionState);
    for (const zip in shard.zips) {
      const refs = shard.zips[zip];
      const ids: string[] = [], partial: string[] = [], states: string[] = [];
      for (const index of refs) {
        const id = shard.divisions[index];
        ids.push(id);
        if (partialDivision[index]) partial.push(id);
        const state = divisionStates[index];
        if (state && !states.includes(state)) states.push(state);
      }
      put(zip, { ids, partial, samples: shard.zipSamples[zip] ?? 0 }, states);
    }
    // Build the resident table without blocking HTML and place requests behind the whole country.
    await yieldToReaders();
  }
  const postal = postalTable();
  let postalCount = 0;
  for (const zip in postal) {
    if (++postalCount % 512 === 0) await yieldToReaders();
    const row = postal[zip];
    const base = out.get(row[3] ?? zip);
    if (!base) continue;
    if (row[2] !== "standard") {
      const ids = base.ids.filter(isTownOrCountyDivision);
      put(zip, { ids, partial: ids.filter(id => id.split("/").length > 3), samples: 0 }, touchedStates(ids));
    } else if (!out.has(zip)) put(zip, base, touchedStates(base.ids));
  }
  stateZipPlaces.value = byState;
  return out;
}, Number.POSITIVE_INFINITY));

/** Each ZIP belongs to every state its held places touch, including cross-state and postal aliases. */
export async function readStateZipPlaces(input: string): Promise<ReadonlyMap<string, ZipDivisionEntry>> {
  const state = requireRegistryState(input.replace(/^US-/i,""));
  await readZipPlaces();
  return stateZipPlaces.value.get(state) ?? new Map<string, ZipDivisionEntry>();
}

export function stateForZip(zip: string): string | null {
  return /^\d{5}$/.test(zip) ? postalArea(zip)?.state || null : null;
}

/** A historical President remains retrievable without being presented as the current holder. */
export function currentPresidentRoster(roster: OfficeholderSet): OfficeholderSet | null {
  const countryLinks = roster.divisions.filter(link => link.ocdId === "ocd-division/country:us");
  const currentIds = new Set(countryLinks.filter(link => {
    const holder = roster.officeholders.find(person => person.id === link.officeholderId);
    return holder && (!link.membershipId || holder.memberships?.find(membership => membership.id === link.membershipId)?.current !== false);
  }).map(link => link.officeholderId));
  const officeholders = roster.officeholders.filter(holder => currentIds.has(holder.id) && /^President(?: of the United States)?$/i.test(holder.officeTitle));
  if (!officeholders.length) return null;
  const ids = new Set(officeholders.map(holder => holder.id));
  return { ...roster, officeholders, divisions: countryLinks.filter(link => ids.has(link.officeholderId)), unmatched: roster.unmatched.filter(row => ids.has(row.officeholderId)) };
}

/** The national roster is deliberately resident in each server, independent of runner publication copies. */
const national = serverReaderValue("national-current", () => ({ value: null as NationalShelf | null }));
export const currentNationalShelf = (): NationalShelf | null => national.value;

/** A state needs the President immediately, independently of Congress's national directory load. */
export const readNationalPresident = serverReaderValue("national-president", () => readerMemory(async (): Promise<OfficeholderSet | null> => {
  const sources = ["statewide-executive-sources", "wikidata-people"];
  const canonical = await readCanonicalShelf(sources.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope("US", source) })));
  const reads = await Promise.all(sources.map(source => readPeopleSourceProjection("US", source, { store: canonical })));
  const president = reads.flatMap(read => {
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return [];
    const roster = currentPresidentRoster(read.value.roster);
    return roster ? [roster] : [];
  })[0] ?? null;
  if (national.value) national.value = { ...national.value, president };
  return president;
}));

export const readNationalShelf = serverReaderValue("national", () => readerMemory(async (): Promise<NationalShelf> => {
  const [canonical, places, president] = await Promise.all([
    readCanonicalShelf(REGISTRY_STATES.map(state => ({ recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) }))),
    readZipPlaces(),
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
    currentMembershipComplete: values.every(value => value.currentMembershipComplete === true),
    roster: { ...first.roster, scope: "us", officeholders: values.flatMap(value => value.roster.officeholders), divisions: values.flatMap(value => value.roster.divisions), unmatched: values.flatMap(value => value.roster.unmatched) },
    directory: { ...first.directory, counts: {}, byMember: Object.assign({}, ...values.map(value => value.directory.byMember)), committees: Object.assign({}, ...values.map(value => value.directory.committees)) },
  };
  return national.value = { congress, federalByState, president, zipPlaces: places, version: versions.join("|") };
}));
