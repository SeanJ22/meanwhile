export { PEOPLE_SOURCE_DEFINITIONS, type PeopleSourceId, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";
export { acquireLegiscanPeople, normalizeLegiscanPeople, currentLegiscanSessions } from "./legiscan.ts";
export { acquireCongressMembers, normalizeCongressMember } from "./congress.ts";
export { acquireGovinfoDirectory, normalizeGovinfoMember } from "./govinfo.ts";
export { acquireWikidataPeople, normalizeWikidataPeople, wikidataPeopleQuery, acquireWikidataPortraitLicense, discoverWikidataIdentifierProperties, WIKIDATA_IDENTIFIER_PROPERTIES } from "./wikidata.ts";
export { acquireLegislatureRosters, normalizeOfficialLegislaturePage, legislatureRosterLinks } from "./legislature.ts";
import type { PeopleAcquisitionOptions, PeopleSourceRelease } from "./common.ts";
import { acquireLegiscanPeople } from "./legiscan.ts";
import { acquireCongressMembers } from "./congress.ts";
import { acquireGovinfoDirectory } from "./govinfo.ts";
import { acquireWikidataPeople } from "./wikidata.ts";
import { acquireLegislatureRosters } from "./legislature.ts";

export async function acquirePeopleSource(options:PeopleAcquisitionOptions):Promise<PeopleSourceRelease> {
  switch(options.sourceId) {
    case "legiscan-api":return acquireLegiscanPeople(options);
    case "congress-api":return acquireCongressMembers(options);
    case "govinfo":return acquireGovinfoDirectory(options);
    case "wikidata-people":return acquireWikidataPeople(options);
    case "official-state-people":return acquireLegislatureRosters(options);
  }
}
