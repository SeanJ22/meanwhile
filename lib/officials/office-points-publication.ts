import { POST } from "../../app/api/geocode/route.ts";
import { CENSUS_GEOCODER_URL } from "../geo/census-geocoder.ts";
import { isOfficeStreetAddress, type OfficePoint } from "../map/office-locator.ts";
import { parseOfficeAddress } from "./member-offices.ts";
import type { DirectoryOffice } from "./directory.ts";
import type { OfficeholderSet } from "./types.ts";

export interface PublishedOfficePoint extends OfficePoint {
  readonly address: string;
  readonly sourceUrl: string;
}
export type OfficePointResolver = (address: string) => Promise<OfficePoint | null>;
const resolvePoint: OfficePointResolver = async address => {
  const response = await POST(new Request("https://meanwhileusa.com/api/geocode", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }),
  }));
  const value = await response.json() as { match?: boolean; lat: number; lng: number };
  return value.match ? { lat: value.lat, lng: value.lng } : null;
};
const valid = (point: OfficePoint | null | undefined): point is OfficePoint => !!point
  && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
export const publicOfficeAddress = (office: Pick<DirectoryOffice, "address" | "city" | "state" | "zip">) =>
  office.address?.trim() ? [office.address, [office.city, [office.state, office.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";

/** Saved with the office, before hashing and publishing. A later run reuses points for the exact same public address. */
export function officePointPublisher(prior: readonly PublishedOfficePoint[] = [], resolve: OfficePointResolver = resolvePoint) {
  const held = new Map<string, Promise<PublishedOfficePoint | null>>(prior.filter(point => valid(point)).map(point => [point.address, Promise.resolve(point)]));
  return (address: string): Promise<PublishedOfficePoint | null> => {
    if (!address || !isOfficeStreetAddress(address)) return Promise.resolve(null);
    const found = held.get(address);
    if (found) return found;
    const read = resolve(address).then(point => valid(point) ? { ...point, address, sourceUrl: CENSUS_GEOCODER_URL } : null)
      .catch(() => null);
    // Only this publication shares in-flight reads; the published record holds successful results across runs.
    held.set(address, read);
    return read.then(point => {
      if (!point) console.error("Public office point unavailable at publication", { address });
      return point;
    });
  };
}

export async function publishRosterOfficePoints(roster: OfficeholderSet, prior: OfficeholderSet | null, resolve?: OfficePointResolver): Promise<OfficeholderSet> {
  const address = (office: NonNullable<OfficeholderSet["officeholders"][number]["offices"]>[number]) => publicOfficeAddress(parseOfficeAddress(office.address ?? ""));
  const offices = [...roster.officeholders, ...(prior?.officeholders ?? [])].flatMap(holder => holder.offices ?? []);
  const locate = officePointPublisher(offices.flatMap(office => office.geocodedPoint?.address === address(office) ? [office.geocodedPoint] : []), resolve);
  return { ...roster, officeholders: await Promise.all(roster.officeholders.map(async holder => !holder.offices?.length ? holder : {
    ...holder, offices: await Promise.all(holder.offices.map(async office => {
      const point = await locate(address(office));
      const { geocodedPoint: _previous, ...sourceOffice } = office;
      return { ...sourceOffice, ...(point ? { geocodedPoint: point } : {}) };
    })),
  })) };
}

export async function publishDirectoryOfficePoints(offices: readonly DirectoryOffice[], prior: readonly DirectoryOffice[] = [], resolve?: OfficePointResolver): Promise<DirectoryOffice[]> {
  const locate = officePointPublisher([...offices, ...prior].flatMap(office =>
    office.geocodedPoint?.address === publicOfficeAddress(office) ? [office.geocodedPoint] : []), resolve);
  return Promise.all(offices.map(async office => {
    if (office.lat !== null && office.lng !== null && valid({lat:office.lat,lng:office.lng})) return office;
    const point = await locate(publicOfficeAddress(office));
    const { geocodedPoint: _previous, ...sourceOffice } = office;
    return { ...sourceOffice, ...(point ? { geocodedPoint: point } : {}) };
  }));
}
