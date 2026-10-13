import { FIPS_TO_STATE } from "../../ocd/fips.ts";

export type LegislatureChamber = "lower" | "upper";

/** Each URL is an official publisher's current roster, never a mirror. */
export interface OfficialRosterTarget {
  readonly id: string;
  readonly sourceId: "official-rosters";
  readonly contractId: string;
  readonly scope: string;
  readonly jurisdiction: string;
  readonly state?: string;
  readonly publisher: string;
  readonly routes: readonly string[];
  readonly parserVersion: string;
  readonly kind: "senate" | "house" | "legislature";
  readonly chambers?: readonly LegislatureChamber[];
  readonly legislatureRoutes?: readonly { readonly url: string; readonly chamber: LegislatureChamber | "both" }[];
  readonly requests?: Readonly<Record<string, { readonly method: "POST"; readonly body?: string; readonly headers?: Readonly<Record<string, string>> }>>;
  readonly currentMarker?: { readonly url: string; readonly parserVersion: string };
}

export const SENATE_ROSTER_URL = "https://www.senate.gov/general/contact_information/senators_cfm.xml";
export const SENATE_APPOINTMENTS_URL = "https://www.senate.gov/senators/AppointedSenators.htm";
export const HOUSE_ROSTER_URL = "https://clerk.house.gov/xml/lists/MemberData.xml";
export const SENATE_SERVICE_URLS: readonly string[] = Object.values(FIPS_TO_STATE)
  .filter(state => state.prefix === "state")
  .map(state => `https://www.senate.gov/states/${state.postal}/senators.htm`);
export const OFFICIAL_FEDERAL_TARGETS: readonly OfficialRosterTarget[] = [
  { id: "official-senate-roster", contractId: "official-senate-roster", sourceId: "official-rosters", kind: "senate",
    scope: "US:official-roster:senate", jurisdiction: "US", publisher: "United States Senate",
    routes: [SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL, ...SENATE_SERVICE_URLS], parserVersion: "official-rosters/1" },
  { id: "official-house-roster", contractId: "official-house-roster", sourceId: "official-rosters", kind: "house",
    scope: "US:official-roster:house", jurisdiction: "US", publisher: "Clerk of the United States House of Representatives",
    routes: [HOUSE_ROSTER_URL], parserVersion: "official-rosters/1" },
];

type StateRoutes = readonly [state: string, publisher: string, lower: string, upper?: string];
const CURRENT_MARKERS: Readonly<Record<string, string>> = {
  SD: "https://sdlegislature.gov/api/Sessions",
  VT: "https://legislature.vermont.gov/people",
  WI: "https://docs.legis.wisconsin.gov/",
  ND: "https://ndlegis.gov/",
  WY: "https://wyoleg.gov/",
};

/** New Hampshire is acquired by its repaired native Members.txt feed. */
const STATE_ROUTES: readonly StateRoutes[] = [
  ["AL", "Alabama Legislature", "https://alison.legislature.state.al.us/graphql"],
  ["AK", "Alaska Legislature", "https://www.akleg.gov/basis/mbr_info.asp"],
  ["AZ", "Arizona State Legislature", "https://www.azleg.gov/MemberRoster/"],
  ["AR", "Arkansas General Assembly", "https://www.arkleg.state.ar.us/Legislators/List"],
  ["CA", "California Legislature", "https://www.assembly.ca.gov/assemblymembers", "https://www.senate.ca.gov/senators"],
  ["CO", "Colorado General Assembly", "https://leg.colorado.gov/legislators"],
  ["CT", "Connecticut General Assembly", "https://www.cga.ct.gov/asp/menu/hlist.asp", "https://www.cga.ct.gov/asp/menu/slist.asp"],
  ["DE", "Delaware General Assembly", "https://legis.delaware.gov/json/House/GetRepresentatives", "https://legis.delaware.gov/json/Senate/GetSenators"],
  ["FL", "Florida Legislature", "https://www.flhouse.gov/Sections/Representatives/representatives.aspx", "https://www.flsenate.gov/Senators"],
  ["GA", "Georgia General Assembly", "https://www.legis.ga.gov/api/members/list/1033"],
  ["HI", "Hawaii State Legislature", "https://www.capitol.hawaii.gov/legislature/memberpage.aspx?member=all&year=2026"],
  ["ID", "Idaho Legislature", "https://legislature.idaho.gov/house/membership/", "https://legislature.idaho.gov/senate/membership/"],
  ["IL", "Illinois General Assembly", "https://www.ilga.gov/house/", "https://www.ilga.gov/senate/"],
  ["IN", "Indiana General Assembly", "https://iga.in.gov/legislative/2026/legislators"],
  ["IA", "Iowa Legislature", "https://www.legis.iowa.gov/legislators/house", "https://www.legis.iowa.gov/legislators/senate"],
  ["KS", "Kansas Legislature", "https://www.kslegislature.gov/b2025_26/house/representatives/?per_page=all", "https://www.kslegislature.gov/b2025_26/senate/senators/?per_page=all"],
  ["KY", "Kentucky General Assembly", "https://legislature.ky.gov/Legislators/house-of-representatives", "https://legislature.ky.gov/Legislators/senate"],
  ["LA", "Louisiana Legislature", "https://house.louisiana.gov/H_Reps/H_Reps_FullInfo", "https://senate.la.gov/Senators_FullInfo"],
  ["ME", "Maine Legislature", "https://legislature.maine.gov/house/MemberProfiles/List?sort=alpha", "https://legislature.maine.gov/senate/senators/9536"],
  ["MD", "Maryland General Assembly", "https://mgaleg.maryland.gov/mgawebsite/Members/Index/house", "https://mgaleg.maryland.gov/mgawebsite/Members/Index/senate"],
  ["MA", "Massachusetts General Court", "https://malegislature.gov/Legislators/Members/House", "https://malegislature.gov/Legislators/Members/Senate"],
  ["MI", "Michigan Legislature", "https://www.house.mi.gov/AllRepresentatives", "https://senate.michigan.gov/senators/all-senators/"],
  ["MN", "Minnesota Legislature", "https://www.house.mn.gov/members/list", "https://www.senate.mn/api/members"],
  ["MS", "Mississippi Legislature", "https://www.legislature.ms.gov/legislators/representatives/", "https://www.legislature.ms.gov/legislators/senators/"],
  ["MO", "Missouri General Assembly", "https://house.mo.gov/MemberRoster.aspx", "https://www.senate.mo.gov/Senators/"],
  ["MT", "Montana Legislature", "https://bearbeta.legmt.gov/legislators/v1/legislators/search?limit=2000"],
  ["NE", "Nebraska Legislature", "https://nebraskalegislature.gov/senators/senator_list.php"],
  ["NV", "Nevada Legislature", "https://www.leg.state.nv.us/App/Legislator/A/Assembly/Current", "https://www.leg.state.nv.us/App/Legislator/A/Senate/Current"],
  ["NJ", "New Jersey Legislature / Office of Legislative Services", "https://www.njleg.state.nj.us/legislative-roster"],
  ["NM", "New Mexico Legislature", "https://www.nmlegis.gov/Members/Legislator_List?T=R", "https://www.nmlegis.gov/Members/Legislator_List?T=S"],
  ["NY", "New York Legislature", "https://nyassembly.gov/mem/", "https://www.nysenate.gov/senators-committees"],
  ["NC", "North Carolina General Assembly", "https://www.ncleg.gov/Members/MemberList/H", "https://www.ncleg.gov/Members/MemberList/S"],
  ["ND", "North Dakota Legislative Assembly", "https://ndlegis.gov/assembly/69-2025/regular/members"],
  ["OH", "Ohio General Assembly", "https://ohiohouse.gov/members/directory", "https://ohiosenate.gov/members/directory"],
  ["OK", "Oklahoma Legislature", "https://www.okhouse.gov/representatives", "https://oksenate.gov/senators"],
  ["OR", "Oregon Legislative Assembly", "https://www.oregonlegislature.gov/house/Pages/RepresentativesAll.aspx", "https://www.oregonlegislature.gov/senate/Pages/SenatorsAll.aspx"],
  ["PA", "Pennsylvania General Assembly", "https://www.palegis.us/house/members", "https://www.palegis.us/senate/members"],
  ["RI", "Rhode Island General Assembly", "https://www.rilegislature.gov/_vti_bin/Lists.asmx"],
  ["SC", "South Carolina General Assembly", "https://www.scstatehouse.gov/member.php?chamber=H", "https://www.scstatehouse.gov/member.php?chamber=S"],
  ["SD", "South Dakota Legislature", "https://sdlegislature.gov/api/SessionMembers/Session/71"],
  ["TN", "Tennessee General Assembly", "https://www.capitol.tn.gov/house/members/", "https://www.capitol.tn.gov/senate/members/"],
  ["TX", "Texas Legislature", "https://house.texas.gov/members", "https://senate.texas.gov/members.php"],
  ["UT", "Utah State Legislature", "https://le.utah.gov/data/legislators.json"],
  ["VT", "Vermont General Assembly", "https://legislature.vermont.gov/people/loadAll/2026/"],
  ["VA", "Virginia General Assembly", "https://house.vga.virginia.gov/members", "https://apps.senate.virginia.gov/Senator/index.php"],
  ["WA", "Washington State Legislature", "https://leg.wa.gov/legislators/"],
  ["WV", "West Virginia Legislature", "https://www.wvlegislature.gov/House/roster.cfm", "https://www.wvlegislature.gov/Senate1/roster.cfm"],
  ["WI", "Wisconsin Legislature", "https://docs.legis.wisconsin.gov/2025/legislators/assembly", "https://docs.legis.wisconsin.gov/2025/legislators/senate"],
  ["WY", "Wyoming Legislature", "https://wyoleg.gov/LsoService/api/Legislator/2026/H", "https://wyoleg.gov/LsoService/api/Legislator/2026/S"],
];

export const OFFICIAL_LEGISLATURE_TARGETS: readonly OfficialRosterTarget[] = STATE_ROUTES.map(([state, publisher, lower, upper]) => {
  const id = `official-legislature-${state.toLowerCase()}`;
  const legislatureRoutes: NonNullable<OfficialRosterTarget["legislatureRoutes"]> = state === "ND"
    ? Array.from({ length: 10 }, (_, page) => ({ url: page === 0 ? lower : `${lower}?page=${page}`, chamber: "both" as const }))
    : state === "NE"
    ? [{ url: lower, chamber: "upper" }]
    : upper ? [{ url: lower, chamber: "lower" }, { url: upper, chamber: "upper" }]
      : [{ url: lower, chamber: "both" }];
  return { id, sourceId: "official-rosters", contractId: id, scope: `US-${state}:official-roster:legislature-${state.toLowerCase()}`,
    jurisdiction: `US-${state}`, state, publisher, routes: legislatureRoutes.map(route => route.url),
    ...(CURRENT_MARKERS[state] ? { currentMarker: { url: CURRENT_MARKERS[state]!, parserVersion: "official-roster-current-marker/1" } } : {}),
    ...(state === "DE" ? { requests: Object.fromEntries(legislatureRoutes.map(route => [route.url, { method: "POST" as const, body: "" }])) }
      : state === "AL" ? { requests: { [lower]: { method: "POST" as const, body: JSON.stringify({ query: "query { legislativeMembers(where: { active: { eq: true }, elected: { eq: true } }) { data { id body fullName affiliation district } count } }" }), headers: { "content-type": "application/json" } } } }
        : state === "MT" ? { requests: { [lower]: { method: "POST" as const, body: JSON.stringify({ sessionIds: [2] }), headers: { "content-type": "application/json" } } } }
          : state === "RI" ? { requests: { [lower]: { method: "POST" as const,
            body: "<?xml version='1.0' encoding='utf-8'?><soap:Envelope xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'><soap:Body><GetListItems xmlns='http://schemas.microsoft.com/sharepoint/soap/'><listName>legislationInformation</listName><rowLimit>300</rowLimit></GetListItems></soap:Body></soap:Envelope>",
            headers: { "content-type": "text/xml; charset=\"utf-8\"" } } } } : {}),
    parserVersion: "official-rosters/1", kind: "legislature", chambers: state === "NE" ? ["upper"] : ["lower", "upper"], legislatureRoutes };
});

export const OFFICIAL_ROSTER_TARGETS: readonly OfficialRosterTarget[] = [...OFFICIAL_FEDERAL_TARGETS, ...OFFICIAL_LEGISLATURE_TARGETS];

export function officialLegislatureTarget(state: string): OfficialRosterTarget | undefined {
  return OFFICIAL_LEGISLATURE_TARGETS.find(target => target.state === state.toUpperCase());
}

export function officialRosterStateFips(state: string): string {
  const result = Object.entries(FIPS_TO_STATE).find(([, value]) => value.postal === state.toUpperCase() && value.prefix === "state")?.[0];
  if (!result) throw new Error(`Unknown official roster state ${state}`);
  return result;
}
