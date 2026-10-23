import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readStateReaderEntry } from "../civic-data/state-reader-store.ts";
import type { VotingReaderPlace } from "../ballot/voting-answer.ts";
import { assertLocalElectionOfficeFile, type LocalElectionOffice, type LocalElectionOfficeFile } from "../sources/local-election-offices/model.ts";
import { localElectionOfficesScope } from "../sources/local-election-offices/targets.ts";

export type { LocalElectionOffice, LocalElectionOfficeFile } from "../sources/local-election-offices/model.ts";

const key = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[._'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const countyKey = (value: string) => key(value).replace(/\s+(?:county|parish|borough|census area|municipality)$/, "");
type MunicipalityKind = "township" | "town" | "city" | "village";

/** Municipal type is identity: Adams city and Adams town have different clerks. */
function municipality(value: string, declaredKind?: string): { name: string; kind?: string } {
  const text = key(value);
  const prefix = /^(township|town|city|village) of (.+)$/.exec(text);
  const suffix = /^(.+) (township|town|city|village)$/.exec(text);
  const kind = declaredKind?.toLowerCase();
  return { name: prefix && (!kind || prefix[1] === kind) ? prefix[2] : suffix && (!kind || suffix[2] === kind) ? suffix[1] : text,
    kind: kind ?? prefix?.[1] ?? suffix?.[2] };
}

function countyMatches(office: LocalElectionOffice, place: Pick<VotingReaderPlace, "countyFips" | "countyNames">): boolean {
  if (office.countyFips && place.countyFips.length) return place.countyFips.includes(office.countyFips);
  if (office.countyName && place.countyNames?.length) return place.countyNames.some(name => countyKey(name) === countyKey(office.countyName!));
  return !office.countyFips && !office.countyName;
}

function officeMunicipality(office: LocalElectionOffice) {
  const identity = municipality(office.town ?? "", office.municipalityType);
  const divisionName = /\/(?:place|cousub):([^/]+)$/.exec(office.divisionId)?.[1]?.replaceAll("_", " ");
  return { ...identity, kind: identity.kind ?? (divisionName ? municipality(divisionName).kind : undefined) };
}

function excludesMunicipality(office: LocalElectionOffice, place: VotingReaderPlace): boolean {
  return (office.excludedMunicipalities ?? []).some(exclusion => {
    if (place.divisionIds.includes(exclusion.divisionId)) return true;
    const nativeName = key(exclusion.name), kind = exclusion.municipalityType?.toLowerCase();
    return place.towns.some(name => {
      if (key(name) === nativeName) return true;
      if (!kind) return false;
      if (key(name) === key(`${kind} of ${exclusion.name}`)) return true;
      if (key(name) !== key(`${exclusion.name} ${kind}`)) return false;
      // Census supplies a full municipal name and sometimes its bare proper name.
      // A bare "Kansas City" cannot be reinterpreted as the city named "Kansas".
      if (place.towns.some(other => key(other) === key(`${name} ${kind}`))) return false;
      return place.point !== null;
    });
  });
}

/** County matching never chooses by a bare name across state lines. */
export function localElectionOfficesForCounty(file: LocalElectionOfficeFile, county: string): LocalElectionOffice[] {
  return file.offices.filter(office => office.state.toUpperCase() === file.state.toUpperCase() && !office.town &&
    (/^\d{5}$/.test(county) ? office.countyFips === county : !!office.countyName && countyKey(office.countyName) === countyKey(county)));
}

/** A bare town name only resolves when the held county has one municipality with that name. */
export function localElectionOfficesForTown(file: LocalElectionOfficeFile, town: string, county?: string, municipalityType?: MunicipalityKind | Uppercase<MunicipalityKind>): LocalElectionOffice[] {
  const wanted = municipality(town, municipalityType);
  const candidates = file.offices.flatMap(office => {
    if (office.state.toUpperCase() !== file.state.toUpperCase() || !office.town) return [];
    if (county && !(/^\d{5}$/.test(county) ? office.countyFips === county : !!office.countyName && countyKey(office.countyName) === countyKey(county))) return [];
    const identity = officeMunicipality(office);
    const literalNativeName = !municipalityType && key(town) === key(office.town);
    const canonicalNativeName = identity.name === key(town) && (!municipalityType || identity.kind === municipalityType.toLowerCase());
    const nativeName = literalNativeName || canonicalNativeName;
    return nativeName || identity.name === wanted.name && (!wanted.kind || identity.kind === wanted.kind) ? [{ office, canonicalNativeName, literalNativeName, kind: identity.kind }] : [];
  });
  // Prefer the proper name "Kansas City" over interpreting its last word as a city-kind suffix.
  const canonicalMatches = candidates.filter(candidate => candidate.canonicalNativeName);
  const literalMatches = candidates.filter(candidate => candidate.literalNativeName);
  const selected = canonicalMatches.length ? canonicalMatches : literalMatches.length ? literalMatches : candidates;
  const identities = new Set(selected.map(({ office, kind }) => `${office.countySubdivisionGeoid ?? office.divisionId}:${kind ?? ""}`));
  return identities.size === 1 ? selected.map(candidate => candidate.office) : [];
}

/** Request-local geography selects held offices; it never sends the address to another publisher. */
export function localElectionOfficesForPlace(file: LocalElectionOfficeFile, place: VotingReaderPlace): LocalElectionOffice[] {
  const state = file.state.toUpperCase();
  if (!place.states.some(value => value.toUpperCase() === state)) return [];
  const inState = file.offices.filter(office => office.state.toUpperCase() === state);
  const selected = inState.filter(office => {
    if (excludesMunicipality(office, place)) return false;
    if (office.town && (office.countyFips || office.countyName) && !countyMatches(office, place)) return false;
    const localDivision = office.town ? /\/(?:place|cousub):/.test(office.divisionId) : /\/county:/.test(office.divisionId) || state === "DC";
    if (localDivision && place.divisionIds.includes(office.divisionId)) return true;
    if (!office.town) return !!(office.countyFips || office.countyName) && countyMatches(office, place);
    if (office.countySubdivisionGeoid && place.countySubdivisionGeoids.length)
      return place.countySubdivisionGeoids.includes(office.countySubdivisionGeoid);
    if (!countyMatches(office, place)) return false;
    return place.towns.some(name => {
      const matches = localElectionOfficesForTown(file, name, office.countyFips ?? office.countyName);
      return matches.some(match => match.id === office.id);
    });
  });
  const unique = [...new Map(selected.map(office => [office.id, office])).values()];
  return unique.some(office => office.town) ? unique.filter(office => office.town) : unique;
}

/** Only one state's live data is loaded; routine updates need no code release. */
export async function readLocalElectionOffices(state: string, options: PromotedCivicDataReadOptions = {}, timeoutMs = 1800): Promise<CivicDataReadResult<LocalElectionOfficeFile>> {
  const scope = localElectionOfficesScope(state);
  const query = options.store || options.edge ? null : readerQuery(timeoutMs);
  const edge = query ? await readStateReaderEntry(async (text, params) => (await query([{ text, params }]))[0], "CURATED_READER_RECORD", scope) : undefined;
  const read = await readPromotedCivicData<LocalElectionOfficeFile>("CURATED_READER_RECORD", scope, { ...options, ...(edge ? { edge } : {}) });
  if (read.kind === "PROMOTED") {
    assertLocalElectionOfficeFile(read.value);
    if (read.value.state.toUpperCase() !== state.toUpperCase()) throw new Error(`Local election-office state does not match its published scope: ${state}.`);
  }
  return read;
}
