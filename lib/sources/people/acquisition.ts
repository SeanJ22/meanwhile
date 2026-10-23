export {   type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";
export {  normalizeLegiscanPeople,  } from "./legiscan.ts";
;
;
export {  normalizeWikidataPeople,     } from "./wikidata.ts";
export {  normalizeOfficialLegislaturePage,  } from "./legislature.ts";
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
