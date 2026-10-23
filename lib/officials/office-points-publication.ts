import { CENSUS_GEOCODER_URL, censusGeocodeUrl, parseCensusPoint, parseCensusZip } from "../geo/census-geocoder.ts";
import { OUTBOUND_USER_AGENT } from "../geo/outbound-agent.ts";
import { isOfficeStreetAddress, type OfficePoint } from "../map/office-locator.ts";
import { parseOfficeAddress } from "./member-offices.ts";
import type { DirectoryOffice } from "./directory.ts";
import type { OfficeholderSet } from "./types.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import {createHash} from "node:crypto";
import type {ManualSourceReview} from "../civic-data/types.ts";

interface CensusOfficeEvidence { readonly body:string; readonly rawHash:string; readonly retrievedAt:string; readonly url:string }
type ResolvedOfficePoint = OfficePoint & {readonly census?:CensusOfficeEvidence};
const STREET_WORDS:Readonly<Record<string,string>>={STREET:"ST",ROAD:"RD",AVENUE:"AVE",BOULEVARD:"BLVD",DRIVE:"DR",PLACE:"PL",COURT:"CT",LANE:"LN",NORTH:"N",SOUTH:"S",EAST:"E",WEST:"W"};
const streetWords=(value:string)=>value.toUpperCase()
  .replace(/^(?:ROOM|RM\.?|SUITE|STE\.?)\s+[\w-]+\s*,\s*/,"")
  .replace(/\b(?:P\.?\s*O\.?|POST OFFICE)\s+BOX\b.*$/,"")
  .replace(/\b(?:ROOM|RM|SUITE|STE|FLOOR|FL)\b.*$/,"")
  .replace(/[^A-Z0-9]+/g," ").trim().split(" ").map(word=>STREET_WORDS[word]??word).join(" ");
/** Office mailing ZIPs can differ from a building's ZIP. Require the exact numbered street, city and state. */
function samePhysicalOffice(address:string,payload:unknown):boolean {
  const stated=parseOfficeAddress(address);
  const match=(payload as {result?:{addressMatches?:{matchedAddress?:string;addressComponents?:{city?:string;state?:string}}[]}})?.result?.addressMatches?.[0];
  const street=match?.matchedAddress?.split(",")[0];
  return !!stated.address&&!!stated.city&&!!stated.state&&!!street&&/^\d+\s/.test(streetWords(stated.address))&&
    streetWords(stated.address)===streetWords(street)&&stated.city.toUpperCase()===match?.addressComponents?.city?.toUpperCase()&&
    stated.state.toUpperCase()===match?.addressComponents?.state?.toUpperCase();
}

export interface PublishedOfficePoint extends OfficePoint {
  readonly address: string;
  readonly sourceUrl: string;
  readonly census?: CensusOfficeEvidence;
}
export interface OfficePointUnavailable {
  readonly address: string;
  readonly reason: "NO_STREET_ADDRESS" | "MAILING_ADDRESS" | "NO_MATCH" | "ZIP_MISMATCH" | "UPSTREAM_ERROR" | "UPSTREAM_TIMEOUT" | "INVALID_POINT" | `UPSTREAM_HTTP_${number}`;
}
export type OfficePointResolution = ResolvedOfficePoint | Pick<OfficePointUnavailable, "reason"> | null;
export type OfficePointResolver = (address: string) => Promise<OfficePointResolution>;
/** Public office addresses are published facts; the private home-address proxy deliberately hides failure details. */
export const resolvePublishedOfficePoint: OfficePointResolver = async address => {
  try {
    const response = await fetch(censusGeocodeUrl(address), {
      headers: {accept:"application/json", "user-agent":OUTBOUND_USER_AGENT}, signal:AbortSignal.timeout(8_000), cache:"no-store",
    });
    if (!response.ok) return {reason:`UPSTREAM_HTTP_${response.status}`};
    const body = await response.text(), payload:unknown = JSON.parse(body), point = parseCensusPoint(payload);
    if (!point) return {reason:"NO_MATCH"};
    const expectedZip = /\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?$/.exec(address)?.[1];
    if (expectedZip && expectedZip !== parseCensusZip(payload) && !samePhysicalOffice(address,payload)) return {reason:"ZIP_MISMATCH"};
    return {...point,census:{body,rawHash:createHash("sha256").update(body).digest("hex"),retrievedAt:new Date().toISOString(),url:censusGeocodeUrl(address)}};
  } catch (error) {
    return {reason:error instanceof Error && error.name === "TimeoutError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR"};
  }
};
const valid = (point: OfficePointResolution | undefined): point is OfficePoint => !!point && "lat" in point && "lng" in point
  && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
export const publicOfficeAddress = (office: Pick<DirectoryOffice, "address" | "city" | "state" | "zip">) =>
  office.address?.trim() ? [office.address, [office.city, [office.state, office.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";

/** Saved with the office, before hashing and publishing. A later run reuses points for the exact same public address. */
function officePointPublisher(prior: readonly PublishedOfficePoint[] = [], resolve: OfficePointResolver = resolvePublishedOfficePoint) {
  type Result = {geocodedPoint:PublishedOfficePoint} | {pointUnavailable:OfficePointUnavailable};
  const held = new Map<string, Promise<Result>>(prior.filter(point => valid(point)).map(point => [point.address, Promise.resolve({geocodedPoint:point})]));
  const missing = (address:string,reason:OfficePointUnavailable["reason"]):Result => ({pointUnavailable:{address,reason}});
  // Source rosters can hold thousands of offices. Bound upstream work independently of their size.
  let active = 0;
  const waiting: (()=>void)[] = [];
  const locate = async (address:string):Promise<Result> => {
    if (active >= 8) await new Promise<void>(resume=>waiting.push(resume));
    active++;
    try {
      const point = await resolve(address);
      return valid(point) ? {geocodedPoint:{...point,address,sourceUrl:(point as ResolvedOfficePoint).census?.url??CENSUS_GEOCODER_URL}}
        : missing(address,point && "reason" in point ? point.reason : point ? "INVALID_POINT" : "NO_MATCH");
    } catch { return missing(address,"UPSTREAM_ERROR"); }
    finally { active--; waiting.shift()?.(); }
  };
  return (address: string): Promise<Result> => {
    if (!address) return Promise.resolve(missing(address,"NO_STREET_ADDRESS"));
    if (!isOfficeStreetAddress(address)) return Promise.resolve(missing(address,"MAILING_ADDRESS"));
    const found = held.get(address);
    if (found) return found;
    const read = locate(address);
    // Only this publication shares in-flight reads; the published record holds successful results across runs.
    held.set(address, read);
    return read;
  };
}

export function officePointSourceReview(point:PublishedOfficePoint):ManualSourceReview | null {
  const evidence=point.census;
  if(!evidence||evidence.url!==censusGeocodeUrl(point.address)||point.sourceUrl!==evidence.url||
      !Number.isFinite(Date.parse(evidence.retrievedAt))||createHash("sha256").update(evidence.body).digest("hex")!==evidence.rawHash)return null;
  let parsed:OfficePoint|null;
  try{parsed=parseCensusPoint(JSON.parse(evidence.body));}catch{return null;}
  if(!parsed||parsed.lat!==point.lat||parsed.lng!==point.lng)return null;
  return{requestedUrl:evidence.url,finalUrl:evidence.url,publisher:"U.S. Census Bureau",sourceClass:"OFFICIAL_PUBLISHER",
    retrievedAt:evidence.retrievedAt,httpStatus:200,rawHash:evidence.rawHash,reviewOutcome:"SUPPORTED",
    reviewedEvidence:"One exact Census address match; its reply bytes and SHA-256 are retained with the saved office point."};
}

export async function publishRosterOfficePoints(roster: OfficeholderSet, prior: OfficeholderSet | null, resolve?: OfficePointResolver): Promise<OfficeholderSet> {
  const address = (office: NonNullable<OfficeholderSet["officeholders"][number]["offices"]>[number]) => publicOfficeAddress(parseOfficeAddress(office.address ?? ""));
  const offices = [...roster.officeholders, ...(prior?.officeholders ?? [])].flatMap(holder => holder.offices ?? []);
  const locate = officePointPublisher(offices.flatMap(office => office.geocodedPoint?.address === address(office) ? [office.geocodedPoint] : []), resolve);
  return { ...roster, officeholders: await Promise.all(roster.officeholders.map(async holder => !holder.offices?.length ? holder : {
    ...holder, offices: await Promise.all(holder.offices.map(async office => {
      const result = await locate(address(office));
      const { geocodedPoint: _previous, pointUnavailable: _missing, ...sourceOffice } = office;
      return { ...sourceOffice, ...result };
    })),
  })) };
}

export async function publishDirectoryOfficePoints(offices: readonly DirectoryOffice[], prior: readonly DirectoryOffice[] = [], resolve?: OfficePointResolver): Promise<DirectoryOffice[]> {
  const locate = officePointPublisher([...offices, ...prior].flatMap(office =>
    office.geocodedPoint?.address === publicOfficeAddress(office) ? [office.geocodedPoint] : []), resolve);
  return Promise.all(offices.map(async office => {
    if (office.lat !== null && office.lng !== null && valid({lat:office.lat,lng:office.lng})) return office;
    const result = await locate(publicOfficeAddress(office));
    const { geocodedPoint: _previous, pointUnavailable: _missing, ...sourceOffice } = office;
    return { ...sourceOffice, ...result };
  }));
}

export async function publishFederalDirectoryOfficePoints(model: FederalDirectoryReadModel, prior: FederalDirectoryReadModel | null = null,
  resolve?: OfficePointResolver): Promise<FederalDirectoryReadModel> {
  const roster = await publishRosterOfficePoints(model.roster, prior?.roster ?? null, resolve);
  const byMember = Object.fromEntries(await Promise.all(Object.entries(model.directory.byMember).map(async ([id, entry]) => [id, {
    ...entry, districtOffices: await publishDirectoryOfficePoints(entry.districtOffices, prior?.directory.byMember[id]?.districtOffices, resolve),
  }])));
  return {...model, roster, directory:{...model.directory, byMember}};
}
