/** A local election office is a contact, never an assertion of a polling place. */
export const LOCAL_ELECTION_OFFICE_FIELDS = ["office", "address", "phone", "email", "hours", "website", "pollingPlaceLookup"] as const;
export type LocalElectionOfficeField = typeof LOCAL_ELECTION_OFFICE_FIELDS[number];

export interface LocalElectionOfficeSource {
  readonly sourceUrl: string;
  readonly publisher: string;
  readonly quote: string;
  readonly checkedAt: string;
  readonly documentHash: string;
  readonly documentUrl?: string;
  /** Exact local-page jurisdiction text when the state directory does not link a website. */
  readonly jurisdictionQuote?: string;
  /** Explicit state-directory heading applying to every listed office. */
  readonly directoryWide?: true;
}

export interface LocalElectionOfficeExcludedMunicipality {
  readonly divisionId: string;
  readonly name: string;
  readonly municipalityType?: "TOWN" | "CITY" | "VILLAGE" | "TOWNSHIP";
}

export interface LocalElectionOffice {
  readonly id: string;
  readonly state: string;
  readonly divisionId: string;
  readonly countyFips?: string;
  readonly countyName?: string;
  readonly town?: string;
  readonly municipalityType?: "TOWN" | "CITY" | "VILLAGE" | "TOWNSHIP";
  readonly countySubdivisionGeoid?: string;
  readonly excludedMunicipalities?: readonly LocalElectionOfficeExcludedMunicipality[];
  readonly office: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly hours?: string;
  readonly website?: string;
  readonly pollingPlaceLookup?: string;
  /** State election authority's own published directory establishing this office. */
  readonly directoryUrl: string;
  /** The directory's exact county/town row; shared headings do not replace this binding. */
  readonly directorySource?: LocalElectionOfficeSource;
  /** The directory's printed county/town label, before its exact reference-id join. */
  readonly directoryJurisdiction?: string;
  readonly checkedAt: string;
  readonly fields: Partial<Readonly<Record<LocalElectionOfficeField, LocalElectionOfficeSource>>>;
}

export interface LocalElectionOfficeBlank {
  readonly id: string;
  readonly divisionId: string;
  readonly officeId?: string;
  readonly field: LocalElectionOfficeField | "directory";
  readonly reason: string;
  readonly sourceUrl?: string;
  readonly status: "OPEN" | "UNPUBLISHED";
}

export interface LocalElectionOfficeFile {
  readonly formatVersion: 1;
  readonly state: string;
  readonly checkedAt: string;
  readonly offices: readonly LocalElectionOffice[];
  readonly blanks?: readonly LocalElectionOfficeBlank[];
}

export function assertLocalElectionOfficeFile(value: LocalElectionOfficeFile): void {
  if (value?.formatVersion !== 1 || !/^[A-Z]{2}$/.test(value.state) || !Array.isArray(value.offices) || !Number.isFinite(Date.parse(value.checkedAt))) throw new Error("Local election-office projection is invalid.");
  const ids = new Set<string>();
  for (const office of value.offices) {
    const prefix = `ocd-division/country:us/${value.state === "DC" ? "district" : "state"}:${value.state.toLowerCase()}`;
    if (!office.id || ids.has(office.id) || office.state !== value.state || !office.office?.trim() || !(office.divisionId === prefix || office.divisionId.startsWith(`${prefix}/`)) || !/^https?:\/\//.test(office.directoryUrl) || !Number.isFinite(Date.parse(office.checkedAt))) throw new Error(`Local election-office identity is invalid: ${office.id}.`);
    ids.add(office.id);
    for (const excluded of office.excludedMunicipalities ?? []) {
      if (!excluded.name?.trim() || !excluded.divisionId.startsWith(`${prefix}/`) || !/\/(?:place|cousub):/.test(excluded.divisionId)) throw new Error(`Local election-office municipal exclusion is invalid: ${office.id}.`);
    }
    for (const field of LOCAL_ELECTION_OFFICE_FIELDS) {
      const fact = office[field], source = office.fields[field];
      if (fact === undefined) {
        if (source !== undefined) throw new Error(`Local election-office source has no value: ${office.id}/${field}.`);
        continue;
      }
      if (!fact.trim() || !source?.quote?.trim() || !source.publisher?.trim() || !/^https?:\/\//.test(source.sourceUrl) || !/^[a-f0-9]{64}$/.test(source.documentHash) || !Number.isFinite(Date.parse(source.checkedAt))) throw new Error(`Local election-office fact has no saved source: ${office.id}/${field}.`);
      if (["website", "pollingPlaceLookup"].includes(field) && !/^https?:\/\//.test(fact)) throw new Error(`Local election-office link is invalid: ${office.id}/${field}.`);
    }
  }
}
